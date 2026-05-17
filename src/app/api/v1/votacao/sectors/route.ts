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


export async function GET(req: NextRequest) {
  const agenciaId = req.nextUrl.searchParams.get("agencia_id") || null;

  if (isDemo() || isDemoRequest(req)) {
    if (isLocalMode()) {
      return NextResponse.json(computeVotacaoSectors(getSyncedDelibs(), agenciaId));
    }
    const sectors = demoData.votacaoSectors(agenciaId);
    return NextResponse.json(sectors);
  }

  const { createSupabaseServerClient } = await import("@/lib/supabase/server");
  const db = createSupabaseServerClient();

  // Agrega votos por microtema via join votos → deliberacoes
  let query = db
    .from("votos")
    .select("deliberacoes!inner(microtema, agencia_id)");

  if (agenciaId) {
    query = query.eq("deliberacoes.agencia_id", agenciaId);
  }

  const { data, error } = await query;

  if (error) {
    return NextResponse.json({ error: "Erro ao buscar votos por setor" }, { status: 500 });
  }

  const counts = new Map<string, number>();
  for (const row of data ?? []) {
    const r = row as unknown as { deliberacoes: { microtema: string | null } };
    const microtema = r.deliberacoes?.microtema ?? "outros";
    counts.set(microtema, (counts.get(microtema) ?? 0) + 1);
  }

  const result: VotoSector[] = [...counts.entries()]
    .map(([microtema, count]) => ({ microtema, count }))
    .sort((a, b) => b.count - a.count);

  return NextResponse.json(result);
}
