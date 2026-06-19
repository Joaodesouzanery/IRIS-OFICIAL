import type { NewsletterDocumentType, RegulatoryNews } from "@/types";

export interface MinutoRegulacaoItemInput {
  noticia_id?: string | null;
  data?: string | null;
  agencia?: string | null;
  imagem_url?: string | null;
  imagem_alt?: string | null;
  titulo_minuto?: string | null;
  subtitulo_minuto?: string | null;
  ato?: string | null;
  ato_titulo?: string | null;
  texto_minuto?: string | null;
  texto_institucional?: string | null;
  editorial_model?: string | null;
  review_status?: "pendente" | "revisado" | "aprovado" | null;
  fonte_url?: string | null;
}

export interface NewsletterDocumentInput {
  assunto: string;
  descricao?: string | null;
  destinatarios?: string[];
  temas?: string[];
  noticias: RegulatoryNews[];
  newsletter_textos?: Record<string, string>;
  generatedAt?: Date;
  baseUrl?: string;
  documento_tipo?: NewsletterDocumentType;
  template_version?: string | null;
  minuto_textos?: string[];
  minuto_items?: MinutoRegulacaoItemInput[];
}

export const NEWSLETTER_TEMPLATE_VERSIONS = {
  newsletter_v1: "iris_newsletter_layout_v1",
  newsletter_v2: "iris_newsletter_layout_v2",
  minuto_v1: "iris_minuto_retrospectiva_v1",
  minuto_v2: "iris_minuto_retrospectiva_v2",
} as const;

export type NewsletterArticleSlot = "main" | "side_1" | "side_2";

export const NEWSLETTER_ARTICLE_TEXT_LIMITS: Record<NewsletterArticleSlot, number> = {
  main: 3000,
  side_1: 980,
  side_2: 900,
};

interface NewsletterTheme {
  outer: string;
  page: string;
  hero: string;
  image: string;
  accent: string;
  text: string;
  body: string;
  bodySoft: string;
  muted: string;
  strongMuted: string;
  faint: string;
  faint2: string;
  placeholder: string;
  line: string;
  lineSoft: string;
  topline: string;
  footline: string;
  svgLine: string;
}

const NEWSLETTER_THEME_DARK: NewsletterTheme = {
  outer: "#111827",
  page: "#0d1220",
  hero: "#0f1a2c",
  image: "#1a2236",
  accent: "#c9a84c",
  text: "#ffffff",
  body: "rgba(255,255,255,0.76)",
  bodySoft: "rgba(255,255,255,0.66)",
  muted: "rgba(255,255,255,0.56)",
  strongMuted: "rgba(255,255,255,0.78)",
  faint: "rgba(255,255,255,0.4)",
  faint2: "rgba(255,255,255,0.22)",
  placeholder: "rgba(255,255,255,0.18)",
  line: "rgba(255,255,255,0.08)",
  lineSoft: "rgba(255,255,255,0.07)",
  topline: "rgba(255,255,255,0.1)",
  footline: "rgba(255,255,255,0.09)",
  svgLine: "rgba(255,255,255,0.1)",
};

// "Newsletter 2" — estetica clara/clean inspirada no whitepaper. Mesma estrutura,
// logo, nome e contatos; muda apenas o design (fundo branco, tipografia editorial).
const NEWSLETTER_THEME_LIGHT: NewsletterTheme = {
  outer: "#e7e3da",
  page: "#ffffff",
  hero: "#f6f3ec",
  image: "#ece8df",
  accent: "#9a7b1f",
  text: "#16202e",
  body: "rgba(22,32,46,0.82)",
  bodySoft: "rgba(22,32,46,0.74)",
  muted: "rgba(22,32,46,0.58)",
  strongMuted: "rgba(22,32,46,0.8)",
  faint: "rgba(22,32,46,0.45)",
  faint2: "rgba(22,32,46,0.32)",
  placeholder: "rgba(22,32,46,0.2)",
  line: "rgba(22,32,46,0.1)",
  lineSoft: "rgba(22,32,46,0.08)",
  topline: "rgba(22,32,46,0.14)",
  footline: "rgba(22,32,46,0.12)",
  svgLine: "rgba(22,32,46,0.14)",
};

