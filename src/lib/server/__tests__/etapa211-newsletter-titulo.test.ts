/**
 * Etapa 211 (Fase 35, Bloco H) — o título da notícia na Newsletter, e o override de IMAGEM que já
 * estava quebrado na mesma linha.
 *
 * ═══ O que eu ia supor errado ═══
 * Não existe coluna de título editado em `regulatory_news` — **e nem de texto editado**. O texto que o
 * usuário já edita hoje não é gravado na notícia: viaja como mapa `{id: texto}` no corpo do "Salvar
 * edição", é normalizado contra os ids SELECIONADOS, entra no HTML gerado e fica espelhado no
 * `metadata` da edição.
 *
 * Isso muda o desenho: seguir o molde significa **não criar migration**. E é a escolha certa por um
 * motivo de dado, não de esforço — a notícia original continua sendo a chave de busca, de dedupe e de
 * auditoria. Editar o título para a newsletter não pode mudar a chave pela qual a notícia é encontrada.
 *
 * ═══ ⚠️ E o defeito que já existia, consertado no mesmo commit ═══
 * `newsletterImagens` era normalizado e gravado no `metadata`, mas **não entrava em
 * `entradaDoDocumento`** — e é ela que alimenta os dois builders. O usuário trocava a imagem, salvava,
 * e o `html_print` guardado saía com a ORIGINAL. O preview mostrava a nova (o cliente monta a entrada
 * dele com as imagens), então o defeito só aparecia na exportação.
 *
 * A `etapa103` não pegou porque ela verifica que o builder é chamado com `"print"` — não COM QUE
 * ENTRADA. Se eu repetisse o esquecimento com o título, a edição salva exportaria o título velho.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";
import { buildRegulatoryNewsletterHtml } from "@/lib/newsletter-document";

const RAIZ = join(__dirname, "../../../..");
const ler = (p: string) => readFileSync(join(RAIZ, p), "utf-8");
const semComentarios = (t: string) =>
  t.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/\/\/[^\n]*/g, " ");

const noticia = (id: string, titulo: string) => ({
  id,
  titulo,
  url: `https://exemplo.gov.br/${id}`,
  resumo: `Resumo da ${id} com texto suficiente para o corpo do artigo ser montado sem cair no fallback.`,
  conteudo: `Conteúdo longo da ${id}. `.repeat(20),
  fonte: "ANTT",
  agencia_sigla: "ANTT",
  data_publicacao: "2026-09-01",
} as any);

const entrada = (extra: Record<string, unknown> = {}) => ({
  assunto: "Newsletter de teste",
  descricao: "",
  destinatarios: [],
  temas: [],
  noticias: [noticia("n1", "Titulo ORIGINAL da principal"), noticia("n2", "Titulo ORIGINAL da lateral"), noticia("n3", "Terceira original")],
  documento_tipo: "newsletter_regulatoria",
  ...extra,
} as any);

describe("etapa211 · o título editado aparece nas DUAS saídas", () => {
  it("⚠️ no e-mail", () => {
    const html = buildRegulatoryNewsletterHtml(
      entrada({ newsletter_titulos: { n1: "MANCHETE EDITADA PARA A EDICAO" } }),
      "email",
    );
    expect(html).toContain("MANCHETE EDITADA PARA A EDICAO");
    expect(html, "o original não pode sobreviver ao lado do editado").not.toContain("Titulo ORIGINAL da principal");
  });

  it("⚠️ e na IMPRESSÃO — que é o caminho que o `html_print` salva", () => {
    const html = buildRegulatoryNewsletterHtml(
      entrada({ newsletter_titulos: { n1: "MANCHETE EDITADA PARA A EDICAO" } }),
      "print",
    );
    expect(html).toContain("MANCHETE EDITADA PARA A EDICAO");
    expect(html).not.toContain("Titulo ORIGINAL da principal");
  });

  it("a notícia LATERAL também aceita título editado, nas duas saídas", () => {
    for (const modo of ["email", "print"] as const) {
      const html = buildRegulatoryNewsletterHtml(
        entrada({ newsletter_titulos: { n2: "LATERAL EDITADA" } }),
        modo,
      );
      expect(html, `modo ${modo}`).toContain("LATERAL EDITADA");
      expect(html, `modo ${modo}`).not.toContain("Titulo ORIGINAL da lateral");
    }
  });

  it("sem override, o ORIGINAL é mantido — é o que mantém a `etapa30` verde", () => {
    for (const modo of ["email", "print"] as const) {
      const html = buildRegulatoryNewsletterHtml(entrada({}), modo);
      expect(html, `modo ${modo}`).toContain("Titulo ORIGINAL da principal");
    }
  });

  it("⚠️ string VAZIA não apaga o título — cai no original", () => {
    // `?? item.titulo` deixaria passar `""`; por isso o helper devolve `null` para vazio.
    const html = buildRegulatoryNewsletterHtml(entrada({ newsletter_titulos: { n1: "   " } }), "print");
    expect(html).toContain("Titulo ORIGINAL da principal");
  });

  it("mapa com id que NÃO está na edição não afeta nada", () => {
    const html = buildRegulatoryNewsletterHtml(
      entrada({ newsletter_titulos: { "id-que-nao-existe": "LIXO" } }),
      "print",
    );
    expect(html).not.toContain("LIXO");
    expect(html).toContain("Titulo ORIGINAL da principal");
  });

  it("o título editado é ESCAPADO — mapa vem do cliente", () => {
    const html = buildRegulatoryNewsletterHtml(
      entrada({ newsletter_titulos: { n1: '<script>alert(1)</script>' } }),
      "print",
    );
    expect(html, "HTML cru do cliente no documento seria injeção").not.toContain("<script>alert(1)</script>");
    expect(html).toContain("&lt;script&gt;");
  });
});

