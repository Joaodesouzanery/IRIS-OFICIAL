/**
 * Etapa 130 (Fase 23, commit 1) — o rótulo de ausência só produz NOMES.
 *
 * ═══ O que o qa-fase22 mostrou ═══
 * As 48 ausências do André Isper (ARTESP) são REAIS: "Ausência Justificada: André Isper
 * Rodrigues Barnabé - Diretor-Presidente - Afastamento em Férias", nas sessões de 25 e 31/03/2026.
 * A revisão externa (e eu, no plano anterior) leu como artefato — por causa de um `trecho` que o
 * MEU SQL produzia errado. O resíduo real é outro: "Afastamento em Férias" entrava no balde de
 * ausentes como se fosse um nome (56 linhas), e "- -Afastamento em Férias" com hífens colados.
 * Não gerava voto, mas passava pela faixa fuzzy 0,6–0,85 de `collectDivergentIntentIds`.
 */

import { describe, it, expect } from "vitest";
import { extractAusentesComOrigem } from "@/lib/server/nlp-extractor";

describe("etapa130 · o rótulo real da ARTESP", () => {
  it("«Nome - Cargo - Afastamento em Férias» → só o nome", () => {
    const r = extractAusentesComOrigem("Ausência Justificada: André Isper Rodrigues Barnabé - Diretor-Presidente - Afastamento em Férias.");
    expect(r.map((a) => a.nome)).toEqual(["André Isper Rodrigues Barnabé"]);
    expect(r[0].origem).toBe("label");
  });

  it("hífens colados do layout («- -Afastamento») também somem", () => {
    const r = extractAusentesComOrigem("Ausência Justificada: Raquel França Carneiro - Diretora - -Afastamento em Férias.");
    expect(r.map((a) => a.nome)).toEqual(["Raquel França Carneiro"]);
  });

  it("dois ausentes no mesmo rótulo continuam dois", () => {
    const r = extractAusentesComOrigem("Ausentes: Diego Albert Zanatto e Raquel França Carneiro - Férias.");
    expect(r.map((a) => a.nome)).toEqual(["Diego Albert Zanatto", "Raquel França Carneiro"]);
  });

  it("palavra institucional não vira ausente («Conselho Diretor»)", () => {
    const r = extractAusentesComOrigem("Ausentes: Conselho Diretor em recesso.");
    expect(r).toEqual([]);
  });
});
