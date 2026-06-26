import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it, expect } from "vitest";
import { parseNewsDetail, extractNewsAnchors, extractDateFromText, type NewsSourceConfig } from "@/lib/server/news-collector";

const here = dirname(fileURLToPath(import.meta.url));
const fx = (p: string) => readFileSync(join(here, "fixtures/news", p), "utf-8");

const ANTT: NewsSourceConfig = { agencia_sigla: "ANTT", fonte: "ANTT", url: "https://www.gov.br/antt/pt-br/assuntos/ultimas-noticias", strategy: "govbr", tier: "core" };
const ANM: NewsSourceConfig = { agencia_sigla: "ANM", fonte: "ANM", url: "https://www.gov.br/anm/pt-br/assuntos/noticias", strategy: "govbr", tier: "core" };
const ARTESP: NewsSourceConfig = { agencia_sigla: "ARTESP", fonte: "ARTESP", url: "https://www.artesp.sp.gov.br/artesp/noticias", strategy: "artesp", tier: "core" };

// ─── Parser de datas (PT por extenso, ISO, DD/MM/YYYY) ──────────────────────
describe("extractDateFromText", () => {
  it("entende data por extenso em português", () => {
    expect(extractDateFromText("Publicado em 23 de junho de 2026")).toMatch(/^2026-06-23/);
  });
  it("entende DD/MM/YYYY", () => {
    expect(extractDateFromText("10/06/2026 14h30")).toMatch(/^2026-06-10/);
  });
  it("entende ISO", () => {
    expect(extractDateFromText("2026-03-15T10:00:00-03:00")).toMatch(/^2026-03-15/);
  });
  it("retorna null sem data", () => {
    expect(extractDateFromText("texto sem nenhuma data reconhecível")).toBeNull();
  });
});

// ─── Extração de âncoras das listagens reais (anti-quebra de layout) ────────
describe("extractNewsAnchors — listagens reais", () => {
  it("ANTT: encontra links de notícia na listagem", () => {
    const anchors = extractNewsAnchors(fx("antt/listing.html"), ANTT.url, "govbr");
    const detalhes = anchors.filter((a) => /\/ultimas-noticias\/[a-z0-9-]{12,}/.test(a.href));
    expect(detalhes.length).toBeGreaterThanOrEqual(3);
  });
  it("ANM: encontra links de notícia na listagem", () => {
    const anchors = extractNewsAnchors(fx("anm/listing.html"), ANM.url, "govbr");
    const detalhes = anchors.filter((a) => /\/noticias\/[a-z0-9-]{12,}/.test(a.href));
    expect(detalhes.length).toBeGreaterThanOrEqual(3);
  });
  it("ARTESP: encontra links de notícia na listagem", () => {
    const anchors = extractNewsAnchors(fx("artesp/listing.html"), ARTESP.url, "artesp");
    const detalhes = anchors.filter((a) => a.href.includes("/artesp/noticias/"));
    expect(detalhes.length).toBeGreaterThanOrEqual(2);
  });
});

// ─── Robustez do parser de âncoras com HTML malformado ──────────────────────
describe("extractNewsAnchors — HTML malformado", () => {
  it("extrai links mesmo com aspas simples, sem aspas e tags não fechadas", () => {
    const anchors = extractNewsAnchors(fx("synthetic/messy-listing.html"), ANTT.url, "govbr");
    const hrefs = anchors.map((a) => a.href);
    expect(hrefs.some((h) => h.includes("antt-aprova-revisao-tarifaria-da-concessionaria-exemplo"))).toBe(true);
    expect(anchors.filter((a) => /\/ultimas-noticias\/[a-z0-9-]{12,}/.test(a.href)).length).toBeGreaterThanOrEqual(3);
  });
});

// ─── Detalhe real: título, data, imagem, conteúdo ───────────────────────────
describe("parseNewsDetail — detalhe real", () => {
  it("ANTT (gov.br): extrai título, data ISO, imagem oficial e conteúdo", () => {
    const link = { url: "https://www.gov.br/antt/pt-br/assuntos/ultimas-noticias/antt-abre-audiencia-publica-sobre-a-taxa-de-retorno-das-concessoes-rodoviarias-federais", title: "fallback" };
    const item = parseNewsDetail(fx("antt/detail.html"), link, ANTT);
    expect(item).not.toBeNull();
    expect(item!.titulo.length).toBeGreaterThan(10);
    expect(item!.publicado_em).toMatch(/^202[3-7]-/); // data plausível
    expect(item!.imagem_url ?? "").toContain("gov.br");
    expect((item!.conteudo ?? "").length).toBeGreaterThan(100);
  });
  it("ARTESP (Liferay): extrai título sem quebrar", () => {
    const link = { url: "https://www.artesp.sp.gov.br/artesp/noticias/corpuschristi", title: "fallback" };
    const item = parseNewsDetail(fx("artesp/detail.html"), link, ARTESP);
    expect(item).not.toBeNull();
    expect(item!.titulo.length).toBeGreaterThan(3);
  });
});

// ─── Garantias de robustez (sintéticos) ─────────────────────────────────────
describe("parseNewsDetail — robustez (sintéticos)", () => {
  const link = { url: "https://www.gov.br/antt/pt-br/assuntos/ultimas-noticias/noticia-sintetica", title: "fallback" };

  it("usa a data do JSON-LD quando não há metatag de data", () => {
    const item = parseNewsDetail(fx("synthetic/govbr-jsonld-date.html"), link, ANTT);
    expect(item).not.toBeNull();
    expect(item!.publicado_em).toMatch(/^2026-03-15/);
    expect(item!.imagem_url ?? "").toContain("foto.png");
    expect(item!.titulo.toLowerCase()).toContain("resolução");
  });

  it("entende data por extenso em português na página", () => {
    const item = parseNewsDetail(fx("synthetic/pt-longform-date.html"), link, ANTT);
    expect(item).not.toBeNull();
    expect(item!.publicado_em ?? "").toContain("2026-06-23");
  });

  it("captura imagem lazy-load (data-src) quando não há og:image", () => {
    const item = parseNewsDetail(fx("synthetic/lazy-image.html"), link, ANTT);
    expect(item).not.toBeNull();
    expect(item!.imagem_url ?? "").toContain("foto-real.png");
  });

  it("descarta página de manutenção servida como 200", () => {
    const item = parseNewsDetail(fx("synthetic/maintenance.html"), link, ANTT);
    expect(item).toBeNull();
  });
});
