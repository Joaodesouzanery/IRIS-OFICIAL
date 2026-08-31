/**
 * Etapa 92 (Fase 15, commit D) — o contrato do QA que prova os cinco consertos.
 *
 * Mesmo padrão da etapa88: o SQL Editor do Supabase só mostra o resultado do ÚLTIMO statement,
 * então o QA inteiro precisa ser UMA consulta; e QA é leitura — qualquer escrita aqui seria um
 * conserto disfarçado de medição.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";

const RAIZ = join(__dirname, "../../../..");
const SQL = readFileSync(join(RAIZ, "docs/qa-fase15.sql"), "utf-8");
const CODIGO = SQL.replace(/^\s*--.*$/gm, " ");

describe("etapa92 · contrato do SQL Editor", () => {
  it("UM statement, leitura pura", () => {
    expect(CODIGO.trim().split(";").filter((x) => x.trim()).length).toBe(1);
    expect(CODIGO).toMatch(/^\s*SELECT jsonb_pretty/m);
    for (const proibido of [/INSERT\s/i, /UPDATE\s+\w+\s+SET/i, /DELETE\s+FROM/i, /CREATE\s/i, /ALTER\s/i]) {
      expect(CODIGO).not.toMatch(proibido);
    }
  });

  it("os 8 blocos dos cinco consertos existem", () => {
    for (const bloco of [
      "1_ata_87_rop", "2_itens_anm_funil", "3_seletor_sites_anm",
      "4_deliberacoes_por_agencia_ano", "5_anm_2026",
      "6_arquivados_pagina_institucional", "7_datas_para_revisao", "8_ultima_esteira_run",
    ]) {
      expect(SQL, `bloco ${bloco} ausente`).toContain(`'${bloco}'`);
    }
  });
});

describe("etapa92 · o QA mede o que os commits desta fase escreveram", () => {
  it("o funil mostra o carimbo do retry — é ele que diz se a migration B pegou", () => {
    expect(SQL).toMatch(/proxima_tentativa_em IS NOT NULL/);
  });

  it("as datas para revisão separam 'invalidada' (1996) de 'sem fonte' (nula)", () => {
    expect(SQL).toContain("data_invalidada_valor");
    expect(SQL).toContain("data_ausente_motivo");
    expect(SQL).toContain("precisa_revisao_data");
  });

  it("a run expõe os contadores novos do passo redatar", () => {
    expect(SQL).toMatch(/'redatadas'/);
    expect(SQL).toMatch(/'datas_para_revisao'/);
  });
});
