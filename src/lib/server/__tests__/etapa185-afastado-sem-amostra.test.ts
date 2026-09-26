/**
 * Etapa 185 (Fase 31, Bloco 4) — o detector de "afastado" NÃO foi escrito, e o motivo é medição.
 *
 * ═══ A hipótese, e o que o repositório de fato sustenta ═══
 * O usuário apontou: *"Caio Mário aparece como 'afastado' na 79ª e não consta como presente na 81ª
 * nem na 83ª, mas tem mandato ativo até 12/2026 no cadastro."* Eu aceitei a primeira metade e planejei
 * um detector de marcador de afastamento, "medido e desligado".
 *
 * Fui conferir antes de escrever, e o repositório diz outra coisa:
 *
 *   · o preâmbulo REAL da 79ª ROP (`PREAMBULO_79`, travado em `etapa24` desde a Fase 7) **não contém
 *     "afastad"** — Caio Mário simplesmente NÃO É NOMEADO ali. A ausência dele é por OMISSÃO;
 *   · a única menção a ele no código é da 83ª, e é como RELATOR ANTERIOR: *"por se tratar de matéria
 *     anteriormente relatada pelo Diretor Caio Mário …, NÃO HAVIA IMPEDIMENTO"*. Há guard explícito
 *     (`RE_IMPEDIMENTO_NEGADO`) para não ler isso como impedimento;
 *   · ZERO fixtures do repo têm a palavra num rótulo de ausência.
 *
 * ═══ Por que NÃO escrever o detector agora ═══
 * Escrever regex sem amostra real é exatamente o erro que produziu a CP850: a Fase 14 ACERTOU ao
 * descartar CP437 (testou) e ERROU ao concluir Latin-1 (não testou), e o custo foi 538 nomes
 * corrompidos mais três fases de diagnóstico errado.
 *
 * ⚠️ E "medido e desligado" NÃO se aplica aqui. Esse padrão é para uma mudança CONHECIDA cujo
 * impacto se quer ver antes de valer. Aqui não se conhece a forma do que se detectaria — uma
 * constante desligada daria a aparência de trabalho feito esperando aprovação, quando o que falta é
 * o dado.
 *
 * ═══ O que existe no lugar ═══
 * Os blocos ⑩ e ⑪ do `qa-fase31.sql` buscam a frase no `raw_text` (índice trigram, ILIKE barato) e
 * devolvem o TRECHO. Com a frase na mão, a regex nasce de amostra.
 *
 * ⚠️ E se o bloco ⑪ vier sem "afastad", a resposta para a 79ª já está escrita e é outra: a ausência
 * é por omissão, e quem a conserta é `PRESENTES_DO_PAI_VALEM` (Commits J/N), não um detector.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";
import { extractPresentes, extractAusentesComOrigem } from "@/lib/server/nlp-extractor";

const RAIZ = join(__dirname, "../../../..");
const ler = (p: string) => readFileSync(join(RAIZ, p), "utf-8");
const QA31 = ler("docs/qa-fase31.sql");
const NLP = ler("src/lib/server/nlp-extractor.ts");

/** O preâmbulo REAL da 79ª ROP, o mesmo texto travado em `etapa24` desde a Fase 7. */
const PREAMBULO_79 =
  "Aos vinte e seis dias do mês de novembro de dois mil e vinte e cinco, teve início a 79ª Reunião " +
  "Ordinária Pública da Diretoria Colegiada da Agência Nacional de Mineração - ANM. A sessão foi " +
  "presidida pelo Diretor-Geral, Mauro Henrique Moreira Sousa, e contou com a presença do Diretor " +
  "Tasso Mendonça Júnior, do Diretor Roger Romão Cabral e do Diretor José Fernando de Mendonça " +
  "Gomes Júnior. Também estiveram presentes o Procurador-Chefe, Thiago de Freitas Benevenuto, " +
  "representando a Procuradoria Federal Especializada junto à ANM - PFE/ANM, o Ouvidor interino, " +
  "André Elias Marques e o Secretário-Geral, Caio Vasconcelos de Azevedo, da Secretaria Geral - SG.";

describe("etapa185 · ⚠️ o que a 79ª REALMENTE diz sobre Caio Mário", () => {
  it("o preâmbulo NÃO contém marcador de afastamento — nem a palavra", () => {
    expect(PREAMBULO_79.toLowerCase()).not.toContain("afastad");
    expect(PREAMBULO_79.toLowerCase()).not.toContain("ausente");
  });

  it("⚠️ e NÃO nomeia Caio Mário: a ausência dele é por OMISSÃO", () => {
    /**
     * Esta é a correção da premissa. "Aparece como afastado" e "não é mencionado" levam a consertos
     * DIFERENTES: a primeira pediria um detector de afastamento; a segunda já é resolvida por fazer
     * a lista de presentes da ata valer — que é o `PRESENTES_DO_PAI_VALEM`, já medido e desligado.
     *
     * ⚠️ O homônimo: "Caio Vasconcelos de Azevedo" (Secretário-Geral) ESTÁ no preâmbulo. Um teste
     * que procurasse só "Caio" concluiria o contrário do que é verdade.
     */
    expect(PREAMBULO_79).not.toContain("Caio Mário");
    expect(PREAMBULO_79, "o homônimo do Secretário-Geral está lá — não confundir").toContain("Caio Vasconcelos");
    const roster = extractPresentes(PREAMBULO_79);
    expect(roster.some((n) => n.includes("Caio"))).toBe(false);
  });

  it("os quatro que a ata nomeia continuam saindo do extrator", () => {
    const roster = extractPresentes(PREAMBULO_79);
    for (const nome of ["Mauro Henrique Moreira Sousa", "Tasso Mendonça Júnior",
                        "Roger Romão Cabral", "José Fernando de Mendonça Gomes Júnior"]) {
      expect(roster, `o extrator perdeu ${nome}`).toContain(nome);
    }
  });

  it("e nenhum ausente é extraído dali — não há rótulo nem prosa de ausência", () => {
    expect(extractAusentesComOrigem(PREAMBULO_79)).toEqual([]);
  });

  it("a única menção a Caio Mário no código é da 83ª, como RELATOR — com guard contra lê-la errado", () => {
    expect(NLP).toMatch(/anteriormente relatada pelo Diretor Caio Mário/);
    expect(NLP).toMatch(/const RE_IMPEDIMENTO_NEGADO = /);
  });
});

