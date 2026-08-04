/**
 * GET /api/v1/votacao/sectors?agencia_id=X
 * Distribuição de votos por microtema (setor) da agência.
 */

import { NextRequest, NextResponse } from "next/server";
import { demoData } from "@/lib/demo-data";
import type { VotoSector } from "@/types";
import { isLocalMode, getSyncedDelibs } from "@/lib/server/local-data-store";
import { computeVotacaoSectors } from "@/lib/server/analytics-engine";
import { isDemo } from "@/lib/server/is-demo";
import { isDemoRequest } from "@/lib/server/request-guards";
import { selectAllPaged } from "@/lib/server/select-all-paged";
import { matchesYear } from "@/lib/server/year-filter";


export async function GET(req: NextRequest) {
  const agenciaId = req.nextUrl.searchParams.get("agencia_id") || null;
  const year = req.nextUrl.searchParams.get("year");

  if (isDemo() || isDemoRequest(req)) {
    if (isLocalMode()) {
      return NextResponse.json(computeVotacaoSectors(getSyncedDelibs(), agenciaId));
    }
    const sectors = demoData.votacaoSectors(agenciaId);
    return NextResponse.json(sectors);
  }

  const { createSupabaseServerClient } = await import("@/lib/supabase/server");
  const db = createSupabaseServerClient();

  // Agrega votos por microtema via join votos → deliberacoes. Paginado (anti-truncamento
  // ~1000 do PostgREST) + `year` honrado (QA ago/2026).
  const { rows: data, error } = await selectAllPaged(() => {
    let query = db
      .from("votos")
      .select("id, deliberacoes!inner(microtema, agencia_id, data_reuniao, data_publicacao)")
      .order("id", { ascending: true });
    if (agenciaId) query = query.eq("deliberacoes.agencia_id", agenciaId);
    return query;
  }, { label: "votacao/sectors" });

  if (error) {
    return NextResponse.json({ error: "Erro ao buscar votos por setor" }, { status: 500 });
  }

  const counts = new Map<string, number>();
  for (const row of data ?? []) {
    const r = row as unknown as { deliberacoes: { microtema: string | null; data_reuniao?: string | null; data_publicacao?: string | null } };
    if (!matchesYear(r.deliberacoes ?? {}, year)) continue;
    const microtema = r.deliberacoes?.microtema ?? "outros";
    counts.set(microtema, (counts.get(microtema) ?? 0) + 1);
  }

  const result: VotoSector[] = [...counts.entries()]
    .map(([microtema, count]) => ({ microtema, count }))
    .sort((a, b) => b.count - a.count);

  return NextResponse.json(result);
}
