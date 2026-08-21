import { describe, it, expect } from "vitest";
import { detectAgenciaSigla } from "@/lib/server/classifier";

// QA ago/2026: "ANS" era substring de "TRANSPORTES" e "ANA" de "ANAC/SEMANA" — documento
// ANTT/ARTESP era gravado como ANS/ANA e agências fora da esteira de votos apareciam na
// Completude com deliberações. Agora a sigla só conta como PALAVRA inteira.

const SIGLAS = ["ANTT", "ANM", "ARTESP", "ANS", "ANA", "ANAC", "ANEEL"];

describe("detectAgenciaSigla com fronteira de palavra [etapa44]", () => {
  it("'TRANSPORTES' não pontua ANS — ata da ANTT continua ANTT", () => {
    const texto = `AGÊNCIA NACIONAL DE TRANSPORTES TERRESTRES - ANTT.
      Deliberação sobre transporte rodoviário de cargas. A ANTT decide aprovar.
      Superintendência de Transportes cita transparência nos transportes.`;
    expect(detectAgenciaSigla(texto, SIGLAS)).toBe("ANTT");
  });

  it("ata da ARTESP (cheia de 'transporte') não vira ANS", () => {
    const texto = `Agência Reguladora de Serviços Públicos Delegados de Transporte do
      Estado de São Paulo - ARTESP. Transporte intermunicipal. Concessões de transporte.`;
    expect(detectAgenciaSigla(texto, SIGLAS)).toBe("ARTESP");
  });

  it("'ANAC' e 'SEMANA' não pontuam ANA", () => {
    const texto = "A ANAC publicou nesta semana a resolução. ANAC decide. ANAC aprova.";
    expect(detectAgenciaSigla(texto, SIGLAS)).toBe("ANAC");
  });

  it("ANS de verdade (palavra isolada) continua detectada", () => {
    const texto = "AGÊNCIA NACIONAL DE SAÚDE SUPLEMENTAR - ANS. A ANS regula planos de saúde.";
    expect(detectAgenciaSigla(texto, SIGLAS)).toBe("ANS");
  });

  it("sigla colada em pontuação/parêntese conta ('(ANM)' e 'ANM.')", () => {
    const texto = "Agência Nacional de Mineração (ANM). Diretoria Colegiada da ANM.";
    expect(detectAgenciaSigla(texto, SIGLAS)).toBe("ANM");
  });
});
