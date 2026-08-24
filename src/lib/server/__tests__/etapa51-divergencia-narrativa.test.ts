/**
 * Etapa 51 — DIVERGÊNCIA NARRATIVA: quem divergiu de QUEM, e quem divergiu com que NOME.
 *
 * Duas correções medidas nas atas ANM, em direções opostas:
 *
 *  1. FALSO POSITIVO fechado — "divergiu/discordou" passa a exigir objeto do COLEGIADO. Nas duas
 *     atas, 4 de 4 ocorrências verbais divergem de manifestação técnica, do posicionamento da
 *     Procuradoria ou de um Voto CS: nenhuma de um colega. Sem o objeto, cada uma viraria um
 *     "Desfavoravel" fabricado — o diretor que discordou da ÁREA TÉCNICA e teve o voto aprovado
 *     POR UNANIMIDADE apareceria como dissidente do colegiado.
 *
 *  2. FALSO NEGATIVO fechado — voto contrário citado só pelo CARGO. A 32ª/4.4.1 diz "com voto
 *     contrário do Diretor-Geral, relator original da matéria". O nome nunca aparece na linha; a
 *     divergência REAL do Diretor-Geral era perdida e, como "por maioria" esvazia o pool, o item
 *     inteiro ficava sem voto nenhum.
 *
 * Trechos LITERAIS dos PDFs oficiais.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { extractPdfText } from "@/lib/server/pdf-extractor";
import {
  extractFields,
  extractItemVotes,
  extractContrariosPorCargo,
  buildRoleMap,
  detectDivergenciaNaoAtribuida,
} from "@/lib/server/nlp-extractor";
import { splitAtaItems } from "@/lib/server/ata-splitter";

const fixturesDir = join(dirname(fileURLToPath(import.meta.url)), "fixtures/votos");

describe("etapa51 · divergir DE QUEM — objeto obrigatório do colegiado", () => {
  it.each([
    ["divergindo parcialmente das análises da área técnica", "área técnica (82ª/1.5.1 e 1.5.2)"],
    ["divergir do posicionamento da Procuradoria, desde que o faça de forma fundamentada", "Procuradoria"],
    ["voto por divergir do Voto CS/ANM n.º 533, de 15 de maio de 2025", "Voto CS/ANM"],
    ["divergindo das manifestações técnicas e jurídicas acostadas nos autos", "manifestações técnicas"],
  ])("«%s» NÃO é dissenso do colegiado", (trecho) => {
    const texto =
      `VOTO DO RELATOR (Diretor Caio Mário Trivellato Seabra Filho): Ante o exposto, ${trecho}, ` +
      `voto por dar provimento ao recurso. DELIBERAÇÃO: Voto aprovado por unanimidade.`;
    expect(extractFields(texto).nomes_votacao_contra).toEqual([]);
    expect(extractItemVotes(texto).contra).toEqual([]);
  });

  it("divergir do RELATOR continua sendo voto contrário — o objeto não desliga a deteção", () => {
    const texto = "O Diretor Tasso Mendonça Jr. divergiu do Relator e votou pelo indeferimento.";
    expect(extractItemVotes(texto).contra).toContain("Tasso Mendonça Jr");
  });

  it("«votou contrariamente» dispensa objeto — é inequívoco", () => {
    expect(
      extractItemVotes("O Diretor Roger Romão Cabral votou contrariamente ao voto do relator.").contra,
    ).toContain("Roger Romão Cabral");
  });
});

describe("etapa51 · voto contrário citado só pelo CARGO", () => {
  const roleMap = { "diretor-geral": "Mauro Henrique Moreira Sousa" };

  it("resolve o Diretor-Geral pelo preâmbulo (32ª/4.4.1, literal)", () => {
    const trecho =
      "DELIBERAÇÃO: Voto do revisor aprovado por maioria pelos diretores presentes, com voto " +
      "contrário do Diretor-Geral, relator original da matéria.";
    expect(extractContrariosPorCargo(trecho, roleMap)).toEqual(["Mauro Henrique Moreira Sousa"]);
    expect(extractItemVotes(trecho, roleMap).contra).toEqual(["Mauro Henrique Moreira Sousa"]);
  });

  it("cargo NÃO resolvido não vira voto — adivinhar quem exercia a função seria fabricar", () => {
    const trecho = "DELIBERAÇÃO: aprovado por maioria, com voto contrário do Diretor-Geral.";
    expect(extractContrariosPorCargo(trecho, {})).toEqual([]);
    expect(extractItemVotes(trecho, {}).contra).toEqual([]);
  });

  it("não confunde o cargo com um nome que comece igual", () => {
    // "do Diretor Geraldo Silva" tem de ser lido como NOME, não como cargo "Diretor-Geral".
    expect(
      extractContrariosPorCargo("com voto contrário do Diretor Geraldo Silva Santos", roleMap),
    ).toEqual([]);
  });
});

describe("etapa51 · divergência sem dissidente vira AVISO, nunca voto", () => {
  it("«voto por divergir» sem sujeito: nenhum voto, um aviso", () => {
    const texto =
      "Assim, voto por divergir do entendimento anterior. DELIBERAÇÃO: aprovado por maioria.";
    const v = extractItemVotes(texto);
    expect(v.contra).toEqual([]);
    expect(v.avisos).toHaveLength(1);
    expect(v.avisos[0]).toMatch(/sem dissidente/i);
  });

  it("com dissidente atribuído NÃO há aviso — o aviso é sobre a lacuna, não sobre o dissenso", () => {
    expect(
      detectDivergenciaNaoAtribuida("aprovado por maioria, com voto contrário do Diretor X", 1),
    ).toBeNull();
  });

  it("item unânime e sem divergência não gera aviso", () => {
    expect(extractItemVotes("DELIBERAÇÃO: Voto aprovado por unanimidade.").avisos).toEqual([]);
  });
});

describe("etapa51 · nos PDFs binários", () => {
  it("a 32ª recupera a divergência do Diretor-Geral no item 4.4.1", async () => {
    const { text } = await extractPdfText(readFileSync(join(fixturesDir, "anm-ata-32-extraordinaria.pdf")));
    const roleMap = buildRoleMap(text);
    expect(roleMap["diretor-geral"]).toBe("Mauro Henrique Moreira Sousa");

    const porItem = new Map<string, string[]>();
    for (const item of splitAtaItems(text)) {
      const v = extractItemVotes(item.raw_text, roleMap);
      if (v.contra.length) porItem.set(item.item_numero ?? "?", v.contra);
    }
    // Os três dissidentes reais da ata — e SÓ eles.
    expect(porItem.get("4.4.1")).toEqual(["Mauro Henrique Moreira Sousa"]);
    expect(porItem.get("3.3.1")).toEqual(["Tasso Mendonça Jr"]);
    expect(porItem.get("1.2.1")).toEqual(["Caio Mario Seabra Filho"]);
    expect(porItem.size).toBe(3);
  }, 60_000);

  it("a 82ª não ganha NENHUM contrário — suas 3 divergências são da área técnica", async () => {
    // É este zero que prova o guard: as 3 ocorrências de "divergindo" da 82ª são todas
    // "divergindo parcialmente das análises da área técnica", em itens APROVADOS POR UNANIMIDADE.
    const { text } = await extractPdfText(readFileSync(join(fixturesDir, "anm-ata-82-ordinaria.pdf")));
    expect(extractFields(text).nomes_votacao_contra).toEqual([]);
  }, 60_000);

  it("o espaço perdido antes do cargo é reposto — sem isso o preâmbulo da 82ª não resolve", async () => {
    // "presidida peloDiretor-Geral, Mauro…" e "presençadoDiretor Substituto Luiz…": 2 colagens
    // reais em TODO o corpus, ambas aqui, ambas travando roleMap e roster.
    const { text } = await extractPdfText(readFileSync(join(fixturesDir, "anm-ata-82-ordinaria.pdf")));
    expect(text).not.toContain("peloDiretor");
    expect(text).not.toContain("presençadoDiretor");
    expect(buildRoleMap(text)["diretor-geral"]).toBe("Mauro Henrique Moreira Sousa");
  }, 60_000);

  it("«YouTube» sobrevive — a regra é enumerada por cargo, não [a-z][A-Z] genérico", async () => {
    // Uma classe genérica partiria "YouTube" e, pior, EcoRodovias/ViaOeste/AutoBAn em produção,
    // quebrando o casamento por empresa.
    const { text } = await extractPdfText(readFileSync(join(fixturesDir, "anm-ata-82-ordinaria.pdf")));
    expect(text).toMatch(/youtube/i);
    expect(text).not.toMatch(/ou\s+Tube/);
  }, 60_000);
});
