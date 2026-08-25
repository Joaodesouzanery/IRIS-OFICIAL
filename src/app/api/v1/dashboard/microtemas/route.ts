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
import { isFinalDecisionRecord, FINAL_DECISION_RAW_SELECT , isDecidedOnMerits, juizoSelect } from "@/lib/server/regulatory-documents";
import { selectAllPaged } from "@/lib/server/select-all-paged";
import { matchesYear, applyYearFilterSql } from "@/lib/server/year-filter";


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
  // Etapa66 — projeta a COLUNA `juizo` quando ela existe (sondada uma vez por processo).
  // O filho de ata gravava a coluna e nunca o JSON, e toda rota projetava só o JSON: a
  // admissibilidade de item de ata era invisível — 13 de 320 itens no corpus, 100% deles.
  const finalSelect = await juizoSelect(db);
  const agenciaId = req.nextUrl.searchParams.get("agencia_id");
  const year = req.nextUrl.searchParams.get("year");

  // selectAllPaged: sem ele o PostgREST corta em ~1000 linhas e a agregação SUBconta em
  // silêncio (divergindo do overview, que pagina). `year` honrado (antes era ignorado).
  const { rows: data, error } = await selectAllPaged(() => {
    let query = db
      .from("deliberacoes")
      .select(`microtema, resultado, tipo_documento, documento_pai_id, data_reuniao, data_publicacao, ${finalSelect}`)
      .not("microtema", "is", null)
      .order("id", { ascending: true });
    if (agenciaId) query = query.eq("agencia_id", agenciaId);
    return applyYearFilterSql(query, year); // recorte no SQL (perf) — matchesYear segue como cinto
  }, { label: "dashboard/microtemas" });

  if (error) {
    return NextResponse.json({ error: "Erro ao buscar microtemas" }, { status: 500 });
  }

  const rows = (data ?? []).filter(isFinalDecisionRecord).filter((r: any) => matchesYear(r, year));
  const stats = new Map<string, { total: number; decidido: number; deferido: number; indeferido: number }>();

  for (const row of rows) {
    const tema = row.microtema!;
    if (!stats.has(tema)) stats.set(tema, { total: 0, decidido: 0, deferido: 0, indeferido: 0 });
    const s = stats.get(tema)!;
    s.total++;
    // Numerador e denominador no MESMO universo (etapa60).
    if (isDecidedOnMerits(row as any)) {
      s.decidido++;
      if (isResultadoPositivo(row.resultado)) s.deferido++;
      else if (row.resultado === "Indeferido") s.indeferido++;
    }
  }

  const result = [...stats.entries()]
    .map(([microtema, s]) => ({
      microtema,
      total: s.total,
      // Etapa60: `total` segue sendo o PAUTADO; os percentuais passam a dividir pelos DECIDIDOS.
      // Um microtema com muitos itens retirados de pauta tinha deferimento artificialmente baixo.
      total_decidido: s.decidido,
      deferido: s.deferido,
      indeferido: s.indeferido,
      pct_deferido: s.decidido > 0 ? (s.deferido / s.decidido) * 100 : 0,
      pct_indeferido: s.decidido > 0 ? (s.indeferido / s.decidido) * 100 : 0,
    }))
    .sort((a, b) => b.total - a.total);

  return NextResponse.json(result);
}
