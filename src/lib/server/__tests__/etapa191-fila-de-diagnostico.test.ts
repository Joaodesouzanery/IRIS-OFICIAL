/**
 * Etapa 191 (Fase 33, Bloco B) — a INANIÇÃO POR PREFIXO, medida em vez de casada por regex.
 *
 * ═══ O que a produção mostrou ═══
 * O bloco ⑧ do `docs/qa-fase31.sql` procura `raw_extraction ? 'roster_divergente'` e vinha VAZIO.
 * A consulta de controle, `SELECT count(*) ... WHERE raw_extraction ? 'motivo_sem_voto'`, devolveu
 * **7**. Então a gravação acontecia: escrevia sete linhas e parava.
 *
 * ═══ ⚠️ E por que este arquivo existe ═══
 * `etapa180` e `etapa172` já cobriam este laço, e **as duas exigiam a presença LITERAL** da linha
 * `if (!hasBudget(deadlineAt, RESERVA_POR_ITEM_MS)) { restantes = true; break; }` — isto é,
 * canonizavam como virtude exatamente a linha que impedia a gravação. Escrevi dois testes que
 * travaram o bug, e ficaram verdes por uma fase inteira enquanto o número no banco era zero.
 * Sétima vez nesta série que eu afirmei sobre TEXTO em vez de sobre COMPORTAMENTO.
 *
 * Aqui nada é lido do fonte. A fila é construída com a forma da população real e as duas decisões
 * (reserva e ordem) são exercidas.
 */

import { describe, it, expect } from "vitest";
import {
  RESERVA_POR_ESCRITA_MS, MOTIVOS_POSTERGAVEIS,
  prioridadeDoPatch, patchJaAplicado, mesmoValorJson, planejarGravacaoDeDiagnostico,
} from "../fila-de-diagnostico";
import { resumirBackfill } from "../resumo-do-backfill";
import { naturezaDaChave } from "../agregar-rodadas";

/** A reserva que o laço usava antes: o custo de PROCESSAR um item, não de um `UPDATE`. */
const RESERVA_ANTIGA_MS = 8_000;

const DIVERGENCIA = {
  recebeu_sem_estar: ["Caio Mário Trivellato Seabra Filho"],
  presente_sem_voto: ["Tasso Mendonça Júnior", "Roger Romão Cabral"],
  presentes_nao_reconhecidos: [],
};

/**
 * A forma da população real: centenas de postergáveis descobertos ANTES do lote da rodada, e as
 * divergências de roster descobertas DEPOIS. 268 + 44 = 312, a ordem em que o `Map` as devolvia.
 */
function filaNaOrdemDeDescoberta(postergaveis = 268, divergencias = 44) {
  const fila: Array<readonly [string, Record<string, unknown>]> = [];
  for (let i = 0; i < postergaveis; i++) {
    const motivo = ["fora_de_escopo", "sem_data", "fora_da_janela_de_mandatos", "materializavel_nao_processado"][i % 4];
    fila.push([`postergavel-${i}`, { motivo_sem_voto: motivo }]);
  }
  for (let i = 0; i < divergencias; i++) {
    fila.push([`divergente-${i}`, { roster_divergente: DIVERGENCIA }]);
  }
  return fila;
}

const contarDivergencias = (f: Array<readonly [string, Record<string, unknown>]>) =>
  f.filter(([, p]) => "roster_divergente" in p).length;

