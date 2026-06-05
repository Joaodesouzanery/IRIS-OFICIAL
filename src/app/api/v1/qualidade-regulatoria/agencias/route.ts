import { NextRequest, NextResponse } from "next/server";
import { loadQualidadeDashboardData } from "@/lib/server/qualidade-regulatoria-service";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const year = Number(req.nextUrl.searchParams.get("ano") ?? new Date().getFullYear());
  const dashboard = await loadQualidadeDashboardData(year);
  return NextResponse.json({
    data: dashboard.agencias,
    ranking: dashboard.ranking.map(({ agencia_sigla, score_geral, posicao_ranking, destaques_positivos, areas_melhoria, status_revisao }) => ({
      agencia_sigla,
      score_geral,
      posicao_ranking,
      destaques_positivos,
      areas_melhoria,
      status_revisao,
    })),
    metricas: dashboard.metricas,
    source: dashboard.source,
  });
}
