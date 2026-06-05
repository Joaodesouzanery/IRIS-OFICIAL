import { NextRequest, NextResponse } from "next/server";
import { loadQualidadeDashboardData } from "@/lib/server/qualidade-regulatoria-service";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const year = Number(req.nextUrl.searchParams.get("ano") ?? new Date().getFullYear());
  const dashboard = await loadQualidadeDashboardData(year);
  return NextResponse.json({
    ano: year,
    categorias: dashboard.categorias,
    vencedoras: dashboard.premio,
    ranking: dashboard.ranking,
    calendario: {
      publicacao_metodologia: `${year}-03-15`,
      consulta_publica_metodologia_dias: 30,
      inicio_coleta: `${year}-04-01`,
      fim_coleta: `${year}-09-30`,
      avaliacao_comite: `${year}-10-15`,
      publicacao_resultado: `${year}-11-15`,
      cerimonia_premiacao: `${year}-12-10`,
    },
    disclaimer: "Vencedoras preliminares dependem de revisao metodologica, evidencias oficiais e validacao humana.",
    source: dashboard.source,
  });
}
