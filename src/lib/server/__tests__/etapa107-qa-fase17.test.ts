/**
 * Etapa 107 (Fase 17, commit I) — o contrato do QA que fecha a fase.
 * Mesmo padrão das etapas 88/92/97: UM statement (o SQL Editor só mostra o último), leitura pura.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";

const RAIZ = join(__dirname, "../../../..");
const SQL = readFileSync(join(RAIZ, "docs/qa-fase17.sql"), "utf-8");
const CODIGO = SQL.replace(/^\s*--.*$/gm, " ");

describe("etapa107 · contrato do SQL Editor", () => {
  it("UM statement, leitura pura", () => {
    expect(CODIGO.trim().split(";").filter((x) => x.trim()).length).toBe(1);
    expect(CODIGO).toMatch(/^\s*SELECT jsonb_pretty/m);
    for (const proibido of [/INSERT\s/i, /UPDATE\s+\w+\s+SET/i, /DELETE\s+FROM/i, /CREATE\s/i, /ALTER\s/i]) {
      expect(CODIGO).not.toMatch(proibido);
    }
  });

  it("os 7 blocos existem", () => {
    for (const bloco of [
      "1_autoria_dos_sem_motivo", "2_decomposicao_do_total", "3_artesp_bloqueio_real",
      "4_populacao_do_ocr", "5_cobertura_por_fonte", "6_chips_do_painel", "7_poco_em_revisao",
    ]) {
      expect(SQL, `bloco ${bloco} ausente`).toContain(`'${bloco}'`);
    }
  });
});

describe("etapa107 · mede exatamente o que esta fase escreveu", () => {
  it("a autoria do carimbo distingue reaper de migration", () => {
    expect(SQL).toMatch(/enqueue_motivo_origem/);
  });

  it("o alarme de queda é medido com a run ANTERIOR ao lado", () => {
    expect(SQL).toMatch(/OFFSET 1/);
    expect(SQL).toMatch(/queda_de_volume/);
  });

  it("o OCR é medido na coluna CERTA — campos_detectados, não metadata", () => {
    expect(SQL).toMatch(/campos_detectados->>'extracao_metodo'/);
    expect(CODIGO).not.toMatch(/metadata->>'extracao_metodo'/);
  });

  it("a decomposição do total usa as três dimensões do predicado final", () => {
    expect(SQL).toMatch(/documento_pai_id IS NOT NULL/);
    expect(SQL).toMatch(/resultado IS NOT NULL/);
  });
});
