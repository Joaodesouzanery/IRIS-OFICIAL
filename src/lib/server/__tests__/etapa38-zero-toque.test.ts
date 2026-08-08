import { describe, it, expect } from "vitest";
import { isHardFailSemSinal } from "@/lib/server/consistency-checks";

// Zero-toque (ago/2026): sem gate humano, a Camada 4 é a proteção contra "aprovar lixo" —
// documento ilegível SEM nenhum campo útil é auto-ARQUIVADO, nunca vira deliberação vazia.

describe("isHardFailSemSinal — Camada 4 [zero-toque]", () => {
  it("ilegível E sem nenhum sinal → hard-fail (arquiva)", () => {
    expect(isHardFailSemSinal({ charsPerPage: 0 })).toBe(true);
    expect(isHardFailSemSinal({ charsPerPage: 30, resultado: null, processo: null })).toBe(true);
  });
  it("ilegível MAS com algum sinal (reunião/processo/data/itens) → NÃO arquiva (revisável)", () => {
    expect(isHardFailSemSinal({ charsPerPage: 10, numeroReuniao: "1036" })).toBe(false);
    expect(isHardFailSemSinal({ charsPerPage: 10, processo: "50500.1/2026-01" })).toBe(false);
    expect(isHardFailSemSinal({ charsPerPage: 10, dataReuniao: "2026-07-02" })).toBe(false);
    expect(isHardFailSemSinal({ charsPerPage: 10, ataItemsCount: 3 })).toBe(false);
  });
  it("legível (texto normal) NUNCA é hard-fail, mesmo sem campos", () => {
    expect(isHardFailSemSinal({ charsPerPage: 900 })).toBe(false);
  });
});
