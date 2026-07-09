/**
 * GET /api/v1/dashboard/microtemas
 * Estatísticas por microtema.
 */

import { NextRequest, NextResponse } from "next/server";
import { demoData } from "@/lib/demo-data";
import { isLocalMode, getSyncedDelibs } from "@/lib/server/local-data-store";
import { computeMicrotemas } from "@/lib/server/analytics-engine";
import { isResultadoPositivo } from "@/lib/utils";
import { isDemo } from "@/lib/server/is-demo";
import { isDemoRequest } from "@/lib/server/request-guards";
import { isFinalDecisionRecord } from "@/lib/server/regulatory-documents";


export async function GET(req: NextRequest) {
  if (isDemo() || isDemoRequest(req)) {
    const agenciaId = req.nextUrl.searchParams.get("agencia_id");
    if (isLocalMode()) {
      return NextResponse.json(computeMicrotemas(getSyncedDelibs(), agenciaId));
    }
    return NextResponse.json(demoData.microtemas());
  }

  const { createSupabaseServerClient } = await import("@/lib/supabase/server");
  const db = createSupabaseServerClient();
  const agenciaId = req.nextUrl.searchParams.get("agencia_id");

  let query = db
    .from("deliberacoes")
    .select("microtema, resultado, tipo_documento, documento_pai_id, raw_extraction")
    .not("microtema", "is", null);

  if (agenciaId) query = query.eq("agencia_id", agenciaId);

  const { data, error } = await query;

  if (error) {
    return NextResponse.json({ error: "Erro ao buscar microtemas" }, { status: 500 });
  }

  const rows = (data ?? []).filter(isFinalDecisionRecord);
  const stats = new Map<string, { total: number; deferido: number; indeferido: number }>();

  for (const row of rows) {
    const tema = row.microtema!;
    if (!stats.has(tema)) stats.set(tema, { total: 0, deferido: 0, indeferido: 0 });
    const s = stats.get(tema)!;
    s.total++;
    if (isResultadoPositivo(row.resultado)) s.deferido++;
    else if (row.resultado === "Indeferido") s.indeferido++;
  }

  const result = [...stats.entries()]
    .map(([microtema, s]) => ({
      microtema,
      total: s.total,
      deferido: s.deferido,
      indeferido: s.indeferido,
      pct_deferido: s.total > 0 ? (s.deferido / s.total) * 100 : 0,
      pct_indeferido: s.total > 0 ? (s.indeferido / s.total) * 100 : 0,
    }))
    .sort((a, b) => b.total - a.total);

  return NextResponse.json(result);
}
