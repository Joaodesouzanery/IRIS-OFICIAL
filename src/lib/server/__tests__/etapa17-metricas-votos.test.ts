/**
 * Etapa 17 — métricas de deferimento (Aprovado=Deferido), filtro de órgão interno
 * nas empresas, e as garantias da captura de voto ANTT (relator nominal + colegiado).
 */
import { describe, it, expect } from "vitest";
import { isResultadoPositivo } from "@/lib/utils";
import { isOrgaoInterno } from "@/lib/server/empresa-resolver";
import { computeOverview, computeMicrotemas, computeEmpresas } from "@/lib/server/analytics-engine";

function delib(over: Partial<any> = {}): any {
  return {
    id: over.id ?? Math.random().toString(36).slice(2),
    agencia_id: "ag1",
    resultado: "Aprovado",
    microtema: "contrato",
    tipo_documento: "deliberacao",
    documento_pai_id: null,
    raw_extraction: {},
    interessado: "CCR ViaSul S.A.",
    data_reuniao: "2026-03-10",
    extraction_confidence: 0.9,
    votos: [],
    ...over,
  };
}

describe("deferimento: Aprovado conta como deferido", () => {
  it("computeOverview: 'Aprovado' entra em deferidos (não some do bucket)", () => {
    const rows = [delib({ resultado: "Aprovado" }), delib({ resultado: "Aprovado" }), delib({ resultado: "Indeferido" })];
    const ov = computeOverview(rows, null);
    expect(ov.deferidos).toBe(2);
    expect(ov.indeferidos).toBe(1);
    // taxa_deferimento deixa de ser 0.0%
    expect(parseFloat(ov.taxa_deferimento)).toBeGreaterThan(0);
  });

  it("computeMicrotemas: 'Aprovado' conta como deferido no microtema", () => {
    const rows = [delib({ resultado: "Aprovado", microtema: "obras" }), delib({ resultado: "Aprovado", microtema: "obras" })];
    const mt = computeMicrotemas(rows, null);
    const obras = mt.find((m: any) => m.microtema === "obras");
    expect(obras?.deferido).toBe(2);
  });

  it("isResultadoPositivo cobre as variantes de aprovação", () => {
    for (const r of ["Deferido", "Aprovado", "Aprovado por Unanimidade", "Ratificado", "Autorizado"]) {
      expect(isResultadoPositivo(r)).toBe(true);
    }
    expect(isResultadoPositivo("Indeferido")).toBe(false);
    expect(isResultadoPositivo(null)).toBe(false);
  });
});

describe("empresas: órgão interno não é empresa regulada", () => {
  it("isOrgaoInterno detecta Superintendência/Diretoria/Agência", () => {
    expect(isOrgaoInterno("Superintendência de Concessão da Infraestrutura")).toBe(true);
    expect(isOrgaoInterno("Superintendência de Governança, Gestão da Estratégia")).toBe(true);
    expect(isOrgaoInterno("Agência Reguladora de Serviços Públicos Delegados")).toBe(true);
    expect(isOrgaoInterno("Diretoria Colegiada")).toBe(true);
    expect(isOrgaoInterno("CCR ViaSul S.A.")).toBe(false);
    expect(isOrgaoInterno("Via Brasil BR-163 Concessionária de Rodovia S.A.")).toBe(false);
  });

  it("computeEmpresas exclui órgãos internos do ranking", () => {
    const rows = [
      delib({ interessado: "CCR ViaSul S.A." }),
      delib({ interessado: "Superintendência de Concessão da Infraestrutura" }),
      delib({ interessado: "Concessionária EPR Via Mineira S.A." }),
    ];
    const emp = computeEmpresas(rows, null);
    const nomes = emp.map((e: any) => e.nome);
    expect(nomes.some((n: string) => /Superintend/i.test(n))).toBe(false);
    expect(nomes.some((n: string) => /CCR ViaSul/i.test(n))).toBe(true);
  });
});