describe("etapa191 · o defeito, reproduzido", () => {
  it("⚠️ com a reserva de 8s, a fatia inteira do passo paga UMA escrita", () => {
    // O passo `backfillVotos` recebe de 9 a 15s. Se o laço principal consumiu a fatia, sobra menos.
    for (const fatiaMs of [9_000, 12_000, 15_000]) {
      const { daRodada } = planejarGravacaoDeDiagnostico(filaNaOrdemDeDescoberta(), fatiaMs, RESERVA_ANTIGA_MS);
      expect(daRodada.length, `fatia de ${fatiaMs}ms`).toBeLessThanOrEqual(1);
    }
    // E se o laço principal consumiu quase tudo, a gravação escreve ZERO — por construção.
    expect(planejarGravacaoDeDiagnostico(filaNaOrdemDeDescoberta(), 7_999, RESERVA_ANTIGA_MS).daRodada).toHaveLength(0);
  });

  it("⚠️ o número 7 do banco cabe na reserva antiga — e as DUAS causas são independentes", () => {
    /**
     * ⚠️ CORREÇÃO DE UM ERRO MEU DENTRO DESTE ARQUIVO. A primeira versão desta expectativa pedia
     * `contarDivergencias === 0` passando a reserva antiga — e falhou, com razão: a função
     * consertada ordena por prioridade **independentemente da reserva**, então as 7 escritas que ela
     * paga são as 7 primeiras divergências. Eu tinha misturado as duas causas numa só expectativa.
     *
     * São independentes, e é isso que se afirma aqui e no teste seguinte:
     *  · a RESERVA decide QUANTAS escritas cabem — 7, com 8s de reserva e ~60s de sobra;
     *  · a ORDEM decide QUAIS — e a ordem antiga punha as 268 postergáveis na frente.
     * Uma sozinha não explicaria o QA: com a ordem antiga e a reserva nova, 268 escritas ainda
     * viriam antes da primeira divergência; com a ordem nova e a reserva antiga, 7 divergências já
     * teriam sido gravadas e o bloco ⑧ não estaria vazio.
     *
     * O 7 é o que o banco mostrou; a sobra entre 56s e 64s é INFERÊNCIA a partir dele, não medição.
     */
    const { daRodada, restantes } = planejarGravacaoDeDiagnostico(
      filaNaOrdemDeDescoberta(), 60_000, RESERVA_ANTIGA_MS,
    );
    expect(daRodada).toHaveLength(7);
    // Com a ordem consertada, essas 7 já seriam divergências — é o que faltava acontecer.
    expect(contarDivergencias(daRodada)).toBe(7);
    expect(restantes).toBe(true);
  });

  it("⚠️ e a ordem sozinha zera a divergência, para QUALQUER sobra que não pague o prefixo", () => {
    // Independe da reserva: enquanto o prefixo postergável vier na frente, 268 escritas não bastam.
    for (const sobraMs of [1_000, 30_000, 60_000, 100_000]) {
      const semPrioridade = [...filaNaOrdemDeDescoberta()].slice(
        0, Math.floor(sobraMs / RESERVA_POR_ESCRITA_MS),
      );
      if (semPrioridade.length >= 268) continue; // aqui o prefixo já foi pago, e a divergência entra
      expect(contarDivergencias(semPrioridade), `sobra de ${sobraMs}ms`).toBe(0);
    }
  });
});

describe("etapa191 · o conserto", () => {
  it("a divergência entra ATÉ com orçamento apertado — é a primeira da fila", () => {
    // 3s de sobra pagam 7 escritas com a reserva nova. Todas as 7 têm de ser divergência.
    const { daRodada, restantes } = planejarGravacaoDeDiagnostico(filaNaOrdemDeDescoberta(), 3_000);
    expect(daRodada).toHaveLength(7);
    expect(contarDivergencias(daRodada)).toBe(7);
    expect(restantes).toBe(true);
  });

  it("com a sobra que antes pagava 7, as 44 divergências entram TODAS", () => {
    const { daRodada } = planejarGravacaoDeDiagnostico(filaNaOrdemDeDescoberta(), 60_000);
    expect(contarDivergencias(daRodada)).toBe(44);
  });

  it("⚠️ e a reserva NOVA é estritamente menor que a do processamento", () => {
    // O invariante, não o número: 8s é o custo de ler um PDF; um `UPDATE` de uma linha não custa isso.
    expect(RESERVA_POR_ESCRITA_MS).toBeLessThan(RESERVA_ANTIGA_MS);
  });

  it("a fila que CABE inteira não declara restantes — senão a esteira nunca fecha a volta", () => {
    const { daRodada, restantes } = planejarGravacaoDeDiagnostico(filaNaOrdemDeDescoberta(4, 2), 60_000);
    expect(daRodada).toHaveLength(6);
    expect(restantes).toBe(false);
  });

  it("sem orçamento nenhum, escreve zero e DECLARA que sobrou", () => {
    const { daRodada, restantes } = planejarGravacaoDeDiagnostico(filaNaOrdemDeDescoberta(), 0);
    expect(daRodada).toHaveLength(0);
    expect(restantes).toBe(true);
  });
});

