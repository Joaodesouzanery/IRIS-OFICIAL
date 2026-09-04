/**
 * Etapa 111 (Fase 18, commit 4) — o contrato do QA que decide a próxima fase.
 * Padrão das etapas 88/92/97/107: UM statement (o SQL Editor só mostra o último), leitura pura.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";

const RAIZ = join(__dirname, "../../../..");
const SQL = readFileSync(join(RAIZ, "docs/qa-fase18.sql"), "utf-8");
const CODIGO = SQL.replace(/^\s*--.*$/gm, " ");

describe("etapa111 · contrato do SQL Editor", () => {
  it("UM statement, leitura pura", () => {
    expect(CODIGO.trim().split(";").filter((x) => x.trim()).length).toBe(1);
    expect(CODIGO).toMatch(/^\s*SELECT jsonb_pretty/m);
    for (const proibido of [/INSERT\s/i, /UPDATE\s+\w+\s+SET/i, /DELETE\s+FROM/i, /CREATE\s/i, /ALTER\s/i]) {
      expect(CODIGO).not.toMatch(proibido);
    }
  });

  it("os 6 blocos existem", () => {
    for (const b of [
      "1_votos_ilegiveis_ocr_ou_parser", "2_ata_sem_resultado", "3_extracao_metodo",
      "4_idade_da_fila", "5_alarme_voltou_a_gravar", "6_cobertura_por_fonte",
    ]) {
      expect(SQL, `bloco ${b} ausente`).toContain(`'${b}'`);
    }
  });
});

describe("etapa111 · mede exatamente o que decide a próxima fase", () => {
  it("os 44 votos vêm com KB/PÁGINA e veredito — é o que separa OCR de parser", () => {
    expect(CODIGO).toMatch(/kb_por_pagina/);
    expect(CODIGO).toMatch(/ESCANEADO/);
    expect(CODIGO).toMatch(/PARSER/);
  });

  it("`extracao_metodo` é lido no caminho CERTO (o erro era da consulta, não do código)", () => {
    expect(CODIGO).toMatch(/campos_detectados->'preview'->'extraction_raw'->>'extracao_metodo'/);
  });

  it("a IDADE da fila é medida — o poço que o commit 1 pode criar", () => {
    expect(CODIGO).toMatch(/first_seen_at/);
    expect(CODIGO).toMatch(/parados_ha_30d/);
    expect(CODIGO).toMatch(/status = 'novo'/);
  });

  it("o alarme é conferido pela regressão que o mantinha mudo", () => {
    expect(CODIGO).toMatch(/item_id IS NULL/);
  });

  it("REVISADO (Fase 19): mede o dispositivo na coluna CERTA, com amostra", () => {
    // ⚠️ Este caso pinava `parece_retirado` e `sem_nenhum_sinal` — duas colunas que eram
    // ESTRUTURALMENTE impossíveis de ser > 0. Elas liam `raw_extraction->>'decisao'` (omissão
    // DECLARADA do raw do filho: o dispositivo vira a coluna `resumo_pleito`) e
    // `fundamento_decisao` (só gravado no ramo demo). Davam 0 em 100% dos casos, e eu quase
    // escrevi um conserto de extrator em cima disso. O teste vigiava a consulta errada.
    expect(CODIGO).toMatch(/resumo_pleito/);
    expect(CODIGO).not.toMatch(/raw_extraction->>'decisao'/);
    expect(CODIGO).toMatch(/'amostra'/);
  });
});
