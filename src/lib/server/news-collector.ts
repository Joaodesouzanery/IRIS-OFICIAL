import crypto from "crypto";

export type RegulatoryNewsStatus = "novo" | "selecionado" | "ignorado" | "arquivado";

export interface NewsSourceConfig {
  agencia_sigla: "ARTESP" | "ANTT" | "ANM";
  fonte: string;
  url: string;
  strategy: "artesp" | "govbr";
}

export interface CollectedRegulatoryNews {
  agencia_sigla: string;
  titulo: string;
  url: string;
  fonte: string;
  imagem_url: string | null;
  resumo: string | null;
  conteudo: string | null;
  publicado_em: string | null;
  hash_item: string;
  metadata: Record<string, unknown>;
}

export interface NewsSourceCollectReport {
  agencia_sigla: string;
  fonte: string;
  source_url: string;
  status: "ok" | "error";
  links_found: number;
  items_collected: number;
  latest_urls: string[];
  detail_errors?: string[];
  error?: string;
}

export interface RegulatoryNewsCollectResult {
  items: CollectedRegulatoryNews[];
  source_reports: NewsSourceCollectReport[];
}

export const NEWS_SOURCES: NewsSourceConfig[] = [
  {
    agencia_sigla: "ARTESP",
    fonte: "ARTESP",
    url: "https://www.artesp.sp.gov.br/artesp/noticias",
    strategy: "artesp",
  },
  {
    agencia_sigla: "ANTT",
    fonte: "ANTT",
    url: "https://www.gov.br/antt/pt-br/assuntos/ultimas-noticias",
    strategy: "govbr",
  },
  {
    agencia_sigla: "ANM",
    fonte: "ANM",
    url: "https://www.gov.br/anm/pt-br/assuntos/noticias",
    strategy: "govbr",
  },
];

export async function collectRegulatoryNews(limitPerSource = 24): Promise<RegulatoryNewsCollectResult> {
  const collected: CollectedRegulatoryNews[] = [];
  const sourceReports: NewsSourceCollectReport[] = [];

  for (const source of NEWS_SOURCES) {
    try {
      const links = await fetchSourceLinks(source, limitPerSource);
      const detailResults = await Promise.all(
        links.slice(0, limitPerSource).map(async (link) => {
          const item = await fetchNewsDetail(source, link);
          return {
            item,
            error: item ? null : `Detalhe ignorado: ${link.url}`,
          };
        }),
      );
      const items = detailResults.map((result) => result.item).filter((item): item is CollectedRegulatoryNews => Boolean(item));
      collected.push(...items);
      sourceReports.push({
        agencia_sigla: source.agencia_sigla,
        fonte: source.fonte,
        source_url: source.url,
        status: "ok",
        links_found: links.length,
        items_collected: items.length,
        latest_urls: items.length ? items.slice(0, 5).map((item) => item.url) : links.slice(0, 5).map((link) => link.url),
        detail_errors: detailResults.map((result) => result.error).filter((error): error is string => Boolean(error)).slice(0, 5),
      });
    } catch (error) {
      sourceReports.push({
        agencia_sigla: source.agencia_sigla,
        fonte: source.fonte,
        source_url: source.url,
        status: "error",
        links_found: 0,
        items_collected: 0,
        latest_urls: [],
        error: error instanceof Error ? error.message : "Falha desconhecida",
      });
    }
  }

  return {
    items: dedupeByUrl(collected),
    source_reports: sourceReports,
  };
}

async function fetchSourceLinks(source: NewsSourceConfig, limit: number) {
  const listingPages = await fetchListingPages(source, limit);
  const seen = new Set<string>();
  const links: Array<{ url: string; title: string }> = [];

  for (const page of listingPages) {
    const anchors = source.strategy === "artesp"
      ? extractArtespNewsAnchors(page.html, page.url)
      : extractAnchors(page.html, page.url);
    for (const anchor of anchors) {
      const url = normalizeNewsUrl(anchor.href);
      if (!url || !isNewsDetailUrl(source, url)) continue;

      const title = cleanTitle(anchor.text);
      if (title.length < 12 || isNavigationTitle(title) || seen.has(url.toString())) continue;

      seen.add(url.toString());
      links.push({ url: url.toString(), title });
      if (links.length >= limit * 2) return links;
    }
  }

  return links;
}

