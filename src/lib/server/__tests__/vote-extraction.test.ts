import { describe, it, expect } from "vitest";
import { extractFields } from "@/lib/server/nlp-extractor";

// Texto sintético sem "unanimidade" e sem bloco de assinatura → exercita o
// caminho RE_VOTO_DIRECAO ("Nome – direção"), com nomes compostos/preposições.
const TEXTO = `DELIBERAÇÃO Nº 42, DE 15 DE MARÇO DE 2026

Após análise, a Diretoria decidiu sobre a matéria com a seguinte votação:

André Luiz de Almeida - Favorável
Maria das Dores Souza - Contrário
Carlos Eduardo dos Santos - Abstenção
`;

describe("extractFields — captura de nomes compostos (preposições)", () => {
  const f = extractFields(TEXTO);

  it("captura nome com preposição como voto favorável", () => {
    expect(f.nomes_votacao_favor).toContain("André Luiz de Almeida");
  });
  it("captura nome composto como voto contrário (não vira favor)", () => {
    expect(f.nomes_votacao_contra).toContain("Maria das Dores Souza");
    expect(f.nomes_votacao_favor).not.toContain("Maria das Dores Souza");
  });
  it("captura nome com preposição como abstenção", () => {
    expect(f.nomes_votacao_abstencao).toContain("Carlos Eduardo dos Santos");
  });
});
