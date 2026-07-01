import { describe, it, expect } from "vitest";
import { isLikelyPersonName, isRoleWordOnly } from "@/lib/server/name-matcher";

describe("isRoleWordOnly — palavra-função não é nome", () => {
  it.each(["Diretor", "Diretora", "Diretor-Geral", "Diretor-Presidente", "Presidente", "Conselheiro", "Relator", "DIRETOR"])(
    "'%s' é só palavra-função",
    (w) => expect(isRoleWordOnly(w)).toBe(true),
  );
  it("nome de pessoa não é palavra-função", () => {
    expect(isRoleWordOnly("João Pedro de Almeida")).toBe(false);
  });
});

describe("isLikelyPersonName — gate de candidato de diretor", () => {
  it("aceita nome de pessoa (≥2 tokens de conteúdo)", () => {
    expect(isLikelyPersonName("João Pedro de Almeida")).toBe(true);
    expect(isLikelyPersonName("Maria Santos")).toBe(true);
    expect(isLikelyPersonName("André Luiz de Sá")).toBe(true);
  });
  it("rejeita palavra-função e lixo (a causa dos 15 matches 'Diretor')", () => {
    expect(isLikelyPersonName("Diretor")).toBe(false);
    expect(isLikelyPersonName("Diretor-Presidente")).toBe(false);
    expect(isLikelyPersonName("Presidente")).toBe(false);
    expect(isLikelyPersonName("Ana")).toBe(false); // só 1 token
    expect(isLikelyPersonName("de da")).toBe(false); // só conectores
    expect(isLikelyPersonName("")).toBe(false);
  });
  it("nome real precedido de cargo ainda passa (tem nome de pessoa dentro)", () => {
    expect(isLikelyPersonName("Diretor João Silva")).toBe(true);
  });
});
