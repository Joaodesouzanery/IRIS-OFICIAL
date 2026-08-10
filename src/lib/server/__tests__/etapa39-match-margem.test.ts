import { describe, it, expect } from "vitest";
import { findBestMatchComMargem } from "@/lib/server/name-matcher";

// Zero-toque (ago/2026): a faixa 0.6–0.8 de similaridade só é auto-aprovada quando o melhor
// diretor é INEQUÍVOCO (margem ≥0.15 sobre o 2º) — variante de grafia da mesma pessoa. Dois
// diretores com scores próximos seguem para decisão humana (anti voto-na-pessoa-errada).

const DIRETORES = [
  { id: "d-felipe", nome: "Felipe Fernandes Queiroz", nome_variantes: [] },
  { id: "d-lucas", nome: "Lucas Asfor Rocha Lima", nome_variantes: [] },
  { id: "d-alex", nome: "Alex Antonio de Azevedo Cruz", nome_variantes: [] },
];

describe("findBestMatchComMargem [zero-toque]", () => {
  it("variante de grafia clara → margem grande sobre o 2º (auto-aprovável)", () => {
    const m = findBestMatchComMargem("Felipe Fernandes Queiros", DIRETORES); // typo z→s
    expect(m.diretorId).toBe("d-felipe");
    expect(m.score).toBeGreaterThanOrEqual(0.6);
    expect(m.margem).toBeGreaterThanOrEqual(0.15);
  });
  it("nome sem parecido com ninguém → score baixo (não aprova por margem)", () => {
    const m = findBestMatchComMargem("Mariana Costa e Silva", DIRETORES);
    expect(m.score).toBeLessThan(0.6);
  });
  it("dois diretores parecidos → margem PEQUENA (fica para o humano)", () => {
    const dirs = [
      { id: "a", nome: "João da Silva Santos", nome_variantes: [] },
      { id: "b", nome: "João da Silva Souza", nome_variantes: [] },
    ];
    const m = findBestMatchComMargem("João da Silva", dirs);
    expect(m.margem).toBeLessThan(0.15); // ambos pontuam alto e próximo
  });
  it("lista vazia / nome curto → neutro", () => {
    expect(findBestMatchComMargem("Fulano de Tal", []).diretorId).toBeNull();
    expect(findBestMatchComMargem("ab", DIRETORES).diretorId).toBeNull();
  });
});
