import { describe, it, expect } from "vitest";
import {
  QUALIDADE_CRITERIOS,
  LEVEL_TO_NOTA,
  scoreToLevel,
  calculateWeightedScore,
} from "@/lib/server/qualidade-regulatoria";

describe("Matriz IMQN — 6 dimensões, pesos e 4 níveis", () => {
  it("tem exatamente 6 dimensões com ids 1..6 e pesos somando 1,0", () => {
    expect(QUALIDADE_CRITERIOS).toHaveLength(6);
    expect(QUALIDADE_CRITERIOS.map((c) => c.id)).toEqual([1, 2, 3, 4, 5, 6]);
    const soma = QUALIDADE_CRITERIOS.reduce((s, c) => s + c.peso, 0);
    expect(Number(soma.toFixed(4))).toBe(1);
    // Pesos oficiais da matriz.
    expect(QUALIDADE_CRITERIOS.map((c) => c.peso)).toEqual([0.25, 0.15, 0.2, 0.15, 0.1, 0.15]);
  });

  it("toda dimensão traz a descrição dos 4 níveis", () => {
    for (const c of QUALIDADE_CRITERIOS) {
      expect(c.niveis).toBeDefined();
      expect(c.niveis?.inexistente).toBeTruthy();
      expect(c.niveis?.inicial).toBeTruthy();
      expect(c.niveis?.gerenciado).toBeTruthy();
      expect(c.niveis?.melhoria_continua).toBeTruthy();
    }
  });

  it("scoreToLevel mapeia as 4 faixas (âncoras 0/35/70/100)", () => {
    expect(scoreToLevel(LEVEL_TO_NOTA.inexistente)).toBe("inexistente"); // 0
    expect(scoreToLevel(LEVEL_TO_NOTA.inicial)).toBe("inicial"); // 35
    expect(scoreToLevel(LEVEL_TO_NOTA.gerenciado)).toBe("gerenciado"); // 70
    expect(scoreToLevel(LEVEL_TO_NOTA.melhoria_continua)).toBe("melhoria_continua"); // 100
    expect(scoreToLevel(10)).toBe("inexistente");
    expect(scoreToLevel(90)).toBe("melhoria_continua");
  });

  it("score = Σ(nota × peso) = IMQN×100 (tudo em Melhoria Contínua → 100)", () => {
    const notas = QUALIDADE_CRITERIOS.map((c) => ({ criterio_id: c.id, nota: 100 }));
    expect(calculateWeightedScore(notas)).toBe(100);
    const parcial = QUALIDADE_CRITERIOS.map((c) => ({ criterio_id: c.id, nota: c.id === 1 ? 100 : 0 }));
    expect(calculateWeightedScore(parcial)).toBe(25); // só AIR (peso 0.25)
  });
});