describe("etapa185 · ⚠️ o detector NÃO existe, e a ausência é declarada", () => {
  it("não há constante desligada esperando aprovação — não há o que ligar", () => {
    /**
     * Uma `const AFASTADO_VALE = false` daria a aparência de trabalho feito à espera de decisão,
     * quando o que falta é o DADO. O padrão "medido e desligado" serve para mudança conhecida cujo
     * impacto se quer ver antes de valer; ele não serve para hipótese sem amostra.
     */
    expect(NLP).not.toMatch(/AFASTAD[OA]_?(?:VALE|CONTA|É_AUSENCIA)/i);
    expect(NLP, "apareceu um detector de afastamento sem amostra que o justifique")
      .not.toMatch(/RE_(?:VOTO_)?AFASTAD/);
  });

  it("⚠️ `afastamento` continua sendo LIMPADOR DE NOME, não detector — e isso está declarado", () => {
    // `RE_MOTIVO_DE_AUSENCIA` tem a palavra, mas existe para o motivo não virar sobrenome. Confundir
    // os dois papéis foi o que me fez achar, no começo, que a detecção já existia.
    expect(NLP).toMatch(/const RE_MOTIVO_DE_AUSENCIA = \/\\b\(\?:afastamento\|/);
    expect(NLP).toMatch(/nunca em nome de pessoa/);
  });

  it("⚠️ e o ADJETIVO `afastado` não está nem nessa lista — só o substantivo", () => {
    // Detalhe que sustenta o diagnóstico: mesmo o limpador de nome não veria "afastado".
    const i = NLP.indexOf("const RE_MOTIVO_DE_AUSENCIA = ");
    const linha = NLP.slice(i, NLP.indexOf("\n", i));
    expect(linha).toContain("afastamento");
    expect(linha).not.toMatch(/\bafastad[oa]\b/);
  });

  it("`RE_AUSENTE_LABEL` continua exigindo rótulo com dois-pontos — prosa não casa", () => {
    // É o rótulo real da ARTESP. Relaxá-lo para prosa faria "ausência de impugnações" virar ausência
    // de diretor, e o comentário no arquivo diz exatamente isso.
    expect(NLP).toMatch(/const RE_AUSENTE_LABEL = \/\(\?:Ausente\[s\]\?\|Aus\[êe\]ncia\[s\]\?\\s\+Justificada\[s\]\?\):/);
  });
});

describe("etapa185 · os blocos de QA que vão buscar a frase", () => {
  it("⑩ busca `afastad` no `raw_text` e devolve o TRECHO, com contagem de ocorrências", () => {
    expect(QA31).toMatch(/'10_frase_do_afastamento'/);
    expect(QA31).toMatch(/d\.raw_text ILIKE '%afastad%'/);
    expect(QA31).toMatch(/AS trecho,/);
    expect(QA31).toMatch(/AS ocorrencias/);
  });

  it("⚠️ e EXCLUI «Afastamento em Férias», que é o rótulo já tratado da ARTESP", () => {
    // Sem isso o bloco devolveria dezenas de casos conhecidos e esconderia a classe nova.
    expect(QA31).toMatch(/AND d\.raw_text NOT ILIKE '%Afastamento em F%rias%'/);
  });

  it("⑪ traz o preâmbulo CRU da 79ª, com as duas perguntas binárias", () => {
    expect(QA31).toMatch(/'11_preambulo_da_79'/);
    expect(QA31).toMatch(/d\.raw_text ILIKE '%afastad%' AS menciona_afastado/);
    expect(QA31).toMatch(/d\.raw_text ILIKE '%Caio M%' AS menciona_caio_mario/);
  });

  it("⚠️ ⑪ lê o PAI da ata — o preâmbulo não está nos filhos", () => {
    // É a mesma causa raiz do Commit J: `nomes_presentes` é do pai e não é propagado aos filhos.
    expect(QA31).toMatch(/AND d\.documento_pai_id IS NULL   -- o PAI da ata carrega o preambulo/);
  });

  it("e o bloco ⑩ declara POR QUE existe: não escrever regex sem amostra", () => {
    const i = QA31.indexOf("'10_frase_do_afastamento'");
    const antes = QA31.slice(Math.max(0, i - 2000), i);
    expect(antes).toMatch(/NAO TENHO A FRASE/);
    expect(antes).toMatch(/CP850|CP437/);
    expect(antes).toMatch(/por OMISSAO/);
  });
});
