/**
 * POST /api/v1/upload/confirm-lote  { ids?: string[], todos?: boolean, agencia_id?: string }
 *
 * APROVAÇÃO EM LOTE por decisão HUMANA (sem o gate conservador do auto-confirm): confirma os
 * documentos `review_pending` selecionados (ids) ou TODOS de uma vez. REUSA 100% o handler do
 * /upload/confirm (writer único) via request sintético — nada de lógica de gravação nova. O
 * próprio confirm dá o destino certo a cada tipo: docs finais viram deliberação+votos;
 * pautas/documento_apoio são marcados `ignored` (não viram deliberação, por desenho).
 * Proteções mínimas que NÃO são opinião (contadas, não derrubam o lote):
 *  - `is_duplicate` é pulado (dupla contagem) — continua na fila p/ decisão manual;
 *  - doc sem `agencia_id` é pulado (o confirm rejeitaria o lote inteiro com 400).
 * Trilha de auditoria: extraction_raw.aprovado_em_lote = true. Admin-only, demo-gated.
 */

import { NextRequest, NextResponse } from "next/server";
import { isDemo } from "@/lib/server/is-demo";
import { isDemoRequest, requireAdminOrCron } from "@/lib/server/request-guards";
import { buildConfirmDelibFromDoc } from "@/lib/server/auto-confirm";
import { isHardFailSemSinal } from "@/lib/server/consistency-checks";
import { hasBudget, budgetFromRequest } from "@/lib/server/time-budget";
import { RESERVA } from "@/lib/server/esteira-reservas";
import { POST as confirmPOST } from "../confirm/route";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
// Fase 12 — 60 → 120: esta rota honra `budget_ms`/HOBBY_BUDGET_MS (70s); declarar 60 aqui
// pediria o kill da plataforma ANTES de o próprio orçamento parar o trabalho. 120 é o valor
// que pipeline/run e o vercel.json já declaram e que os builds já provaram.
export const maxDuration = 120;

const SELECT_COLS =
  "id, status, tipo_documento, extraction_confidence, chars_per_page, is_duplicate, file_hash, agencia_id, ata_items, warnings, campos_detectados";

