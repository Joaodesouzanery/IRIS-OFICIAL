import { NextRequest, NextResponse } from "next/server";
import { loadQualidadeDashboardData } from "@/lib/server/qualidade-regulatoria-service";
import { diagnosticoMedido } from "@/lib/server/qualidade-regulatoria";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const year = Number(req.nextUrl.searchParams.get("ano") ?? new Date().getFullYear());
  const format = req.nextUrl.searchParams.get("format") ?? "json";
  const dashboard = await loadQualidadeDashboardData(year);

  if (format === "csv") {
    const header = [
      "posicao",
      "agencia",
      "score_geral",
      // ⚠️ "nao" = a linha usa referência curada ou tem dimensão sem avaliação: fora do ranking.
      "nota_medida",
      "imqn_comprovada",
      "imqn_maxima_verificavel_publica",
      "status_revisao",
      ...dashboard.criterios.map((criterio) => `criterio_${criterio.id}_${slug(criterio.nome)}`),
      "destaques",
      "areas_melhoria",
    ];
    const rows = [
      header,
      ...dashboard.ranking.map((item) => [
        item.posicao_ranking ?? "",
        item.agencia_sigla,
        item.score_geral,
        diagnosticoMedido(item) ? "sim" : "nao",
        dashboard.imqn.por_agencia[item.agencia_sigla]?.comprovada ?? "",
        dashboard.imqn.por_agencia[item.agencia_sigla]?.maxima_verificavel_publica ?? "",
        item.status_revisao,
        ...dashboard.criterios.map((criterio) => item.notas.find((note) => note.criterio_id === criterio.id)?.nota ?? ""),
        item.destaques_positivos.join("; "),
        item.areas_melhoria.join("; "),
      ]),
    ];
    const csv = rows.map((row) => row.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(",")).join("\n");
    return new NextResponse(csv, {
      headers: {
        "Content-Type": "text/csv;charset=utf-8",
        "Content-Disposition": `attachment; filename="ranking-qualidade-regulatoria-${year}.csv"`,
      },
    });
  }

  return NextResponse.json({
    ano: year,
    ranking: dashboard.ranking,
    criterios: dashboard.criterios,
    fontes: dashboard.fontes,
    evidencias_resumo: dashboard.evidencias_resumo,
    matriz: dashboard.matriz,
    metricas: dashboard.metricas,
    referencias_legais: dashboard.legal.references,
    disclaimer: dashboard.legal.disclaimer,
    source: dashboard.source,
  });
}

function slug(value: string) {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-zA-Z0-9]+/g, "_").replace(/^_|_$/g, "").toLowerCase();
}
