/**
 * Etapa 122 (Fase 20, commit 4) — o acervo pré-2022 entra MARCADO, e não estraga a métrica.
 *
 * ═══ O número real ═══
 * O mandato ANM verificado mais antigo começa em **05/12/2022**. A fonte nova da agência é o
 * acervo ANTIGO — reuniões de 2019, 2020, 2021. Sem distinção, cada uma dessas deliberações cai
 * em `roster_nao_conferivel`, o balde que significa "vá consertar o cadastro".
 *
 * Não há o que consertar: a plataforma não tem registro de quem estava no colegiado em 2019.
 * O efeito prático de não separar é duplo e ambos ruins — manda o operador procurar um defeito
 * inexistente, e faz a cobertura de votação PARECER que caiu quando o acervo entra. Escalar a
 * coleta da ANM passaria a PIORAR o número, que é o incentivo exatamente invertido.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";
import {
  foraDaJanelaDeMandatos,
  inicioDaJanelaConhecida,
  type JanelaDeMandato,
} from "@/lib/server/janela-de-mandatos";

/** A janela real da ANM, como está nas migrations de mandato verificado. */
const ANM: JanelaDeMandato[] = [
  { data_inicio: "2022-12-05", data_fim: null },
  { data_inicio: "2023-06-01", data_fim: "2026-11-30" },
];

describe("etapa122 · o acervo antigo é reconhecido como antigo", () => {
  it("a 79ª ROP (26/11/2025) está DENTRO da janela — ela não pode ser desculpada", () => {
    expect(foraDaJanelaDeMandatos({ dataReuniao: "2025-11-26", janelas: ANM })).toBeNull();
  });

  it("uma reunião de 2019 está FORA — e o motivo é nomeado, não genérico", () => {
    expect(foraDaJanelaDeMandatos({ dataReuniao: "2019-04-10", janelas: ANM }))
      .toBe("anterior_ao_primeiro_mandato");
  });

  it("a fronteira é o próprio dia do primeiro mandato: 05/12/2022 entra, 04/12 não", () => {
    expect(foraDaJanelaDeMandatos({ dataReuniao: "2022-12-05", janelas: ANM })).toBeNull();
    expect(foraDaJanelaDeMandatos({ dataReuniao: "2022-12-04", janelas: ANM }))
      .toBe("anterior_ao_primeiro_mandato");
  });

  it("item SEM data de reunião não é dado como dentro por omissão", () => {
    expect(foraDaJanelaDeMandatos({ dataReuniao: null, janelas: ANM })).toBe("sem_data_de_reuniao");
  });
});

describe("etapa122 · as duas recusas — a marcação não pode virar a próxima mentira", () => {
  it("agência SEM mandato nenhum não tem o acervo inteiro declarado «fora da janela»", () => {
    // Seria transformar ausência de cadastro em afirmação sobre o período — a mentira oposta.
    expect(foraDaJanelaDeMandatos({ dataReuniao: "2019-04-10", janelas: [] })).toBeNull();
    expect(inicioDaJanelaConhecida([])).toBeNull();
  });

  it("data POSTERIOR ao último mandato continua dentro — buraco recente tem de aparecer", () => {
    // Mandato em curso tem `data_fim` nulo; esconder deliberação recente seria apagar justamente
    // o dado que mais importa.
    expect(foraDaJanelaDeMandatos({ dataReuniao: "2030-01-01", janelas: ANM })).toBeNull();
  });

  it("o início da janela é o MENOR começo, não o primeiro da lista", () => {
    expect(inicioDaJanelaConhecida([
      { data_inicio: "2023-06-01" },
      { data_inicio: "2022-12-05" },
    ])).toBe("2022-12-05");
  });
});

describe("etapa122 · o materializador separa os dois baldes", () => {
  const ROTA = readFileSync(
    join(__dirname, "../../../../src/app/api/v1/admin/votos/materializar-faltantes/route.ts"),
    "utf-8",
  );

  it("o gate de janela vem ANTES do roster — senão o item volta ao balde errado", () => {
    expect(ROTA.indexOf("foraDaJanelaDeMandatos({")).toBeLessThan(ROTA.indexOf("conferirRoster({"));
  });

  it("mandato FABRICADO não amplia a janela", () => {
    // `fonte_dado='automatico'` é mandato derivado do próprio voto inferido. Aceitá-lo aqui faria
    // a janela se auto-ampliar e a plataforma afirmaria saber quem votava justamente onde não sabe.
    const janelas = ROTA.slice(ROTA.indexOf("async function janelasDa"), ROTA.indexOf("let materializaveis"));
    expect(janelas).toMatch(/\.neq\("fonte_dado", "automatico"\)/);
    expect(janelas).toMatch(/\.eq\("diretores\.review_status", "aprovado"\)/);
  });

  it("o número sai no payload separado de `roster_nao_conferivel`", () => {
    expect(ROTA).toMatch(/fora_da_janela_de_mandatos: foraDaJanela,/);
    expect(ROTA).toMatch(/fora_da_janela_por_agencia:/);
    expect(ROTA).toMatch(/roster_nao_conferivel: rosterNaoConferivel,/);
  });
});
