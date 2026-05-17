import type { RegulatoryNews } from "@/types";

export interface NewsletterDocumentInput {
  assunto: string;
  descricao?: string | null;
  destinatarios?: string[];
  temas?: string[];
  noticias: RegulatoryNews[];
  generatedAt?: Date;
  baseUrl?: string;
}

const BRAND = {
  black: "#000000",
  navy: "#0B4068",
  slate: "#7C93A4",
  gold: "#C1A037",
  white: "#FFFFFF",
};

export function buildRegulatoryNewsletterHtml(input: NewsletterDocumentInput) {
  const generatedAt = input.generatedAt ?? new Date();
  const date = generatedAt.toLocaleDateString("pt-BR", { day: "2-digit", month: "long", year: "numeric" }).toUpperCase();
  const [highlight] = input.noticias;
  const description =
    input.descricao?.trim() ||
    "Seleção das principais notícias regulatórias com fontes oficiais para acompanhamento dos associados.";
  const title = highlight?.titulo ?? input.assunto ?? "Atualização regulatória";
  const logo = absolutePath("/brand/newsletter-logo.png", input.baseUrl);
  const heroImage = officialImageUrl(highlight?.imagem_url);
  const heroFallback = proxiedImageUrl(highlight?.imagem_url, input.baseUrl);

  return `<!doctype html>
<html lang="pt-BR">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(input.assunto || "Newsletter Regulatório")}</title>
  <style>
    @page { size: A4; margin: 0; }
    * { box-sizing: border-box; }
    body { margin: 0; background: #e9eef2; color: ${BRAND.black}; font-family: Arial, Helvetica, sans-serif; }
    main { width: 794px; max-width: 100%; margin: 0 auto; background: ${BRAND.white}; min-height: 1123px; }
    .cover { position: relative; display: grid; grid-template-columns: 42% 58%; min-height: 520px; background: ${BRAND.black}; color: ${BRAND.white}; overflow: hidden; }
    .cover-copy { padding: 42px 34px 34px; display: flex; flex-direction: column; justify-content: space-between; z-index: 2; }
    .logo { width: 118px; height: auto; max-height: 92px; object-fit: contain; display: block; margin-bottom: 34px; }
    .label { margin: 0 0 16px; color: ${BRAND.gold}; font-size: 13px; line-height: 1; font-weight: 700; letter-spacing: .02em; }
    .brand { margin: 0; color: ${BRAND.white}; font-size: 37px; line-height: .9; font-weight: 900; letter-spacing: .02em; text-transform: uppercase; }
    .title { margin: 22px 0 0; color: ${BRAND.white}; font-size: 34px; line-height: 1.03; font-weight: 900; letter-spacing: 0; }
    .date { margin: 24px 0 0; color: ${BRAND.slate}; font-size: 13px; font-weight: 800; letter-spacing: .12em; text-transform: uppercase; }
    .contact { margin: 0; color: ${BRAND.gold}; font-size: 11px; font-weight: 800; letter-spacing: .08em; text-transform: uppercase; }
    .hero-frame { width: 100%; min-height: 520px; background: linear-gradient(135deg, ${BRAND.navy}, ${BRAND.black}); }
    .hero-frame img { width: 100%; height: 100%; min-height: 520px; object-fit: cover; display: block; }
    .hero-frame.image-missing::after { content: ""; display: block; min-height: 520px; }
    .intro { padding: 34px 42px 24px; border-bottom: 1px solid rgba(11,64,104,.18); }
    .summary { margin: 0; color: #25313b; font-size: 15px; line-height: 1.68; }
    .chips { display: flex; flex-wrap: wrap; gap: 7px; margin-top: 18px; }
    .chip { border: 1px solid ${BRAND.gold}; color: ${BRAND.navy}; background: #fbf8ef; border-radius: 999px; padding: 5px 10px; font-size: 10px; font-weight: 800; text-transform: uppercase; letter-spacing: .05em; }
    .news { padding: 28px 42px 36px; }
    .section-title { margin: 0 0 18px; color: ${BRAND.navy}; font-size: 13px; font-weight: 900; letter-spacing: .16em; text-transform: uppercase; }
    article { break-inside: avoid; display: grid; grid-template-columns: 122px minmax(0,1fr); gap: 18px; padding: 20px 0; border-top: 1px solid rgba(11,64,104,.18); }
    article:first-of-type { border-top: 0; padding-top: 0; }
    .thumb-frame { width: 122px; height: 86px; background: ${BRAND.navy}; overflow: hidden; }
    .thumb-frame img { width: 122px; height: 86px; object-fit: cover; display: block; }
    .thumb-frame.image-missing::after { content: ""; display: block; width: 122px; height: 86px; }
    .meta { margin: 0 0 7px; color: ${BRAND.gold}; font-size: 10px; line-height: 1.2; font-weight: 900; letter-spacing: .08em; text-transform: uppercase; }
    h2 { margin: 0; color: ${BRAND.black}; font-size: 18px; line-height: 1.2; font-weight: 900; letter-spacing: 0; }
    p { font-size: 13px; line-height: 1.55; }
    .excerpt { margin: 9px 0 0; color: #3f4a54; }
    a { color: ${BRAND.navy}; font-weight: 900; text-decoration: none; }
    .link { display: inline-block; margin-top: 9px; color: ${BRAND.navy}; font-size: 11px; letter-spacing: .04em; text-transform: uppercase; }
    footer { padding: 24px 42px 32px; color: ${BRAND.slate}; border-top: 1px solid rgba(11,64,104,.18); font-size: 11px; line-height: 1.5; }
    @media print {
      body { background: ${BRAND.white}; }
      main { width: auto; max-width: none; }
    }
    @media (max-width: 720px) {
      .cover { grid-template-columns: 1fr; }
      .hero-frame, .hero-frame img, .hero-frame.image-missing::after { min-height: 260px; }
      article { grid-template-columns: 1fr; }
      .thumb-frame, .thumb-frame img, .thumb-frame.image-missing::after { width: 100%; height: 170px; }
    }
  </style>
  <script>
    function irisImageFallback(img) {
      var fallback = img.getAttribute("data-fallback-src");
      if (fallback && img.src !== fallback) {
        img.removeAttribute("data-fallback-src");
        img.src = fallback;
        return;
      }
      img.style.display = "none";
      if (img.parentElement) img.parentElement.classList.add("image-missing");
    }
  </script>
</head>
<body>
  <main>
    <header class="cover">
      <div class="cover-copy">
        <div>
          <img class="logo" src="${escapeHtml(logo)}" alt="IRIS">
          <p class="label">Destaque</p>
          <p class="brand">Newsletter<br>Regulatório</p>
          <h1 class="title">${escapeHtml(title)}</h1>
          <p class="date">${escapeHtml(date)}</p>
        </div>
        <p class="contact">CONTATO@IRISREGULACAO.ORG</p>
      </div>
      ${heroImage ? `<div class="hero-frame">${renderImage(heroImage, heroFallback, "")}</div>` : `<div class="hero-frame image-missing"></div>`}
    </header>
    <section class="intro">
      <p class="summary">${escapeHtml(description)}</p>
      ${input.temas?.length ? `<div class="chips">${input.temas.map((tema) => `<span class="chip">${escapeHtml(tema)}</span>`).join("")}</div>` : ""}
    </section>
    <section class="news">
      <p class="section-title">Notícias selecionadas</p>
      ${input.noticias.length ? input.noticias.map((item) => renderNews(item, input.baseUrl)).join("") : `<p>Nenhuma notícia selecionada.</p>`}
    </section>
    <footer>
      Documento gerado pelo IRIS Regulação com fontes oficiais das agências reguladoras. As imagens foram preservadas das páginas oficiais quando disponíveis.
    </footer>
  </main>
</body>
</html>`;
}

