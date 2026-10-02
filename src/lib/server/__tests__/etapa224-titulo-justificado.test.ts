/**
 * Etapa 224 — "Justificar" o título da notícia na Newsletter.
 *
 * ═══ O pedido ═══
 * "Em notícias, ... quero poder 'Justificar' os títulos das notícias da Newsletter. Para ficarem
 * justificadas." — um controle por notícia que aplica `text-align: justify` ao bloco do título, no
 * e-mail e no PDF/impressão.
 *
 * ═══ Por que é um campo PRÓPRIO, e não um efeito colateral do título editado ═══
 * `newsletter_titulos` (o texto do título nesta edição) e `newsletter_titulos_justificados` (se o
 * bloco justifica) são dois conceitos independentes: dá para justificar o título ORIGINAL sem
 * reescrevê-lo, e dá para reescrever o título sem justificá-lo. Misturar os dois faria desmarcar
 * "Justificar" perder também o texto editado, ou vice-versa.
 *
 * ═══ Por que é UMA função pura, usada nos QUATRO pontos de render ═══
 * A Newsletter tem duas variantes de layout (`v1` com estilo inline, `v2` com classe CSS) e cada
 * uma renderiza o título principal e os títulos secundários separadamente — quatro pontos. Uma
 * função (`tituloJustificadoAttr`) decide uma vez o que "justificado" produz em CSS; os quatro
 * pontos só concatenam. Divergir nisso seria o título justificar no e-mail e não no PDF (ou
 * vice-versa) sem ninguém perceber.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";
import { buildRegulatoryNewsletterHtml, type NewsletterDocumentInput } from "../../newsletter-document";
import type { RegulatoryNews } from "../../../types";

const RAIZ = join(__dirname, "../../../..");
const ler = (p: string) => readFileSync(join(RAIZ, p), "utf-8");
const semComentarios = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/\/\/[^\n]*/g, " ");

const LIB = semComentarios(ler("src/lib/newsletter-document.ts"));
const TELA = semComentarios(ler("src/app/dashboard/noticias/page.tsx"));
const RASCUNHO = semComentarios(ler("src/lib/noticias-rascunho.ts"));

const noticia = (over: Partial<RegulatoryNews> = {}): RegulatoryNews => ({
  id: "n1",
  agencia_sigla: "ANTT",
  titulo: "ANTT publica nova resolução sobre pedágios",
  resumo: "A ANTT publicou hoje uma resolução que regulamenta o reajuste dos pedágios nas rodovias federais concedidas, trazendo critérios mais claros para o cálculo anual.",
  conteudo: null,
  url: "https://www.gov.br/antt/pt-br/assuntos/noticias/exemplo",
  fonte: "ANTT",
  imagem_url: null,
  publicado_em: "2026-10-01",
  first_seen_at: "2026-10-01",
  last_seen_at: "2026-10-01",
  status: "novo",
  ...over,
} as RegulatoryNews);

function input(over: Partial<NewsletterDocumentInput> = {}): NewsletterDocumentInput {
  return {
    assunto: "Edição de teste",
    noticias: [noticia(), noticia({ id: "n2", titulo: "Segunda notícia" }), noticia({ id: "n3", titulo: "Terceira notícia" })],
    ...over,
  };
}

describe("etapa224 · o título justifica no HTML gerado, nos dois templates", () => {
  it("v1 (e-mail): justificado entra no style do <h2> do destaque principal", () => {
    const html = buildRegulatoryNewsletterHtml(
      input({ template_version: "iris_newsletter_layout_v1", newsletter_titulos_justificados: { n1: true } }),
      "email",
    );
    const i = html.indexOf("<h2");
    const tag = html.slice(i, html.indexOf(">", i) + 1);
    expect(tag, "o <h2> do destaque não ganhou text-align: justify").toMatch(/text-align:\s*justify/);
  });

  it("⚠️ e SEM a marcação, o título NÃO justifica — o padrão é não mexer no alinhamento", () => {
    const html = buildRegulatoryNewsletterHtml(
      input({ template_version: "iris_newsletter_layout_v1" }),
      "email",
    );
    const i = html.indexOf("<h2");
    const tag = html.slice(i, html.indexOf(">", i) + 1);
    expect(tag).not.toMatch(/text-align:\s*justify/);
  });

  it("v2 (PDF/impressão): justificado entra no <h2 class=\"main-title\">", () => {
    const html = buildRegulatoryNewsletterHtml(
      input({ template_version: "iris_newsletter_layout_v2", newsletter_titulos_justificados: { n1: true } }),
      "print",
    );
    const i = html.indexOf('class="main-title"');
    const tag = html.slice(Math.max(0, i - 20), html.indexOf(">", i) + 1);
    expect(tag).toMatch(/text-align:\s*justify/);
  });

  it("v2: o título SECUNDÁRIO (side-title) justifica independente do principal", () => {
    const html = buildRegulatoryNewsletterHtml(
      input({ template_version: "iris_newsletter_layout_v2", newsletter_titulos_justificados: { n2: true } }),
      "print",
    );
    const iPrincipal = html.indexOf('class="main-title"');
    const tagPrincipal = html.slice(Math.max(0, iPrincipal - 20), html.indexOf(">", iPrincipal) + 1);
    expect(tagPrincipal, "o principal (n1) justificou sem estar marcado").not.toMatch(/text-align:\s*justify/);

    const iSecundario = html.indexOf('class="side-title"');
    const tagSecundario = html.slice(Math.max(0, iSecundario - 20), html.indexOf(">", iSecundario) + 1);
    expect(tagSecundario, "o secundário marcado (n2) não justificou").toMatch(/text-align:\s*justify/);
  });

  it("⚠️ é INDEPENDENTE do título editado — justifica o título ORIGINAL sem reescrevê-lo", () => {
    const html = buildRegulatoryNewsletterHtml(
      input({
        template_version: "iris_newsletter_layout_v1",
        newsletter_titulos_justificados: { n1: true },
        // SEM newsletter_titulos — o título não foi editado.
      }),
      "email",
    );
    expect(html).toContain("ANTT publica nova resolução sobre pedágios");
    const i = html.indexOf("<h2");
    expect(html.slice(i, html.indexOf(">", i) + 1)).toMatch(/text-align:\s*justify/);
  });

  it("e, ao contrário, o título EDITADO não força justificar", () => {
    const html = buildRegulatoryNewsletterHtml(
      input({ template_version: "iris_newsletter_layout_v1", newsletter_titulos: { n1: "Título reescrito" } }),
      "email",
    );
    expect(html).toContain("Título reescrito");
    const i = html.indexOf("<h2");
    expect(html.slice(i, html.indexOf(">", i) + 1)).not.toMatch(/text-align:\s*justify/);
  });
});

