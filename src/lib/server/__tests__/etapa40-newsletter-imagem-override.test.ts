import { describe, it, expect } from "vitest";
import { buildRegulatoryNewsletterHtml } from "@/lib/newsletter-document";
import type { RegulatoryNews } from "@/types";

// ago/2026: no PDF (impressão) da Newsletter, o usuário pode REMOVER a imagem de uma notícia
// ou TROCÁ-LA por outra (hospedada no bucket). O e-mail segue com as imagens originais.

const noticia = (id: string, imagem: string | null): RegulatoryNews =>
  ({
    id,
    titulo: `Notícia ${id}`,
    url: `https://gov.br/antt/${id}`,
    fonte: "ANTT",
    imagem_url: imagem,
    resumo: "Resumo de teste.",
    conteudo: null,
    publicado_em: "2026-08-01",
    agencia_sigla: "ANTT",
  }) as RegulatoryNews;

const BUCKET_URL = "https://proj.supabase.co/storage/v1/object/public/newsletter-images/posts/troca.jpg";

const input = {
  assunto: "Edição de teste",
  noticias: [
    noticia("n1", "https://gov.br/antt/foto1.jpg"),
    noticia("n2", "https://gov.br/antt/foto2.jpg"),
    noticia("n3", "https://gov.br/antt/foto3.jpg"),
  ],
  baseUrl: "https://app.irisregulacao.org",
  documento_tipo: "newsletter_regulatoria" as const,
  template_version: "iris_newsletter_layout_v1",
  newsletter_imagens: { n1: null, n2: BUCKET_URL } as Record<string, string | null>,
};

describe("override de imagem no PDF (impressão) [etapa40]", () => {
  const printHtml = buildRegulatoryNewsletterHtml(input, "print");
  const emailHtml = buildRegulatoryNewsletterHtml(input, "email");

  it("PRINT: n1 sem imagem (removida), n2 com a imagem TROCADA (bucket, direto, sem proxy), n3 original", () => {
    expect(printHtml).not.toContain("foto1.jpg"); // removida
    expect(printHtml).toContain(BUCKET_URL); // trocada — URL direta
    expect(printHtml).not.toContain(encodeURIComponent(BUCKET_URL)); // NÃO passa pelo proxy gov.br
    expect(printHtml).toContain(encodeURIComponent("https://gov.br/antt/foto3.jpg")); // original via proxy
  });

  it("EMAIL: segue com as imagens ORIGINAIS (override é só do PDF)", () => {
    expect(emailHtml).toContain(encodeURIComponent("https://gov.br/antt/foto1.jpg"));
    expect(emailHtml).not.toContain(BUCKET_URL);
  });
});
