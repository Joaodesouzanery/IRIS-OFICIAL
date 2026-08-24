/**
 * Etapa 65 — quem VENCEU não é dissidente.
 *
 * O defeito: nas atas da ANM, "divergente" qualifica divergência **do relator**, e essa posição
 * frequentemente é a que PREVALECE. As regexes de dissenso tratam
 * `divergente|dissidente|contrário|vencido` como sinônimos, então gravavam voto CONTRÁRIO para o
 * diretor cujo voto o dispositivo declara APROVADO. É o pior erro possível nesta base: não perde
 * um voto, INVERTE o sinal do diretor — e o mesmo diretor aparece no painel como oposição quando
 * foi maioria.
 *
 * Os dois casos são literais e foram lidos no binário:
 *   79ª/2.2.1 — "teve divergência apresentada pelo Diretor-Geral […] este foi APROVADO por maioria"
 *   83ª/2.3.1 — "o voto divergente do Diretor-Geral […] Voto do Revisor, Diretor-Geral, APROVADO"
 *
 * A trava é o próprio dispositivo: se a ata diz as duas coisas, quem decide é o dispositivo.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { extractPdfText } from "@/lib/server/pdf-extractor";
import { extractAutoresDoVotoAprovado, extractFields, buildRoleMap, extractItemVotes } from "@/lib/server/nlp-extractor";
import { splitAtaItems } from "@/lib/server/ata-splitter";

const fixturesDir = join(dirname(fileURLToPath(import.meta.url)), "fixtures/votos");
const DG = "Mauro Henrique Moreira Sousa";
const roleMap = { "diretor-geral": DG };

describe("etapa65 · autor do voto aprovado", () => {
  it("credita o cargo resolvido pelo preâmbulo (83ª, literal)", () => {
    expect(
      extractAutoresDoVotoAprovado("DELIBERAÇÃO: Voto do Revisor, Diretor-Geral, aprovado por maioria.", roleMap),
    ).toEqual([DG]);
  });

  it("credita o nome quando a ata o traz inline (82ª, literal)", () => {
    expect(
      extractAutoresDoVotoAprovado(
        "DELIBERAÇÃO: Voto do Relator, Diretor Caio Mário Trivellato Seabra Filho, aprovado por unanimidade.",
        roleMap,
      ),
    ).toContain("Caio Mário Trivellato Seabra Filho");
  });

  it("cargo NÃO resolvido não credita ninguém — adivinhar seria fabricar", () => {
    expect(extractAutoresDoVotoAprovado("Voto do Revisor, Diretor-Geral, aprovado por maioria.", {})).toEqual([]);
  });

  it("negação não credita: «voto do relator NÃO foi aprovado»", () => {
    expect(
      extractAutoresDoVotoAprovado("Voto do Relator, Diretor-Geral, não foi aprovado pelos demais.", roleMap),
    ).toEqual([]);
  });

  it("dispositivo sem crédito a pessoa não credita ninguém", () => {
    expect(extractAutoresDoVotoAprovado("DELIBERAÇÃO: Voto aprovado por unanimidade.", roleMap)).toEqual([]);
  });
});

describe("etapa65 · a divergência do VENCEDOR não vira voto contrário", () => {
  const textoBase =
    "A sessão foi presidida pelo Diretor-Geral, Mauro Henrique Moreira Sousa.\n";

  it("83ª: «voto divergente do Diretor-Geral» + dispositivo aprovando ⇒ NÃO é contra", () => {
    const texto =
      textoBase +
      "havia dois entendimentos formados nos autos: o voto do relator original e o voto divergente " +
      "do Diretor-Geral, acompanhado pelo Diretor Substituto Luiz Paniago Neves. " +
      "DELIBERAÇÃO: Voto do Revisor, Diretor-Geral, aprovado por maioria dos membros.";
    expect(extractFields(texto).nomes_votacao_contra ?? []).not.toContain(DG);
    expect(extractItemVotes(texto, roleMap).contra).not.toContain(DG);
  });

  it("79ª: «divergência apresentada pelo Diretor-Geral» + aprovação ⇒ NÃO é contra", () => {
    const texto =
      textoBase +
      "o voto do relator original teve divergência apresentada pelo Diretor-Geral, a qual foi " +
      "acompanhada pelo Diretor Roger Romão Cabral. " +
      "DELIBERAÇÃO: acompanhando o voto do primeiro revisor, Diretor-Geral, este foi aprovado por maioria.";
    expect(extractFields(texto).nomes_votacao_contra ?? []).not.toContain(DG);
    expect(extractItemVotes(texto, roleMap).contra).not.toContain(DG);
  });

  it("a trava NÃO engole divergência real: sem dispositivo creditando, o contrário permanece", () => {
    // 32ª REP (literal): o Diretor-Geral divergiu e PERDEU — nada no dispositivo o credita.
    const texto =
      textoBase +
      "DELIBERAÇÃO: Voto do revisor aprovado por maioria pelos diretores presentes, com voto " +
      "contrário do Diretor-Geral, relator original da matéria.";
    expect(extractFields(texto).nomes_votacao_contra ?? []).toContain(DG);
  });
});

describe("etapa65 · nos PDFs reais", () => {
  it.each([
    ["anm-ata-79-rop.pdf", "2.2.1"],
    ["anm-ata-83-rop.pdf", "2.3.1"],
  ])("%s — o Diretor-Geral venceu e não pode figurar como contrário", async (file) => {
    const { text } = await extractPdfText(readFileSync(join(fixturesDir, file)));
    const rm = buildRoleMap(text);
    expect(rm["diretor-geral"]).toBe(DG);
    expect(extractAutoresDoVotoAprovado(text, rm)).toContain(DG);
    expect(extractFields(text).nomes_votacao_contra ?? []).not.toContain(DG);
    for (const item of splitAtaItems(text)) {
      expect(extractItemVotes(item.raw_text, rm).contra, `item ${item.item_numero}`).not.toContain(DG);
    }
  }, 60_000);

  it("a 32ª mantém sua divergência REAL — a trava não é um apagador geral", async () => {
    const { text } = await extractPdfText(readFileSync(join(fixturesDir, "anm-ata-32-extraordinaria.pdf")));
    expect((extractFields(text).nomes_votacao_contra ?? []).length).toBeGreaterThan(0);
  }, 60_000);
});

describe("etapa65 · o rótulo de item tem de vir COLADO ao número", () => {
  it("número de processo em início de linha NÃO abre item (81ª, literal)", () => {
    const itens = splitAtaItems(
      "1.6.6 PROCESSO Nº: 48065.800164/2019-20\n" +
      "INTERESSADO: Fulano de Tal\n" +
      "DELIBERAÇÃO: Voto aprovado por unanimidade pelos diretores presentes.\n" +
      "48065.800164/2019-20. Acatada a posição do Relator, depois de publicado o ato, o processo deverá ser\n" +
      "remetido ao setor competente.\n",
    );
    expect(itens.map((i) => i.item_numero)).toEqual(["1.6.6"]);
  });

  it("a 81ª tem exatamente 68 itens — 70 cabeçalhos numerados menos 2 repetidos", async () => {
    const { text } = await extractPdfText(readFileSync(join(fixturesDir, "anm-ata-81-rop.pdf")));
    expect(splitAtaItems(text)).toHaveLength(68);
  }, 60_000);
});