describe("etapa211 · ⚠️ o override de IMAGEM chega à entrada que o `html_print` usa", () => {
  const ROTA = semComentarios(ler("src/app/api/v1/newsletter/edicoes/route.ts"));

  it("`newsletter_imagens` está em `entradaDoDocumento`, não só no `metadata`", () => {
    const i = ROTA.indexOf("const entradaDoDocumento = {");
    expect(i, "a entrada do documento desapareceu").toBeGreaterThan(-1);
    const bloco = ROTA.slice(i, ROTA.indexOf("};", i));
    expect(bloco, "sem isto, trocar a imagem e salvar exporta a ORIGINAL").toMatch(
      /newsletter_imagens: newsletterImagens/,
    );
  });

  it("e o título também — os dois na MESMA entrada, que alimenta os dois builders", () => {
    const i = ROTA.indexOf("const entradaDoDocumento = {");
    const bloco = ROTA.slice(i, ROTA.indexOf("};", i));
    expect(bloco).toMatch(/newsletter_titulos: newsletterTitulos/);
    expect(bloco).toMatch(/newsletter_textos: newsletterTextos/);
  });

  it("⚠️ e os DOIS builders saem da MESMA entrada — senão e-mail e PDF divergem", () => {
    expect(ROTA).toMatch(/const html = buildRegulatoryNewsletterHtml\(entradaDoDocumento\);/);
    expect(ROTA).toMatch(/const htmlPrint = buildRegulatoryNewsletterHtml\(entradaDoDocumento, "print"\);/);
  });

  it("o espelho no `metadata` continua, para a edição salva poder ser reaberta", () => {
    const i = ROTA.indexOf("metadata: {");
    const bloco = ROTA.slice(i, ROTA.indexOf("},", i));
    expect(bloco).toMatch(/newsletter_titulos: newsletterTitulos/);
    expect(bloco).toMatch(/newsletter_imagens: newsletterImagens/);
  });
});

describe("etapa211 · o normalizador só aceita o que a edição selecionou", () => {
  const ROTA = semComentarios(ler("src/app/api/v1/newsletter/edicoes/route.ts"));

  it("o mapa é filtrado pelos ids SELECIONADOS — ele vem do cliente", () => {
    const i = ROTA.indexOf("function normalizeNewsletterArticleTitles");
    expect(i, "o normalizador de títulos desapareceu").toBeGreaterThan(-1);
    const corpo = ROTA.slice(i, i + 900);
    expect(corpo).toMatch(/const allowedIds = selectedNews\.map\(/);
    expect(corpo, "sem o filtro, um id arbitrário do cliente entraria no metadata").toMatch(
      /allowedIds\.forEach/,
    );
  });

  it("e tem LIMITE de tamanho, igual ao da tela", () => {
    const i = ROTA.indexOf("function normalizeNewsletterArticleTitles");
    expect(ROTA.slice(i, i + 900)).toMatch(/normalizeOptionalString\(raw\[id\], 300\)/);
    const TELA = semComentarios(ler("src/app/dashboard/noticias/page.tsx"));
    expect(TELA, "limite divergente produz corte surpresa ao salvar").toMatch(
      /NEWSLETTER_TITULO_LIMITE = 300/,
    );
  });
});

describe("etapa211 · a tela manda só o que MUDOU, e não toca a notícia original", () => {
  const TELA = semComentarios(ler("src/app/dashboard/noticias/page.tsx"));

  it("o memo descarta título igual ao original", () => {
    /**
     * Mandar o original de volta faria toda notícia parecer editada no `metadata` da edição — e aí
     * ninguém distingue depois o que foi decisão editorial de o que veio da fonte.
     */
    expect(TELA).toMatch(/if \(!value \|\| value === item\.titulo\) return acc;/);
  });

  it("o preview e o salvar usam o MESMO mapa — senão o que se vê não é o que se salva", () => {
    const usos = (TELA.match(/newsletter_titulos: newsletterTitleOverrides/g) ?? []).length;
    expect(usos, "o `documentInput` (preview) e o corpo do salvar precisam dos dois").toBe(2);
  });

  it("⚠️ e NÃO existe escrita em `regulatory_news` para o título", () => {
    // A notícia original é a chave de busca, dedupe e auditoria. O título da edição é da EDIÇÃO.
    expect(TELA).not.toMatch(/from\("regulatory_news"\)[\s\S]{0,200}update\(/);
    const ROTA = semComentarios(ler("src/app/api/v1/newsletter/edicoes/route.ts"));
    expect(ROTA, "a rota passou a ESCREVER na notícia — o título da edição não pode fazer isso")
      .not.toMatch(/from\("regulatory_news"\)\s*\.\s*update\(/);
  });
});
