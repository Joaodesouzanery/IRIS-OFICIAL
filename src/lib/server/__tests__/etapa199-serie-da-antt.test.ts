/**
 * Etapa 199 (Fase 34, Bloco 5) — ⚠️ MOJIBAKE NO CÓDIGO-FONTE, e toda RDE virava "ordinaria".
 *
 * ═══ O defeito, confirmado por hexdump ═══
 * `formatMeetingTitle` tinha mojibake DUPLO-CODIFICADO escrito no próprio arquivo: `c3 83 c2 a3`
 * onde deveria haver `c3 a3` (`ã`), `c3 83 c2 b4` no lugar de `ô`, `c3 82 c2 aa` no lugar de `ª`. O
 * arquivo misturava as duas grafias — poucas linhas abaixo, `Reunião` estava correto.
 *
 * ═══ Por que não era cosmético ═══
 * `deriveSerie` normaliza com NFD e remove as combinantes. Mas o `´` de `EletrÃ´nica` é **U+00B4,
 * espaçador**, não combinante: ele SOBREVIVE. O texto vira `eletra´nica`, o `includes("eletronic")`
 * falha, e a função cai no `return "ordinaria"` final. Idem `ExtraordinÃ¡ria` → `extraordina¡ria`.
 *
 * **Toda RDE e toda Extraordinária da ANTT eram gravadas com `serie = 'ordinaria'`.** E a série é o
 * eixo em que a numeração faz sentido: sem ela a 271ª RDE e a 1.028ª Reunião de Diretoria caem na
 * mesma sequência, e o placar não consegue agrupar.
 *
 * ⚠️ Contradição interna que isso produzia: `extractMeeting` grava `tipo_reuniao='Extraordinaria'`
 * CORRETAMENTE. A linha ficava com `tipo_reuniao='Extraordinaria'` e `serie='ordinaria'`. E o degrau
 * do backfill de `20260825120000` que derivaria a série de `tipo_reuniao` nunca dispara, porque só
 * roda `WHERE serie IS NULL`.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";
import { deriveSerie } from "../reunioes";

const RAIZ = join(__dirname, "../../../..");
const PARSER = readFileSync(join(RAIZ, "src/lib/server/antt-manual-parser.ts"), "utf-8");

describe("etapa199 · ⚠️ a série sai certa dos títulos REAIS da ANTT", () => {
  it("RDE, Reunião de Diretoria, Extraordinária e Ordinária, cada uma na sua série", () => {
    expect(deriveSerie("264ª Reunião Deliberativa Eletrônica")).toBe("eletronica");
    expect(deriveSerie("1.028ª Reunião de Diretoria Pública")).toBe("ordinaria");
    expect(deriveSerie("99ª Reunião Extraordinária de Diretoria")).toBe("extraordinaria");
    expect(deriveSerie("85ª Reunião Ordinária Pública")).toBe("ordinaria");
  });

  it("⚠️ e o mojibake, se voltasse, daria a série ERRADA — é o teste do DEFEITO, não do conserto", () => {
    // Se `deriveSerie` passar a aceitar estas, o conserto virou remendo no leitor em vez de na
    // fonte, e a linha gravada continuaria com o título feio.
    expect(deriveSerie("264Âª ReuniÃ£o Deliberativa EletrÃ´nica")).not.toBe("eletronica");
    expect(deriveSerie("99Âª ReuniÃ£o ExtraordinÃ¡ria de Diretoria")).not.toBe("extraordinaria");
  });

  it("⚠️ o U+00B4 é ESPAÇADOR — é por isso que o NFD não o removia", () => {
    const limpo = "EletrÃ´nica".toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
    expect(limpo).toContain("´");
    expect(limpo).not.toContain("eletronic");
    // Já o acento CERTO some, e é o que faz o `includes` acertar.
    expect("Eletrônica".toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "")).toBe("eletronica");
  });
});

describe("etapa199 · ⚠️ as REGEXES do fonte, exercidas contra texto ACENTUADO real", () => {
  /**
   * ⚠️ O teste LÊ a regex do arquivo e a roda. É a única forma de pegar esta classe de defeito: uma
   * classe de caracteres com mojibake parece correta na revisão de código e falha em silêncio só
   * quando o texto tem acento — e o parser da ANTT roda quase sempre sobre texto já normalizado por
   * `plain()`, então o caminho acentuado fica meses sem ser exercitado.
   *
   * Medido ANTES do conserto:
   *   `ELETR[OÃ”]NICA` → a classe é {O, Ã, ”}; um `Ô` real (U+00D4) NÃO casa.
   *   `(?:Âª|a)?`      → exige a sequência `Â`+`ª`; o `ª` real fica sem consumidor e a regex falha.
   *   `[A-ZÃÃ‰ÃÃ“Ãš…]` → "DIRETOR: JOSÉ FERNANDO" capturava só **"JOS"**, truncando no acento.
   */
  function regexDoFonte(marcador: string): RegExp {
    const linha = PARSER.split("\n").find((l) => l.includes(marcador));
    expect(linha, `não achei a linha de ${marcador}`).toBeTruthy();
    const m = linha!.match(/\/(.+)\/[a-z]*\)/);
    expect(m, `não achei a regex em ${marcador}`).toBeTruthy();
    return new RegExp(m![1], "i");
  }

  it("as três séries casam o título ACENTUADO, como o PDF o traz", () => {
    expect("264ª REUNIÃO DELIBERATIVA ELETRÔNICA".match(regexDoFonte("const rde ="))?.[1]).toBe("264");
    expect("1.028ª REUNIÃO DE DIRETORIA PÚBLICA".match(regexDoFonte("const publica ="))?.[1]).toBe("1.028");
    expect("99ª REUNIÃO EXTRAORDINÁRIA DE DIRETORIA".match(regexDoFonte("const extraordinaria ="))?.[1]).toBe("99");
  });

  it("e continuam casando a forma SEM acento, que é a que `plain()` produz", () => {
    // O caminho que funcionava por acidente não pode quebrar no conserto.
    expect("264a REUNIAO DELIBERATIVA ELETRONICA".match(regexDoFonte("const rde ="))?.[1]).toBe("264");
    expect("1.028a REUNIAO DE DIRETORIA PUBLICA".match(regexDoFonte("const publica ="))?.[1]).toBe("1.028");
  });

  it("⚠️⚠️ o nome do relator ACENTUADO não é mais truncado no acento", () => {
    /**
     * `extractRelatorForBlock` roda sobre `cleanText(...)`, que PRESERVA acento (não é `plain`).
     * Com a classe antiga, "DIRETOR: JOSÉ FERNANDO GOMES JÚNIOR" virava relator **"Jos"** — e um
     * relator de três letras não casa com diretor nenhum, então o voto dele sumia. Não mordeu na
     * ANTT porque os cinco nomes de lá não têm acento; morderia no primeiro que tiver.
     */
    const rx = regexDoFonte("const sectionRelator =");
    expect("DIRETOR: JOSÉ FERNANDO GOMES JÚNIOR".match(rx)?.[1]?.trim()).toBe("JOSÉ FERNANDO GOMES JÚNIOR");
    expect("DIRETOR-GERAL: MAURO HENRIQUE MOREIRA SOUSA".match(rx)?.[1]?.trim())
      .toBe("MAURO HENRIQUE MOREIRA SOUSA");
  });
});

