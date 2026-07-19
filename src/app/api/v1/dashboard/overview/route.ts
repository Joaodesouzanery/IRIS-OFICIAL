/**
 * GET /api/v1/dashboard/overview
 * KPIs principais do dashboard.
 */

import { NextRequest, NextResponse } from "next/server";
import { demoData } from "@/lib/demo-data";
import { isLocalMode, getSyncedDelibs } from "@/lib/server/local-data-store";
import { computeOverview } from "@/lib/server/analytics-engine";
import { isResultadoPositivo } from "@/lib/utils";
import { isDemo } from "@/lib/server/is-demo";
import { isDemoRequest } from "@/lib/server/request-guards";
import { isFinalDecisionRecord, FINAL_DECISION_RAW_SELECT } from "@/lib/server/regulatory-documents";
import { selectAllPaged } from "@/lib/server/select-all-paged";


export async function GET(req: NextRequest) {
  const agenciaId = req.nextUrl.searchParams.get("agencia_id") || null;

  if (isDemo() || isDemoRequest(req)) {
    if (isLocalMode()) {
      return NextResponse.json(computeOverview(getSyncedDelibs(), agenciaId));
    }
    return NextResponse.json(demoData.overview(agenciaId));
  }

  const { createSupabaseServerClient } = await import("@/lib/supabase/server");
  const db = createSupabaseServerClient();

  // Paginado (PERF-4): sem isto, a agregação em JS pararia no ~1000 do PostgREST e
  // subcontaria em silêncio quando a base crescer.
  const { rows: deliberacoes, error } = await selectAllPaged(() => {
    let q = db
      .from("deliberacoes")
      .select(`id, resultado, microtema, data_reuniao, extraction_confidence, auto_classified, pauta_interna, tipo_documento, documento_pai_id, ${FINAL_DECISION_RAW_SELECT}`);
    if (agenciaId) q = q.eq("agencia_id", agenciaId);
    return q;
  }, { label: "dashboard/overview" });

  if (error) {
    return NextResponse.json({ error: "Erro ao buscar overview" }, { status: 500 });
  }

  const rows = deliberacoes.filter(isFinalDecisionRecord);
  const total = rows.length;
  const deferidos = rows.filter((r) => isResultadoPositivo(r.resultado)).length;
  const indeferidos = rows.filter((r) => r.resultado === "Indeferido").length;
  const semResultado = rows.filter((r) => !r.resultado).length;

  const confidenceRows = rows.filter((r) => r.extraction_confidence !== null);
  const avgConfidence =
    confidenceRows.length > 0
      ? confidenceRows.reduce((sum, r) => sum + (r.extraction_confidence ?? 0), 0) / confidenceRows.length
      : 0;

  const reunioesUnicas = new Set(rows.map((r) => r.data_reuniao).filter(Boolean)).size;

  const microtemaCount = new Map<string, number>();
  for (const r of rows) {
    if (r.microtema) {
      microtemaCount.set(r.microtema, (microtemaCount.get(r.microtema) ?? 0) + 1);
    }
  }
  const topMicrotema =
    microtemaCount.size > 0
      ? [...microtemaCount.entries()].sort((a, b) => b[1] - a[1])[0][0]
      : null;

  const autoClassified = rows.filter((r) => r.auto_classified).length;
  const auto_classified_pct = total > 0 ? Math.round((autoClassified / total) * 100) : 0;
  const pauta_interna_count = rows.filter((r) => r.pauta_interna).length;
  const pauta_externa = total - pauta_interna_count;

  return NextResponse.json({
    total_deliberacoes: total,
    deferidos,
    indeferidos,
    sem_resultado: semResultado,
    taxa_deferimento: total > 0 ? ((deferidos / total) * 100).toFixed(1) : "0",
    reunioes_unicas: reunioesUnicas,
    avg_confidence: avgConfidence,
    top_microtema: topMicrotema,
    auto_classified_pct,
    pauta_externa,
    pauta_interna_count,
  });
}
