import { describe, it, expect } from "vitest";
import { extractFields } from "@/lib/server/nlp-extractor";

// Golden-set dos padrões FRÁGEIS de voto (dissidente/vencido, verbal, ausente,
// unanimidade). Trava regressões nas regex mais sensíveis do nlp-extractor.

describe("Golden — voto DISSIDENTE (vencido o Diretor)", () => {
  const f = extractFields(`DELIBERAÇÃO Nº 100, DE 10 DE MARÇO DE 2026
A Diretoria, por maioria, aprovou a matéria. Vencido o Diretor João da Silva Pereira, que votou pela improcedência.`);
  it("classifica o vencido como voto contrário/dissidente", () => {
    expect(f.nomes_votacao_contra).toContain("João da Silva Pereira");
    expect(f.nomes_votacao_favor).not.toContain("João da Silva Pereira");
  });
});

describe("Golden — divergência VERBAL (divergiu / votou contrariamente)", () => {
  const f = extractFields(`ATA DA REUNIÃO
O Diretor Pedro Henrique Souza divergiu do relator e votou contrariamente à proposta.`);
  it("captura a divergência verbal como contrário", () => {
    expect(f.nomes_votacao_contra).toContain("Pedro Henrique Souza");
  });
});

describe("Golden — AUSENTE (ausente o Diretor)", () => {
  const f = extractFields(`Registra-se a ausência. Ausente o Diretor Carlos Alberto Lima, justificadamente.`);
  it("classifica como ausente e não como voto", () => {
    expect(f.nomes_votacao_ausente).toContain("Carlos Alberto Lima");
    expect(f.nomes_votacao_favor).not.toContain("Carlos Alberto Lima");
    expect(f.nomes_votacao_contra).not.toContain("Carlos Alberto Lima");
  });
});

describe("Golden — UNANIMIDADE", () => {
  const f = extractFields(`DELIBERAÇÃO Nº 55, DE 20 DE MAIO DE 2026
A matéria foi aprovada por unanimidade.`);
  it("detecta unanimidade e resultado de aprovação", () => {
    expect(f.unanimidade_detectada).toBe(true);
    expect(f.resultado).toMatch(/Aprovad/i);
  });
});

describe("Golden — sem falso positivo em prosa", () => {
  const f = extractFields(`O relatório menciona o histórico de votos anteriores e o voto do cidadão nas eleições. Nenhuma deliberação foi tomada.`);
  it("não inventa nome de diretor a partir de prosa genérica", () => {
    expect(f.nomes_votacao_contra).toHaveLength(0);
    expect(f.nomes_votacao_ausente).toHaveLength(0);
  });
});
