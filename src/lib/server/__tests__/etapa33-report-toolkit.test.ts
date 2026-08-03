import { describe, it, expect } from "vitest";
import { svgDonut, svgGauge, svgBarsH, svgLine } from "@/lib/report-charts";
import { reportDocument, REPORT_COLORS, REPORT_VOTE_COLORS } from "@/lib/report-theme";

// Bloco 1 (ago/2026): toolkit de relatório — gráficos como SVG-string (impressão, sem React/DOM)
// + documento na identidade IRIS. Sem preview visual aqui; o teste trava a estrutura.

describe("report-charts — SVG-string determinístico [toolkit]", () => {
  it("svgDonut: fatias + legenda rotulada (identidade não é só cor) + total", () => {
    const svg = svgDonut([
      { label: "Favorável", value: 7, color: REPORT_VOTE_COLORS.favoravel },
      { label: "Desfavorável", value: 2, color: REPORT_VOTE_COLORS.desfavoravel },
      { label: "Abstenção", value: 1, color: REPORT_VOTE_COLORS.abstencao },
    ], { title: "Distribuição" });
    expect(svg).toContain("<svg");
    expect(svg).toContain("<path"); // fatias
    expect(svg).toContain("Favorável"); // rótulo direto (secondary encoding)
    expect(svg).toContain("70%"); // 7/10
    expect(svg).toContain(">10<"); // total central
  });

  it("svgDonut vazio (total 0) não quebra", () => {
    expect(svgDonut([{ label: "x", value: 0, color: "#000" }])).toContain("<svg");
  });

  it("svgGauge: medidor com o valor em %", () => {
    const svg = svgGauge(63.5, { label: "Favorável", color: REPORT_VOTE_COLORS.favoravel });
    expect(svg).toContain("<svg");
    expect(svg).toContain("64%"); // arredondado
    expect(svg).toContain("stroke-dasharray");
  });

  it("svgBarsH: uma barra por item, com rótulo e valor", () => {
    const svg = svgBarsH([
      { label: "Diretor A", value: 80, suffix: "%" },
      { label: "Diretor B", value: 40, suffix: "%" },
    ], { max: 100 });
    expect(svg).toContain("Diretor A");
    expect(svg).toContain("80%");
    expect((svg.match(/<rect/g) ?? []).length).toBeGreaterThanOrEqual(4); // trilho + barra por item
  });

  it("svgLine: caminho + pontos", () => {
    const svg = svgLine([{ label: "jan", value: 3 }, { label: "fev", value: 8 }, { label: "mar", value: 5 }]);
    expect(svg).toContain("<path");
    expect((svg.match(/<circle/g) ?? []).length).toBe(3);
  });
});

describe("reportDocument — documento IRIS de impressão [toolkit]", () => {
  const html = reportDocument({
    title: "Relatório de Teste",
    eyebrow: "Esteira de Votos",
    subtitle: "sub",
    generatedAt: "Gerado em 2026-08-03 12:00 UTC",
    baseUrl: "https://app.irisregulacao.org",
    contentHtml: "<section><h2>ANTT</h2><p>conteúdo</p></section>",
  });

  it("HTML completo, identidade IRIS, botão imprimir e print CSS", () => {
    expect(html).toContain("<!doctype html>");
    expect(html).toContain(REPORT_COLORS.navy); // navy
    expect(html).toContain(REPORT_COLORS.gold); // dourado
    expect(html).toContain("Playfair Display");
    expect(html).toContain("/brand/newsletter-logo-wide.png");
    expect(html).toContain("window.print()");
    expect(html).toContain("@media print");
    expect(html).toContain("Relatório de Teste");
    expect(html).toContain("<h2>ANTT</h2>");
  });
});