function renderNews(item: RegulatoryNews, baseUrl?: string) {
  const image = officialImageUrl(item.imagem_url);
  const fallback = proxiedImageUrl(item.imagem_url, baseUrl);
  return `<article>
    ${image ? `<div class="thumb-frame">${renderImage(image, fallback, "")}</div>` : `<div class="thumb-frame image-missing"></div>`}
    <div>
      <p class="meta">${escapeHtml(item.fonte)} · ${escapeHtml(formatDate(item.publicado_em ?? item.first_seen_at))}</p>
      <h2>${escapeHtml(item.titulo)}</h2>
      <p class="excerpt">${escapeHtml(item.resumo ?? "Sem resumo disponível.")}</p>
      <a class="link" href="${escapeHtml(item.url)}">Ler fonte oficial</a>
    </div>
  </article>`;
}

function renderImage(src: string, fallback: string | null, alt: string) {
  const fallbackAttr = fallback && fallback !== src ? ` data-fallback-src="${escapeHtml(fallback)}"` : "";
  return `<img src="${escapeHtml(src)}"${fallbackAttr} alt="${escapeHtml(alt)}" onerror="irisImageFallback(this)">`;
}

function officialImageUrl(value: string | null | undefined) {
  if (!value) return null;
  return value;
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

function formatDate(value: string) {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleDateString("pt-BR", { day: "2-digit", month: "short", year: "numeric" });
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
