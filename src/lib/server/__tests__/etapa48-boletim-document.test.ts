import { describe, it, expect } from "vitest";
import { buildBoletimHtml, calcGovScore } from "@/lib/boletim-document";
import { REPORT_COLORS } from "@/lib/report-theme";

// Redesign ago/2026: o boletim saiu do client (string inline) para módulo compartilhado com
// tokens de marca únicos. Este teste trava a direção editorial: SEM monospace nos títulos,
// hierarquia de KPI (número-hero), rankings como barras (width%), tinta em 3 níveis.

const fmt = (n: number) => String(n);

function sample(sections: string[]) {
  return buildBoletimHtml({
    selectedSections: sections,
    periodoLabel: "Último mês",
    agenciaLabel: "ANTT",
    baseUrl: "https://app.irisregulacao.org",
    hoje: "21 de agosto de 2026",
    formatNumber: fmt,
    overview: { total_deliberacoes: 208, deferidos: 150, taxa_deferimento: "72.1", reunioes_unicas: 14, avg_confidence: 0.9 },
    mandatos: { taxa_consenso: "88.0", taxa_litigio: "12.0", taxa_sancao: "4.0" },
    microtemas: [{ label: "Rodovias", total: 40 }, { label: "Ferrovias", total: 12 }],
    areas: [{ label: "Concessões", total: 90 }, { label: "Tarifas", total: 30 }],
    empresas: [{ label: "Samarco Mineração S.A.", total: 9 }],
    diretores: [{ nome: "Felipe Fernandes Queiroz", total: 55, pctFavor: 96 }],
    recentes: [{ titulo: "487 — Vale S.A.", meta: "Recurso · Indeferido" }],
    divergentes: [{ titulo: "512 — Samarco", meta: "Aprovado por maioria", nomes: "Roger Romão Cabral" }],
    publicadas: [{ titulo: "487 — Vale S.A.", meta: "Publicado em 01/08/2026" }],
  });
}

describe("boletim-document [etapa48]", () => {
  const html = sample(["kpis", "recentes", "divergentes", "publicacao", "areas", "setores", "diretores", "empresas", "consenso", "governanca"]);

  it("identidade IRIS: navy + dourado ÚNICOS (de report-theme) + logo + Playfair", () => {
    expect(html).toContain(REPORT_COLORS.navy);
    expect(html).toContain(REPORT_COLORS.gold);
    expect(html).not.toContain("#c9a84c"); // dourado divergente extinto
    expect(html).toContain("/brand/newsletter-logo-wide.png");
    expect(html).toContain("Playfair Display");
  });

  it("SEM monospace (a marca registrada do design-de-IA foi extinta)", () => {
    expect(html).not.toContain("monospace");
  });

  it("KPI com hierarquia: número-hero grande em serif, não 4 cards clonados", () => {
    expect(html).toContain("font-size:52px");
    expect(html).toContain(">208<");
    expect(html).not.toContain("width:25%"); // layout antigo dos 4 clones
  });

  it("rankings viram BARRAS email-safe (width%), não lista '1. X — N'", () => {
    expect(html).toMatch(/width:\d+%;background:#58618f/);
    expect(html).not.toMatch(/>1\.\s/);
  });

  it("divergência com rótulo direto e cor semântica (não dourado)", () => {
    expect(html).toContain("Voto divergente: Roger Romão Cabral");
    expect(html).toContain("#b3a1e6");
    expect(html).not.toContain("#f59e0b"); // âmbar Tailwind cru extinto
  });

  it("seções respeitam a seleção", () => {
    const so = sample(["kpis"]);
    expect(so).toContain("Panorama");
    expect(so).not.toContain("Deliberações recentes");
  });

  it("governança usa a mesma fórmula composta", () => {
    expect(calcGovScore(88, 72.1, 90, 4)).toBe(86);
    expect(html).toContain(">86<");
  });
});
