import { describe, it, expect } from "vitest";
import { buildRegulatoryNewsletterHtml, type SocialPostInput } from "@/lib/newsletter-document";
import type { RegulatoryNews } from "@/types";

// Stage 2 (out/2026): a Newsletter Regulatória passou a gerar um HTML de E-MAIL table-based
// (para colar no cliente de e-mail) na identidade IRIS, com botões de seguir e cards de posts
// sociais. O canvas antigo fica só na variante "print" (PDF). Este teste trava o formato.

const noticia = (over: Partial<RegulatoryNews>): RegulatoryNews =>
  ({
    id: "n1",
    titulo: "Título de teste",
    url: "https://gov.br/antt/noticia-1",
    fonte: "ANTT",
    imagem_url: "https://gov.br/antt/foto.jpg",
    resumo: "Resumo curto de teste da notícia.",
    conteudo: null,
    publicado_em: "2026-10-01",
    agencia_sigla: "ANTT",
    ...over,
  }) as RegulatoryNews;

const social: SocialPostInput = {
  rede: "instagram",
  url: "https://www.instagram.com/p/abc123/",
  titulo: "Post do Instagram",
  resumo: "Legenda do post social.",
  imagem_url: "https://proj.supabase.co/storage/v1/object/public/newsletter-images/posts/a.jpg",
};

const input = {
  assunto: "Edição #12 — Regulação em Foco",
  descricao: "O resumo da semana regulatória.",
  noticias: [noticia({}), noticia({ id: "n2", titulo: "Segunda notícia", url: "https://gov.br/anm/n2", imagem_url: null })],
  baseUrl: "https://app.irisregulacao.org",
  documento_tipo: "newsletter_regulatoria" as const,
  template_version: "iris_newsletter_layout_v1",
  social_posts: [social],
  eventos: [{ titulo: "Fórum IRIS de Teste", data: "2026-09-24", local: "São Paulo – SP", url: "https://irisregulacao.org/evento/forum-teste/" }],
};

describe("Newsletter e-mail IRIS [Stage 2]", () => {
  const html = buildRegulatoryNewsletterHtml(input, "email");

  it("é HTML de e-mail table-based (sem <script>/@page/grid)", () => {
    expect(html).toContain("<table");
    expect(html).not.toContain("<script");
    expect(html).not.toContain("@page");
    expect(html).not.toContain("grid-template-columns");
  });

  it("traz a identidade IRIS (navy + dourado + logo + serifada)", () => {
    expect(html).toContain("#0a0e2a"); // navy
    expect(html).toContain("#c2a24a"); // dourado
    expect(html).toContain("/brand/newsletter-logo-wide.png");
    expect(html).toContain("Playfair Display");
    expect(html).toContain("Edição #12"); // título da edição (H1)
    expect(html.toLowerCase()).toContain("regulat"); // eyebrow "Atualização Regulatória"
  });

  it("hero = 1ª notícia + cards alternados p/ as demais; imagem gov.br via proxy, link e CTA", () => {
    expect(html).toContain("Título de teste"); // hero (1ª)
    expect(html).toContain("Segunda notícia"); // card seguinte
    expect(html.toLowerCase()).toContain("mais destaques"); // ribbon das notícias seguintes
    expect(html).toContain("https://app.irisregulacao.org/api/v1/noticias/imagem?url="); // imagem gov.br via proxy
    expect(html).toContain("https://gov.br/antt/noticia-1"); // link da fonte
    expect(html.toLowerCase()).toContain("ler a mat"); // "Ler a matéria"
  });

  it("renderiza o card de post social com imagem DIRETA (bucket) e botão 'ver post'", () => {
    expect(html).toContain("Post do Instagram");
    expect(html).toContain("newsletter-images/posts/a.jpg"); // imagem do bucket, sem proxy
    expect(html).not.toContain("noticias/imagem?url=https%3A%2F%2Fproj.supabase"); // social NÃO passa pelo proxy
    expect(html).toContain("https://www.instagram.com/p/abc123/");
    expect(html.toLowerCase()).toContain("ver post");
  });

  it("traz a seção de eventos do IRIS (título + data + link) e o CTA da agenda", () => {
    expect(html).toContain("Fórum IRIS de Teste");
    expect(html).toContain("24 set 2026"); // data formatada
    expect(html).toContain("https://irisregulacao.org/evento/forum-teste/");
    expect(html.toLowerCase()).toContain("próximos eventos iris");
    expect(html).toContain("https://irisregulacao.org/eventos/"); // CTA "Ver a agenda completa"
  });

  it("traz os botões de seguir o IRIS + link para o site", () => {
    expect(html).toContain("https://www.instagram.com/iris.regulacao/");
    expect(html).toContain("https://www.linkedin.com/company/irisregulacao/");
    expect(html).toContain("https://irisregulacao.org/"); // link do site (header/footer)
    expect(html.toLowerCase()).toContain("siga o iris");
  });

  it("a variante 'print' continua sendo o canvas de PDF (não o e-mail)", () => {
    const printHtml = buildRegulatoryNewsletterHtml(input, "print");
    expect(printHtml).toContain("newsletter-page");
    expect(printHtml).toContain("@page");
  });
});