export async function POST(req: NextRequest) {
  if (isDemo() || isDemoRequest(req)) {
    return NextResponse.json({ error: "Aprovação em lote indisponível em modo DEMO." }, { status: 403 });
  }
  // Fase 10 — era `requireAdmin`: sob o cron diário este passo respondia 403. É o ÚNICO que
  // transforma documento em deliberação em massa, e o orquestrador nunca olhava o status HTTP,
  // então o cron reportava sucesso todo dia sem materializar uma linha.
  const guard = await requireAdminOrCron(req, "upload/confirm-lote");
  if (guard) return guard;

  const body = (await req.json().catch(() => ({}))) as { ids?: unknown; todos?: boolean; agencia_id?: string };
  const ids = Array.isArray(body.ids) ? body.ids.map(String).filter(Boolean).slice(0, 200) : [];
  const todos = body.todos === true;
  if (!todos && ids.length === 0) {
    return NextResponse.json({ error: "Informe 'ids' (até 200) ou 'todos: true'." }, { status: 400 });
  }

  const deadlineAt = Date.now() + Math.min(budgetFromRequest(req), 50_000);
  const { createSupabaseServerClient } = await import("@/lib/supabase/server");
  const db = createSupabaseServerClient();

  let query = db.from("documentos_regulatorios").select(SELECT_COLS).eq("status", "review_pending");
  if (todos) {
    query = query.order("id", { ascending: true }).limit(500);
    if (body.agencia_id) query = query.eq("agencia_id", body.agencia_id);
  } else {
    query = query.in("id", ids);
  }
  const { data: docs, error } = await query;
  if (error) return NextResponse.json({ error: "Falha ao listar documentos do lote." }, { status: 500 });

  // Arquiva um doc (Camada 4 / duplicata exata): sai da fila SEM virar deliberação; rastreável.
  // O MOTIVO fica em campos_detectados.arquivado_motivo (jsonb já existente — sem migration),
  // para a dedup/arquivamento ser auditável linha a linha (QA ago/2026).
  async function arquivar(doc: any, motivo: string, extras: Record<string, unknown> = {}) {
    await db.from("documentos_regulatorios")
      .update({
        status: "ignored",
        reviewed_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        campos_detectados: { ...(doc.campos_detectados ?? {}), arquivado_motivo: motivo },
        ...extras,
      })
      .eq("id", doc.id);
  }

  // Política zero-toque (QA ago/2026) — dedup em camadas, nada fica em beco sem saída:
  //  • Duplicata EXATA (mesmo file_hash de um doc já CONFIRMADO) → auto-ARQUIVA com link p/ o
  //    original (duplicate_documento_id/duplicate_deliberacao_id). O dado já existe; nada re-entra.
  //  • Duplicata SEMÂNTICA (mesmo nº/processo/chave — ex.: voto e ata da mesma matéria) → vai ao
  //    confirm MESMO ASSIM: findDeliberacaoExistente FUNDE na deliberação existente (idempotente;
  //    votos upsert por deliberação+diretor) → métrica nunca duplica.
  //  • Camada 4 (hard-fail): ilegível (chars/página <50) SEM nenhum campo útil, ou sem agência →
  //    auto-ARQUIVA (deliberação vazia não polui métrica). Recuperável via reprocesso no Avançado.
  let arquivadosDuplicataExata = 0;
  let fundidosSemanticos = 0;
  let arquivadosIlegiveis = 0;
  let arquivadosSemAgencia = 0;

  // Perf (QA ago/2026): a checagem de duplicata exata era 1 maybeSingle POR doc — com
  // todos:true (até 500) eram centenas de queries seriais antes de qualquer escrita.
  // Agora 1 query em lote → mapa hash→original.
  const hashesDuplicados = [...new Set(
    ((docs ?? []) as any[]).filter((d) => d.is_duplicate && d.file_hash).map((d) => String(d.file_hash)),
  )];
  const originaisPorHash = new Map<string, { id: string; deliberacao_id: string | null }>();
  if (hashesDuplicados.length > 0) {
    const { data: originais } = await db
      .from("documentos_regulatorios")
      .select("id, file_hash, deliberacao_id")
      .in("file_hash", hashesDuplicados)
      .eq("status", "confirmed");
    for (const o of (originais ?? []) as any[]) {
      if (!originaisPorHash.has(String(o.file_hash))) {
        originaisPorHash.set(String(o.file_hash), { id: o.id, deliberacao_id: o.deliberacao_id ?? null });
      }
    }
  }

  const aprovaveis: any[] = [];
  for (const doc of (docs ?? []) as any[]) {
    const fields = doc?.campos_detectados?.preview?.fields ?? {};
    const agenciaId = doc.agencia_id ?? doc?.campos_detectados?.preview?.agencia_id_detected ?? null;

    if (doc.is_duplicate && doc.file_hash) {
      // Distingue EXATA (hash bate com doc confirmado) de SEMÂNTICA.
      const candidato = originaisPorHash.get(String(doc.file_hash));
      const original = candidato && candidato.id !== doc.id ? candidato : null;
      if (original) {
        await arquivar(doc, "duplicata_exata", {
          duplicate_documento_id: original.id,
          ...(original.deliberacao_id ? { duplicate_deliberacao_id: original.deliberacao_id } : {}),
        });
        arquivadosDuplicataExata++;
        continue;
      }
      // Semântica → segue para o confirm (merge idempotente) — contada à parte.
      fundidosSemanticos++;
    }

    if (!agenciaId) {
      await arquivar(doc, "sem_agencia");
      arquivadosSemAgencia++;
      continue;
    }

    if (isHardFailSemSinal({
      charsPerPage: doc.chars_per_page,
      resultado: fields.resultado,
      numeroReuniao: fields.numero_reuniao,
      processo: fields.processo,
      dataReuniao: fields.data_reuniao,
      ataItemsCount: Array.isArray(doc.ata_items) ? doc.ata_items.length : 0,
    })) {
      await arquivar(doc, "ilegivel_sem_sinal");
      arquivadosIlegiveis++;
      continue;
    }

    aprovaveis.push(doc);
  }

  let materializados = 0;
  let ignorados = 0;
  let erros = 0;
  let processadosNoLote = 0;
  let restantes = false;
  const agora = new Date().toISOString();

  for (let i = 0; i < aprovaveis.length; i += 100) {
    if (!hasBudget(deadlineAt, RESERVA.confirmLote)) { restantes = true; break; }
    const sublote = aprovaveis.slice(i, i + 100);
    const deliberacoes = sublote.map((doc) => {
      const delib = buildConfirmDelibFromDoc(doc);
      const raw = delib.extraction_raw && typeof delib.extraction_raw === "object" ? (delib.extraction_raw as Record<string, unknown>) : {};
      return { ...delib, extraction_raw: { ...raw, aprovado_em_lote: true, aprovado_em_lote_em: agora } };
    });
    // Propaga a fatia de saldo restante ao confirm (budgetFromRequest) — sublote pesado
    // corta lá dentro em vez de estourar o SIGKILL.
    const confirmUrl = new URL("/api/v1/upload/confirm", req.url);
    confirmUrl.searchParams.set("budget_ms", String(Math.max(3_000, deadlineAt - Date.now() - 3_000)));
    const syntheticReq = new NextRequest(confirmUrl, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: req.headers.get("authorization") ?? "" },
      body: JSON.stringify({ agencia_id: body.agencia_id ?? null, deliberacoes }),
    });
    try {
      const confirmRes = await confirmPOST(syntheticReq);
      const payload = (await confirmRes.json().catch(() => ({}))) as { results?: Array<{ status?: string }>; restantes?: boolean };
      if (payload.restantes) restantes = true; // confirm cortou por orçamento — re-rodar
      for (const r of payload.results ?? []) {
        if (r.status === "created") materializados++;
        else if (r.status === "error") erros++;
        else ignorados++; // document_saved: pauta/apoio marcado ignored (por desenho)
      }
      processadosNoLote += sublote.length;
    } catch (err) {
      console.error("[upload/confirm-lote] Falha no sublote:", err);
      return NextResponse.json({
        error: "Falha ao confirmar um sublote — parte do lote pode ter sido aplicada.",
        materializados, ignorados, erros,
        arquivados_duplicata_exata: arquivadosDuplicataExata,
        arquivados_ilegiveis: arquivadosIlegiveis,
        arquivados_sem_agencia: arquivadosSemAgencia,
      }, { status: 502 });
    }
  }
  if (todos && (docs?.length ?? 0) >= 500) restantes = true;

  return NextResponse.json({
    analisados: (docs ?? []).length,
    processados: processadosNoLote,
    materializados,
    ignorados,
    erros,
    arquivados_duplicata_exata: arquivadosDuplicataExata,
    fundidos_semanticos: fundidosSemanticos,
    arquivados_ilegiveis: arquivadosIlegiveis,
    arquivados_sem_agencia: arquivadosSemAgencia,
    restantes,
    legal_notice:
      "Zero-toque: duplicata EXATA auto-arquivada com link ao original; duplicata SEMÂNTICA fundida na deliberação existente (idempotente); ilegível/sem agência auto-arquivado; pautas/apoio marcados como revisados (não viram deliberação).",
  });
}
