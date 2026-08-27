/**
 * POST /api/v1/votos/recalcular-divergencia
 * Recalcula `is_divergente` dos votos EXISTENTES de forma relativa ao resultado da
 * deliberação (abstenção sempre diverge; favorável diverge em Indeferido) — alinhando
 * o histórico à lógica nova. Também conta deliberações 100% inferidas (suspeita de
 * falsa unanimidade legada). Admin-only, idempotente, paginado.
 *
 * `?apply=1` grava as mudanças; sem ele, roda em DRY-RUN (só conta o que mudaria).
 */

import { NextRequest, NextResponse } from "next/server";
import { isDemo } from "@/lib/server/is-demo";
import { budgetFromRequest, hasBudget } from "@/lib/server/time-budget";
import { requireAdminOrCron } from "@/lib/server/request-guards";
import { repartirPorDivergencia } from "@/lib/server/vote-inference";
import { parseIntParam } from "@/lib/server/http-params";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const guard = await requireAdminOrCron(req, "votos/recalcular-divergencia"); // pipeline (passo 11) roda como cron
  if (guard) return guard;
  if (isDemo()) return NextResponse.json({ demo: true });

  const apply = req.nextUrl.searchParams.get("apply") === "1";
  const offset = parseIntParam(req.nextUrl.searchParams.get("offset"), 0, 0);
  // Fase 10 — esta rota IGNORAVA o `budget_ms` que o orquestrador manda na URL. A esteira
  // encadeia ~12 sub-rotas na MESMA invocação repartindo um orçamento único; quem não lê a
  // própria fatia trabalha até acabar e a rodada estoura o relógio — foi o "passou de 90s sem
  // resposta" que a tela mostrou. Para no saldo e DIZ que ficou parcial, para o orquestrador
  // voltar na rodada seguinte.
  const deadlineAt = Date.now() + budgetFromRequest(req);
  /** Uma deliberação: ler votos + até 3 UPDATEs em lotes de 100. */
  const RESERVA_POR_DELIBERACAO_MS = 700;

  const limit = parseIntParam(req.nextUrl.searchParams.get("limit"), 300, 1, 500);

  const { createSupabaseServerClient } = await import("@/lib/supabase/server");
  const db = createSupabaseServerClient();

  const { data: delibs, error } = await db
    .from("deliberacoes")
    // unanimidade_detectada: MESMO sinal que o buildVotoRows usa. Sem ele, este recálculo
    // rederivava is_divergente só de (tipo_voto, resultado) e reintroduzia a divergência
    // FALSA no INDEFERE-por-unanimidade (o desfecho do pleito não é divisão do colegiado).
    .select("id, resultado, unanimidade_detectada:raw_extraction->>unanimidade_detectada, votos(id, tipo_voto, is_divergente, is_nominal)")
    .order("created_at", { ascending: false })
    .order("id", { ascending: false }) // desempate estável p/ paginação por offset
    .range(offset, offset + limit - 1);

  if (error) {
    return NextResponse.json({ error: "Erro ao buscar deliberações" }, { status: 500 });
  }

  let divergenciaCorrigida = 0;
  let deliberacoesAfetadas = 0;
  let deliberacoesSoInferidas = 0;
  // Coleta os IDs por valor-alvo para atualizar em LOTE (2 queries) em vez de 1 UPDATE
  // por voto — o duplo loop podia disparar centenas de PATCHes sequenciais e estourar o tempo.
  const idsParaDivergente: string[] = [];
  const idsParaNaoDivergente: string[] = [];

  let parcial = false;
  for (const d of (delibs ?? []) as any[]) {
    if (!hasBudget(deadlineAt, RESERVA_POR_DELIBERACAO_MS)) { parcial = true; break; }
    const votos = (d.votos ?? []) as Array<{ id: string; tipo_voto: string; is_divergente: boolean; is_nominal: boolean }>;
    if (votos.length === 0) continue;
    if (votos.every((v) => !v.is_nominal)) deliberacoesSoInferidas++;

    // Etapa65 — `deriveUnanime`/`repartirPorDivergencia` são a FONTE ÚNICA desta regra; o PATCH
    // manual de `deliberacoes/[id]` usa o mesmo repartidor. Antes a regra vivia só aqui.
    const { idsDivergentes } = repartirPorDivergencia(votos, d.resultado ?? null, d.unanimidade_detectada);
    const divSet = new Set(idsDivergentes);

    let afetou = false;
    for (const v of votos) {
      const novo = divSet.has(v.id);
      if (novo !== v.is_divergente) {
        divergenciaCorrigida++;
        afetou = true;
        if (apply) (novo ? idsParaDivergente : idsParaNaoDivergente).push(v.id);
      }
    }
    if (afetou) deliberacoesAfetadas++;
  }

  if (apply) {
    // Chunk de 100 p/ não estourar o tamanho da URL do PATCH do PostgREST.
    const aplicarEmLote = async (ids: string[], valor: boolean) => {
      for (let i = 0; i < ids.length; i += 100) {
        const chunk = ids.slice(i, i + 100);
        if (chunk.length) await db.from("votos").update({ is_divergente: valor }).in("id", chunk);
      }
    };
    await aplicarEmLote(idsParaDivergente, true);
    await aplicarEmLote(idsParaNaoDivergente, false);
  }

  if (apply && deliberacoesAfetadas > 0) {
    await db.from("votos_retroativos_audit").insert({
      diretor_id: null,
      agencia_id: null,
      nome_detectado: "(recálculo de divergência relativa ao resultado)",
      deliberacoes_afetadas: deliberacoesAfetadas,
      votos_criados: 0,
      votos_ignorados_fora_mandato: 0,
      detalhe: { tipo: "recalculo_divergencia", offset, limit, votos_corrigidos: divergenciaCorrigida },
    });
  }

  const processados = (delibs ?? []).length;
  return NextResponse.json({
    // Parou no saldo: o orquestrador só volta na rodada seguinte se souber que sobrou.
    ...(parcial ? { parcial: true, restantes: true } : {}),
    modo: apply ? "aplicado" : "dry-run",
    divergencia_corrigida: divergenciaCorrigida,
    deliberacoes_afetadas: deliberacoesAfetadas,
    deliberacoes_so_inferidas: deliberacoesSoInferidas,
    processados,
    next_offset: processados === limit ? offset + limit : null,
  });
}
