/**
 * Etapa 57 — VOTO EM AUTOS: voto proferido em sessão ANTERIOR, apenas registrado nesta ata.
 *
 * Fecha a Fase 1 por um motivo material: os votos NOMINAIS da ANM vêm quase todos de blocos de
 * voto vista, e é exatamente ali que mora o voto em autos. Construir métricas de comportamento
 * antes disto seria construí-las sobre a fatia mais contaminada do corpus.
 *
 * O que estava errado sem esta etapa:
 *  - o voto entrava na série temporal do diretor na data da sessão de REGISTRO, não na data em
 *    que ele votou;
 *  - contava como presença numa sessão em que o diretor não esteve;
 *  - disparava o alarme de "voto fora do mandato" em toda ata com voto vista — ruído que treina
 *    o revisor a ignorar o alarme;
 *  - e, no backfill retroativo, o ex-diretor era descartado em SILÊNCIO, como se nunca tivesse
 *    votado.
 *
 * Os três casos abaixo são os REAIS do corpus, medidos.
 */

import { describe, it, expect, beforeAll } from "vitest";
import { readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { extractPdfText } from "@/lib/server/pdf-extractor";
import { extractVotosEmAutos, hasAdesaoVotoAnterior } from "@/lib/server/nlp-extractor";
import { splitAtaItems } from "@/lib/server/ata-splitter";

const fixturesDir = join(dirname(fileURLToPath(import.meta.url)), "fixtures/votos");
const FIXTURES = [
  "anm-ata-82-ordinaria.pdf",
  "anm-ata-32-extraordinaria.pdf",
  "artesp-ata-1201.pdf",
  "antt-pauta-1036.pdf",
] as const;
const texto: Record<string, string> = {};

beforeAll(async () => {
  for (const f of FIXTURES) {
    texto[f] = (await extractPdfText(readFileSync(join(fixturesDir, f)))).text;
  }
}, 120_000);

describe("etapa57 · os casos reais do corpus", () => {
  it("82ª: «já havia sido proferido o voto do relator original» + «então Diretor»", () => {
    const v = extractVotosEmAutos(texto["anm-ata-82-ordinaria.pdf"]);
    expect(v.map((x) => x.nome)).toEqual([
      "Caio Mário Trivellato Seabra Filho",
      "Guilherme Santana Lopes Gomes",
    ]);
  });

  it("82ª: os dois casos caem nos itens 2.3.1 e 2.3.2 — não vazam para o resto da ata", () => {
    const comAutos = splitAtaItems(texto["anm-ata-82-ordinaria.pdf"])
      .filter((i) => extractVotosEmAutos(i.raw_text).length > 0)
      .map((i) => i.item_numero);
    expect(comAutos).toEqual(["2.3.1", "2.3.2"]);
  });

  it("32ª: «antecipação de voto realizada pelo Diretor X na 73ª Reunião» — com a SESSÃO", () => {
    const v = extractVotosEmAutos(texto["anm-ata-32-extraordinaria.pdf"]);
    expect(v).toHaveLength(1);
    expect(v[0].nome).toBe("Luiz Paniago Neves");
    // A sessão é o dado que permite recolocar o voto na data certa (etapa61).
    expect(v[0].sessao).toMatch(/^73[ªa]\s*Reunião Ordinária Pública/);
  });

  it.each(["artesp-ata-1201.pdf", "antt-pauta-1036.pdf"])(
    "%s não tem voto em autos e não pode ganhar nenhum",
    (f) => {
      expect(extractVotosEmAutos(texto[f])).toEqual([]);
    },
  );
});

describe("etapa57 · guards — o que NÃO é voto em autos", () => {
  it("«aderiram ao voto vista … NA PRESENTE SESSÃO» é voto desta sessão (32ª, literal)", () => {
    const t =
      "Os demais diretores aderiram ao voto vista apresentado pelo Diretor-Geral na presente sessão.";
    expect(extractVotosEmAutos(t)).toEqual([]);
    expect(hasAdesaoVotoAnterior(t)).toBe(false);
  });

  it("«aderiram ao voto vista … POR OCASIÃO DA 32ª Reunião Extraordinária» é anterior", () => {
    expect(
      hasAdesaoVotoAnterior(
        "Os diretores aderiram ao voto vista apresentado por ocasião da 32ª Reunião Extraordinária.",
      ),
    ).toBe(true);
  });

  it("relator da sessão corrente não vira voto em autos", () => {
    expect(
      extractVotosEmAutos("VOTO DO RELATOR (Diretor Caio Mário Seabra): Diante do exposto, voto por..."),
    ).toEqual([]);
  });

  it("prosa sem nome de pessoa não vira voto em autos", () => {
    expect(extractVotosEmAutos("O então Diretor da área técnica manifestou-se nos autos.")).toEqual([]);
  });

  it("a frase quebrada pelo PDF é reconhecida (roda sobre a janela achatada)", () => {
    const v = extractVotosEmAutos(
      "Esclareceu que já havia sido proferido o voto do relator\noriginal, Diretor Caio Mário\nTrivellato Seabra Filho.",
    );
    expect(v.map((x) => x.nome)).toEqual(["Caio Mário Trivellato Seabra Filho"]);
  });

  it("nome repetido em dois marcadores entra uma vez só", () => {
    const v = extractVotosEmAutos(
      "Antecipação de voto realizada pelo Diretor Luiz Paniago Neves na 73ª Reunião Ordinária. " +
        "O então Diretor Luiz Paniago Neves havia se manifestado.",
    );
    expect(v).toHaveLength(1);
  });
});