describe("etapa199 · o título é montado com escapes, e o fonte não regride", () => {
  it("⚠️ escapes unicode, que não se corrompem em cópia/colagem", () => {
    // Escrever `ã` direto voltaria a depender do encoding de quem editar o arquivo — foi assim que o
    // defeito entrou, e o arquivo chegou a ter as duas grafias convivendo.
    expect(PARSER).toMatch(/Reuni\\u00e3o Deliberativa Eletr\\u00f4nica/);
    expect(PARSER).toMatch(/Reuni\\u00e3o Extraordin\\u00e1ria de Diretoria/);
    expect(PARSER).toMatch(/Reuni\\u00e3o de Diretoria P\\u00fablica/);
  });

  it("⚠️ e o mojibake que SOBRA está CONGELADO — só pode cair, nunca subir", () => {
    /**
     * ⚠️ Eu NÃO consertei o arquivo inteiro, e digo por quê: medi cada ocorrência restante e elas
     * FUNCIONAM — `[Âºo]` contém o `º` real, `Decis[aÃ£]o` casa `Decisão` por causa do `/i`, e
     * `plain()` substitui `[ÂºÂª]` por "a" acertando os dois reais. Mexer no que funciona por
     * acidente, sem uma medição que mostre o defeito, é como este projeto já quebrou coisa antes.
     *
     * O que fica é a TRAVA: o número não pode crescer. Quem acrescentar mojibake novo reprova; quem
     * limpar mais, baixa o teto.
     */
    const seqs = [
      "Ã£", "Ã´", "Ãº", "Ã¡", "Âª",
      "Âº", "Ãƒ", "Ã”", "Ãª", "Ã­", "Ã§",
    ];
    const semComentario = PARSER.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/\/\/[^\n]*/g, " ");
    const total = seqs.reduce((t, q) => t + (semComentario.split(q).length - 1), 0);
    expect(total, "apareceu mojibake NOVO no parser da ANTT").toBeLessThanOrEqual(29);
  });
});
