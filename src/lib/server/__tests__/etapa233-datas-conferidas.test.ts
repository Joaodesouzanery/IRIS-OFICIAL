/**
 * Etapa 233 (Fase 39, passo 4) — as datas conferidas que destravam o portão da ARTESP.
 *
 * O site da ARTESP respondeu ao ambiente de desenvolvimento com o desafio do Imperva ("Request
 * unsuccessful", 1.164 bytes) — não se contorna. Mas o repositório já tem a prova: o harness dos 164
 * (fixtures/votos/gabarito.json) certifica a data de três reuniões da ARTESP pelas deliberações
 * oficiais. A data de uma reunião se prova com UMA deliberação dela; a contagem de votos exige a
 * reunião inteira — por isso a ARTESP entra no portão de DATA e ainda não no gabarito de VOTOS.
 *
 * ⚠️ O teste que importa é o primeiro: nenhuma data daqui pode divergir do harness. Duas verdades
 * sobre a mesma reunião é o defeito que "uma fonte por conceito" existe para impedir.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";
import { DATAS_CONFERIDAS } from "../gabarito";
import { planejarAtasAnm, type DelibParaData } from "../datas-a-corrigir";

const HARNESS = JSON.parse(readFileSync(join(__dirname, "fixtures/votos/gabarito.json"), "utf-8")) as {
  docs: Array<{ file: string; agencia_sigla: string; tipo_documento: string; data_reuniao: string | null; fonte?: string }>;
};

describe("etapa233 · cada data conferida é a do harness certificado", () => {
  it("toda fonte existe no harness, é ata ou deliberação, da mesma agência e com a MESMA data", () => {
    for (const d of DATAS_CONFERIDAS) {
      expect(d.fontes.length, `${d.agencia} ${d.reuniao} sem fonte`).toBeGreaterThan(0);
      for (const arquivo of d.fontes) {
        const doc = HARNESS.docs.find((x) => x.file === arquivo);
        expect(doc, `${arquivo} não está no harness`).toBeDefined();
        expect(["ata", "deliberacao"]).toContain(doc!.tipo_documento);
        expect(doc!.agencia_sigla).toBe(d.agencia);
        expect(doc!.data_reuniao, `${arquivo}: harness diz ${doc!.data_reuniao}, datas-conferidas diz ${d.data_reuniao}`).toBe(d.data_reuniao);
      }
    }
  });

  it("e a fonte fala da MESMA reunião (o número aparece na descrição do PDF)", () => {
    for (const d of DATAS_CONFERIDAS) {
      const n = d.reuniao.replace(/\./g, "").match(/\d+/)![0];
      for (const arquivo of d.fontes) {
        const doc = HARNESS.docs.find((x) => x.file === arquivo)!;
        expect(`${doc.file} ${doc.fonte ?? ""}`.replace(/\./g, ""), `${arquivo} não cita a ${d.reuniao}`).toMatch(new RegExp(`\\b${n}`));
      }
    }
  });

  it("as três agências têm âncora — a ARTESP deixou de ficar 'sem ata para conferir'", () => {
    const porAgencia = new Set(DATAS_CONFERIDAS.map((d) => d.agencia));
    expect([...porAgencia].sort()).toEqual(["ANM", "ANTT", "ARTESP"]);
    expect(DATAS_CONFERIDAS.filter((d) => d.agencia === "ARTESP").map((d) => d.reuniao)).toEqual(["1177ª", "236ª", "1201ª"]);
  });

  it("pauta NÃO entra — pauta não prova a data da reunião", () => {
    const fontes = DATAS_CONFERIDAS.flatMap((d) => d.fontes);
    expect(fontes.some((f) => f.includes("pauta"))).toBe(false);
  });
});

describe("etapa233 · o portão da ANM casa por SÉRIE — a 32ª REP não é a 32ª ROP", () => {
  const mae = (n: string, serie: string, doTexto: string): DelibParaData & { dataDoTexto: string } => ({
    id: `${serie}-${n}`, agencia: "ANM", agencia_id: "anm", numero_reuniao: n, serie,
    data_reuniao: doTexto, documento_pai_id: null, dataDoTexto: doTexto,
  });

  it("uma ROP antiga de número 32 não reprova (nem aprova) a âncora da 32ª REP", () => {
    const p = planejarAtasAnm({
      maes: [mae("32", "ordinaria", "2019-05-01"), mae("81", "ordinaria", "2026-01-28")],
      atasDoGabarito: DATAS_CONFERIDAS,
    });
    expect(p.portoes.ANM).toMatchObject({ aprovado: true, conferidas: 1, batem: 1 });
  });
});
