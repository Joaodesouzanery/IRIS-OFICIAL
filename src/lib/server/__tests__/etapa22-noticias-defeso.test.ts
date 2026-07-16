/**
 * Etapa 22 — cobertura auto-adaptável de notícias (defeso eleitoral):
 * derivação das listagens irmãs + parse de detalhe escopado na listagem variante.
 */
import { describe, it, expect } from "vitest";
import {
  siblingListingVariants,
  parseNewsDetail,
  type NewsSourceConfig,
} from "@/lib/server/news-collector";

const ANTT: NewsSourceConfig = {
  agencia_sigla: "ANTT", fonte: "ANTT",
  url: "https://www.gov.br/antt/pt-br/assuntos/ultimas-noticias", strategy: "govbr", tier: "core",
};
const ANEEL: NewsSourceConfig = {
  agencia_sigla: "ANEEL", fonte: "ANEEL",
  url: "https://www.gov.br/aneel/pt-br/assuntos/noticias", strategy: "govbr", tier: "expanded",
};
const ARTESP: NewsSourceConfig = {
  agencia_sigla: "ARTESP", fonte: "ARTESP",
  url: "https://www.artesp.sp.gov.br/artesp/noticias", strategy: "artesp", tier: "core",
};

describe("siblingListingVariants — listagens irmãs (defeso eleitoral)", () => {
  it("ANTT (ultimas-noticias) deriva defeso, noticias-1 e noticias (subseções do blackout)", () => {
    const urls = siblingListingVariants(ANTT).map((v) => v.url);
    expect(urls).toContain("https://www.gov.br/antt/pt-br/assuntos/noticias-defeso-eleitoral");
    expect(urls).toContain("https://www.gov.br/antt/pt-br/assuntos/noticias-1");
    expect(urls).toContain("https://www.gov.br/antt/pt-br/assuntos/noticias");
    // Não repete a canônica configurada.
    expect(urls).not.toContain("https://www.gov.br/antt/pt-br/assuntos/ultimas-noticias");
  });

  it("ANEEL (noticias) deriva a defeso (e outras subseções) sem repetir a própria", () => {
    const urls = siblingListingVariants(ANEEL).map((v) => v.url);
    expect(urls).toContain("https://www.gov.br/aneel/pt-br/assuntos/noticias-defeso-eleitoral");
    expect(urls).not.toContain("https://www.gov.br/aneel/pt-br/assuntos/noticias");
  });

  it("variante preserva agência/tier/strategy (só muda a URL)", () => {
    const v = siblingListingVariants(ANTT)[0];
    expect(v.agencia_sigla).toBe("ANTT");
    expect(v.strategy).toBe("govbr");
    expect(v.tier).toBe("core");
  });

  it("ARTESP (não-govbr) não tem variantes", () => {
    expect(siblingListingVariants(ARTESP)).toEqual([]);
  });
});

describe("parse de detalhe escopado na listagem variante (defeso)", () => {
  it("artigo sob /noticias-defeso-eleitoral/<slug> é aceito com o source variante", () => {
    const defeso = siblingListingVariants(ANTT).find((v) => v.url.includes("defeso"))!;
    const artigoUrl = `${defeso.url}/operacao-da-antt-identifica-sete-veiculos`;
    const html = `<!doctype html><html><head>
      <meta property="og:title" content="Operação da ANTT identifica sete veículos em transporte clandestino">
      <meta property="og:url" content="${artigoUrl}">
      <script type="application/ld+json">{"@type":"NewsArticle","datePublished":"2026-07-10"}</script>
      </head><body><article><h1>Operação da ANTT</h1>
      <p>Fiscalização encontrou diversas irregularidades durante o período de férias escolares em Goiás.</p>
      </article></body></html>`;
    const parsed = parseNewsDetail(html, { url: artigoUrl, title: "Operação da ANTT identifica sete veículos" }, defeso);
    expect(parsed).not.toBeNull();
    expect(parsed!.url).toBe(artigoUrl); // canonical aceito (escopo da listagem defeso)
    expect(parsed!.publicado_em).toContain("2026-07-10");
    expect(parsed!.agencia_sigla).toBe("ANTT");
  });
});
