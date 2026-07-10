/**
 * Etapa 20 — imagem sempre (host oficial) + cobertura das fontes expanded
 * (não descartar notícia sem data).
 */
import { describe, it, expect } from "vitest";
import {
  parseNewsDetail,
  isOfficialImageHost,
  type NewsSourceConfig,
} from "@/lib/server/news-collector";

const ANATEL_EXPANDED: NewsSourceConfig = {
  agencia_sigla: "ANATEL", fonte: "ANATEL",
  url: "https://www.gov.br/anatel/pt-br/assuntos/noticias", strategy: "govbr", tier: "expanded",
};
const ANM_CORE: NewsSourceConfig = {
  agencia_sigla: "ANM", fonte: "ANM",
  url: "https://www.gov.br/anm/pt-br/assuntos/noticias", strategy: "govbr", tier: "core",
};

describe("isOfficialImageHost", () => {
  it("aceita gov.br e sp.gov.br; recusa terceiros", () => {
    expect(isOfficialImageHost("https://www.gov.br/anm/x/@@images/abc.jpeg")).toBe(true);
    expect(isOfficialImageHost("https://www.artesp.sp.gov.br/x/foto.jpg")).toBe(true);
    expect(isOfficialImageHost("https://cdn.terceiro.com/foto.jpg")).toBe(false);
    expect(isOfficialImageHost("não-é-url")).toBe(false);
  });
});

describe("expanded — não descartar notícia sem data (QA Etapa 20)", () => {
  // Página com título + corpo, porém SEM qualquer data (nem JSON-LD, nem meta, nem <time>).
  const semData = `<!doctype html><html><head><title>ANATEL aprova novo regulamento</title></head>
    <body><article><h1>ANATEL aprova novo regulamento de qualidade</h1>
    <p>A agência aprovou nesta sessão o novo regulamento de qualidade dos serviços, com metas de atendimento e prazos.</p>
    </article></body></html>`;

  it("expanded SEM data agora é MANTIDA (publicado_em null), não mais descartada", () => {
    const parsed = parseNewsDetail(semData, { url: "https://www.gov.br/anatel/pt-br/assuntos/noticias/x", title: "ANATEL aprova novo regulamento" }, ANATEL_EXPANDED);
    expect(parsed).not.toBeNull();
    expect(parsed!.titulo.length).toBeGreaterThan(0);
    expect(parsed!.publicado_em).toBeNull();
  });

  it("expanded SEM título continua descartada (estrutural)", () => {
    const semTitulo = `<!doctype html><html><head></head><body><article><p>corpo sem titulo algum aqui</p></article></body></html>`;
    const parsed = parseNewsDetail(semTitulo, { url: "https://www.gov.br/anatel/pt-br/assuntos/noticias/y", title: "" }, ANATEL_EXPANDED);
    expect(parsed).toBeNull();
  });

  it("core (ANM) segue aceitando sem data, como antes", () => {
    const parsed = parseNewsDetail(semData, { url: "https://www.gov.br/anm/pt-br/assuntos/noticias/z", title: "ANM nota" }, ANM_CORE);
    expect(parsed).not.toBeNull();
  });
});
