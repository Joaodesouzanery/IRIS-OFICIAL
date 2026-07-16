import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it, expect } from "vitest";
import { parseNewsDetail, extractNewsAnchors, extractDateFromText, siblingListingVariants, artespCcmFallback, detectNewsSourceFromUrl, type NewsSourceConfig } from "@/lib/server/news-collector";

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

// ─── Imagem gov.br: reparo de og malformada + reconstrução de lead-image ─────
describe("parseNewsDetail — imagem gov.br (Volto/Plone)", () => {
  const ANATEL: NewsSourceConfig = { agencia_sigla: "ANATEL", fonte: "ANATEL", url: "https://www.gov.br/anatel/pt-br/assuntos/noticias", strategy: "govbr", tier: "expanded" };
  const ANP: NewsSourceConfig = { agencia_sigla: "ANP", fonte: "ANP", url: "https://www.gov.br/anp/pt-br/canais_atendimento/imprensa/noticias-comunicados", strategy: "govbr", tier: "expanded" };
  const pastIso = new Date(Date.now() - 30 * 864e5).toISOString();

  it("repara og:image com host interno grudado (10.164.57.1:3000 → URL real)", () => {
    const url = "https://www.gov.br/anatel/pt-br/assuntos/noticias/anatel-divulga-relatorio-de-monitoramento";
    const html = `<html><head>
      <meta property="og:title" content="ANATEL divulga relatório de monitoramento da competição"/>
      <meta property="og:image" content="http://10.164.57.1:3000${url}/@@images/image-800-abc123.png"/>
      <meta property="article:published_time" content="${pastIso}"/>
    </head><body><article><p>Conteúdo da notícia com tamanho suficiente para passar nos filtros de comprimento e não ser tratado como lixo.</p></article></body></html>`;
    const item = parseNewsDetail(html, { url, title: "fallback" }, ANATEL);
    expect(item).not.toBeNull();
    expect(item!.imagem_url).toBe(`${url}/@@images/image-800-abc123.png`);
  });

  it("sem og:image: reconstrói lead-image por-artigo <url>/@@images/image/large", () => {
    const url = "https://www.gov.br/anp/pt-br/canais_atendimento/imprensa/noticias-comunicados/confira-o-repasse-da-cfem";
    const html = `<html><head>
      <meta property="og:title" content="Confira o repasse da CFEM referente à arrecadação"/>
      <meta property="article:published_time" content="${pastIso}"/>
    </head><body><article><p>Relatório apresenta os valores distribuídos aos entes. Conteúdo com comprimento suficiente para o parser aceitar.</p></article></body></html>`;
    const item = parseNewsDetail(html, { url, title: "t" }, ANP);
    expect(item).not.toBeNull();
    expect(item!.imagem_url).toContain("/confira-o-repasse-da-cfem/@@images/image/large");
    expect(item!.metadata.image_source).toBe("govbr lead image reconstructed");
  });
});

// ─── Fallback de subseção eleitoral (blackout 2026) ─────────────────────────
describe("siblingListingVariants — subseções eleitorais (blackout)", () => {
  const mk = (url: string): NewsSourceConfig => ({ agencia_sigla: "X", fonte: "X", url, strategy: "govbr", tier: "expanded" });
  const paths = (u: string) => siblingListingVariants(mk(u)).map((s) => new URL(s.url).pathname);

  it("ANA: inclui o PAI (.../noticias-e-eventos) quando /noticias exige login", () => {
    const p = paths("https://www.gov.br/ana/pt-br/assuntos/noticias-e-eventos/noticias");
    expect(p).toContain("/ana/pt-br/assuntos/noticias-e-eventos");
  });
  it("ANS: inclui noticias-1 e noticias-1/periodo-eleitoral; NÃO dropa para /assuntos", () => {
    const p = paths("https://www.gov.br/ans/pt-br/assuntos/noticias");
    expect(p).toContain("/ans/pt-br/assuntos/noticias-1");
    expect(p).toContain("/ans/pt-br/assuntos/noticias-1/periodo-eleitoral");
    expect(p).not.toContain("/ans/pt-br/assuntos");
  });
  it("ANTT: inclui a irmã defeso", () => {
    const p = paths("https://www.gov.br/antt/pt-br/assuntos/ultimas-noticias");
    expect(p).toContain("/antt/pt-br/assuntos/noticias-defeso-eleitoral");
  });
  it("não repete a URL canônica e retorna [] para fonte não-govbr", () => {
    const p = paths("https://www.gov.br/ans/pt-br/assuntos/noticias");
    expect(p).not.toContain("/ans/pt-br/assuntos/noticias");
    expect(siblingListingVariants({ agencia_sigla: "ARTESP", fonte: "ARTESP", url: "https://www.artesp.sp.gov.br/artesp/noticias", strategy: "artesp", tier: "core" })).toHaveLength(0);
  });
});

