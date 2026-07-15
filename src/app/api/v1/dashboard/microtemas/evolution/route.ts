/**
 * GET /api/v1/dashboard/microtemas/evolution
 * Evolução de microtemas por mês/ano.
 */

import { NextRequest, NextResponse } from "next/server";
import { demoData } from "@/lib/demo-data";
import { isLocalMode, getSyncedDelibs } from "@/lib/server/local-data-store";
import { computeMicrotemasEvolution } from "@/lib/server/analytics-engine";
import { isDemo } from "@/lib/server/is-demo";
import { isDemoRequest } from "@/lib/server/request-guards";
import { isFinalDecisionRecord, FINAL_DECISION_RAW_SELECT } from "@/lib/server/regulatory-documents";


export async function GET(req: NextRequest) {
  if (isDemo() || isDemoRequest(req)) {
    const agenciaId = req.nextUrl.searchParams.get("agencia_id");
    if (isLocalMode()) {
      return NextResponse.json(computeMicrotemasEvolution(getSyncedDelibs(), agenciaId));
    }
    return NextResponse.json(demoData.microtemasEvolution());
  }

  const { createSupabaseServerClient } = await import("@/lib/supabase/server");
  const db = createSupabaseServerClient();
  const agenciaId = req.nextUrl.searchParams.get("agencia_id");

  let query = db
    .from("deliberacoes")
    .select(`microtema, data_reuniao, tipo_documento, documento_pai_id, resultado, ${FINAL_DECISION_RAW_SELECT}`)
    .not("microtema", "is", null)
    .not("data_reuniao", "is", null)
    .order("data_reuniao", { ascending: true });

  if (agenciaId) query = query.eq("agencia_id", agenciaId);

  const { data, error } = await query;

  if (error) {
    return NextResponse.json({ error: "Erro ao buscar evolução" }, { status: 500 });
  }

  const groups = new Map<string, Map<string, number>>();

  for (const row of (data ?? []).filter(isFinalDecisionRecord)) {
    const date = new Date(row.data_reuniao!);
    const period = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
    if (!groups.has(period)) groups.set(period, new Map());
    const periodMap = groups.get(period)!;
    periodMap.set(row.microtema!, (periodMap.get(row.microtema!) ?? 0) + 1);
  }

  const result = [...groups.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([period, temas]) => ({
      period,
      ...Object.fromEntries(temas),
    }));

  return NextResponse.json(result);
}