function newsletterPageStyles(t: NewsletterTheme) {
  return `*,*::before,*::after{box-sizing:border-box;margin:0;padding:0;-webkit-print-color-adjust:exact;print-color-adjust:exact;color-adjust:exact;}
html,body{background:${t.outer};}
body{margin:0;color:${t.text};font-family:'Inter',sans-serif;}
.newsletter-page{width:960px;height:1357px;background:${t.page};display:flex;flex-direction:column;overflow:hidden;padding-bottom:32px;margin:0 auto;position:relative;isolation:isolate;break-after:page;page-break-after:always;}
.newsletter-page:last-child{break-after:auto;page-break-after:auto;}
.print-bg{position:absolute;inset:0;width:960px;height:1357px;z-index:0;pointer-events:none;display:block;}
.topbar,.hero,.body,.footer{position:relative;z-index:1;}
.topbar{display:flex;align-items:center;justify-content:space-between;padding:0 44px;height:38px;flex-shrink:0;border-bottom:1px solid ${t.topline};font-size:9px;font-weight:500;letter-spacing:0.15em;text-transform:uppercase;color:${t.faint};}
.topbar strong{color:${t.strongMuted};font-weight:600;}
.hero{background:${t.hero};padding:0 44px;height:190px;flex-shrink:0;display:flex;align-items:center;justify-content:space-between;gap:24px;border-bottom:1px solid ${t.line};}
.hero-left{display:flex;flex-direction:column;gap:8px;min-width:0;max-width:510px;}
.hero-eyebrow{font-size:8.5px;font-weight:700;letter-spacing:0.24em;text-transform:uppercase;color:${t.accent};}
.hero-title{font-family:'Playfair Display',serif;font-size:64px;font-weight:900;line-height:0.92;letter-spacing:-0.025em;color:${t.text};}
.hero-subtitle{font-size:11px;font-weight:400;line-height:1.35;letter-spacing:0.035em;text-transform:uppercase;color:${t.muted};max-width:510px;}
.hero-subtitle strong{color:${t.strongMuted};font-weight:500;}
.hero-logo-frame{width:360px;height:168px;flex-shrink:0;display:flex;align-items:center;justify-content:center;overflow:hidden;}
.hero-logo{width:360px;height:360px;object-fit:cover;object-position:center;display:block;transform:scale(2.05);}
.body{display:grid;grid-template-columns:58% 42%;gap:0;flex:1;min-height:0;}
.col-main{padding:22px 30px 12px 44px;border-right:1px solid ${t.line};display:flex;flex-direction:column;gap:10px;overflow:hidden;}
.main-img{width:100%;height:224px;flex-shrink:0;display:flex;align-items:center;justify-content:center;background:${t.image};font-size:10px;letter-spacing:0.1em;text-transform:uppercase;color:${t.placeholder};font-weight:500;overflow:hidden;margin:1px 0;}
.main-img img{width:100%;height:100%;max-width:100%;object-fit:cover;object-position:center;display:block;margin:0 auto;}
.art-tag{font-size:10px;font-weight:700;letter-spacing:0.18em;text-transform:uppercase;color:${t.accent};display:block;margin-bottom:8px;}
.main-title{font-family:'Playfair Display',serif;font-size:25.5px;font-weight:900;line-height:1.01;letter-spacing:0;color:${t.text};text-align:left;}
.main-body{font-size:13.8px;line-height:1.39;color:${t.body};text-align:justify;hyphens:auto;flex:1 1 auto;min-height:0;overflow:hidden;-webkit-mask-image:linear-gradient(to bottom,black 75%,transparent 100%);mask-image:linear-gradient(to bottom,black 75%,transparent 100%);}
.main-body p+p{margin-top:7px;}
.read-more{display:inline-flex;align-items:center;gap:6px;font-size:10px;font-weight:700;letter-spacing:0.16em;text-transform:uppercase;color:${t.accent};text-decoration:none;flex-shrink:0;}
.col-side{display:flex;flex-direction:column;}
.side-art{padding:18px 34px 12px 22px;border-bottom:1px solid ${t.lineSoft};display:flex;flex-direction:column;gap:8px;flex:1;overflow:visible;}
.side-art.no-image{gap:9px;justify-content:flex-start;}
.side-art:last-child{border-bottom:none;}
.side-img{width:100%;height:94px;flex-shrink:0;display:flex;align-items:center;justify-content:center;background:${t.image};font-size:9.5px;letter-spacing:0.1em;text-transform:uppercase;color:${t.placeholder};font-weight:500;overflow:hidden;}
.side-img img{width:100%;height:100%;max-width:100%;object-fit:cover;object-position:center;display:block;margin:0 auto;}
.side-title{font-family:'Playfair Display',serif;font-size:17.8px;font-weight:800;line-height:1.08;letter-spacing:0;color:${t.text};text-align:left;}
.side-excerpt{font-size:11.8px;line-height:1.34;color:${t.bodySoft};text-align:justify;hyphens:auto;flex:0 0 auto;overflow:visible;}
.side-excerpt p+p{margin-top:6px;}
.side-link{font-size:10px;font-weight:700;letter-spacing:0.14em;text-transform:uppercase;color:${t.accent};text-decoration:none;flex-shrink:0;}
.footer{border-top:1px solid ${t.footline};padding:0 44px;height:34px;flex-shrink:0;display:flex;align-items:center;justify-content:space-between;}
.footer-brand{font-size:10px;font-weight:700;letter-spacing:0.22em;text-transform:uppercase;color:${t.text};}
.footer-sub{font-size:8.5px;letter-spacing:0.06em;margin-top:2px;color:${t.faint2};text-transform:uppercase;display:block;}
.footer-note{font-size:8.5px;letter-spacing:0.08em;text-align:right;color:${t.faint2};text-transform:uppercase;line-height:1.6;}
@page{size:960px 1357px;margin:0;}
@media print{html,body{background:${t.page}!important;}.newsletter-page{margin:0!important;}*,*::before,*::after{-webkit-print-color-adjust:exact!important;print-color-adjust:exact!important;color-adjust:exact!important;}}`;
}

export function buildRegulatoryNewsletterHtml(input: NewsletterDocumentInput) {
  const version = input.template_version ?? "";
  const isV2 = version.endsWith("_v2");
  if (input.documento_tipo === "minuto_regulacao") {
    return buildMinutoRegulacaoHtml(input, isV2);
  }
  return buildNewsletterRegulatorioHtml(input, isV2 ? NEWSLETTER_THEME_LIGHT : NEWSLETTER_THEME_DARK);
}