// ─── ARTESP: fallback para o portal CCM (SSR) ───────────────────────────────
describe("ARTESP → portal CCM", () => {
  it("artespCcmFallback: legado www.artesp → CCM (govbr); CCM/gov.br → null", () => {
    const legacy: NewsSourceConfig = { agencia_sigla: "ARTESP", fonte: "ARTESP", url: "https://www.artesp.sp.gov.br/artesp/noticias", strategy: "artesp", tier: "core" };
    const ccm = artespCcmFallback(legacy);
    expect(ccm).not.toBeNull();
    expect(ccm!.url).toBe("https://ccm.artesp.sp.gov.br/noticias/todas");
    expect(ccm!.strategy).toBe("govbr");
    expect(ccm!.agencia_sigla).toBe("ARTESP");
    expect(artespCcmFallback(ccm!)).toBeNull(); // não recursa no próprio CCM
    expect(artespCcmFallback({ agencia_sigla: "ANM", fonte: "ANM", url: "https://www.gov.br/anm/pt-br/assuntos/noticias", strategy: "govbr", tier: "core" })).toBeNull();
  });

  it("detectNewsSourceFromUrl: artigo CCM → agência ARTESP, estratégia govbr (não o parser Liferay)", () => {
    const d = detectNewsSourceFromUrl("https://ccm.artesp.sp.gov.br/noticias/der-sp-ativa-04-radares-em-rodovias-estaduais");
    expect(d).not.toBeNull();
    expect(d!.agencia_sigla).toBe("ARTESP");
    expect(d!.strategy).toBe("govbr");
    expect(d!.url).toBe("https://ccm.artesp.sp.gov.br/noticias");
  });

  it("parseNewsDetail aceita artigo CCM /noticias/<slug> como canonical", () => {
    const source: NewsSourceConfig = { agencia_sigla: "ARTESP", fonte: "ARTESP", url: "https://ccm.artesp.sp.gov.br/noticias/todas", strategy: "govbr", tier: "core" };
    const url = "https://ccm.artesp.sp.gov.br/noticias/der-sp-ativa-04-radares-em-rodovias-estaduais-a-partir-desta-terca";
    const html = `<html><head><meta property="og:title" content="DER-SP ativa 04 radares em rodovias estaduais a partir desta terça"/><meta property="og:url" content="${url}"/><meta property="article:published_time" content="2026-02-09T10:00:00-03:00"/></head><body><article><p>O DER-SP informa a ativação de novos radares em rodovias estaduais para reforçar a segurança viária.</p></article></body></html>`;
    const item = parseNewsDetail(html, { url, title: "t" }, source);
    expect(item).not.toBeNull();
    expect(item!.url).toBe(url); // canonical CCM aceito (isNewsDetailUrl branch CCM)
    expect(item!.agencia_sigla).toBe("ARTESP");
  });
});

// ─── Data futura (calendário/evento no corpo) não deve virar publicado_em ────
describe("parseNewsDetail — clamp de data futura", () => {
  const detailUrl = "https://www.gov.br/antt/pt-br/assuntos/ultimas-noticias/nota-informativa-sobre-calendario-eleitoral";
  it("descarta data FUTURA do texto → publicado_em null (não lidera a lista)", () => {
    const fy = new Date().getFullYear() + 5;
    const html = `<html><head><meta property="og:title" content="Nota informativa com título de tamanho adequado ao parser"/></head><body><article><p>O evento ocorrerá em ${fy}-08-24 conforme o calendário eleitoral. Texto de corpo com comprimento suficiente para o parser de conteúdo aceitar.</p></article></body></html>`;
    const item = parseNewsDetail(html, { url: detailUrl, title: "t" }, ANTT);
    expect(item).not.toBeNull();
    expect(item!.publicado_em).toBeNull();
  });
  it("mantém data PASSADA normal", () => {
    const py = new Date().getFullYear() - 1;
    const html = `<html><head><meta property="og:title" content="Nota informativa com título de tamanho adequado ao parser"/></head><body><article><p>Publicado em ${py}-03-15 pela agência. Texto de corpo com comprimento suficiente para o parser de conteúdo aceitar sem problemas.</p></article></body></html>`;
    const item = parseNewsDetail(html, { url: detailUrl, title: "t" }, ANTT);
    expect(item!.publicado_em ?? "").toContain(`${py}-03-15`);
  });
});