describe("etapa224 · uma função só decide, os quatro pontos de render só concatenam", () => {
  it("existe `tituloJustificadoAttr`, e ela é chamada nos quatro pontos", () => {
    expect(LIB).toMatch(/function tituloJustificadoAttr\(/);
    const usos = (LIB.match(/tituloJustificadoAttr\(/g) ?? []).length;
    // 1 declaração + 4 usos (h2/h3 do v1 inline, main-title e side-title do v2).
    expect(usos, "algum dos quatro pontos deixou de chamar a função única").toBeGreaterThanOrEqual(5);
  });

  it("⚠️ e NENHUM dos quatro pontos de TÍTULO escreve `text-align: justify` por conta própria", () => {
    /**
     * ⚠️ O corpo do artigo (`.main-body`/`.side-excerpt`) já usa `text-align:justify` por DESIGN —
     * não relacionado a este pedido. Por isso a checagem é escopada à função
     * `tituloJustificadoAttr`, e não ao arquivo inteiro: um "exatamente 1 no arquivo todo" reprovaria
     * por causa do corpo, que é um conceito diferente.
     */
    const i = LIB.indexOf("function tituloJustificadoAttr(");
    const fimFuncao = LIB.indexOf("\n}", i);
    const dentro = (LIB.slice(i, fimFuncao).match(/text-align:\s*justify/g) ?? []).length;
    expect(dentro, "a função não contém mais o literal — virou outra coisa?").toBe(1);
    const fora = LIB.slice(0, i) + LIB.slice(fimFuncao);
    const total = (fora.match(/text-align:\s*justify/g) ?? []).length;
    // 2 é o CORPO do artigo (`.main-body`, `.side-excerpt`), que já justifica por design e não
    // tem relação com este pedido — contado à parte para o teste 2 blocos acima continuar
    // vigiando por regra separada (ver "e os títulos existentes seguem incluindo o corpo").
    expect(total, "um dos quatro pontos de título passou a escrever o CSS direto, fora da função única").toBe(2);
  });
});

describe("etapa224 · a tela: o controle, o estado e a persistência", () => {
  it("o botão 'Justificar' existe, por notícia, chamando o toggle", () => {
    expect(TELA).toMatch(/toggleNewsletterArticleTitleJustify\(item\.id\)/);
    expect(TELA).toMatch(/Justificar/);
  });

  it("⚠️ o estado é um TOGGLE — marcar entra, desmarcar REMOVE (não grava `false`)", () => {
    const i = TELA.indexOf("function toggleNewsletterArticleTitleJustify");
    expect(i).toBeGreaterThan(-1);
    const bloco = TELA.slice(i, i + 300);
    expect(bloco, "o toggle passou a gravar `false` em vez de remover a chave").toMatch(/delete next\[id\]/);
  });

  it("o memo derivado só manda `true`, e só de quem está selecionado NESTA edição", () => {
    const i = TELA.indexOf("const newsletterTitleJustifyOverrides = useMemo");
    expect(i).toBeGreaterThan(-1);
    const bloco = TELA.slice(i, i + 500);
    expect(bloco).toMatch(/newsletterSelected\.reduce/);
    expect(bloco).toMatch(/if \(newsletterArticleTitleJustify\[item\.id\]\) acc\[item\.id\] = true;/);
  });

  it("entra em `documentInput`, e nas dependências do memo — senão marcar não atualiza a prévia", () => {
    expect(TELA).toMatch(/newsletter_titulos_justificados: newsletterTitleJustifyOverrides,/);
    const i = TELA.indexOf("const documentInput = useMemo(");
    const fimDeps = TELA.indexOf("]);", TELA.indexOf("}), [", i));
    const deps = TELA.slice(TELA.indexOf("}), [", i), fimDeps);
    expect(deps, "newsletterTitleJustifyOverrides faltando nas dependências do documentInput — mesmo defeito da etapa214").toMatch(/newsletterTitleJustifyOverrides/);
  });
});

describe("etapa224 · a marcação sobrevive a sair da tela (rascunho)", () => {
  it("o rascunho tem o campo, e a restauração + gravação o tocam", () => {
    expect(RASCUNHO).toMatch(/newsletterArticleTitleJustify: Record<string, boolean>/);
    expect(TELA).toMatch(/setNewsletterArticleTitleJustify\(rascunho\.newsletterArticleTitleJustify\)/);
    expect(TELA).toMatch(/newsletterArticleTitleJustify,\s*\n\s*newsletterImagens,/);
  });

  it("⚠️ a leitura do rascunho filtra a `=== true` — não deixa `false` voltar como justificado", () => {
    expect(RASCUNHO).toMatch(/\.filter\(\(\[, v\]\) => v === true\)/);
  });
});
