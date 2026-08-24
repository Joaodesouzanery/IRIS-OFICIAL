/**
 * Etapa 62 — cobertura restante: plural e voto de qualidade.
 *
 * Dois defeitos pequenos de aparência e grandes de efeito:
 *
 * 1. **Plural.** "PROCESSOS Nº:" e "INTERESSADOS:" não casavam. A ANM agrupa vários processos num
 *    item só — a 79ª ROP tem um bloco com 44 números. O campo saía NULL, e `processo` null quebra
 *    o dedupe de item no confirm: o mesmo item volta a entrar a cada reprocessamento.
 *
 * 2. **Voto de qualidade.** Era o único voto que a ata declara com CERTEZA e o único que o sistema
 *    APAGAVA. O item casa `RE_CONTESTADO` ("voto de qualidade"), o pool inteiro era esvaziado e o
 *    item ia para revisão com ZERO voto. Esvaziar os demais está certo — num empate ninguém sabe
 *    quem votou o quê. Apagar justamente o voto NOMEADO é que não.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { extractPdfText } from "@/lib/server/pdf-extractor";
import { extractFields, extractVotoQualidade, buildRoleMap, extractItemVotes } from "@/lib/server/nlp-extractor";
import { splitAtaItems } from "@/lib/server/ata-splitter";

const fixturesDir = join(dirname(fileURLToPath(import.meta.url)), "fixtures/votos");

describe("etapa62 · plural de PROCESSOS e INTERESSADOS", () => {
  it("«PROCESSOS Nº:» é reconhecido — o singular deixava o campo null", () => {
    const f = extractFields("1.3.1 PROCESSOS Nº: 48403.933562/2015-10\nINTERESSADOS: Companhia Brasileira de Alumínio; Minegral\n");
    expect(f.processo).toBe("48403.933562/2015-10");
    expect(f.interessado).toMatch(/Companhia Brasileira de Alumínio/);
  });

  it("o singular continua funcionando — a mudança é aditiva", () => {
    const f = extractFields("PROCESSO Nº: 48405.950567/2016-78\nINTERESSADO: Vale S.A.\n");
    expect(f.processo).toBe("48405.950567/2016-78");
    expect(f.interessado).toMatch(/Vale S\.A\./);
  });

  it("item de ata com plural não perde o processo (é ele que chaveia o dedupe)", () => {
    const itens = splitAtaItems(
      "1.3.1 PROCESSOS Nº: 48403.933562/2015-10\n" +
      "INTERESSADOS: Companhia Brasileira de Alumínio\n" +
      "DELIBERAÇÃO: Voto aprovado por unanimidade pelos diretores presentes.\n",
    );
    expect(itens[0]?.processo).toBe("48403.933562/2015-10");
  });
});

describe("etapa62 · voto de qualidade", () => {
  const roleMap = { "diretor-geral": "Mauro Henrique Moreira Sousa" };

  it("resolve o autor pelo CARGO, via preâmbulo (79ª/1.4.1, literal)", () => {
    expect(
      extractVotoQualidade(
        "DELIBERAÇÃO: Voto do Relator, Diretor-Geral, aprovado por maioria dos diretores presentes " +
          "com cômputo do voto de qualidade proferido pelo Diretor-Geral.",
        roleMap,
      ),
    ).toBe("Mauro Henrique Moreira Sousa");
  });

  it("resolve o autor pelo NOME quando a ata o traz inline", () => {
    expect(
      extractVotoQualidade("aprovado com voto de qualidade proferido pelo Diretor Roger Romão Cabral.", {}),
    ).toBe("Roger Romão Cabral");
  });

  it("cargo NÃO resolvido não vira autor — adivinhar seria fabricar", () => {
    expect(extractVotoQualidade("com cômputo do voto de qualidade proferido pelo Diretor-Geral.", {}))
      .toBeNull();
  });

  it("item sem voto de qualidade devolve null", () => {
    expect(extractVotoQualidade("DELIBERAÇÃO: Voto aprovado por unanimidade.", roleMap)).toBeNull();
  });

  it("o voto de qualidade SOBREVIVE ao esvaziamento do pool", () => {
    // Sem a preservação, este item ia para revisão com ZERO voto — perdendo a única evidência
    // nominal que a ata oferece sobre um empate.
    const texto =
      "Estiveram presentes os Diretores. A sessão foi presidida pelo Diretor-Geral, " +
      "Mauro Henrique Moreira Sousa.\n" +
      "DELIBERAÇÃO: Voto do Relator aprovado por maioria dos diretores presentes com cômputo do " +
      "voto de qualidade proferido pelo Diretor-Geral.";
    const f = extractFields(texto);
    expect(f.voto_qualidade_por).toBe("Mauro Henrique Moreira Sousa");
    expect(f.nomes_votacao_favor).toContain("Mauro Henrique Moreira Sousa");
  });

  it("no caminho por ITEM o voto de qualidade também vira voto", () => {
    const v = extractItemVotes(
      "DELIBERAÇÃO: aprovado por maioria com cômputo do voto de qualidade proferido pelo Diretor-Geral.",
      roleMap,
    );
    expect(v.voto_qualidade_por).toBe("Mauro Henrique Moreira Sousa");
    expect(v.favor).toContain("Mauro Henrique Moreira Sousa");
  });

  it("no PDF real: a 79ª tem exatamente um voto de qualidade, no item 1.4.1", async () => {
    const { text } = await extractPdfText(readFileSync(join(fixturesDir, "anm-ata-79-rop.pdf")));
    const rm = buildRoleMap(text);
    expect(extractVotoQualidade(text, rm)).toBe("Mauro Henrique Moreira Sousa");
    const comQualidade = splitAtaItems(text)
      .filter((i) => extractVotoQualidade(i.raw_text, rm))
      .map((i) => i.item_numero);
    expect(comQualidade).toEqual(["1.4.1"]);
  }, 60_000);

  it.each(["anm-ata-82-ordinaria.pdf", "anm-ata-32-extraordinaria.pdf", "artesp-delib-487.pdf"])(
    "%s não tem voto de qualidade e não pode ganhar um",
    async (f) => {
      const { text } = await extractPdfText(readFileSync(join(fixturesDir, f)));
      expect(extractVotoQualidade(text, buildRoleMap(text))).toBeNull();
    },
    60_000,
  );
});
