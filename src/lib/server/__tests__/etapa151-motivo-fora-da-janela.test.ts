/**
 * Etapa 151 (Fase 28, commit 4) — "fora da janela" tem DOIS motivos, e só um fala de mandato.
 *
 * ═══ O número que o dado não sustentava ═══
 * O banner dizia "72 anterior(es) ao 1º mandato conhecido". Essa afirmação é praticamente
 * IMPOSSÍVEL para o acervo corrente: 2026 é posterior a todos os primeiros mandatos conhecidos —
 * ANM 05/12/2022, ANTT 23/12/2022, ARTESP 07/10/2024. `foraDaJanelaDeMandatos` sempre devolveu
 * dois motivos (`anterior_ao_primeiro_mandato` e `sem_data_de_reuniao`), e o materializador
 * DESCARTAVA o motivo, incrementando um contador só.
 *
 * O que estava naquele número, em boa parte, é deliberação cuja DATA a extração não achou. Um
 * defeito de EXTRAÇÃO exibido como fato de MANDATO manda o operador procurar num cadastro de
 * mandatos um problema que está no parser — e o passo que conserta (`redatar`) nunca é acionado.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";
import { foraDaJanelaDeMandatos } from "@/lib/server/janela-de-mandatos";
import { resumirBackfill, CHAVES_NUMERICAS_DO_MATERIALIZADOR } from "@/lib/server/resumo-do-backfill";

const RAIZ = join(__dirname, "../../../..");
const ler = (p: string) => readFileSync(join(RAIZ, p), "utf-8");

/** Os primeiros mandatos conhecidos, das migrations de seed. 2026 é posterior a todos. */
const PRIMEIRO_MANDATO = { ANM: "2022-12-05", ANTT: "2022-12-23", ARTESP: "2024-10-07" };

describe("etapa151 · os dois motivos são coisas diferentes e não podem virar um número só", () => {
  it.each(Object.entries(PRIMEIRO_MANDATO))(
    "%s — deliberação de 2026 SEM data não é 'anterior ao 1º mandato'",
    (_sigla, inicio) => {
      const janelas = [{ data_inicio: inicio, data_fim: null }];
      expect(foraDaJanelaDeMandatos({ dataReuniao: null, janelas })).toBe("sem_data_de_reuniao");
      // E uma COM data de 2026 não cai fora da janela de jeito nenhum.
      expect(foraDaJanelaDeMandatos({ dataReuniao: "2026-06-15", janelas })).toBeNull();
    },
  );

  it("só data realmente antiga produz 'anterior ao 1º mandato'", () => {
    const janelas = [{ data_inicio: "2024-10-07", data_fim: null }];
    expect(foraDaJanelaDeMandatos({ dataReuniao: "2019-03-01", janelas })).toBe("anterior_ao_primeiro_mandato");
  });
});

describe("etapa151 · o resumo leva os dois motivos separados, e a agência junto", () => {
  it("70 sem data e 2 anteriores não colapsam num 72", () => {
    const r = resumirBackfill({
      fora_da_janela_de_mandatos: 72,
      fora_da_janela_sem_data_de_reuniao: 70,
      fora_da_janela_anterior_ao_1o_mandato: 2,
    });
    expect(r.fora_da_janela_sem_data_de_reuniao).toBe(70);
    expect(r.fora_da_janela_anterior_ao_1o_mandato).toBe(2);
    expect(r.fora_da_janela).toBe(72); // a soma continua, por compatibilidade
  });

  it("a agência vai como STRING — objeto seria descartado em silêncio pelos consumidores", () => {
    const r = resumirBackfill({ sem_data_por_agencia: { ARTESP: 3, ANM: 41 } });
    expect(typeof r.sem_data_por_agencia).toBe("string");
    expect(r.sem_data_por_agencia).toBe("ANM 41 · ARTESP 3"); // ordenado pelo maior
  });

  it("agência sem ocorrência não polui a linha", () => {
    expect(resumirBackfill({ sem_data_por_agencia: { ANM: 0 } }).sem_data_por_agencia).toBeUndefined();
  });

  it("as duas chaves novas entram na lista que a etapa123 cobra leitor", () => {
    for (const chave of ["fora_da_janela_anterior_ao_1o_mandato", "fora_da_janela_sem_data_de_reuniao"]) {
      expect(CHAVES_NUMERICAS_DO_MATERIALIZADOR as readonly string[]).toContain(chave);
    }
  });
});

describe("etapa151 · a tela para de chamar falta de data de fato de mandato", () => {
  const tela = ler("src/app/dashboard/deliberacoes/votos-diretores/page.tsx");

  it("a linha única virou duas, e a de data diz que NÃO é mandato", () => {
    expect(tela).toMatch(/totais\.fora_da_janela_anterior_ao_1o_mandato/);
    expect(tela).toMatch(/totais\.fora_da_janela_sem_data_de_reuniao/);
    expect(tela).toMatch(/NÃO é fato de mandato: a extração não achou a data/);
    // A linha antiga somava os dois sob o rótulo errado.
    expect(tela).not.toMatch(/totais\.fora_da_janela \?\? 0\) > 0 \? `\$\{totais\.fora_da_janela\} anterior/);
  });

  it("diz o que FAZER — motivo sem instrução é silêncio com outro nome", () => {
    expect(tela).toMatch(/O passo «redatar» é quem conserta/);
  });

  it("e mostra em QUAL agência, que é o que o operador precisa para agir", () => {
    expect(tela).toMatch(/ultimas\.backfill_votos\?\.sem_data_por_agencia/);
    expect(tela).toMatch(/semDataPorAgencia \? ` \(\$\{semDataPorAgencia\}\)`/);
  });
});

describe("etapa151 · o materializador conta por motivo, não por agregado", () => {
  const rota = ler("src/app/api/v1/admin/votos/materializar-faltantes/route.ts");

  it("o motivo é USADO, não descartado", () => {
    expect(rota).toMatch(/if \(motivoFora === "sem_data_de_reuniao"\) \{/);
    expect(rota).toMatch(/foraDaJanelaSemData\+\+/);
    expect(rota).toMatch(/foraDaJanelaAnterior\+\+/);
  });

  it("e o payload publica os dois, mais a agência", () => {
    for (const chave of [
      "fora_da_janela_anterior_ao_1o_mandato: foraDaJanelaAnterior",
      "fora_da_janela_sem_data_de_reuniao: foraDaJanelaSemData",
      "sem_data_por_agencia: semDataPorAgencia",
    ]) {
      expect(rota).toContain(chave);
    }
  });
});
