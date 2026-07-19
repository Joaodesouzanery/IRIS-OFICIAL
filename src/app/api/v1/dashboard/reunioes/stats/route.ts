/**
 * GET /api/v1/dashboard/reunioes/stats
 * Estatísticas de reuniões por mês.
 */

import { NextRequest, NextResponse } from "next/server";
import { demoData } from "@/lib/demo-data";
import { isLocalMode, getSyncedDelibs } from "@/lib/server/local-data-store";
import { computeReunioesStats } from "@/lib/server/analytics-engine";
import { isResultadoPositivo } from "@/lib/utils";
import { isDemo } from "@/lib/server/is-demo";
import { isDemoRequest } from "@/lib/server/request-guards";
import { isFinalDecisionRecord, FINAL_DECISION_RAW_SELECT } from "@/lib/server/regulatory-documents";
import { selectAllPaged } from "@/lib/server/select-all-paged";


export async function GET(req: NextRequest) {
  if (isDemo() || isDemoRequest(req)) {
    const agenciaId = req.nextUrl.searchParams.get("agencia_id");
    if (isLocalMode()) {
      return NextResponse.json(computeReunioesStats(getSyncedDelibs(), agenciaId));
    }
    return NextResponse.json(demoData.reunioesStats());
  }

  const { createSupabaseServerClient } = await import("@/lib/supabase/server");
  const db = createSupabaseServerClient();
  const agenciaId = req.nextUrl.searchParams.get("agencia_id");

  // Paginado (PERF-4): agregação por mês precisa ver TODAS as linhas, não parar no ~1000.
  const { rows: data, error } = await selectAllPaged(() => {
    let q = db
      .from("deliberacoes")
      .select(`data_reuniao, resultado, tipo_documento, documento_pai_id, ${FINAL_DECISION_RAW_SELECT}`)
      .not("data_reuniao", "is", null)
      .order("data_reuniao", { ascending: true });
    if (agenciaId) q = q.eq("agencia_id", agenciaId);
    return q;
  }, { label: "dashboard/reunioes/stats" });

  if (error) {
    return NextResponse.json({ error: "Erro ao buscar stats de reuniões" }, { status: 500 });
  }

  const monthStats = new Map<string, { total: number; deferido: number; indeferido: number }>();

  for (const row of data.filter(isFinalDecisionRecord)) {
    const d = new Date(row.data_reuniao!);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    if (!monthStats.has(key)) monthStats.set(key, { total: 0, deferido: 0, indeferido: 0 });
    const s = monthStats.get(key)!;
    s.total++;
    if (isResultadoPositivo(row.resultado)) s.deferido++;
    else if (row.resultado === "Indeferido") s.indeferido++;
  }

  const result = [...monthStats.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([period, s]) => ({ period, ...s }));

  return NextResponse.json(result);
}