function buildNewsletterRegulatorioHtml(input: NewsletterDocumentInput, theme: NewsletterTheme = NEWSLETTER_THEME_DARK) {
  const generatedAt = input.generatedAt ?? new Date();
  const date = formatNewsletterDate(generatedAt);
  const selected = input.noticias;
  const pages = chunkNewsletterItems(selected);
  const logo = absolutePath("/brand/newsletter-logo.png", input.baseUrl);

  return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="UTF-8"/>
<meta name="viewport" content="width=960, initial-scale=1"/>
<link rel="preconnect" href="https://fonts.googleapis.com"/>
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin/>
<link href="https://fonts.googleapis.com/css2?family=Playfair+Display:ital,wght@0,700;0,800;0,900;1,700&family=Inter:wght@300;400;500;600;700&display=swap" rel="stylesheet"/>
<title>${escapeHtml(input.assunto || "Newsletter Regulatória")}</title>
<style>
${newsletterPageStyles(theme)}
</style>
<script>
function irisImageFallback(img){var fallback=img.getAttribute("data-fallback-src");if(fallback&&img.src!==fallback){img.removeAttribute("data-fallback-src");img.src=fallback;return;}if(img.parentElement){img.parentElement.remove();}}
</script>
</head>
<body>
  ${(pages.length ? pages : [[]]).map((page) => renderNewsletterPage(page, date, logo, input, theme)).join("")}
</body>
</html>`;
}

function renderNewsletterPage(items: RegulatoryNews[], date: string, logo: string, input: NewsletterDocumentInput, theme: NewsletterTheme = NEWSLETTER_THEME_DARK) {
  const heroSubtitle = buildNewsletterSubtitle(items, input.assunto);
  return `<section class="newsletter-page">
    <svg class="print-bg" viewBox="0 0 960 1357" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <rect width="960" height="1357" fill="${theme.page}"/>
      <rect y="38" width="960" height="190" fill="${theme.hero}"/>
      <line x1="0" y1="38" x2="960" y2="38" stroke="${theme.svgLine}"/>
      <line x1="0" y1="228" x2="960" y2="228" stroke="${theme.line}"/>
      <line x1="557" y1="228" x2="557" y2="1323" stroke="${theme.line}"/>
      <line x1="0" y1="1323" x2="960" y2="1323" stroke="${theme.footline}"/>
    </svg>
    <header class="topbar">
      <span>IRIS &mdash; <strong>Newsletter Regulat&oacute;rio</strong></span>
      <span>${escapeHtml(date)}</span>
      <strong>contato@irisregulacao.org</strong>
    </header>
    <section class="hero">
      <div class="hero-left">
        <span class="hero-eyebrow">Edi&ccedil;&atilde;o Semanal &middot; Atualiza&ccedil;&atilde;o Regulat&oacute;ria</span>
        <h1 class="hero-title">NEWSLETTER<br>REGULAT&Oacute;RIO</h1>
        <p class="hero-subtitle">${heroSubtitle}</p>
      </div>
      <span class="hero-logo-frame"><img src="${escapeHtml(logo)}" alt="IRIS" class="hero-logo"/></span>
    </section>
    <div class="body">
      <article class="col-main">${renderNewsletterMainArticle(items[0], input.baseUrl, input.newsletter_textos)}</article>
      <aside class="col-side">
        ${renderNewsletterSideArticle(items[1], input.baseUrl, 0, input.newsletter_textos)}
        ${renderNewsletterSideArticle(items[2], input.baseUrl, 1, input.newsletter_textos)}
      </aside>
    </div>
    <footer class="footer">
      <div><span class="footer-brand">IRIS Regula&ccedil;&atilde;o</span><span class="footer-sub">Instituto de Regula&ccedil;&atilde;o, Inova&ccedil;&atilde;o e Sustentabilidade</span></div>
      <div class="footer-note">Documento gerado automaticamente &middot; Fontes oficiais<br>Uso interno &mdash; confidencial</div>
    </footer>
  </section>`;
}

function buildMinutoRegulacaoHtml(input: NewsletterDocumentInput, isV2 = false) {
  const generatedAt = input.generatedAt ?? new Date();
  const date = formatLongDate(generatedAt.toISOString());
  const items = buildMinutoItems(input);
  const fontLink = isV2
    ? `<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin><link href="https://fonts.googleapis.com/css2?family=Playfair+Display:wght@700;800;900&family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">`
    : "";
  // "Minuto 2" — variante clara/editorial com tipografia serifada (mesma logo, nome e contatos).
  const styles = isV2
    ? `@page { size: A4 landscape; margin: 12mm; }
    * { box-sizing: border-box; -webkit-print-color-adjust: exact; print-color-adjust: exact; color-adjust: exact; }
    html, body { min-height: 100%; }
    body { margin: 0; background: #e7e3da; color: #16202e; font-family: 'Inter', Arial, Helvetica, sans-serif; }
    .minuto-page { width: 1123px; min-height: 794px; max-width: 100%; margin: 0 auto; background: #fff; padding: 30px 40px; display:flex; flex-direction:column; break-after: page; page-break-after: always; }
    .minuto-page:last-child { break-after: auto; page-break-after: auto; }
    header { border-bottom: 1px solid rgba(22,32,46,0.14); padding-bottom: 16px; margin-bottom: 24px; display:flex; align-items:flex-end; justify-content:space-between; gap:24px; flex-shrink:0; }
    .eyebrow { margin: 0 0 8px; font-size: 11px; line-height: 1; font-weight: 700; letter-spacing: .22em; text-transform: uppercase; color: #9a7b1f; }
    h1 { margin: 0; font-family: 'Playfair Display', serif; font-size: 40px; line-height: 1.02; font-weight: 800; letter-spacing: 0; }
    .generated { margin: 0; font-size: 13px; color: rgba(22,32,46,0.55); text-align:right; flex-shrink:0; }
    .minuto-item { flex:1; min-height:0; break-inside: avoid; display:flex; flex-direction:column; justify-content:center; gap:22px; }
    .minuto-copy { min-width:0; max-width: 980px; margin: 0 auto; display:flex; flex-direction:column; justify-content:center; }
    .item-meta { display: flex; gap: 10px; flex-wrap: wrap; align-items: center; margin-bottom: 18px; font-size: 12px; font-weight: 700; letter-spacing: .14em; text-transform: uppercase; color: #9a7b1f; }
    .script-title { margin: 0 0 16px; font-family: 'Playfair Display', serif; font-size: 44px; line-height: 1.06; font-weight: 800; color: #16202e; }
    .script-subtitle { margin: 0 0 20px; font-size: 28px; line-height: 1.24; font-weight: 600; color: rgba(22,32,46,0.78); }
    .script { margin: 0; white-space: pre-line; font-size: 24px; line-height: 1.42; font-weight: 400; color: rgba(22,32,46,0.86); }
    .source { color: #9a7b1f; text-decoration: none; }
    .empty { color: #666; font-size: 14px; }
    @media print { body { background: #fff; } .minuto-page { width:auto; max-width: none; min-height: calc(100vh - 24mm); margin: 0; padding: 0; } * { -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; color-adjust: exact !important; } }`
    : `@page { size: A4 landscape; margin: 12mm; }
    * { box-sizing: border-box; -webkit-print-color-adjust: exact; print-color-adjust: exact; color-adjust: exact; }
    html, body { min-height: 100%; }
    body { margin: 0; background: #f3f4f6; color: #111827; font-family: Arial, Helvetica, sans-serif; }
    .minuto-page { width: 1123px; min-height: 794px; max-width: 100%; margin: 0 auto; background: #fff; padding: 28px 36px; display:flex; flex-direction:column; break-after: page; page-break-after: always; }
    .minuto-page:last-child { break-after: auto; page-break-after: auto; }
    header { border-bottom: 2px solid #111827; padding-bottom: 16px; margin-bottom: 24px; display:flex; align-items:flex-end; justify-content:space-between; gap:24px; flex-shrink:0; }
    .eyebrow { margin: 0 0 8px; font-size: 12px; line-height: 1; font-weight: 700; letter-spacing: .16em; text-transform: uppercase; color: #4b5563; }
    h1 { margin: 0; font-size: 38px; line-height: 1.02; font-weight: 800; letter-spacing: 0; text-transform: uppercase; }
    .generated { margin: 0; font-size: 13px; color: #6b7280; text-align:right; flex-shrink:0; }
    .minuto-item { flex:1; min-height:0; break-inside: avoid; display:flex; flex-direction:column; justify-content:center; gap:22px; }
    .minuto-copy { min-width:0; max-width: 980px; margin: 0 auto; display:flex; flex-direction:column; justify-content:center; }
    .item-meta { display: flex; gap: 10px; flex-wrap: wrap; align-items: center; margin-bottom: 18px; font-size: 13px; font-weight: 700; letter-spacing: .08em; text-transform: uppercase; color: #4b5563; }
    .script-title { margin: 0 0 16px; font-size: 42px; line-height: 1.08; font-weight: 800; color: #111827; }
    .script-subtitle { margin: 0 0 20px; font-size: 30px; line-height: 1.22; font-weight: 650; color: #1f2937; }
    .script { margin: 0; white-space: pre-line; font-size: 25px; line-height: 1.38; font-weight: 500; color: #111827; }
    .source { color: #1d4f7a; text-decoration: none; }
    .empty { color: #666; font-size: 14px; }
    @media print { body { background: #fff; } .minuto-page { width:auto; max-width: none; min-height: calc(100vh - 24mm); margin: 0; padding: 0; } * { -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; color-adjust: exact !important; } }`;

  return `<!doctype html>
<html lang="pt-BR">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=1123, initial-scale=1">
  ${fontLink}
  <title>${escapeHtml(input.assunto || "Minuto da Regulação")}</title>
  <style>
    ${styles}
  </style>
</head>
<body>
  ${items.length ? items.map((item, index) => renderMinutoPage(item, input.baseUrl, date, index)).join("") : renderMinutoEmptyPage(date)}
</body>
</html>`;
}

function renderMinutoPage(item: MinutoRegulacaoItemInput, _baseUrl: string | undefined, date: string, index: number) {
  return `<section class="minuto-page">
    ${renderMinutoHeader(date)}
    ${renderMinutoItem(item, index)}
  </section>`;
}

function renderMinutoEmptyPage(date: string) {
  return `<section class="minuto-page">
    ${renderMinutoHeader(date)}
    <p class="empty">Selecione not&iacute;cias para montar o roteiro.</p>
  </section>`;
}

function renderMinutoHeader(date: string) {
  return `<header>
    <div>
      <p class="eyebrow">IRIS Regula&ccedil;&atilde;o</p>
      <h1>Minuto da Regula&ccedil;&atilde;o</h1>
    </div>
    <p class="generated">Roteiro gerado em ${escapeHtml(date)}</p>
  </header>`;
}

function renderNewsletterMainArticle(item: RegulatoryNews | undefined, baseUrl?: string, articleTexts?: Record<string, string>) {
  const title = item?.titulo ?? "Selecione a noticia principal para montar a edicao";
  const body = newsletterArticleBody(item, {
    maxLength: NEWSLETTER_ARTICLE_TEXT_LIMITS.main,
    minLength: item?.imagem_url ? 1500 : 1900,
  }, newsletterArticleOverride(item, articleTexts, NEWSLETTER_ARTICLE_TEXT_LIMITS.main));
  return `
    <div>
      <span class="art-tag">${escapeHtml(formatArticleTag(item))}</span>
      <h2 class="main-title">${escapeHtml(title)}</h2>
    </div>
    ${item?.imagem_url ? `<div class="main-img">${renderArticleImage(item, baseUrl, title)}</div>` : ""}
    <div class="main-body">${renderParagraphs(body, item?.imagem_url ? 9 : 11, item?.imagem_url ? 360 : 390)}</div>
    ${item?.url ? `<a href="${escapeHtml(item.url)}" class="read-more">Ler fonte oficial &#8599;</a>` : `<a class="read-more">Ler fonte oficial &#8599;</a>`}
  `;
}

function renderNewsletterSideArticle(item: RegulatoryNews | undefined, baseUrl?: string, index = 0, articleTexts?: Record<string, string>) {
  if (!item) return "";
  const title = item?.titulo ?? "Selecione uma noticia secundaria";
  const slot: NewsletterArticleSlot = index >= 1 ? "side_2" : "side_1";
  const excerptLimit = NEWSLETTER_ARTICLE_TEXT_LIMITS[slot];
  const body = newsletterArticleBody(item, {
    maxLength: excerptLimit,
    minLength: item.imagem_url ? 520 : 680,
  }, newsletterArticleOverride(item, articleTexts, excerptLimit));
  return `<div class="side-art ${item.imagem_url ? "" : "no-image"}">
    ${item.imagem_url ? `<div class="side-img">${renderArticleImage(item, baseUrl, title)}</div>` : ""}
    <span class="art-tag">${escapeHtml(formatArticleTag(item))}</span>
    <h3 class="side-title">${escapeHtml(title)}</h3>
    <div class="side-excerpt">${renderParagraphs(body, item.imagem_url ? 5 : 6, item.imagem_url ? 240 : 280)}</div>
    ${item?.url ? `<a href="${escapeHtml(item.url)}" class="side-link">Fonte oficial &#8599;</a>` : `<a class="side-link">Fonte oficial &#8599;</a>`}
  </div>`;
}

function renderArticleImage(item: RegulatoryNews | undefined, baseUrl: string | undefined, alt: string) {
  if (!item?.imagem_url) return "";
  const src = primaryImageUrl(item.imagem_url, baseUrl);
  const fallback = fallbackImageUrl(item.imagem_url, baseUrl, src);
  return renderImage(src, fallback, alt);
}

function chunkItems<T>(items: T[], size: number) {
  const pages: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    pages.push(items.slice(index, index + size));
  }
  return pages;
}

function chunkNewsletterItems(items: RegulatoryNews[]): RegulatoryNews[][] {
  return chunkItems(items, 3);
}

export function estimateNewsletterPageCount(items: RegulatoryNews[]) {
  const pages = chunkNewsletterItems(items);
  return Math.max(1, pages.length);
}

export function buildMinutoRegulacaoPrompt(items: RegulatoryNews[]) {
  const payload = items.map((item, index) => ({
    ordem: index + 1,
    noticia_id: item.id,
    titulo_original: item.titulo,
    agencia: item.agencia_sigla ?? item.agencia?.sigla ?? item.fonte,
    data: item.publicado_em ?? item.first_seen_at,
    fonte_url: item.url,
    resumo: clipText(item.resumo || "", 1600),
    conteudo_completo: clipText(item.conteudo || item.resumo || "", 4200),
  }));

  return `Voce e roteirista regulatorio do IRIS. Transforme as noticias abaixo em roteiro de teleprompter para video curto no Instagram.

Regras:
- Responda somente em JSON valido.
- Use o formato: {"titulo_geral":"...","subtitulo_geral":"...","itens":[{"ordem":1,"noticia_id":"id_original","data":"...","agencia":"...","titulo_minuto":"...","subtitulo_minuto":"...","texto_minuto":"...","fonte_url":"..."}]}.
- titulo_minuto deve ser um novo titulo jornalistico, curto e claro, combinando titulo original, resumo e conteudo completo.
- subtitulo_minuto deve ser uma frase breve com o principal impacto regulatorio da noticia.
- texto_minuto deve ser uma fala pronta para camera, com 20 a 40 segundos.
- Linguagem: natural, clara, sem jargao excessivo, como apresentador falando para frente da camera.
- Comece pelo fato principal, explique por que importa e feche com transicao curta.
- Nao inclua marcacoes de cena, hashtags, emojis, CTA generico ou texto institucional.
- Nao invente fatos, datas, nomes, normas ou efeitos. Se faltar informacao, seja conservador.
- Preserve o link da fonte oficial.

Noticias selecionadas:
${JSON.stringify(payload, null, 2)}`;
}

export function buildMinutoRegulacaoDraftJson(items: RegulatoryNews[]) {
  const payload = {
    itens: items.map((item, index) => ({
      ordem: index + 1,
      noticia_id: item.id,
      data: item.publicado_em ?? item.first_seen_at,
      agencia: item.agencia?.nome || item.agencia_sigla || item.fonte,
      titulo_minuto: createMinutoTitle(item),
      subtitulo_minuto: createMinutoSubtitle(item),
      ato_titulo: null,
      ato: null,
      texto_institucional: null,
      texto_minuto: createMinutoScript(item),
      editorial_model: identifyEditorialModel(item),
      review_status: "revisado",
      fonte_url: item.url,
    })),
  };
  return JSON.stringify(payload, null, 2);
}

export function buildMinutoRegulacaoDraftText(items: RegulatoryNews[]) {
  return items.map((item) => createMinutoScript(item)).join("\n\n---\n\n");
}

function buildMinutoItems(input: NewsletterDocumentInput): MinutoRegulacaoItemInput[] {
  const allowedIds = new Set(input.noticias.map((item) => item.id).filter(Boolean));
  const allowedUrls = new Set(input.noticias.map((item) => item.url).filter(Boolean));
  const filterSelected = (items: MinutoRegulacaoItemInput[]) => items.filter((item) => {
    if (!allowedIds.size && !allowedUrls.size) return true;
    if (item.noticia_id && allowedIds.has(item.noticia_id)) return true;
    if (item.fonte_url && allowedUrls.has(item.fonte_url)) return true;
    return false;
  });
  const structured = filterSelected(input.minuto_items?.filter((item) => item.texto_minuto || item.texto_institucional || item.titulo_minuto) ?? []);
  if (structured.length > 0) return attachMinutoNewsImages(structured, input.noticias);

  const parsed = filterSelected(parseMinutoTextos(input.minuto_textos));
  if (parsed.length > 0) return attachMinutoNewsImages(parsed, input.noticias);

  return attachMinutoNewsImages(input.noticias.map((item) => ({
    noticia_id: item.id,
    data: item.publicado_em ?? item.first_seen_at,
    agencia: item.agencia?.nome || item.agencia_sigla || item.fonte,
    imagem_url: item.imagem_url,
    imagem_alt: item.titulo,
    titulo_minuto: createMinutoTitle(item),
    subtitulo_minuto: null,
    ato: null,
    ato_titulo: null,
    texto_minuto: createMinutoScript(item),
    texto_institucional: createMinutoScript(item),
    editorial_model: null,
    review_status: "pendente",
    fonte_url: item.url,
  })), input.noticias);
}

function parseMinutoTextos(value: string[] | undefined): MinutoRegulacaoItemInput[] {
  if (!value?.length) return [];
  const joined = value.join("\n").trim();
  if (!joined) return [];
  if (joined.startsWith("{") || joined.startsWith("[")) {
    try {
      const parsed = JSON.parse(joined);
      const items = Array.isArray(parsed) ? parsed : parsed.itens;
      if (Array.isArray(items)) {
        return items.map((item) => ({
          noticia_id: item.noticia_id ?? item.id ?? null,
          data: item.data ?? null,
          agencia: item.agencia ?? null,
          imagem_url: item.imagem_url ?? null,
          imagem_alt: item.imagem_alt ?? item.titulo_minuto ?? item.titulo ?? null,
          titulo_minuto: item.titulo_minuto ?? item.titulo ?? null,
          subtitulo_minuto: null,
          ato: null,
          ato_titulo: null,
          texto_minuto: item.texto_minuto ?? item.roteiro ?? item.texto ?? null,
          texto_institucional: item.texto_institucional ?? item.texto_minuto ?? item.roteiro ?? item.texto ?? null,
          editorial_model: item.editorial_model ?? null,
          review_status: item.review_status === "aprovado" || item.review_status === "revisado" ? item.review_status : "pendente",
          fonte_url: item.fonte_url ?? item.url ?? null,
        }));
      }
    } catch {
      return value.map((text) => ({ texto_minuto: text, texto_institucional: text }));
    }
  }
  return value.map((text) => ({ texto_minuto: text, texto_institucional: text }));
}

function attachMinutoNewsImages(items: MinutoRegulacaoItemInput[], noticias: RegulatoryNews[]) {
  const byId = new Map(noticias.map((item) => [item.id, item]));
  const byUrl = new Map(noticias.map((item) => [item.url, item]));
  return items.map((item, index) => {
    const noticia = (item.noticia_id ? byId.get(item.noticia_id) : undefined)
      ?? (item.fonte_url ? byUrl.get(item.fonte_url) : undefined)
      ?? noticias[index];
    return {
      ...item,
      data: item.data ?? noticia?.publicado_em ?? noticia?.first_seen_at ?? null,
      agencia: item.agencia ?? noticia?.agencia?.nome ?? noticia?.agencia_sigla ?? noticia?.fonte ?? null,
      titulo_minuto: item.titulo_minuto ?? noticia?.titulo ?? null,
      fonte_url: item.fonte_url ?? noticia?.url ?? null,
      imagem_url: item.imagem_url ?? noticia?.imagem_url ?? null,
      imagem_alt: item.imagem_alt ?? noticia?.titulo ?? item.titulo_minuto ?? null,
    };
  });
}

function renderMinutoItem(item: MinutoRegulacaoItemInput, _index: number) {
  const date = item.data ? formatLongDate(item.data) : "";
  const title = item.titulo_minuto || item.ato_titulo || item.ato || "Titulo pendente";
  const subtitle = item.subtitulo_minuto || "";
  const script = item.texto_minuto || item.texto_institucional || "";
  return `<article class="minuto-item">
    <div class="minuto-copy">
      <div class="item-meta">
        <span>${escapeHtml(date)}</span>
        <span>${escapeHtml(item.agencia || "Fonte oficial")}</span>
        ${item.fonte_url ? `<a class="source" href="${escapeHtml(item.fonte_url)}">Fonte oficial</a>` : ""}
      </div>
      <div>
        <p class="script-title">${escapeHtml(title)}</p>
        ${subtitle ? `<p class="script-subtitle">${escapeHtml(subtitle)}</p>` : ""}
        <p class="script">${escapeHtml(script || subtitle || "Roteiro pendente de revisao.")}</p>
      </div>
    </div>
  </article>`;
}

function createMinutoTitle(item: RegulatoryNews) {
  const source = `${item.titulo}. ${item.resumo ?? ""} ${item.conteudo ?? ""}`;
  const agency = item.agencia_sigla ?? item.agencia?.sigla ?? item.fonte;
  const subject = extractRegulatorySubject(source);
  const lower = normalizeText(source);

  if (lower.includes("consulta publica")) return clipText(`${agency} abre consulta publica sobre ${subject}`, 105);
  if (lower.includes("audiencia publica")) return clipText(`${agency} debate ${subject} em audiencia publica`, 105);
  if (lower.includes("tomada de subsidios")) return clipText(`${agency} recebe subsidios sobre ${subject}`, 105);
  if (lower.includes("resolucao") || lower.includes("deliberacao") || lower.includes("norma")) return clipText(`${agency} atualiza regra sobre ${subject}`, 105);
  if (lower.includes("autoriza") || lower.includes("aprov")) return clipText(`${agency} aprova medida sobre ${subject}`, 105);
  if (lower.includes("fiscalizacao") || lower.includes("penalidade") || lower.includes("multa")) return clipText(`${agency} reforca fiscalizacao de ${subject}`, 105);
  return clipText(cleanEditorialTitle(item.titulo), 105);
}

function createMinutoLegacySubtitleUnused(item: RegulatoryNews) {
  const source = `${item.titulo}. ${item.resumo ?? ""} ${item.conteudo ?? ""}`;
  const agency = item.agencia_sigla ?? item.agencia?.sigla ?? item.fonte;
  const subject = extractRegulatorySubject(source);
  const lower = normalizeText(source);

  if (lower.includes("consulta publica")) return clipText(`Consulta pública abre debate sobre ${subject}`, 90);
  if (lower.includes("audiencia publica")) return clipText(`Audiência pública pauta ${subject}`, 90);
  if (lower.includes("tomada de subsidios")) return clipText(`Tomada de subsídios coleta contribuições sobre ${subject}`, 90);
  if (lower.includes("resolucao") || lower.includes("deliberacao")) return clipText(`${agency} atualiza regra sobre ${subject}`, 90);
  if (lower.includes("autoriza") || lower.includes("aprov")) return clipText(`${agency} aprova medida sobre ${subject}`, 90);
  if (lower.includes("fiscalizacao") || lower.includes("penalidade") || lower.includes("multa")) return clipText(`${agency} reforca acompanhamento de ${subject}`, 90);
  return clipText(`${agency} movimenta agenda sobre ${subject}`, 90);
}

function createMinutoScript(item: RegulatoryNews) {
  const agency = item.agencia_sigla ?? item.agencia?.sigla ?? item.fonte ?? "A agencia";
  const title = cleanEditorialTitle(item.titulo);
  const context = newsletterExcerpt(item, 260);
  const impact = context && normalizeText(context) !== normalizeText(title)
    ? context
    : `${agency} divulgou uma nova atualizacao regulatoria sobre o tema.`;
  return [
    `${agency}: ${title}.`,
    impact,
    "Esse e o ponto principal para acompanhar agora na agenda regulatoria.",
  ].join(" ");
}

function createMinutoAct(item: RegulatoryNews) {
  const text = `${item.titulo}. ${item.resumo ?? ""}`;
  const formalAct = identifyFormalAct(item);
  if (formalAct) return formalAct;
  return clipText(item.titulo || extractRegulatorySubject(text), 160);
}

function createMinutoSubtitle(item: RegulatoryNews) {
  const sourceText = newsletterArticleText(item, 420) || item.titulo;
  const subtitle = clipSentence(sourceText, 190);
  if (subtitle && normalizeText(subtitle) !== normalizeText(item.titulo)) return subtitle;
  const fallbackAgency = item.agencia_sigla ?? item.agencia?.sigla ?? item.fonte ?? "Fonte oficial";
  return clipSentence(`${fallbackAgency}: ${item.titulo}`, 190);
}

function createMinutoText(item: RegulatoryNews) {
  const agency = item.agencia_sigla ?? item.agencia?.sigla ?? item.fonte;
  const subject = extractRegulatorySubject(`${item.titulo}. ${item.resumo ?? ""} ${item.conteudo ?? ""}`);
  const sentences: Record<string, string> = {
    consulta_publica: `A ${agency} submeteu a consulta pública tema relacionado a ${subject}.`,
    audiencia_publica: `A ${agency} promoveu audiência pública para discutir ${subject}.`,
    reajuste_tarifario: `A ${agency} informou decisão tarifária relacionada a ${subject}.`,
    resolucao: `A ${agency} publicou ato normativo relacionado a ${subject}.`,
    deliberacao: `A ${agency} comunicou deliberação relacionada a ${subject}.`,
    fiscalizacao: `A ${agency} informou medida de fiscalização relacionada a ${subject}.`,
    institucional: `A ${agency} divulgou atualização institucional relacionada a ${subject}.`,
  };
  const closing = "";
  return clipText(`${sentences[identifyEditorialModel(item)]} ${closing}`, 420);
}

function identifyEditorialModel(item: RegulatoryNews) {
  const lower = normalizeText(`${item.titulo}. ${item.resumo ?? ""} ${item.conteudo ?? ""}`);
  if (lower.includes("consulta publica")) return "consulta_publica";
  if (lower.includes("audiencia publica")) return "audiencia_publica";
  if (lower.includes("reajuste tarifario") || lower.includes("revisao tarifaria")) return "reajuste_tarifario";
  if (lower.includes("resolucao") || lower.includes("rdc") || lower.includes("norma de referencia")) return "resolucao";
  if (lower.includes("deliberacao")) return "deliberacao";
  if (lower.includes("fiscalizacao") || lower.includes("penalidade") || lower.includes("multa")) return "fiscalizacao";
  return "institucional";
}

function identifyFormalAct(item: RegulatoryNews) {
  const text = `${item.titulo}. ${item.resumo ?? ""} ${item.conteudo ?? ""}`.replace(/\s+/g, " ");
  const match = text.match(/\b(?:Resolu[cç][aã]o(?:\s+(?:Normativa|Homologat[oó]ria|ANM))?|RDC|Norma de Refer[eê]ncia|Delibera[cç][aã]o|Consulta P[uú]blica|Audi[eê]ncia P[uú]blica|Reajuste Tarif[aá]rio)\s*(?:n[ºo.]?\s*)?[\d./-]*(?:\/\d{4})?/i);
  return match?.[0]?.trim() || null;
}

function ensureSentence(value: string) {
  if (!value) return "";
  return /[.!?]$/.test(value.trim()) ? value.trim() : `${value.trim()}.`;
}

function extractRegulatorySubject(value: string) {
  const text = value.replace(/\s+/g, " ").trim();
  const candidates = [
    /\bsobre\s+([^.;:]{12,110})/i,
    /\bpara\s+([^.;:]{12,110})/i,
    /\brelacionad[ao]s?\s+a\s+([^.;:]{12,110})/i,
    /\bde\s+([^.;:]{12,110})/i,
  ];
  for (const pattern of candidates) {
    const match = text.match(pattern)?.[1];
    if (match) return cleanSubject(match);
  }
  return cleanSubject(text);
}

function cleanSubject(value: string) {
  return clipText(value.replace(/\b(ANTT|ANM|ARTESP|Agencia|Agência|Agencia Nacional|Agência Nacional)\b/gi, "").replace(/\s+/g, " ").trim(), 78) || "tema regulatório";
}

function cleanEditorialTitle(value: string | null | undefined) {
  return (value || "Noticia regulatoria")
    .replace(/\s+/g, " ")
    .replace(/\s+-\s+gov\.br$/i, "")
    .trim();
}

function normalizeText(value: string) {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
}

function formatNewsletterDate(value: Date) {
  return value.toLocaleDateString("pt-BR", { day: "2-digit", month: "short", year: "numeric" }).replace(".", "");
}

function formatLongDate(value: string) {
  const parsed = parseDate(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleDateString("pt-BR", { day: "numeric", month: "long", year: "numeric" });
}

function formatArticleTag(item: RegulatoryNews | undefined) {
  if (!item) return "IRIS";
  const agency = item.agencia_sigla ?? item.agencia?.sigla ?? item.fonte ?? "Fonte oficial";
  return `${agency} · ${formatNewsletterDate(parseDate(item.publicado_em ?? item.first_seen_at))}`;
}

function buildNewsletterSubtitle(items: RegulatoryNews[], assunto: string) {
  if (items.length === 0) return "<strong>IRIS em destaque:</strong> selecione 3 not&iacute;cias para montar a edi&ccedil;&atilde;o";
  const agencies = [...new Set(items.map((item) => item.agencia_sigla ?? item.agencia?.sigla).filter(Boolean))];
  const focus = agencies.length === 1 ? `${agencies[0]} em destaque` : "Regula&ccedil;&atilde;o em destaque";
  const titles = items.slice(0, 3).map((item) => item.titulo.split(":")[0]).filter(Boolean);
  const text = titles.length ? titles.join(", ") : assunto;
  return `<strong>${escapeHtml(focus)}:</strong> ${escapeHtml(clipText(text, 92))}`;
}

function renderParagraphs(value: string | null | undefined, maxParagraphs: number, maxLength: number) {
  const text = clipText(value || "Sem resumo disponível.", maxParagraphs * maxLength);
  const sentences = text.match(/[^.!?]+[.!?]+|[^.!?]+$/g)?.map((part) => part.trim()).filter(Boolean) ?? [text];
  const paragraphs: string[] = [];
  let current = "";

  for (const sentence of sentences) {
    if (paragraphs.length >= maxParagraphs) break;
    if ((current + " " + sentence).trim().length > maxLength && current) {
      paragraphs.push(current);
      current = sentence;
    } else {
      current = `${current} ${sentence}`.trim();
    }
  }

  if (current && paragraphs.length < maxParagraphs) paragraphs.push(current);
  // Ensure last visible paragraph ends at a sentence boundary (never mid-sentence).
  if (paragraphs.length > 0) {
    const last = paragraphs[paragraphs.length - 1];
    const lastSentenceEnd = Math.max(last.lastIndexOf("."), last.lastIndexOf("!"), last.lastIndexOf("?"));
    if (lastSentenceEnd > last.length * 0.4) {
      paragraphs[paragraphs.length - 1] = last.slice(0, lastSentenceEnd + 1).trim();
    }
  }
  return paragraphs.map((paragraph) => `<p>${escapeHtml(paragraph)}</p>`).join("");
}

function newsletterExcerpt(item: RegulatoryNews | undefined, maxLength: number) {
  const resumo = item?.resumo?.replace(/\s+/g, " ").trim();
  const conteudo = item?.conteudo?.replace(/\s+/g, " ").trim();
  const text = resumo && resumo.length >= 80 ? resumo : conteudo || resumo || item?.titulo || "Sem resumo disponível.";
  return clipSentence(text, maxLength);
}

function newsletterArticleText(item: RegulatoryNews | undefined, maxLength: number) {
  return clipSentence(newsletterArticleBody(item, maxLength), maxLength) || "Sem resumo disponÃ­vel.";
}

export function buildNewsletterArticleTextDraft(item: RegulatoryNews | undefined, slot: NewsletterArticleSlot) {
  return newsletterArticleBody(item, {
    maxLength: NEWSLETTER_ARTICLE_TEXT_LIMITS[slot],
    minLength: slot === "main" ? 1500 : 520,
  });
}

function newsletterArticleBody(
  item: RegulatoryNews | undefined,
  options: number | { maxLength: number; minLength?: number },
  overrideText?: string | null,
) {
  if (!item) return "Sem resumo disponível.";
  const maxLength = typeof options === "number" ? options : options.maxLength;
  const minLength = typeof options === "number" ? 0 : options.minLength ?? 0;
  const override = cleanNewsletterSourceText(overrideText);
  if (override) return clipText(override, maxLength) || "Sem resumo disponível.";
  const resumo = cleanNewsletterSourceText(item.resumo);
  const conteudo = cleanNewsletterSourceText(item.conteudo);
  const title = cleanNewsletterSourceText(item.titulo);
  const normalizedResumo = normalizeText(resumo);
  const normalizedConteudo = normalizeText(conteudo);
  const parts: string[] = [];

  const resumoNeedle = normalizedResumo.slice(0, Math.min(120, normalizedResumo.length));
  const conteudoAlreadyContainsResumo = Boolean(
    resumoNeedle && normalizedConteudo.includes(resumoNeedle) && conteudo.length > resumo.length,
  );

  if (conteudoAlreadyContainsResumo) {
    appendNewsletterTextPart(parts, conteudo);
  } else {
    appendNewsletterTextPart(parts, resumo && resumo.length >= 70 ? resumo : "");
    appendNewsletterTextPart(parts, conteudo);
    if (!parts.length) appendNewsletterTextPart(parts, resumo);
  }

  if (parts.join(" ").length < minLength) {
    for (const candidate of newsletterMetadataTextCandidates(item.metadata)) {
      appendNewsletterTextPart(parts, candidate);
      if (parts.join(" ").length >= minLength) break;
    }
  }
  if (!parts.length && title) appendNewsletterTextPart(parts, title);

  return clipText(parts.join(" "), maxLength) || "Sem resumo disponível.";
}

function appendNewsletterTextPart(parts: string[], value: string | null | undefined) {
  const text = cleanNewsletterSourceText(value);
  if (!text || text.length < 24) return;
  const normalized = normalizeText(text);
  const duplicate = parts.some((part) => {
    const current = normalizeText(part);
    const probe = normalized.slice(0, Math.min(160, normalized.length));
    const currentProbe = current.slice(0, Math.min(160, current.length));
    return Boolean((probe && current.includes(probe)) || (currentProbe && normalized.includes(currentProbe)));
  });
  if (!duplicate) parts.push(text);
}

function newsletterMetadataTextCandidates(metadata: Record<string, unknown> | null | undefined) {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) return [];
  const keys = [
    "full_text",
    "raw_text",
    "article_text",
    "articleBody",
    "body",
    "content",
    "conteudo",
    "description",
    "og_description",
    "summary",
    "resumo",
    "excerpt",
  ];
  return keys
    .map((key) => metadata[key])
    .filter((value): value is string => typeof value === "string")
    .map(cleanNewsletterSourceText)
    .filter((value) => value.length >= 80);
}

function newsletterArticleOverride(item: RegulatoryNews | undefined, articleTexts: Record<string, string> | undefined, maxLength: number) {
  if (!item?.id || !articleTexts) return null;
  const value = articleTexts[item.id];
  return typeof value === "string" && value.trim() ? clipText(value, maxLength) : null;
}

function cleanNewsletterSourceText(value: string | null | undefined) {
  return (value || "")
    .replace(/\s+/g, " ")
    .replace(/\bCompartilhe:?.*$/i, "")
    .replace(/\bPublicado em\s*:?.*?(?=[A-ZÁÉÍÓÚÂÊÔÃÕÇ][a-záéíóúâêôãõç])/i, "")
    .trim();
}

function clipText(value: string | null | undefined, maxLength: number) {
  const text = (value || "").replace(/\s+/g, " ").trim();
  if (text.length <= maxLength) return text;
  const sentenceMatches = [...text.slice(0, maxLength).matchAll(/[.!?](?=\s|$)/g)];
  const lastSentence = sentenceMatches.at(-1)?.index;
  if (lastSentence && lastSentence > Math.min(80, maxLength * 0.45)) {
    return text.slice(0, lastSentence + 1).trim();
  }
  const clipped = text.slice(0, maxLength);
  const lastSpace = clipped.lastIndexOf(" ");
  const cut = clipped.slice(0, lastSpace > 80 ? lastSpace : clipped.length).trim();
  return cut.replace(/[,:;/-]+$/, "").trim();
}

function clipSentence(value: string | null | undefined, maxLength: number) {
  const text = (value || "").replace(/\s+/g, " ").trim();
  if (!text) return "";
  const firstSentence = text.match(/[^.!?]+[.!?]+/)?.[0]?.trim();
  if (firstSentence && firstSentence.length <= maxLength) return firstSentence;
  const clipped = clipText(text, maxLength).replace(/[.!?,:;/-]+$/, "").trim();
  return clipped ? `${clipped}.` : "";
}

function renderImage(src: string, fallback: string | null, alt: string) {
  const fallbackAttr = fallback && fallback !== src ? ` data-fallback-src="${escapeHtml(fallback)}"` : "";
  return `<img src="${escapeHtml(src)}"${fallbackAttr} alt="${escapeHtml(alt)}" loading="eager" decoding="async" referrerpolicy="no-referrer" onerror="irisImageFallback(this)">`;
}

function renderDocumentImage(value: string, baseUrl: string | undefined, alt: string) {
  const src = primaryImageUrl(value, baseUrl);
  const fallback = fallbackImageUrl(value, baseUrl, src);
  return renderImage(src, fallback, alt);
}

function primaryImageUrl(value: string | null | undefined, baseUrl?: string) {
  const proxied = proxiedImageUrl(value, baseUrl);
  if (baseUrl && proxied) return proxied;
  return officialImageUrl(value);
}

function fallbackImageUrl(value: string | null | undefined, baseUrl: string | undefined, src: string) {
  const official = officialImageUrl(value);
  const proxied = proxiedImageUrl(value, baseUrl);
  if (official && official !== src) return official;
  if (proxied && proxied !== src) return proxied;
  return null;
}

function officialImageUrl(value: string | null | undefined) {
  return upgradeImageScale(value ?? "");
}

function proxiedImageUrl(value: string | null | undefined, baseUrl?: string) {
  if (!value) return null;
  return absolutePath(`/api/v1/noticias/imagem?url=${encodeURIComponent(upgradeImageScale(value))}`, baseUrl);
}

function upgradeImageScale(value: string) {
  return value
    .replace(/\/@@images\/image\/(?:mini|thumb|tile|preview)(?=\/|$|\?)/i, "/@@images/image/large")
    .replace(/\/@@images\/[^/?#]+\/(?:mini|thumb|tile|preview)(?=\/|$|\?)/i, (match) => match.replace(/\/(?:mini|thumb|tile|preview)$/i, "/large"));
}

function absolutePath(path: string, baseUrl?: string) {
  if (!baseUrl) return path;
  try {
    return new URL(path, baseUrl).toString();
  } catch {
    return path;
  }
}

function parseDate(value: string) {
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const [year, month, day] = value.split("-").map(Number);
    return new Date(year, month - 1, day);
  }
  return new Date(value);
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