describe("etapa191 · a prioridade, item a item", () => {
  it("divergência 0 · motivo que exige ler o documento 1 · derivável de coluna 2", () => {
    expect(prioridadeDoPatch({ roster_divergente: DIVERGENCIA })).toBe(0);
    expect(prioridadeDoPatch({ motivo_sem_voto: "roster_desconhecido" })).toBe(1);
    expect(prioridadeDoPatch({ motivo_sem_voto: "sem_nomes_no_documento" })).toBe(1);
    for (const m of MOTIVOS_POSTERGAVEIS) expect(prioridadeDoPatch({ motivo_sem_voto: m }), m).toBe(2);
  });

  it("⚠️ a divergência ganha da própria companhia: patch com os DOIS vai como divergência", () => {
    // As populações se cruzam — quem tem roster divergente pode também ter motivo postergável.
    expect(prioridadeDoPatch({ motivo_sem_voto: "fora_de_escopo", roster_divergente: DIVERGENCIA })).toBe(0);
  });

  it("os quatro postergáveis são exatamente os deriváveis de coluna e o efêmero", () => {
    expect([...MOTIVOS_POSTERGAVEIS].sort()).toEqual([
      "fora_da_janela_de_mandatos", "fora_de_escopo", "materializavel_nao_processado", "sem_data",
    ]);
  });

  it("⚠️ a ordenação é ESTÁVEL dentro da prioridade — a frente da fila não pode variar por rodada", () => {
    // Se variasse, o skip perderia sentido: cada rodada tentaria um subconjunto diferente.
    const fila = filaNaOrdemDeDescoberta(6, 3);
    const a = planejarGravacaoDeDiagnostico(fila, 60_000).daRodada.map(([id]) => id);
    const b = planejarGravacaoDeDiagnostico(fila, 60_000).daRodada.map(([id]) => id);
    expect(a).toEqual(b);
    expect(a.slice(0, 3)).toEqual(["divergente-0", "divergente-1", "divergente-2"]);
  });
});

describe("etapa191 · o skip do que já está igual", () => {
  it("igual não regrava; diferente regrava", () => {
    expect(patchJaAplicado({ motivo_sem_voto: "sem_data" }, { motivo_sem_voto: "sem_data" })).toBe(true);
    expect(patchJaAplicado({ motivo_sem_voto: "sem_data" }, { motivo_sem_voto: "fora_de_escopo" })).toBe(false);
    expect(patchJaAplicado({}, { motivo_sem_voto: "sem_data" })).toBe(false);
  });

  it("⚠️ e a ORDEM DAS CHAVES não conta — o Postgres normaliza o jsonb", () => {
    /**
     * Era o modo de o skip nunca acertar: o `roster_divergente` que volta do banco tem as três
     * chaves em ordem alfabética, e o objeto recém-montado tem na ordem em que o código o escreve.
     * Com `JSON.stringify` cru, os dois nunca seriam iguais e toda rodada reescreveria os mesmos
     * bytes — o mesmo custo, com zero de progresso.
     */
    const doBanco = {
      presente_sem_voto: ["Tasso Mendonça Júnior", "Roger Romão Cabral"],
      presentes_nao_reconhecidos: [],
      recebeu_sem_estar: ["Caio Mário Trivellato Seabra Filho"],
    };
    expect(Object.keys(doBanco)).not.toEqual(Object.keys(DIVERGENCIA)); // ordens de fato diferentes
    expect(mesmoValorJson(doBanco, DIVERGENCIA)).toBe(true);
    expect(patchJaAplicado({ roster_divergente: doBanco }, { roster_divergente: DIVERGENCIA })).toBe(true);
  });

  it("⚠️ mas a ordem dos ARRAYS conta — nomes são uma lista, não um conjunto", () => {
    const trocado = { ...DIVERGENCIA, presente_sem_voto: ["Roger Romão Cabral", "Tasso Mendonça Júnior"] };
    expect(mesmoValorJson(trocado, DIVERGENCIA)).toBe(false);
  });

  it("um patch vazio é trivialmente já aplicado — e não consome escrita", () => {
    expect(patchJaAplicado({ motivo_sem_voto: "sem_data" }, {})).toBe(true);
  });

  it("chave AUSENTE no banco não é igual a chave presente no patch", () => {
    expect(patchJaAplicado({ outra_coisa: 1 }, { motivo_sem_voto: "sem_data" })).toBe(false);
  });

  it("⚠️ SEM o jsonb em mão, não é 'já aplicado' — é indecidível, e mentir aqui esconde a falha", () => {
    /**
     * ⚠️ Esta expectativa nasceu de uma MUTAÇÃO SOBREVIVENTE: `if (!base) return true` passou por
     * todas as outras 21. Eu testava `{}` (que é truthy) e nunca `undefined`.
     *
     * O risco não é escrever errado — quem chama recusa a escrita sem base, logo antes. É a
     * CONTAGEM: devolver `true` faria a linha entrar em `diagnosticos_ja_iguais`, isto é, o banner
     * diria "nada a fazer" sobre uma linha cujo valor atual nem foi possível ler. Era o formato de
     * zero que esta fase inteira está consertando.
     */
    expect(patchJaAplicado(undefined, { motivo_sem_voto: "sem_data" })).toBe(false);
    expect(patchJaAplicado(undefined, {})).toBe(false);
  });
});

