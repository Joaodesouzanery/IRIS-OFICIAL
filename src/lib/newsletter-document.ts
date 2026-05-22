import type { NewsletterDocumentType, RegulatoryNews } from "@/types";

export interface MinutoRegulacaoItemInput {
  noticia_id?: string | null;
  data?: string | null;
  agencia?: string | null;
  titulo_minuto?: string | null;
  ato?: string | null;
  texto_minuto?: string | null;
  fonte_url?: string | null;
}

export interface NewsletterDocumentInput {
  assunto: string;
  descricao?: string | null;
  destinatarios?: string[];
  temas?: string[];
  noticias: RegulatoryNews[];
  generatedAt?: Date;
  baseUrl?: string;
  documento_tipo?: NewsletterDocumentType;
  minuto_textos?: string[];
  minuto_items?: MinutoRegulacaoItemInput[];
}

const NEWSLETTER_COLORS = {
  page: "#0d1220",
  hero: "#0f1a2c",
  image: "#1a2236",
  gold: "#c9a84c",
  white: "#fff",
};

export function buildRegulatoryNewsletterHtml(input: NewsletterDocumentInput) {
  if (input.documento_tipo === "minuto_regulacao") {
    return buildMinutoRegulacaoHtml(input);
  }
  return buildNewsletterRegulatorioHtml(input);
}

