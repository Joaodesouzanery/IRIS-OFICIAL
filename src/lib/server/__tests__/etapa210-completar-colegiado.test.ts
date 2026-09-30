/**
 * Etapa 210 (Fase 35, Bloco G) — completar colegiado parcial: o plano, e sobretudo as RECUSAS.
 *
 * ═══ A lacuna que o QA revelou ═══
 * O materializador só visita deliberação com ZERO voto. Uma com 3 de 5 está em `comVoto` e é pulada
 * PARA SEMPRE. Por isso o José Fernando voltou ao cadastro pela migration da Fase 34 e tem **1 voto em
 * todo 2026**: os votos dele nas 84ª/85ª/86ª nunca serão refeitos pelo caminho existente. E
 * `roster-divergente`, que mede exatamente isso, é somente leitura por construção.
 *
 * ═══ Por que este arquivo é quase todo sobre o que NÃO fazer ═══
 * Afirmar que alguém votou é a escrita mais cara desta esteira. A Fase 28 registrou o caso: revisão
 * adversarial pegou um erro de leitura ignorado que produzia voto FABRICADO para o colegiado inteiro.
 * Um passo que "completa o que falta" é, por natureza, uma máquina de fabricar voto — a não ser que
 * recuse nos casos em que a fonte não sustenta. As três recusas têm um caso real cada.
 *
 * ⚠️ A ESCRITA ESTÁ DESLIGADA. Este módulo só diz o que aconteceria; o número vai à tela primeiro.
 */

import { describe, it, expect } from "vitest";
import {
  planejarCompletar,
  paresPorAgencia,
  type DeliberacaoParcial,
} from "@/lib/server/completar-colegiado";

const base = (o: Partial<DeliberacaoParcial>): DeliberacaoParcial => ({
  id: "d1", sigla: "ANM", tipo_documento: "ata", resultado: "Deferido",
  contestado: false, roster: ["mauro", "fabio", "jose", "luiz", "caio"],
  jaResponderam: ["mauro", "fabio", "luiz"], temVotoNominalDeDirecao: false, temPai: true, ...o,
});

describe("etapa210 · o plano: quem falta, e só quem falta", () => {
  it("planeja um par por diretor que não respondeu", () => {
    const p = planejarCompletar([base({})]);
    expect(p.pares.map((x) => x.diretor_id).sort()).toEqual(["caio", "jose"]);
    expect(p.recusas).toEqual([]);
  });

  it("⚠️ NÃO toca em quem já respondeu — o existente é sempre a verdade mais forte", () => {
    const p = planejarCompletar([base({ jaResponderam: ["mauro", "fabio", "jose", "luiz"] })]);
    expect(p.pares.map((x) => x.diretor_id)).toEqual(["caio"]);
  });

  it("deliberação COMPLETA não entra em pares nem em recusas", () => {
    const p = planejarCompletar([base({ jaResponderam: ["mauro", "fabio", "jose", "luiz", "caio"] })]);
    expect(p.pares).toEqual([]);
    expect(p.recusas, "contá-la como recusa inflaria o denominador do diagnóstico").toEqual([]);
  });

  it("o caso real do José Fernando: 1 de 39 itens vira 38 pares", () => {
    const itens = Array.from({ length: 39 }, (_, i) =>
      base({
        id: `item-${i + 1}`,
        roster: ["mauro", "fabio", "jose"],
        jaResponderam: i === 0 ? ["mauro", "fabio", "jose"] : ["mauro", "fabio"],
      }),
    );
    const p = planejarCompletar(itens);
    expect(p.pares.length).toBe(38);
    expect(new Set(p.pares.map((x) => x.diretor_id))).toEqual(new Set(["jose"]));
  });
});