describe("etapa191 · ⚠️ o desempatador que eu prometi e não existia", () => {
  it("`divergencias_gravadas` chega ao banner — antes não tinha UM leitor", () => {
    /**
     * Ele era publicado pela rota e nunca lido: nem por `resumirBackfill`, nem pela tela. E
     * `docs/qa-fase31.sql` e `docs/PENDENCIAS.md` afirmavam que aparecia no banner. Sem consumidor, o
     * bloco ⑧ podia sair vazio por rodadas sem que nada na tela mudasse.
     */
    expect(resumirBackfill({ divergencias_gravadas: 12, roster_mudaria_com_presentes_do_pai: 44 })
      .divergencias_gravadas).toBe(12);
  });

  it("⚠️ e publica o ZERO quando houve divergência medida — é o alarme", () => {
    expect(resumirBackfill({ divergencias_gravadas: 0, roster_mudaria_com_presentes_do_pai: 44 })
      .divergencias_gravadas).toBe(0);
  });

  it("rodada que não chamou o materializador não publica nada — zero sobre zero não é notícia", () => {
    expect(resumirBackfill({ divergencias_gravadas: 0, roster_mudaria_com_presentes_do_pai: 0 })
      .divergencias_gravadas).toBeUndefined();
  });

  it("⚠️ os contadores seguem NÚMERO — string sairia dos totais da run em silêncio", () => {
    /**
     * ⚠️ ERRO MEU, pego ao escrever isto. A primeira versão publicava `motivos_gravados: "7/312"`.
     * `agregarEtapas` e `registrarRodada` descartam texto na soma (é por isso que
     * `motivos_sem_voto` é string DE PROPÓSITO), então a fração teria apagado o contador dos totais
     * da run — consertar a legibilidade quebrando a agregação. O número fica número; a fração vai
     * numa chave própria.
     */
    const r = resumirBackfill({
      motivos_gravados: 7, diagnosticos_candidatos: 312, divergencias_gravadas: 3,
      roster_mudaria_com_presentes_do_pai: 44,
    });
    expect(typeof r.motivos_gravados).toBe("number");
    expect(typeof r.divergencias_gravadas).toBe("number");
    expect(naturezaDaChave("divergencias_gravadas")).toBe("evento"); // soma: cada escrita é trabalho
    expect(naturezaDaChave("diagnosticos_candidatos")).toBe("estoque"); // retrato, recalculado inteiro
    expect(naturezaDaChave("diagnosticos_ja_iguais")).toBe("parcial"); // sobre a fatia, logo repete
  });

  it("a FRAÇÃO separa convergido de quebrado — os dois zeros são idênticos sem ela", () => {
    expect(resumirBackfill({ motivos_gravados: 7, diagnosticos_candidatos: 312 }).gravacao_do_diagnostico)
      .toBe("7/312");
    expect(resumirBackfill({
      motivos_gravados: 0, diagnosticos_candidatos: 312, diagnosticos_ja_iguais: 312,
    }).gravacao_do_diagnostico).toBe("0/312 · 312 já iguais");
    // Payload antigo, sem denominador: não inventa fração.
    expect(resumirBackfill({ motivos_gravados: 7 }).gravacao_do_diagnostico).toBeUndefined();
  });
});