function buildNewsletterRegulatorioHtml(input: NewsletterDocumentInput) {
  const generatedAt = input.generatedAt ?? new Date();
  const date = formatNewsletterDate(generatedAt);
  const selected = input.noticias.slice(0, 3);
  const [main, second, third] = selected;
  const heroSubtitle = buildNewsletterSubtitle(selected, input.assunto);
  const logo = absolutePath("/brand/iris-logo-transparent.png", input.baseUrl);

  return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="UTF-8"/>
<meta name="viewport" content="width=960, initial-scale=1"/>
<link rel="preconnect" href="https://fonts.googleapis.com"/>
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin/>
<link href="https://fonts.googleapis.com/css2?family=Playfair+Display:ital,wght@0,700;0,800;0,900;1,700&family=Inter:wght@300;400;500;600;700&display=swap" rel="stylesheet"/>
<title>${escapeHtml(input.assunto || "Newsletter Regulatorio")}</title>
<style>
*,*::before,*::after{box-sizing:border-box;margin:0;padding:0;-webkit-print-color-adjust:exact;print-color-adjust:exact;color-adjust:exact;}
html{background:#111827;}
body{width:960px;height:1357px;background:${NEWSLETTER_COLORS.page};color:#fff;font-family:'Inter',sans-serif;display:flex;flex-direction:column;overflow:hidden;padding-bottom:32px;margin:0 auto;position:relative;isolation:isolate;}
.print-bg{position:absolute;inset:0;width:960px;height:1357px;z-index:0;pointer-events:none;display:block;}
.topbar,.hero,.body,.footer{position:relative;z-index:1;}
.topbar{display:flex;align-items:center;justify-content:space-between;padding:0 44px;height:38px;flex-shrink:0;border-bottom:1px solid rgba(255,255,255,0.1);font-size:9px;font-weight:500;letter-spacing:0.15em;text-transform:uppercase;color:rgba(255,255,255,0.4);}
.topbar strong{color:rgba(255,255,255,0.75);font-weight:600;}
.hero{background:${NEWSLETTER_COLORS.hero};padding:0 44px;height:190px;flex-shrink:0;display:flex;align-items:center;justify-content:space-between;gap:24px;border-bottom:1px solid rgba(255,255,255,0.08);}
.hero-left{display:flex;flex-direction:column;gap:10px;}
.hero-eyebrow{font-size:8.5px;font-weight:700;letter-spacing:0.24em;text-transform:uppercase;color:${NEWSLETTER_COLORS.gold};}
.hero-title{font-family:'Playfair Display',serif;font-size:64px;font-weight:900;line-height:0.92;letter-spacing:-0.025em;color:#fff;}
.hero-subtitle{font-size:12px;font-weight:400;line-height:1.55;letter-spacing:0.04em;text-transform:uppercase;color:rgba(255,255,255,0.56);max-width:500px;}
.hero-subtitle strong{color:rgba(255,255,255,0.78);font-weight:500;}
.hero-logo{width:400px;height:auto;flex-shrink:0;object-fit:contain;display:block;}
.body{display:grid;grid-template-columns:1fr 296px;flex:1;min-height:0;}
.col-main{padding:28px 32px 16px 44px;border-right:1px solid rgba(255,255,255,0.08);display:flex;flex-direction:column;gap:18px;overflow:hidden;}
.main-img{width:100%;height:256px;background:${NEWSLETTER_COLORS.image};flex-shrink:0;display:flex;align-items:center;justify-content:center;font-size:10px;letter-spacing:0.1em;text-transform:uppercase;color:rgba(255,255,255,0.13);font-weight:500;overflow:hidden;}
.main-img img,.side-img img{width:100%;height:100%;object-fit:cover;display:block;}
.art-tag{font-size:8.5px;font-weight:700;letter-spacing:0.2em;text-transform:uppercase;color:${NEWSLETTER_COLORS.gold};display:block;margin-bottom:7px;}
.main-title{font-family:'Playfair Display',serif;font-size:28px;font-weight:900;line-height:1.1;letter-spacing:-0.015em;color:#fff;text-align:left;}
.main-body{font-size:13px;line-height:1.78;color:rgba(255,255,255,0.58);text-align:justify;hyphens:auto;flex:1;overflow:hidden;}
.main-body p+p{margin-top:10px;}
.read-more{display:inline-flex;align-items:center;gap:6px;font-size:8.5px;font-weight:700;letter-spacing:0.18em;text-transform:uppercase;color:${NEWSLETTER_COLORS.gold};text-decoration:none;flex-shrink:0;}
.col-side{display:flex;flex-direction:column;}
.side-art{padding:24px 44px 14px 24px;border-bottom:1px solid rgba(255,255,255,0.07);display:flex;flex-direction:column;gap:10px;flex:1;overflow:hidden;}
.side-art:last-child{border-bottom:none;}
.side-img{width:100%;height:130px;flex-shrink:0;background:${NEWSLETTER_COLORS.image};display:flex;align-items:center;justify-content:center;font-size:9.5px;letter-spacing:0.1em;text-transform:uppercase;color:rgba(255,255,255,0.11);font-weight:500;overflow:hidden;}
.side-title{font-family:'Playfair Display',serif;font-size:17.5px;font-weight:800;line-height:1.2;letter-spacing:0;color:#fff;text-align:left;}
.side-excerpt{font-size:13px;line-height:1.72;color:rgba(255,255,255,0.58);text-align:justify;hyphens:auto;flex:1;overflow:hidden;}
.side-link{font-size:8.5px;font-weight:700;letter-spacing:0.16em;text-transform:uppercase;color:${NEWSLETTER_COLORS.gold};text-decoration:none;flex-shrink:0;}
.footer{border-top:1px solid rgba(255,255,255,0.09);padding:0 44px;height:34px;flex-shrink:0;display:flex;align-items:center;justify-content:space-between;}
.footer-brand{font-size:10px;font-weight:700;letter-spacing:0.22em;text-transform:uppercase;color:#fff;}
.footer-sub{font-size:8.5px;letter-spacing:0.06em;margin-top:2px;color:rgba(255,255,255,0.25);text-transform:uppercase;display:block;}
.footer-note{font-size:8.5px;letter-spacing:0.08em;text-align:right;color:rgba(255,255,255,0.2);text-transform:uppercase;line-height:1.6;}
@page{size:960px 1357px;margin:0;}
@media print{html,body{background:${NEWSLETTER_COLORS.page}!important;}body{margin:0!important;}*,*::before,*::after{-webkit-print-color-adjust:exact!important;print-color-adjust:exact!important;color-adjust:exact!important;}}
</style>
<script>
function irisImageFallback(img){var fallback=img.getAttribute("data-fallback-src");if(fallback&&img.src!==fallback){img.removeAttribute("data-fallback-src");img.src=fallback;return;}img.style.display="none";if(img.parentElement){img.parentElement.textContent=img.parentElement.getAttribute("data-placeholder")||"[ imagem ]";}}
</script>
</head>
<body>
  <svg class="print-bg" viewBox="0 0 960 1357" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
    <rect width="960" height="1357" fill="${NEWSLETTER_COLORS.page}"/>
    <rect y="38" width="960" height="190" fill="${NEWSLETTER_COLORS.hero}"/>
    <line x1="0" y1="38" x2="960" y2="38" stroke="rgba(255,255,255,0.1)"/>
    <line x1="0" y1="228" x2="960" y2="228" stroke="rgba(255,255,255,0.08)"/>
    <line x1="664" y1="228" x2="664" y2="1323" stroke="rgba(255,255,255,0.08)"/>
    <line x1="0" y1="1323" x2="960" y2="1323" stroke="rgba(255,255,255,0.09)"/>
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
    <img src="${escapeHtml(logo)}" alt="IRIS" class="hero-logo"/>
  </section>
  <div class="body">
    <div class="col-main">
      ${renderNewsletterMainArticle(main, input.baseUrl)}
    </div>
    <div class="col-side">
      ${renderNewsletterSideArticle(second, input.baseUrl)}
      ${renderNewsletterSideArticle(third, input.baseUrl)}
    </div>
  </div>
  <footer class="footer">
    <div>
      <span class="footer-brand">IRIS Regula&ccedil;&atilde;o</span>
      <span class="footer-sub">Instituto de Regula&ccedil;&atilde;o, Inova&ccedil;&atilde;o e Sustentabilidade</span>
    </div>
    <div class="footer-note">Documento gerado automaticamente &middot; Fontes oficiais<br>Uso interno &mdash; confidencial</div>
  </footer>
</body>
</html>`;
}

function buildMinutoRegulacaoHtml(input: NewsletterDocumentInput) {
  const generatedAt = input.generatedAt ?? new Date();
  const date = formatLongDate(generatedAt.toISOString());
  const items = buildMinutoItems(input);

  return `<!doctype html>
<html lang="pt-BR">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=794, initial-scale=1">
  <title>${escapeHtml(input.assunto || "Minuto da Regulacao")}</title>
  <style>
    @page { size: A4; margin: 0; }
    * { box-sizing: border-box; -webkit-print-color-adjust: exact; print-color-adjust: exact; color-adjust: exact; }
    body { margin: 0; background: #e6e7ea; color: #151515; font-family: Arial, Helvetica, sans-serif; }
    main { width: 794px; min-height: 1123px; margin: 0 auto; background: #fff; padding: 54px 68px 48px; }
    header { border-bottom: 2px solid #111; padding-bottom: 18px; margin-bottom: 28px; }
    .eyebrow { margin: 0 0 8px; font-size: 10px; line-height: 1; font-weight: 700; letter-spacing: .16em; text-transform: uppercase; color: #4a4a4a; }
    h1 { margin: 0; font-size: 36px; line-height: 1.02; font-weight: 800; letter-spacing: 0; text-transform: uppercase; }
    .generated { margin: 10px 0 0; font-size: 12px; color: #555; }
    .timeline { display: grid; grid-template-columns: 1fr; gap: 0; }
    .minuto-item { break-inside: avoid; padding: 0 0 28px; margin: 0 0 28px; border-bottom: 1px solid #d6d6d6; }
    .item-date { margin: 0 0 11px; font-size: 17px; line-height: 1.2; font-weight: 500; color: #252525; }
    .agency { margin: 0 0 5px; font-size: 15px; line-height: 1.32; font-weight: 500; color: #242424; }
    .minute-title { margin: 0 0 8px; font-size: 20px; line-height: 1.18; font-weight: 800; color: #171717; }
    .act { margin: 0 0 17px; font-size: 15px; line-height: 1.28; font-weight: 700; color: #242424; }
    .summary { margin: 0; max-width: 560px; white-space: pre-line; font-size: 16px; line-height: 1.42; font-weight: 400; color: #202020; }
    .source { display: inline-block; margin-top: 12px; color: #1d4f7a; font-size: 10px; line-height: 1; font-weight: 700; letter-spacing: .08em; text-transform: uppercase; text-decoration: none; }
    .empty { color: #666; font-size: 14px; }
    footer { margin-top: 28px; padding-top: 14px; border-top: 2px solid #111; color: #555; font-size: 10px; line-height: 1.4; text-transform: uppercase; letter-spacing: .08em; }
    @media print { body { background: #fff; } main { margin: 0; } * { -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; color-adjust: exact !important; } }
  </style>
</head>
<body>
  <main>
    <header>
      <p class="eyebrow">IRIS Regula&ccedil;&atilde;o</p>
      <h1>Minuto da Regula&ccedil;&atilde;o</h1>
      <p class="generated">Gerado em ${escapeHtml(date)}</p>
    </header>
    ${
      items.length
        ? `<section class="timeline">${items.map(renderMinutoItem).join("")}</section>`
        : `<p class="empty">Selecione not&iacute;cias e cole os textos revisados para montar o Minuto da Regula&ccedil;&atilde;o.</p>`
    }
    <footer>Documento gerado automaticamente com base em fontes oficiais. Conte&uacute;do resumido para uso interno e acompanhamento regulat&oacute;rio.</footer>
  </main>
</body>
</html>`;
}

function renderNewsletterMainArticle(item: RegulatoryNews | undefined, baseUrl?: string) {
  const title = item?.titulo ?? "Selecione a noticia principal para montar a edicao";
  return `
    <div class="main-img" data-placeholder="[ imagem da not&iacute;cia ]">${renderArticleImage(item, baseUrl, title)}</div>
    <div>
      <span class="art-tag">${escapeHtml(formatArticleTag(item))}</span>
      <h2 class="main-title">${escapeHtml(clipText(title, 145))}</h2>
    </div>
    <div class="main-body">${renderParagraphs(item?.conteudo || item?.resumo || "A noticia selecionada aparecera neste espaco, mantendo o mesmo desenho, hierarquia e proporcao do layout original.", 3, 470)}</div>
    ${item?.url ? `<a href="${escapeHtml(item.url)}" class="read-more">Ler fonte oficial &#8599;</a>` : `<a class="read-more">Ler fonte oficial &#8599;</a>`}
  `;
}

function renderNewsletterSideArticle(item: RegulatoryNews | undefined, baseUrl?: string) {
  const title = item?.titulo ?? "Selecione uma noticia secundaria";
  return `<div class="side-art">
    <div class="side-img" data-placeholder="[ imagem ]">${renderArticleImage(item, baseUrl, title)}</div>
    <span class="art-tag">${escapeHtml(formatArticleTag(item))}</span>
    <h3 class="side-title">${escapeHtml(clipText(title, 105))}</h3>
    <p class="side-excerpt">${escapeHtml(clipText(item?.conteudo || item?.resumo || "O resumo revisado da noticia secundaria aparecera neste bloco.", 310))}</p>
    ${item?.url ? `<a href="${escapeHtml(item.url)}" class="side-link">Fonte oficial &#8599;</a>` : `<a class="side-link">Fonte oficial &#8599;</a>`}
  </div>`;
}

function renderArticleImage(item: RegulatoryNews | undefined, baseUrl: string | undefined, alt: string) {
  if (!item?.imagem_url) return "";
  const src = officialImageUrl(item.imagem_url);
  const fallback = proxiedImageUrl(item.imagem_url, baseUrl);
  return renderImage(src, fallback, alt);
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

  return `Voce e redator regulatorio do IRIS. Transforme as noticias abaixo em itens para o documento "Minuto da Regulacao", no mesmo estilo do PDF Retrospectiva 2025: data, agencia, titulo proprio, ato regulatorio e um texto curto, objetivo e institucional.

Regras:
- Responda somente em JSON valido.
- Use o formato: {"itens":[{"ordem":1,"noticia_id":"id_original","data":"...","agencia":"...","titulo_minuto":"...","ato":"...","texto_minuto":"...","fonte_url":"..."}]}.
- Crie titulo_minuto proprio a partir do titulo original, resumo e conteudo completo. Nao copie literalmente o titulo da noticia, salvo se for nome oficial indispensavel.
- titulo_minuto deve ser curto, claro e editorial, com ate 90 caracteres.
- ato deve indicar o ato/regra/decisao/fato regulatorio em linguagem objetiva, sem repetir exatamente o titulo_minuto.
- texto_minuto deve ter 2 a 3 frases curtas, explicar o que mudou e o impacto regulatorio.
- Nao copie a noticia integral; reescreva em linguagem propria.
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
      ato: createMinutoAct(item),
      texto_minuto: createMinutoText(item),
      fonte_url: item.url,
    })),
  };
  return JSON.stringify(payload, null, 2);
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
  const structured = filterSelected(input.minuto_items?.filter((item) => item.texto_minuto || item.ato) ?? []);
  if (structured.length > 0) return structured;

  const parsed = filterSelected(parseMinutoTextos(input.minuto_textos));
  if (parsed.length > 0) return parsed;

  return input.noticias.map((item) => ({
    noticia_id: item.id,
    data: item.publicado_em ?? item.first_seen_at,
    agencia: item.agencia?.nome || item.agencia_sigla || item.fonte,
    titulo_minuto: null,
    ato: item.titulo,
    texto_minuto: "",
    fonte_url: item.url,
  }));
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
          titulo_minuto: item.titulo_minuto ?? item.titulo ?? null,
          ato: item.ato ?? item.titulo ?? null,
          texto_minuto: item.texto_minuto ?? item.texto ?? null,
          fonte_url: item.fonte_url ?? item.url ?? null,
        }));
      }
    } catch {
      return value.map((text) => ({ texto_minuto: text }));
    }
  }
  return value.map((text) => ({ texto_minuto: text }));
}

function renderMinutoItem(item: MinutoRegulacaoItemInput) {
  const date = item.data ? formatLongDate(item.data) : "";
  return `<article class="minuto-item">
    <p class="item-date">${escapeHtml(date)}</p>
    <p class="agency">${escapeHtml(item.agencia || "Fonte oficial")}</p>
    ${item.titulo_minuto ? `<p class="minute-title">${escapeHtml(item.titulo_minuto)}</p>` : ""}
    <p class="act">${escapeHtml(item.ato || "Ato regulatorio selecionado")}</p>
    <p class="summary">${escapeHtml(item.texto_minuto || "Texto do Minuto pendente de revisao.")}</p>
    ${item.fonte_url ? `<a class="source" href="${escapeHtml(item.fonte_url)}">Fonte oficial</a>` : ""}
  </article>`;
}

function createMinutoTitle(item: RegulatoryNews) {
  const source = `${item.titulo}. ${item.resumo ?? ""} ${item.conteudo ?? ""}`;
  const agency = item.agencia_sigla ?? item.agencia?.sigla ?? item.fonte;
  const subject = extractRegulatorySubject(source);
  const lower = normalizeText(source);

  if (lower.includes("consulta publica")) return clipText(`Consulta publica abre debate sobre ${subject}`, 90);
  if (lower.includes("audiencia publica")) return clipText(`Audiencia publica pauta ${subject}`, 90);
  if (lower.includes("tomada de subsidios")) return clipText(`Tomada de subsidios coleta contribuicoes sobre ${subject}`, 90);
  if (lower.includes("resolucao") || lower.includes("deliberacao")) return clipText(`${agency} atualiza regra sobre ${subject}`, 90);
  if (lower.includes("autoriza") || lower.includes("aprov")) return clipText(`${agency} aprova medida sobre ${subject}`, 90);
  if (lower.includes("fiscalizacao") || lower.includes("penalidade") || lower.includes("multa")) return clipText(`${agency} reforca acompanhamento de ${subject}`, 90);
  return clipText(`${agency} movimenta agenda sobre ${subject}`, 90);
}

function createMinutoAct(item: RegulatoryNews) {
  const text = `${item.titulo}. ${item.resumo ?? ""}`;
  const subject = extractRegulatorySubject(text);
  const agency = item.agencia_sigla ?? item.agencia?.sigla ?? item.fonte;
  return clipText(`${agency} - ${subject}`, 160);
}

function createMinutoText(item: RegulatoryNews) {
  const base = item.conteudo || item.resumo || item.titulo;
  const sentences = base.match(/[^.!?]+[.!?]+|[^.!?]+$/g)?.map((part) => part.trim()).filter(Boolean) ?? [];
  const first = sentences[0] ?? item.titulo;
  const second = sentences.find((sentence) => sentence !== first && sentence.length > 40) ?? "";
  return clipText([first, second].filter(Boolean).join(" "), 420);
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
  return clipText(value.replace(/\b(ANTT|ANM|ARTESP|Agencia|Agencia Nacional)\b/gi, "").replace(/\s+/g, " ").trim(), 78) || "tema regulatorio";
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
  return `<strong>${escapeHtml(focus)}:</strong> ${escapeHtml(clipText(text, 140))}`;
}

function renderParagraphs(value: string | null | undefined, maxParagraphs: number, maxLength: number) {
  const text = clipText(value || "Sem resumo disponivel.", maxParagraphs * maxLength);
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
  return paragraphs.map((paragraph) => `<p>${escapeHtml(paragraph)}</p>`).join("");
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

function renderImage(src: string, fallback: string | null, alt: string) {
  const fallbackAttr = fallback && fallback !== src ? ` data-fallback-src="${escapeHtml(fallback)}"` : "";
  return `<img src="${escapeHtml(src)}"${fallbackAttr} alt="${escapeHtml(alt)}" onerror="irisImageFallback(this)">`;
}

function officialImageUrl(value: string | null | undefined) {
  return value ?? "";
}

function proxiedImageUrl(value: string | null | undefined, baseUrl?: string) {
  if (!value) return null;
  return absolutePath(`/api/v1/noticias/imagem?url=${encodeURIComponent(value)}`, baseUrl);
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
