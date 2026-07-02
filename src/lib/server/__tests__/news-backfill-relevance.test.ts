import { describe, it, expect } from "vitest";
import { isPrizeRelevantTitle, prizeDimsForTitle } from "@/lib/server/news-collector";

describe("Backfill 2026 — filtro de relevância por título (prêmio)", () => {
  it("marca a dimensão certa por termos no título", () => {
    expect(prizeDimsForTitle("ANTT abre Consulta Pública sobre pedágio")).toContain(2);
    expect(prizeDimsForTitle("Agência publica Agenda Regulatória 2026")).toContain(4);
    expect(prizeDimsForTitle("Relatório de Análise de Impacto Regulatório da norma X")).toContain(1);
    expect(prizeDimsForTitle("Análise de Resultado Regulatório (ARR) concluída")).toContain(6);
  });

  it("aceita itens regulatórios gerais (resolução/portaria/deliberação)", () => {
    expect(isPrizeRelevantTitle("Diretoria aprova Resolução nº 1.234")).toBe(true);
    expect(isPrizeRelevantTitle("Portaria estabelece novo prazo")).toBe(true);
    expect(isPrizeRelevantTitle("Deliberação da reunião do conselho diretor")).toBe(true);
  });

  it("descarta ruído não-regulatório", () => {
    expect(isPrizeRelevantTitle("Agência participa de feira de tecnologia")).toBe(false);
    expect(isPrizeRelevantTitle("Servidores celebram aniversário da instituição")).toBe(false);
    expect(prizeDimsForTitle("Nota de pesar")).toHaveLength(0);
  });
});