async function fetchListingPages(source: NewsSourceConfig, limit: number) {
  const firstHtml = await fetchHtml(source.url);
  if (source.strategy !== "artesp") return [{ url: source.url, html: firstHtml }];

  const pageUrls = new Set<string>([source.url]);
  const sourceUrl = new URL(source.url);
  for (const anchor of extractAnchors(firstHtml, source.url)) {
    const pageUrl = normalizeNewsUrl(anchor.href);
    if (!pageUrl) continue;
    if (pageUrl.host !== sourceUrl.host) continue;
    if (stripTrailingSlash(pageUrl.pathname) !== stripTrailingSlash(sourceUrl.pathname)) continue;
    if (!pageUrl.search && !/^\d+$|^>|pr[oó]ximo/i.test(anchor.text.trim())) continue;
    pageUrls.add(pageUrl.toString());
    if (pageUrls.size >= Math.min(8, Math.max(3, Math.ceil(limit / 4)))) break;
  }

  const pages = await Promise.all(
    [...pageUrls].map(async (url) => ({ url, html: url === source.url ? firstHtml : await fetchHtml(url) })),
  );
  return pages;
}

async function fetchNewsDetail(
  source: NewsSourceConfig,
  link: { url: string; title: string },
): Promise<CollectedRegulatoryNews | null> {
  try {
    const html = await fetchHtml(link.url);
    const rawTitle =
      meta(html, "property", "og:title") ??
      meta(html, "name", "twitter:title") ??
      firstText(html, /<h1[^>]*>([\s\S]*?)<\/h1>/i) ??
      link.title;
    const conteudo = extractArticleText(html);
    const rawResumo =
      meta(html, "property", "og:description") ??
      meta(html, "name", "description") ??
      firstParagraph(html);
    const titulo = isGenericArtespTitle(source, rawTitle) ? link.title : rawTitle;
    const resumo = isGenericArtespDescription(source, rawResumo) ? excerptFromText(conteudo) : rawResumo;
    const canonicalUrl = normalizeNewsUrl(absolutize(meta(html, "property", "og:url"), link.url) ?? link.url);
    const canonical = canonicalUrl && isNewsDetailUrl(source, canonicalUrl) ? canonicalUrl.toString() : link.url;
    const image = extractMainImage(html, link.url);
    const publicado_em =
      meta(html, "property", "article:published_time") ??
      meta(html, "name", "DC.date.created") ??
      meta(html, "name", "dcterms.created") ??
      meta(html, "name", "date") ??
      firstAttr(html, /<time[^>]+datetime=["']([^"']+)["']/i) ??
      extractDateFromText(stripTags(html));
    const hash_item = sha256(`${source.agencia_sigla}|${canonical}`);

    return {
      agencia_sigla: source.agencia_sigla,
      titulo: cleanText(titulo).slice(0, 500),
      url: canonical,
      fonte: source.fonte,
      imagem_url: image.url,
      resumo: resumo ? cleanText(resumo).slice(0, 900) : null,
      conteudo,
      publicado_em: normalizeDate(publicado_em),
      hash_item,
      metadata: {
        source_url: source.url,
        collector: source.strategy,
        image_source: image.source,
      },
    };
  } catch {
    return null;
  }
}

