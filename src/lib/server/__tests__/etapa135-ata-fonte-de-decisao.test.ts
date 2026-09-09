/**
 * Etapa 135 (Fase 24, commit 4) — a ata que NÃO é fonte de decisão é arquivada com nome.
 *
 * qa-fase23 ①: 18 atas REAIS da ARTESP (1201ª–1210ª ordinárias, 216ª–246ª extraordinárias) em
 * "Revisar" com 0 itens. O splitter é da forma da ANM; a ata da ARTESP é narrativa e cada decisão
 * sai como DELIBERAÇÃO própria — ela nunca terá itens, e não deve (duplicaria as deliberações).
 * "Nomina voto" (ANTT|ata = nenhum) e "é fonte de decisão" (ANTT|ata = sim) são conceitos
 * distintos; por isso uma tabela nova, não o `fonteNominaVotos`.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";
import { ataEhFonteDeDecisao } from "@/lib/server/colegiado-sources";
import { canAutoConfirm } from "@/lib/server/auto-confirm";

describe("etapa135 · a tabela", () => {
  it.each([["ANM", true], ["ANTT", true], ["ARTESP", false], ["artesp", false], [null, true], ["XYZ", true]] as Array<[string | null, boolean]>)(
    "%s → ata é fonte de decisão = %s", (sigla, esperado) => { expect(ataEhFonteDeDecisao(sigla)).toBe(esperado); });
});

describe("etapa135 · o gate distingue os motivos", () => {
  const ata = (sigla: string) => ({
    id: "d", status: "review_pending", tipo_documento: "ata", agencia_id: "ag", agencia_sigla: sigla,
    extraction_confidence: 0.72, chars_per_page: 2000, is_duplicate: false, warnings: [], ata_items: [],
    campos_detectados: { preview: { fields: { tipo_documento: "ata", import_counts_as_final: false } } },
  }) as any;
  it("ARTESP: ata sem itens → «não é fonte de decisão» (o confirm-lote arquiva)", () => {
    expect(canAutoConfirm(ata("ARTESP")).reason).toMatch(/ata_fonte_nao_deliberativa/);
  });
  it("ANM: ata sem itens → continua «sem itens parseados» (revisão humana)", () => {
    expect(canAutoConfirm(ata("ANM")).reason).toMatch(/ata sem itens parseados/);
  });
});

describe("etapa135 · o confirm arquiva a ata da ARTESP com o motivo, e mantém a da ANM", () => {
  const ROTA = readFileSync(join(__dirname, "../../../../src/app/api/v1/upload/confirm/route.ts"), "utf-8");
  it("o ramo da ata consulta ataEhFonteDeDecisao antes de manter em revisão", () => {
    const i = ROTA.indexOf('if (d.tipo_documento === "ata") {');
    const ramo = ROTA.slice(i, i + 1200);
    expect(ramo).toMatch(/ataEhFonteDeDecisao\(/);
    expect(ramo).toMatch(/"ignored", null, "ata_fonte_nao_deliberativa"/);
    expect(ramo).toMatch(/"review_pending"\)/);
  });
});
