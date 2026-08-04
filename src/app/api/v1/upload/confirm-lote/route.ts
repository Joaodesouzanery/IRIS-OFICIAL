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
import { isDemoRequest, requireAdmin } from "@/lib/server/request-guards";
import { buildConfirmDelibFromDoc } from "@/lib/server/auto-confirm";
import { hasBudget } from "@/lib/server/time-budget";
import { POST as confirmPOST } from "../confirm/route";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

const SELECT_COLS =
  "id, status, tipo_documento, extraction_confidence, chars_per_page, is_duplicate, agencia_id, ata_items, warnings, campos_detectados";

export async function POST(req: NextRequest) {
  if (isDemo() || isDemoRequest(req)) {
    return NextResponse.json({ error: "Aprovação em lote indisponível em modo DEMO." }, { status: 403 });
  }
  const guard = await requireAdmin(req);
  if (guard) return guard;

  const body = (await req.json().catch(() => ({}))) as { ids?: unknown; todos?: boolean; agencia_id?: string };
  const ids = Array.isArray(body.ids) ? body.ids.map(String).filter(Boolean).slice(0, 200) : [];
  const todos = body.todos === true;
  if (!todos && ids.length === 0) {
    return NextResponse.json({ error: "Informe 'ids' (até 200) ou 'todos: true'." }, { status: 400 });
  }

  const deadlineAt = Date.now() + 50_000;
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

  let puladosDuplicata = 0;
  let puladosSemAgencia = 0;
  const aprovaveis: any[] = [];
  for (const doc of (docs ?? []) as any[]) {
    if (doc.is_duplicate) { puladosDuplicata++; continue; }
    const agenciaId = doc.agencia_id ?? doc?.campos_detectados?.preview?.agencia_id_detected ?? null;
    if (!agenciaId) { puladosSemAgencia++; continue; }
    aprovaveis.push(doc);
  }

  let materializados = 0;
  let ignorados = 0;
  let erros = 0;
  let processadosNoLote = 0;
  let restantes = false;
  const agora = new Date().toISOString();

  for (let i = 0; i < aprovaveis.length; i += 100) {
    if (!hasBudget(deadlineAt, 15_000)) { restantes = true; break; }
    const sublote = aprovaveis.slice(i, i + 100);
    const deliberacoes = sublote.map((doc) => {
      const delib = buildConfirmDelibFromDoc(doc);
      const raw = delib.extraction_raw && typeof delib.extraction_raw === "object" ? (delib.extraction_raw as Record<string, unknown>) : {};
      return { ...delib, extraction_raw: { ...raw, aprovado_em_lote: true, aprovado_em_lote_em: agora } };
    });
    const syntheticReq = new NextRequest(new URL("/api/v1/upload/confirm", req.url), {
      method: "POST",
      headers: { "content-type": "application/json", authorization: req.headers.get("authorization") ?? "" },
      body: JSON.stringify({ agencia_id: body.agencia_id ?? null, deliberacoes }),
    });
    try {
      const confirmRes = await confirmPOST(syntheticReq);
      const payload = (await confirmRes.json().catch(() => ({}))) as { results?: Array<{ status?: string }> };
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
        materializados, ignorados, erros, pulados_duplicata: puladosDuplicata, pulados_sem_agencia: puladosSemAgencia,
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
    pulados_duplicata: puladosDuplicata,
    pulados_sem_agencia: puladosSemAgencia,
    restantes,
    legal_notice:
      "Aprovação em lote por decisão humana (sem o gate conservador). Duplicatas e docs sem agência foram PULADOS e seguem na fila; pautas/apoio são marcados como revisados (não viram deliberação).",
  });
}