async function fetchHtml(url: string) {
  const res = await fetch(url, {
    headers: {
      "User-Agent": "IRIS-Regulacao-Noticias/1.0 (+https://iris-oficial.vercel.app)",
      Accept: "text/html,application/xhtml+xml",
    },
    next: { revalidate: 0 },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} ao coletar ${url}`);
  return res.text();
}

function isNewsDetailUrl(source: NewsSourceConfig, url: URL) {
  const sourceUrl = new URL(source.url);
  if (url.host !== sourceUrl.host) return false;

  const path = stripTrailingSlash(url.pathname);
  const sourcePath = stripTrailingSlash(sourceUrl.pathname);
  if (path === sourcePath) return false;
  if (!path.startsWith(`${sourcePath}/`)) return false;
  if (source.strategy === "artesp" && /\/(?:!ut|dz)\//i.test(path)) return false;

  const lastSegment = decodeURIComponent(path.split("/").filter(Boolean).at(-1) ?? "");
  if (!lastSegment || /^\d+$/.test(lastSegment)) return false;
  if (["noticias", "ultimas-noticias", "noticias-anteriores"].includes(normalizeText(lastSegment))) return false;
  if (lastSegment.includes(".")) return false;
  if (source.strategy === "artesp" && /^z[0-9a-z_]+$/i.test(lastSegment)) return false;

  return true;
}

function normalizeNewsUrl(value: string) {
  try {
    const url = new URL(value);
    url.hash = "";
    ["b_start:int", "b_start", "utm_source", "utm_medium", "utm_campaign"].forEach((param) => {
      url.searchParams.delete(param);
    });
    return url;
  } catch {
    return null;
  }
}

function extractAnchors(html: string, baseUrl: string) {
  const anchors: Array<{ href: string; text: string }> = [];
  const re = /<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  let match: RegExpExecArray | null;

  while ((match = re.exec(html)) !== null) {
    const text = cleanText(stripTags(match[2]));
    if (!text) continue;
    try {
      anchors.push({ href: new URL(decodeHtml(match[1]), baseUrl).toString(), text });
    } catch {
      // Ignora links malformados do CMS.
    }
  }

  return anchors;
}

function extractArtespNewsAnchors(html: string, baseUrl: string) {
  const sourcePath = stripTrailingSlash(new URL(baseUrl).pathname);
  const source: NewsSourceConfig = { agencia_sigla: "ARTESP", fonte: "ARTESP", url: baseUrl, strategy: "artesp" };
  const seen = new Set<string>();
  const links: Array<{ href: string; text: string }> = [];
  const hrefRe = /\bhref=["']([^"']+)["']/gi;
  let match: RegExpExecArray | null;

  while ((match = hrefRe.exec(html)) !== null) {
    try {
      const url = new URL(decodeHtml(match[1]), baseUrl);
      const path = stripTrailingSlash(url.pathname);
      const lastSegment = decodeURIComponent(path.split("/").filter(Boolean).at(-1) ?? "");
      if (!path.startsWith(`${sourcePath}/`) || path === sourcePath) continue;
      if (/\/(?:!ut|dz)\//i.test(path)) continue;
      if (!lastSegment || lastSegment.includes(".") || /^z[0-9a-z_]+$/i.test(lastSegment)) continue;
      if (!isNewsDetailUrl(source, url)) continue;
      const href = url.toString();
      if (seen.has(href)) continue;
      seen.add(href);
      links.push({ href, text: slugToTitle(lastSegment) });
    } catch {
      // Ignora hrefs malformados do CMS.
    }
  }

  return links;
}

function extractMainImage(html: string, baseUrl: string): { url: string | null; source: string | null } {
  const candidates: Array<{ value: string | null; source: string }> = [
    { value: meta(html, "property", "og:image"), source: "og:image" },
    { value: meta(html, "property", "og:image:url"), source: "og:image:url" },
    { value: meta(html, "name", "twitter:image"), source: "twitter:image" },
    { value: meta(html, "itemprop", "image"), source: "itemprop:image" },
    { value: firstImageFromBlock(html, /<article[^>]*>([\s\S]*?)<\/article>/i), source: "article img" },
    { value: firstImageFromBlock(html, /<main[^>]*>([\s\S]*?)<\/main>/i), source: "main img" },
    { value: firstImageFromBlock(html, /<body[^>]*>([\s\S]*?)<\/body>/i), source: "body img" },
  ];

  for (const candidate of candidates) {
    const value = candidate.value ? pickSrcsetFirst(candidate.value) : null;
    const absolute = absolutize(value, baseUrl);
    if (absolute && isLikelyContentImage(absolute)) return { url: absolute, source: candidate.source };
  }

  return { url: null, source: null };
}

function firstImageFromBlock(html: string, blockRe: RegExp) {
  const block = blockRe.exec(html)?.[1] ?? html;
  const imgRe = /<img\b[^>]*(?:src|data-src|data-original|data-lazy-src|data-srcset|srcset)=["']([^"']+)["'][^>]*>/gi;
  let match: RegExpExecArray | null;

  while ((match = imgRe.exec(block)) !== null) {
    const value = decodeHtml(match[1]);
    if (!isDecorativeImage(value)) return value;
  }

  return null;
}

function meta(html: string, attr: "name" | "property" | "itemprop", key: string) {
  const re = new RegExp(`<meta[^>]+${attr}=["']${escapeRegExp(key)}["'][^>]+content=["']([^"']+)["'][^>]*>`, "i");
  const inverted = new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]+${attr}=["']${escapeRegExp(key)}["'][^>]*>`, "i");
  return decodeHtml(re.exec(html)?.[1] ?? inverted.exec(html)?.[1] ?? "").trim() || null;
}

function firstAttr(html: string, re: RegExp) {
  const match = re.exec(html);
  return match?.[1] ? decodeHtml(match[1]) : null;
}

function firstText(html: string, re: RegExp) {
  const match = re.exec(html);
  return match?.[1] ? cleanText(stripTags(match[1])) : null;
}

function firstParagraph(html: string) {
  const match = /<p[^>]*>([\s\S]{40,900}?)<\/p>/i.exec(html)
    ?? /<h1[^>]*>[\s\S]*?<\/h1>\s*([\s\S]{40,900}?)(?:<time|<img|<p|<h2|<h3|<div|<\/)/i.exec(html);
  return match?.[1] ? cleanText(stripTags(match[1])) : null;
}

function isGenericArtespTitle(source: NewsSourceConfig, value: string | null) {
  if (source.strategy !== "artesp") return false;
  const normalized = normalizeText(value ?? "");
  return normalized === "noticias" || normalized === "noticia" || normalized.includes("sistema de gestao de conteudo");
}

function isGenericArtespDescription(source: NewsSourceConfig, value: string | null) {
  if (source.strategy !== "artesp") return false;
  const normalized = normalizeText(value ?? "");
  return !normalized ||
    normalized.includes("cms - sistema de gestao de conteudo") ||
    normalized.includes("javascript esta desativado") ||
    normalized.includes("javascript is disabled");
}

function excerptFromText(value: string | null) {
  if (!value) return null;
  const sentence = value.match(/[^.!?]+[.!?]+/)?.[0] ?? value;
  return cleanText(sentence).slice(0, 900);
}

function extractArticleText(html: string) {
  const article =
    /<article[^>]*>([\s\S]*?)<\/article>/i.exec(html)?.[1] ??
    /<main[^>]*>([\s\S]*?)<\/main>/i.exec(html)?.[1] ??
    /<h1[^>]*>[\s\S]*?<\/h1>([\s\S]*?)(?:<h[2-4][^>]*>\s*(?:ultimas|[uú]ltimas)\s*<\/h[2-4]>|<footer|Complementary Content)/i.exec(html)?.[1] ??
    html;
  const paragraphs = [...article.matchAll(/<p[^>]*>([\s\S]*?)<\/p>/gi)]
    .map((match) => cleanText(stripTags(match[1])))
    .filter((text) => text.length >= 30);
  if (paragraphs.length) return paragraphs.join("\n\n").slice(0, 6000);

  const text = cleanText(stripTags(article))
    .replace(/\bAumentar fonte\b[\s\S]*$/i, "")
    .replace(/\bUltimas\s+Noticias\b[\s\S]*$/i, "")
    .replace(/\bÚltimas\s+Notícias\b[\s\S]*$/i, "");
  return text.length >= 80 ? text.slice(0, 6000) : null;
}

function extractDateFromText(text: string) {
  const match = /(\d{2})\/(\d{2})\/(\d{4})(?:\s*(?:-|às|as)?\s*(\d{2}):(\d{2}))?/.exec(text);
  if (!match) return null;
  const [, day, month, year, hour = "12", minute = "00"] = match;
  return `${year}-${month}-${day}T${hour}:${minute}:00-03:00`;
}

function normalizeDate(value: string | null) {
  if (!value) return null;
  const parsed = new Date(value);
  if (!Number.isNaN(parsed.getTime())) return parsed.toISOString();
  return extractDateFromText(value);
}

function absolutize(value: string | null, baseUrl: string) {
  if (!value) return null;
  try {
    return new URL(value, baseUrl).toString();
  } catch {
    return null;
  }
}

function dedupeByUrl(items: CollectedRegulatoryNews[]) {
  const seen = new Set<string>();
  return items.filter((item) => {
    if (seen.has(item.url)) return false;
    seen.add(item.url);
    return true;
  });
}

function stripTags(value: string) {
  return value
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ");
}

function decodeHtml(value: string) {
  const named: Record<string, string> = {
    amp: "&",
    quot: '"',
    apos: "'",
    nbsp: " ",
    ccedil: "ç",
    Ccedil: "Ç",
    atilde: "ã",
    Atilde: "Ã",
    otilde: "õ",
    Otilde: "Õ",
    aacute: "á",
    Aacute: "Á",
    eacute: "é",
    Eacute: "É",
    iacute: "í",
    Iacute: "Í",
    oacute: "ó",
    Oacute: "Ó",
    uacute: "ú",
    Uacute: "Ú",
    acirc: "â",
    Acirc: "Â",
    ecirc: "ê",
    Ecirc: "Ê",
    ocirc: "ô",
    Ocirc: "Ô",
    agrave: "à",
    Agrave: "À",
  };

  return value.replace(/&(#x?[0-9a-f]+|[a-zA-Z]+);/g, (entity, code: string) => {
    if (code[0] === "#") {
      const isHex = code[1]?.toLowerCase() === "x";
      const parsed = Number.parseInt(code.slice(isHex ? 2 : 1), isHex ? 16 : 10);
      if (!Number.isFinite(parsed)) return entity;
      try {
        return String.fromCodePoint(parsed);
      } catch {
        return entity;
      }
    }
    return named[code] ?? entity;
  });
}

function cleanText(value: string) {
  return decodeHtml(value).replace(/\s+/g, " ").trim();
}

function cleanTitle(value: string) {
  return cleanText(value)
    .replace(/\s+\d{2}\/\d{2}\/\d{4}(?:\s+\d{2}:\d{2})?$/, "")
    .trim();
}

function normalizeText(value: string) {
  return cleanText(value)
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

function stripTrailingSlash(value: string) {
  return value.replace(/\/+$/, "");
}

function slugToTitle(value: string) {
  return cleanText(value.replace(/[+_-]+/g, " "));
}

function isNavigationTitle(value: string) {
  const normalized = normalizeText(value);
  return [
    "noticias",
    "ultimas noticias",
    "noticias anteriores",
    "proximo",
    "anterior",
    "ver todas as noticias",
  ].includes(normalized);
}

function pickSrcsetFirst(value: string) {
  return value.split(",")[0]?.trim().split(/\s+/)[0] ?? value;
}

function isDecorativeImage(value: string) {
  const normalized = normalizeText(value);
  return normalized.includes("logo") ||
    normalized.includes("vlibras") ||
    normalized.includes("avatar") ||
    normalized.includes("icone") ||
    normalized.includes("icon");
}

function isLikelyContentImage(value: string) {
  if (isDecorativeImage(value)) return false;
  try {
    const path = new URL(value).pathname.toLowerCase();
    return /\.(png|jpe?g|webp|gif)$/i.test(path) ||
      path.includes("@@images") ||
      path.includes("/image") ||
      path.includes("/imagem");
  } catch {
    return /\.(png|jpe?g|webp|gif)(?:\?|$)/i.test(value);
  }
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function sha256(value: string) {
  return crypto.createHash("sha256").update(value).digest("hex");
}
