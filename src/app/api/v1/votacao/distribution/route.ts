/**
 * GET /api/v1/votacao/distribution
 * Distribuição de tipos de voto (para gráfico de pizza).
 */

import { NextRequest, NextResponse } from "next/server";
import { demoData } from "@/lib/demo-data";
import { isLocalMode, getSyncedDelibs } from "@/lib/server/local-data-store";
import { computeVotacaoDistribution } from "@/lib/server/analytics-engine";
import { isDemo } from "@/lib/server/is-demo";
import { isDemoRequest } from "@/lib/server/request-guards";
import { parseVotacaoFilters, applyDeliberacaoFilters, filterDelibsForVotacao } from "@/lib/server/votacao-filters";


export async function GET(req: NextRequest) {
  const filters = parseVotacaoFilters(req.nextUrl.searchParams);

  if (isDemo() || isDemoRequest(req)) {
    if (isLocalMode()) {
      return NextResponse.json(computeVotacaoDistribution(filterDelibsForVotacao(getSyncedDelibs(), filters), filters.agenciaId));
    }
    return NextResponse.json(demoData.votacaoDistribution());
  }

  const { createSupabaseServerClient } = await import("@/lib/supabase/server");
  const db = createSupabaseServerClient();

  let query = db
    .from("votos")
    .select(`tipo_voto, diretores!inner (agencia_id), deliberacoes!inner (data_reuniao, microtema, area_regulatoria, numero_reuniao)`);

  if (filters.agenciaId) {
    query = query.eq("diretores.agencia_id", filters.agenciaId);
  }
  query = applyDeliberacaoFilters(query, filters);

  const { data, error } = await query;

  if (error) {
    return NextResponse.json({ error: "Erro ao buscar distribuição" }, { status: 500 });
  }

  const counts = new Map<string, number>();
  for (const row of data ?? []) {
    const tipo = (row as any).tipo_voto;
    counts.set(tipo, (counts.get(tipo) ?? 0) + 1);
  }

  const total = [...counts.values()].reduce((a, b) => a + b, 0);

  const result = [...counts.entries()].map(([tipo_voto, count]) => ({
    tipo_voto,
    count,
    pct: total > 0 ? ((count / total) * 100).toFixed(1) : "0",
  }));

  return NextResponse.json(result);
}
