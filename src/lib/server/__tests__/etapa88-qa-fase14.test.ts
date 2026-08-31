/**
 * Etapa 88 — o SQL do QA da Fase 14 obedece o contrato do SQL Editor.
 *
 * Mesmas propriedades da etapa77 (o instrumento não pode dar resultado errado em silêncio):
 * uma instrução, somente leitura, e o predicado de roster/final espelhando o código real.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";

const SQL = readFileSync(join(__dirname, "../../../..", "docs/qa-fase14.sql"), "utf-8");
const CODE = SQL.replace(/--[^\n]*/g, "").replace(/'(?:[^']|'')*'/g, "''");

describe("etapa88 · contrato", () => {
  it("uma instrução, somente leitura, parênteses fechados", () => {
    expect(CODE.split(";").filter((s) => s.trim()).length).toBe(1);
    expect(CODE).not.toMatch(/\b(INSERT|UPDATE|DELETE|DROP|ALTER|CREATE|TRUNCATE)\b/i);
    let bal = 0;
    for (const ch of CODE) { if (ch === "(") bal++; else if (ch === ")") { bal--; expect(bal).toBeGreaterThanOrEqual(0); } }
    expect(bal).toBe(0);
  });

  it("os 8 blocos do QA existem", () => {
    for (const k of ["1_deliberacoes_por_agencia_ano","2_anm","3_finais_sem_voto_diagnostico",
      "4_votos_orfaos","5_queued","6_mojibake","7_coleta_por_site","8_esteira_runs"]) {
      expect(SQL).toContain(`'${k}'`);
    }
  });

  it("o roster do bloco ③ é o ESTRITO (paridade com a inferência real)", () => {
    expect(SQL).toMatch(/fonte_dado <> 'automatico'/);
    expect(SQL).toMatch(/NOT IN \('pauta','voto_individual','documento_apoio'\)/);
  });

  it("`inferivel_pela_decisao` exige NÃO-contestado — a mesma regra do commit D", () => {
    expect(SQL).toMatch(/roster_n > 0 AND NOT contestado/);
    expect(SQL).toMatch(/por\\s\+maioria\|voto\\s\+de\\s\+qualidade/);
  });
});
