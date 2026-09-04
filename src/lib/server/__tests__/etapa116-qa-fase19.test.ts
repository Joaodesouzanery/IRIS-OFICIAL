/**
 * Etapa 116 (Fase 19, commit 5) — o QA da fase, e a correção da medição que quase custou uma fase.
 *
 * O bloco `2_ata_sem_resultado` do QA anterior lia `raw_extraction->>'decisao'` e
 * `fundamento_decisao` — DOIS caminhos que, para filho de ata, nunca são escritos. Deu 0 em 100%
 * dos casos, e eu quase escrevi um conserto de extrator em cima disso. **100% é a assinatura de
 * consulta errada, não de dado uniforme** — é a terceira vez nesta série (`extracao_metodo`,
 * `chars_per_page`, e agora `decisao`).
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";

const RAIZ = join(__dirname, "../../../..");
const ler = (p: string) => readFileSync(join(RAIZ, p), "utf-8");
const SQL = ler("docs/qa-fase19.sql");
const CODIGO = SQL.replace(/^\s*--.*$/gm, " ");
const QA18 = ler("docs/qa-fase18.sql").replace(/^\s*--.*$/gm, " ");

describe("etapa116 · contrato do SQL Editor", () => {
  it("UM statement, leitura pura", () => {
    expect(CODIGO.trim().split(";").filter((x) => x.trim()).length).toBe(1);
    expect(CODIGO).toMatch(/^\s*SELECT jsonb_pretty/m);
    for (const proibido of [/INSERT\s/i, /UPDATE\s+\w+\s+SET/i, /DELETE\s+FROM/i, /CREATE\s/i, /ALTER\s/i]) {
      expect(CODIGO).not.toMatch(proibido);
    }
  });

  it("os 6 blocos existem", () => {
    for (const b of ["1_itens_de_ata_sem_resultado", "2_janela_de_reparo", "3_filhos_de_pauta",
                     "4_votos", "5_alarme", "6_cobertura_por_fonte"]) {
      expect(SQL, `bloco ${b} ausente`).toContain(`'${b}'`);
    }
  });
});

describe("etapa116 · a medição errada não sobrevive no repo", () => {
  it("o QA da Fase 18 parou de ler os caminhos que nunca são escritos", () => {
    expect(QA18).not.toMatch(/raw_extraction->>'decisao'/);
    expect(QA18).toMatch(/resumo_pleito/);
  });

  it("o QA novo mede o dispositivo na coluna CERTA", () => {
    expect(CODIGO).toMatch(/d\.resumo_pleito/);
    expect(CODIGO).not.toMatch(/raw_extraction->>'decisao'/);
  });
});

describe("etapa116 · mede o que esta fase escreveu", () => {
  it("a janela de reparo é medida em número — pendentes COM e SEM fonte", () => {
    expect(SQL).toMatch(/pendentes_com_fonte/);
    expect(SQL).toMatch(/pendentes_sem_fonte/);
    expect(CODIGO).toMatch(/dr\.deliberacao_id = d\.documento_pai_id/);
  });

  it("os filhos de PAUTA são contados contra a marca que os arquiva", () => {
    expect(CODIGO).toMatch(/import_counts_as_final/);
  });

  it("o que importa no fim: VOTO — e o que sobrou com resultado e sem voto", () => {
    expect(SQL).toMatch(/itens_de_ata_COM_resultado_SEM_voto/);
  });
});
