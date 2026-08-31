/**
 * Etapa 97 (Fase 16, commit E) — o contrato do QA que fecha as Fases 15+16.
 * Mesmo padrão das etapas 88/92: UM statement (o SQL Editor só mostra o último), leitura pura.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";

const RAIZ = join(__dirname, "../../../..");
const SQL = readFileSync(join(RAIZ, "docs/qa-fase16.sql"), "utf-8");
const CODIGO = SQL.replace(/^\s*--.*$/gm, " ");

describe("etapa97 · contrato do SQL Editor", () => {
  it("UM statement, leitura pura", () => {
    expect(CODIGO.trim().split(";").filter((x) => x.trim()).length).toBe(1);
    expect(CODIGO).toMatch(/^\s*SELECT jsonb_pretty/m);
    for (const proibido of [/INSERT\s/i, /UPDATE\s+\w+\s+SET/i, /DELETE\s+FROM/i, /CREATE\s/i, /ALTER\s/i]) {
      expect(CODIGO).not.toMatch(proibido);
    }
  });

  it("os 8 blocos dos vereditos existem", () => {
    for (const bloco of [
      "1_ultimas_runs", "2_deliberacoes_por_agencia_ano", "3_em_revisao_restante_x_doc",
      "4_87rop_e_dfq", "5_carimbo_anm_consumido", "6_votos_por_diretor",
      "7_sem_voto_e_datas", "8_anm_2026",
    ]) {
      expect(SQL, `bloco ${bloco} ausente`).toContain(`'${bloco}'`);
    }
  });
});

describe("etapa97 · mede o que os commits desta fase escreveram", () => {
  it("a run expõe os contadores novos — redatadas e os três reconciliados", () => {
    for (const c of ["'redatadas'", "'reconciliados_importado'", "'reconciliados_ignorado'", "'reconciliados_novo'"]) {
      expect(SQL).toContain(c);
    }
  });

  it("o em_revisao restante é cruzado com o STATUS DO DOC — só trânsito é aceitável", () => {
    expect(SQL).toMatch(/mi\.status = 'em_revisao'/);
    expect(SQL).toMatch(/LEFT JOIN documentos_regulatorios/);
  });

  it("votos por diretor na definição NOVA: efetivos + oportunidades (o roster espelha o código)", () => {
    expect(SQL).toMatch(/tipo_voto IN \('Favoravel','Desfavoravel'\)/);
    expect(SQL).toMatch(/fonte_dado <> 'automatico'/);
    expect(SQL).toMatch(/review_status = 'aprovado'/);
  });
});
