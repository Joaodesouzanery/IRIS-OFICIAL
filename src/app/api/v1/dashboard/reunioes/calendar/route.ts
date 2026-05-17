/**
 * GET /api/v1/dashboard/reunioes/calendar
 * Calendário de reuniões com contagem por data (heatmap).
 */

import { NextRequest, NextResponse } from "next/server";
import { demoData } from "@/lib/demo-data";
import { isLocalMode, getSyncedDelibs } from "@/lib/server/local-data-store";
import { computeReunioesCalendar } from "@/lib/server/analytics-engine";
import { isDemo } from "@/lib/server/is-demo";
import { isDemoRequest } from "@/lib/server/request-guards";
import { isFinalDecisionRecord } from "@/lib/server/regulatory-documents";


export async function GET(req: NextRequest) {
  if (isDemo() || isDemoRequest(req)) {
    const agenciaId = req.nextUrl.searchParams.get("agencia_id");
    if (isLocalMode()) {
      return NextResponse.json(computeReunioesCalendar(getSyncedDelibs(), agenciaId));
    }
    return NextResponse.json(demoData.reunioesCalendar());
  }

  const { createSupabaseServerClient } = await import("@/lib/supabase/server");
  const db = createSupabaseServerClient();
  const agenciaId = req.nextUrl.searchParams.get("agencia_id");
  const year = req.nextUrl.searchParams.get("year") ?? new Date().getFullYear().toString();

  let query = db
    .from("deliberacoes")
    .select("data_reuniao, tipo_documento, documento_pai_id, resultado, raw_extraction")
    .not("data_reuniao", "is", null)
    .gte("data_reuniao", `${year}-01-01`)
    .lte("data_reuniao", `${year}-12-31`);

  if (agenciaId) query = query.eq("agencia_id", agenciaId);

  const { data, error } = await query;

  if (error) {
    return NextResponse.json({ error: "Erro ao buscar calendário" }, { status: 500 });
  }

  const counts = new Map<string, number>();
  for (const row of (data ?? []).filter(isFinalDecisionRecord)) {
    const date = row.data_reuniao!;
    counts.set(date, (counts.get(date) ?? 0) + 1);
  }

  const result = [...counts.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, count]) => ({ date, count }));

  return NextResponse.json(result);
}
