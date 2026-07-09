/**
 * Etapa 19 — Notícias: nunca vazar lixo (JSON-LD cru / resumo de 1 caractere) e
 * manter a imagem lead do gov.br mesmo quando a validação por rede falha.
 */
import { describe, it, expect } from "vitest";
import {
  parseNewsDetail,
  isJunkText,
  sanitizeResumo,
  type NewsSourceConfig,
} from "@/lib/server/news-collector";
import { looksLikeJunkResumo } from "@/lib/news-repairs";

const ANATEL: NewsSourceConfig = {
  agencia_sigla: "ANATEL", fonte: "ANATEL",
  url: "https://www.gov.br/anatel/pt-br/assuntos/noticias", strategy: "govbr", tier: "core",
};

describe("isJunkText / sanitizeResumo", () => {
  it("rejeita JSON-LD cru, HTML e fragmentos de 1 caractere", () => {
    expect(isJunkText('{"@context": "http://schema.')).toBe(true);
    expect(isJunkText("<div>algo</div>")).toBe(true);
    expect(isJunkText('{"@type":"NewsArticle"')).toBe(true);
    expect(sanitizeResumo('{"@context": "http://schema.')).toBeNull();
    expect(sanitizeResumo("i")).toBeNull();
    expect(sanitizeResumo("   ")).toBeNull();
    expect(sanitizeResumo("Curto.")).toBeNull(); // < piso de comprimento
  });

  it("aceita um resumo real de notícia", () => {
    const real = "A ANATEL aprovou nesta terça-feira o novo regulamento de qualidade dos serviços de telecomunicações, com metas de atendimento.";
    expect(isJunkText(real)).toBe(false);
    expect(sanitizeResumo(real)).toBe(real);
  });
});

describe("parseNewsDetail — página Volto/React sem <p> (gov.br)", () => {
  // Reproduz o caso ANEEL: corpo renderizado por JS, só há <script ld+json> no HTML
  // estático. Antes, o resumo vazava como `{"@context": "http://schema.`.
  const html = `<!doctype html><html><head>
    <title>Defeso Eleitoral</title>
    <script type="application/ld+json">{"@context":"http://schema.org","@type":"NewsArticle","headline":"Defeso Eleitoral","datePublished":"2026-07-06"}</script>
    </head><body><div id="root"><h1>Defeso Eleitoral</h1></div></body></html>`;

  it("nunca produz resumo/conteúdo com JSON-LD cru", () => {
    const parsed = parseNewsDetail(html, { url: "https://www.gov.br/anatel/pt-br/x", title: "Defeso Eleitoral" }, ANATEL);
    expect(parsed).not.toBeNull();
    expect(parsed!.resumo ?? "").not.toContain("@context");
    expect(parsed!.resumo ?? "").not.toContain("schema.");
    expect(parsed!.conteudo ?? "").not.toContain("@context");
    // Sem corpo real → resumo nulo (o front mostra "Sem resumo disponível", nunca lixo).
    expect(parsed!.resumo).toBeNull();
  });

  it("usa a lead-image do gov.br como candidato (mantida para o proxy revalidar)", () => {
    const parsed = parseNewsDetail(html, {
      url: "https://www.gov.br/anatel/pt-br/x",
      title: "Defeso Eleitoral",
      imageUrl: "https://www.gov.br/anatel/pt-br/x/@@images/image/large",
      imageSource: "govbr api lead image",
    }, ANATEL);
    expect(parsed!.imagem_url).toContain("/@@images/image");
    expect(parsed!.metadata.image_source).toBe("govbr api lead image");
  });
});

describe("backstop de listagem (looksLikeJunkResumo)", () => {
  it("marca resumo-lixo já persistido para ser zerado no card", () => {
    expect(looksLikeJunkResumo('{"@context": "http://schema.')).toBe(true);
    expect(looksLikeJunkResumo("i")).toBe(true);
    expect(looksLikeJunkResumo("Resumo real e suficientemente longo da notícia regulatória.")).toBe(false);
    expect(looksLikeJunkResumo(null)).toBe(false); // já tratado como "sem resumo"
  });
});
