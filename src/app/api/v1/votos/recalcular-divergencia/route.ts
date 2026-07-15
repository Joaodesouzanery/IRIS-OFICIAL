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
import { requireAdmin } from "@/lib/server/request-guards";
import { isDivergentVote, type TipoVoto } from "@/lib/server/vote-inference";
import { parseIntParam } from "@/lib/server/http-params";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const guard = await requireAdmin(req);
  if (guard) return guard;
  if (isDemo()) return NextResponse.json({ demo: true });

  const apply = req.nextUrl.searchParams.get("apply") === "1";
  const offset = parseIntParam(req.nextUrl.searchParams.get("offset"), 0, 0);
  const limit = parseIntParam(req.nextUrl.searchParams.get("limit"), 300, 1, 500);

  const { createSupabaseServerClient } = await import("@/lib/supabase/server");
  const db = createSupabaseServerClient();

  const { data: delibs, error } = await db
    .from("deliberacoes")
    .select("id, resultado, votos(id, tipo_voto, is_divergente, is_nominal)")
    .order("created_at", { ascending: false })
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

  for (const d of (delibs ?? []) as any[]) {
    const votos = (d.votos ?? []) as Array<{ id: string; tipo_voto: string; is_divergente: boolean; is_nominal: boolean }>;
    if (votos.length === 0) continue;
    if (votos.every((v) => !v.is_nominal)) deliberacoesSoInferidas++;

    let afetou = false;
    for (const v of votos) {
      const novo = isDivergentVote(v.tipo_voto as TipoVoto, d.resultado ?? null);
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
    modo: apply ? "aplicado" : "dry-run",
    divergencia_corrigida: divergenciaCorrigida,
    deliberacoes_afetadas: deliberacoesAfetadas,
    deliberacoes_so_inferidas: deliberacoesSoInferidas,
    processados,
    next_offset: processados === limit ? offset + limit : null,
  });
}