describe("etapa210 · ⚠️ AS RECUSAS — cada uma tem um caso real por trás", () => {
  it("(a) fonte que NÃO NOMINA + voto nominal existente = voto artefato, pertence a outro passo", () => {
    /**
     * `CAPACIDADE_NOMINAL['ANTT|ata'] = 'nenhum'`: a ata da ANTT registra a decisão do colegiado, nunca
     * o voto de cada um. Se há voto nominal ali, ele é ARTEFATO (o relator gravado como se fosse o
     * colegiado) — e completar em volta dele criaria quatro votos irmãos de um voto que não devia
     * existir, multiplicando o artefato em vez de apagá-lo.
     */
    const p = planejarCompletar([
      // ⚠️ UM voto e item de ata: é exatamente o que `votoNominalImpossivel` alcança.
      base({ sigla: "ANTT", tipo_documento: "ata", temVotoNominalDeDirecao: true, jaResponderam: ["mauro"] }),
    ]);
    expect(p.pares, "completar aqui multiplicaria o artefato por cinco").toEqual([]);
    expect(p.recusas[0].motivo).toBe("voto_artefato_pendente");
  });

  it("⚠️ CORREÇÃO DESTA ETAPA: nominal que o reparo NÃO alcança recebe motivo PRÓPRIO", () => {
    /**
     * A recusa original era mais LARGA que o reparo que ela invocava: bastava "tem nominal", mas
     * `votoNominalImpossivel` exige item de ata **com exatamente um voto**. Com três votos, o reparo
     * nunca visita a linha — e o rótulo `voto_artefato_pendente` prometia um conserto que não vinha.
     * Fica parada para sempre, com o número escondido debaixo do motivo errado.
     */
    const p = planejarCompletar([
      base({ sigla: "ANTT", tipo_documento: "ata", temVotoNominalDeDirecao: true, jaResponderam: ["mauro", "fabio", "luiz"] }),
    ]);
    expect(p.pares).toEqual([]);
    expect(p.recusas[0].motivo).toBe("nominal_inconsistente");
  });

  it("e sem PAI também não é artefato — o reparo só alcança item de ata", () => {
    const p = planejarCompletar([
      base({ sigla: "ANTT", tipo_documento: "ata", temVotoNominalDeDirecao: true, jaResponderam: ["mauro"], temPai: false }),
    ]);
    expect(p.recusas[0].motivo).toBe("nominal_inconsistente");
  });

  it("⚠️ e `Ausente` NOMINAL não bloqueia nada — era o falso positivo da ARTESP", () => {
    /**
     * Uma ata da ARTESP diz quem faltou sem dizer quem votou como: `Ausente` nominal é leitura
     * legítima, não artefato. Recusar por causa dele deixaria a deliberação parcial para sempre.
     * É por isso que o campo pergunta por voto de DIREÇÃO, e não por "tem nominal".
     */
    const p = planejarCompletar([
      base({ sigla: "ARTESP", tipo_documento: "ata", temVotoNominalDeDirecao: false, jaResponderam: ["mauro"] }),
    ]);
    expect(p.pares.map((x) => x.diretor_id).sort()).toEqual(["caio", "fabio", "jose", "luiz"]);
    expect(p.recusas).toEqual([]);
  });

  it("e a MESMA fonte, sem voto nominal, é completável — a recusa é pelo artefato, não pela agência", () => {
    const p = planejarCompletar([
      base({ sigla: "ANTT", tipo_documento: "ata", temVotoNominalDeDirecao: false }),
    ]);
    expect(p.pares.length).toBe(2);
    expect(p.recusas).toEqual([]);
  });

  it("(b) CONTESTADO recusa — o desfecho não diz como cada um votou", () => {
    // Mesma regra de `shouldInferVotesFromMandate`. A Fase 21 pagou caro lendo "não houve
    // unanimidade" como consenso.
    const p = planejarCompletar([base({ contestado: true })]);
    expect(p.pares).toEqual([]);
    expect(p.recusas[0].motivo).toBe("contestado");
  });

  it("(c) SEM RESULTADO recusa — voto inferido SEGUE o desfecho (Fase 26)", () => {
    expect(planejarCompletar([base({ resultado: null })]).recusas[0].motivo).toBe("sem_resultado");
    expect(planejarCompletar([base({ resultado: "" })]).recusas[0].motivo).toBe("sem_resultado");
  });

  it("⚠️ a PRECEDÊNCIA do artefato é primeira, e isso é decisão", () => {
    /**
     * Uma linha pode ser artefato E contestada. Se o motivo publicado fosse "contestado", o artefato
     * ficaria invisível — e ele é o único dos três que pede uma AÇÃO (apagar o voto do relator), em vez
     * de apenas não agir.
     */
    const p = planejarCompletar([
      base({ sigla: "ANTT", tipo_documento: "ata", temVotoNominalDeDirecao: true, jaResponderam: ["mauro"], contestado: true }),
    ]);
    expect(p.recusas[0].motivo).toBe("voto_artefato_pendente");
  });

  it("(d) SEM ROSTER: recusa se havia voto, e silêncio se não havia nada", () => {
    // Com voto e sem roster, algo está errado no cadastro e o número tem de aparecer.
    const comVoto = planejarCompletar([base({ roster: [], jaResponderam: ["mauro"] })]);
    expect(comVoto.recusas[0].motivo).toBe("sem_roster");
    // Sem roster e sem voto não há falta DECLARÁVEL — e declarar seria afirmar sobre o que não se sabe.
    const semNada = planejarCompletar([base({ roster: [], jaResponderam: [] })]);
    expect(semNada.recusas).toEqual([]);
    expect(semNada.pares).toEqual([]);
  });

  it("a contagem por motivo fecha com a lista de recusas", () => {
    const p = planejarCompletar([
      base({ id: "a", contestado: true }),
      base({ id: "b", contestado: true }),
      base({ id: "c", resultado: null }),
      // "d" tem UM voto: é artefato de verdade. "f" tem três: o reparo não a alcança.
      base({ id: "d", sigla: "ANTT", temVotoNominalDeDirecao: true, jaResponderam: ["mauro"] }),
      base({ id: "f", sigla: "ANTT", temVotoNominalDeDirecao: true }),
      base({ id: "e" }),
    ]);
    expect(p.porMotivo).toEqual({ contestado: 2, sem_resultado: 1, voto_artefato_pendente: 1, nominal_inconsistente: 1 });
    expect(Object.values(p.porMotivo).reduce((x, y) => x + y, 0)).toBe(p.recusas.length);
    expect(p.pares.length, "só a última era completável").toBe(2);
  });
});

describe("etapa210 · o número é acionável por agência", () => {
  it("os pares são quebrados por agência — um total só não diz onde trabalhar", () => {
    const plano = planejarCompletar([
      base({ id: "anm-1" }),
      base({ id: "antt-1", sigla: "ANTT", roster: ["a", "b"], jaResponderam: ["a"] }),
    ]);
    const porAgencia = paresPorAgencia(plano, (id) => (id.startsWith("antt") ? "ANTT" : "ANM"));
    expect(porAgencia).toEqual({ ANM: 2, ANTT: 1 });
  });

  it("lista vazia não explode e não inventa número", () => {
    const p = planejarCompletar([]);
    expect(p.pares).toEqual([]);
    expect(p.recusas).toEqual([]);
    expect(p.porMotivo).toEqual({});
    expect(paresPorAgencia(p, () => "ANM")).toEqual({});
  });
});
