/**
 * GET /api/v1/votacao/fidelidade
 * Taxa de fidelidade ao colegiado vs votos nominais divergentes.
 */

import { NextRequest, NextResponse } from "next/server";
import { demoData } from "@/lib/demo-data";
import { isLocalMode, getSyncedDelibs } from "@/lib/server/local-data-store";
import { computeVotacaoFidelidade } from "@/lib/server/analytics-engine";
import { isDemo } from "@/lib/server/is-demo";
import { isDemoRequest } from "@/lib/server/request-guards";
import { parseVotacaoFilters, applyDeliberacaoFilters, filterDelibsForVotacao } from "@/lib/server/votacao-filters";


export async function GET(req: NextRequest) {
  const filters = parseVotacaoFilters(req.nextUrl.searchParams);

  if (isDemo() || isDemoRequest(req)) {
    if (isLocalMode()) {
      return NextResponse.json(computeVotacaoFidelidade(filterDelibsForVotacao(getSyncedDelibs(), filters), filters.agenciaId));
    }
    return NextResponse.json(demoData.votacaoFidelidade());
  }

  const { createSupabaseServerClient } = await import("@/lib/supabase/server");
  const db = createSupabaseServerClient();

  let query = db
    .from("votos")
    .select(`is_divergente, is_nominal, diretores!inner (id, nome, agencia_id), deliberacoes!inner (data_reuniao, microtema, area_regulatoria, numero_reuniao)`);

  if (filters.agenciaId) {
    query = query.eq("diretores.agencia_id", filters.agenciaId);
  }
  query = applyDeliberacaoFilters(query, filters);

  const { data, error } = await query;

  if (error) {
    return NextResponse.json({ error: "Erro ao buscar fidelidade" }, { status: 500 });
  }

  const stats = new Map<string, { nome: string; total: number; nominal: number; divergente: number }>();

  for (const row of data ?? []) {
    const dir = (row as any).diretores;
    if (!stats.has(dir.id)) {
      stats.set(dir.id, { nome: dir.nome, total: 0, nominal: 0, divergente: 0 });
    }
    const s = stats.get(dir.id)!;
    s.total++;
    if ((row as any).is_nominal) s.nominal++;
    if ((row as any).is_divergente) s.divergente++;
  }

  const result = [...stats.entries()].map(([id, s]) => ({
    diretor_id: id,
    diretor_nome: s.nome,
    total_votos: s.total,
    votos_nominais: s.nominal,
    votos_divergentes: s.divergente,
    taxa_fidelidade:
      s.total > 0
        ? (((s.total - s.divergente) / s.total) * 100).toFixed(1)
        : "100",
  }));

  return NextResponse.json(result);
}
