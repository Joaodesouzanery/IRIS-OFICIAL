/**
 * Etapa 142 (Fase 26, commit 4) — duplicata é por ANO, e o voto de vista tem chave própria.
 *
 * qa-fase25 ①: 19 números da ARTESP "em dobro". A ARTESP renumera por ano e o banco guarda "344"
 * sem ano — eram atos de anos diferentes. O confirm e o dedup já eram cientes do ano; a análise
 * não: marcava "344/2026" como duplicata de "344/2025", e com `.maybeSingle()` (que erra com duas
 * linhas) a marca sumia em silêncio. E "VOTO-DFQ-001-2026 ×2" era "Voto Vista" colapsando com
 * "Voto" na mesma chave.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";
import { anosCompativeis } from "@/lib/server/deliberacao-dedup";
import { parseAnttManualDocument } from "@/lib/server/antt-manual-parser";

describe("etapa142 · anos", () => {
  it.each([
    ["2025-03-31", "2026-03-31", false],
    ["2026-01-13", "2026-07-01", true],
    [null, "2026-07-01", true],
    ["2026-07-01", null, true],
  ] as Array<[string | null, string | null, boolean]>)("%s × %s → compatíveis=%s", (a, b, esperado) => {
    expect(anosCompativeis(a, b)).toBe(esperado);
  });

  it("a análise decide pelo ano, com candidatas em lista (não maybeSingle)", () => {
    const ua = readFileSync(join(__dirname, "../../../../src/lib/server/upload-analysis.ts"), "utf-8").replace(/\/\/[^\n]*/g, "");
    expect(ua).toMatch(/anosCompativeis\(c\.data_reuniao, fields\.data_reuniao \?\? null\)/);
    const bloco = ua.slice(ua.indexOf("let semantic_duplicate = false;"), ua.indexOf("const semanticKeyForDedup"));
    expect(bloco.length).toBeGreaterThan(100);
    expect(bloco).not.toMatch(/maybeSingle/);
  });
});

describe("etapa142 · a chave do voto da ANTT", () => {
  it("«Voto Vista DFQ 001/2026» e «Voto DFQ 001/2026» têm chaves DIFERENTES", () => {
    const vista = parseAnttManualDocument("AGÊNCIA NACIONAL DE TRANSPORTES TERRESTRES\nVoto Vista DFQ 001/2026\nProcesso nº 50500.000001/2026-11", "Voto Vista DFQ 001-2026.pdf");
    const comum = parseAnttManualDocument("AGÊNCIA NACIONAL DE TRANSPORTES TERRESTRES\nVoto DFQ 001/2026\nProcesso nº 50500.000001/2026-11", "Voto DFQ 001-2026.pdf");
    expect(vista.fields.numero_deliberacao).toBe("VOTO-VISTA-DFQ-001-2026");
    expect(comum.fields.numero_deliberacao).toBe("VOTO-DFQ-001-2026");
  });
});
