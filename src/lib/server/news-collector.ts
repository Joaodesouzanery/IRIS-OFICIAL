import crypto from "crypto";
import type { HTMLElement } from "node-html-parser";
import { FetchFailureError, resilientFetchText } from "@/lib/server/resilient-fetch";
import { tryRenderHtmlFallback } from "@/lib/server/headless";
import { parseHtml, metaContent, jsonLdBlocks, safeQuery, safeQueryAll, firstAttrValue } from "@/lib/server/html-dom";

export type RegulatoryNewsStatus = "novo" | "selecionado" | "ignorado" | "arquivado";

export interface NewsSourceConfig {
  id?: string;
  agencia_sigla: string;
  fonte: string;
  url: string;
  strategy: "artesp" | "govbr";
  tier?: "core" | "expanded";
  profile?: string;
  /** Seletor de links configurável via banco (monitoramento_sites.seletor_links). */
  linkSelector?: string | null;
}

// Seletor de links restrito (".classe", "[atributo]", "tag.classe") aplicado como
// pré-filtro sobre os anchors. Vazio/"a[href]"/não-parseável mantém todos.
function matchesLinkSelector(attrs: string, selector: string): boolean {
  const classMatch = selector.match(/\.([\w-]+)/);
  if (classMatch) {
    const classAttr = attrs.match(/class=["']([^"']*)["']/i)?.[1] ?? "";
    if (!new RegExp(`(^|\\s)${classMatch[1]}(\\s|$)`).test(classAttr)) return false;
  }
  const attrMatch = selector.match(/\[([\w-]+)/);
  if (attrMatch) {
    if (!new RegExp(`(^|\\s)${attrMatch[1]}(=|\\s|$)`, "i").test(attrs)) return false;
  }
  return true;
}

function filterAnchorsBySelector<T extends { attrs: string }>(
  anchors: T[],
  selector: string | null | undefined,
  baseUrl: string,
): T[] {
  const sel = selector?.trim();
  if (!sel || sel === "a[href]" || sel === "a") return anchors;
  const filtered = anchors.filter((a) => matchesLinkSelector(a.attrs, sel));
  if (filtered.length === 0 && anchors.length > 0) {
    console.warn(`[news-collector] seletor "${sel}" não casou nenhum link em ${baseUrl}; usando todos`);
    return anchors;
  }
  return filtered;
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
  source_id?: string;
  agencia_sigla: string;
  fonte: string;
  tier?: "core" | "expanded";
  source_url: string;
  status: "ok" | "error";
  collection_phase?: "fresh" | "backlog" | "manual";
  links_found: number;
  items_collected: number;
  items_processed: number;
  items_pending: number;
  batch_offset: number;
  images_found: number;
  images_absent: number;
  images_failed: number;
  latest_urls: string[];
  latest_publicado_em?: string | null;
  latest_title?: string | null;
  detail_errors?: string[];
  error?: string;
}

export interface RegulatoryNewsCollectResult {
  items: CollectedRegulatoryNews[];
  source_reports: NewsSourceCollectReport[];
}

export type NewsCollectionMode = "discover" | "enrich";

type NewsLink = {
  url: string;
  title: string;
  imageUrl: string | null;
  imageSource?: string | null;
  publishedAt?: string | null;
};

const PRIORITY_IMAGE_REPAIR_AGENCIES = new Set(["ANTT", "ANM", "ARTESP"]);
const SOURCE_CONCURRENCY = 2;
const DETAIL_CONCURRENCY = 3;
const FETCH_TIMEOUT_MS = 12_000;
const IMAGE_TIMEOUT_MS = 8_000;

export async function collectRegulatoryNews(
  sources: NewsSourceConfig[],
  limitPerSource = 24,
  offsetPerSource = 0,
  options: { mode?: NewsCollectionMode } = {},
): Promise<RegulatoryNewsCollectResult> {
  const mode = options.mode ?? "enrich";
  const sourceResults = await mapWithConcurrency(
    sources,
    SOURCE_CONCURRENCY,
    (source) => collectNewsSource(source, limitPerSource, offsetPerSource, mode),
  );

  return {
    items: sortNewsItemsByDate(dedupeByUrl(sourceResults.flatMap((result) => result.items))),
    source_reports: sourceResults.map((result) => result.report),
  };
}

export async function extractOfficialImageFromNewsUrl(input: {
  url: string;
  agencia_sigla?: string | null;
  fonte?: string | null;
}) {
  const strategy = input.url.includes("artesp.sp.gov.br") ? "artesp" : "govbr";
  const html = await fetchHtml(input.url);
  const root = parseHtml(html);
  const candidate = strategy === "artesp"
    ? extractArtespMainImage(root, input.url)
    : extractMainImage(root, input.url);
  const image = await validateOfficialImage(candidate);
  return {
    imagem_url: image.status === "official_image_found" || image.status === "official_image_unverified" ? upgradeImageScale(image.url ?? "") : null,
    image_status: image.status,
    image_source: image.source,
    image_content_type: image.contentType ?? null,
    image_content_length: image.contentLength ?? null,
    image_quality: image.url ? classifyImageQuality(image.url, image.contentLength ?? null) : "absent",
    image_proxy_path: image.url ? `/api/v1/noticias/imagem?url=${encodeURIComponent(image.url)}` : null,
  };
}

async function collectNewsSource(
  source: NewsSourceConfig,
  limitPerSource: number,
  offsetPerSource: number,
  mode: NewsCollectionMode,
): Promise<{ items: CollectedRegulatoryNews[]; report: NewsSourceCollectReport }> {
  try {
    const links = await fetchSourceLinks(source, limitPerSource + offsetPerSource);
    if (links.length === 0) {
      throw new Error("Nenhum link de noticia valido encontrado na fonte oficial");
    }
    const pageLinks = links.slice(offsetPerSource, offsetPerSource + limitPerSource);
    const detailResults = await mapWithConcurrency(
      pageLinks,
      DETAIL_CONCURRENCY,
      (link) => collectNewsLink(source, link, mode),
    );
    const rawItems = detailResults.map((result) => result.item).filter((item): item is CollectedRegulatoryNews => Boolean(item));
    const items = await repairDuplicateListingImages(source, rawItems, mode);
    const freshItems = filterStaleMixedItems(sortNewsItemsByDate(items));
    const detailErrors = detailResults
      .map((result) => result.error)
      .filter((error): error is string => Boolean(error))
      .slice(0, 5);
    const report: NewsSourceCollectReport = {
      source_id: source.id,
      agencia_sigla: source.agencia_sigla,
      fonte: source.fonte,
      tier: source.tier ?? "core",
      source_url: source.url,
      status: freshItems.length > 0 ? "ok" : "error",
      links_found: links.length,
      items_collected: freshItems.length,
      items_processed: detailResults.length,
      items_pending: Math.max(0, links.length - offsetPerSource - detailResults.length),
      batch_offset: offsetPerSource,
      images_found: freshItems.filter((item) => item.metadata.image_status === "official_image_found" || item.metadata.image_status === "official_image_unverified").length,
      images_absent: freshItems.filter((item) => item.metadata.image_status === "official_image_absent").length,
      images_failed: freshItems.filter((item) => item.metadata.image_status === "image_fetch_failed").length,
      latest_urls: freshItems.length ? freshItems.slice(0, 5).map((item) => item.url) : links.slice(0, 5).map((link) => link.url),
      latest_publicado_em: latestPublishedAt(freshItems),
      latest_title: latestItem(freshItems)?.titulo ?? null,
      detail_errors: detailErrors,
    };
    if (freshItems.length === 0) {
      report.error = detailErrors[0] ?? "Nenhuma noticia valida foi extraida dos links encontrados";
    }
    return { items: freshItems, report };
  } catch (error) {
    return {
      items: [],
      report: {
        source_id: source.id,
        agencia_sigla: source.agencia_sigla,
        fonte: source.fonte,
        tier: source.tier ?? "core",
        source_url: source.url,
        status: "error",
        links_found: 0,
        items_collected: 0,
        items_processed: 0,
        items_pending: 0,
        batch_offset: offsetPerSource,
        images_found: 0,
        images_absent: 0,
        images_failed: 0,
        latest_urls: [],
        latest_publicado_em: null,
        latest_title: null,
        detail_errors: [],
        error: error instanceof Error ? error.message : "Falha desconhecida",
      },
    };
  }
}

async function collectNewsLink(source: NewsSourceConfig, link: NewsLink, mode: NewsCollectionMode) {
  if (mode === "discover") {
    const item = buildListingFallbackItem(source, link);
    return {
      item,
      error: item ? null : `Listagem sem titulo ou data publicavel: ${link.url}`,
    };
  }

  const detail = await fetchNewsDetail(source, link);
  if (detail) return { item: detail, error: null };

  const fallback = buildListingFallbackItem(source, link);
  return {
    item: fallback,
    error: fallback
      ? `Detalhe indisponivel; usando dados da listagem: ${link.url}`
      : `Detalhe indisponivel e listagem sem titulo ou data publicavel: ${link.url}`,
  };
}

async function repairDuplicateListingImages(
  source: NewsSourceConfig,
  items: CollectedRegulatoryNews[],
  mode: NewsCollectionMode,
) {
  if (mode !== "discover" || !PRIORITY_IMAGE_REPAIR_AGENCIES.has(source.agencia_sigla)) return items;
  const byImage = new Map<string, CollectedRegulatoryNews[]>();
  for (const item of items) {
    if (!item.imagem_url) continue;
    byImage.set(item.imagem_url, [...(byImage.get(item.imagem_url) ?? []), item]);
  }

  const duplicateItems = [...byImage.values()]
    .filter((group) => group.length > 1)
    .flat()
    .slice(0, 8);
  if (!duplicateItems.length) return items;

  const repaired = await mapWithConcurrency(duplicateItems, DETAIL_CONCURRENCY, async (item) => {
    const detail = await fetchNewsDetail(source, {
      url: item.url,
      title: item.titulo,
      imageUrl: item.imagem_url,
      publishedAt: item.publicado_em,
    });
    if (!detail?.imagem_url) {
      return {
        ...item,
        metadata: {
          ...item.metadata,
          image_duplicate_detected: true,
          image_duplicate_repair: "detail_unavailable",
        },
      };
    }
    return {
      ...detail,
      metadata: {
        ...detail.metadata,
        image_duplicate_detected: true,
        image_duplicate_listing_url: item.imagem_url,
        image_duplicate_repair: detail.imagem_url === item.imagem_url ? "confirmed_same_official_image" : "replaced_from_detail",
      },
    };
  });

  const repairedByUrl = new Map(repaired.map((item) => [item.url, item]));
  return items.map((item) => repairedByUrl.get(item.url) ?? item);
}

function sortNewsItemsByDate(items: CollectedRegulatoryNews[]) {
  return [...items].sort((left, right) => {
    const rightTime = publishedTime(right);
    const leftTime = publishedTime(left);
    if (rightTime !== leftTime) return rightTime - leftTime;
    return left.titulo.localeCompare(right.titulo, "pt-BR");
  });
}

function filterStaleMixedItems(items: CollectedRegulatoryNews[]) {
  const dated = items.map(publishedTime).filter((time) => time > 0);
  if (dated.length < 3) return items;
  const latest = Math.max(...dated);
  const cutoff = latest - 120 * 24 * 60 * 60 * 1000;
  const filtered = items.filter((item) => {
    const time = publishedTime(item);
    return time === 0 || time >= cutoff;
  });
  return filtered.length >= Math.min(3, items.length) ? filtered : items;
}

async function fetchSourceLinks(source: NewsSourceConfig, limit: number): Promise<NewsLink[]> {
  if (source.strategy === "govbr") {
    const [htmlLinks, apiLinks] = await Promise.allSettled([
      fetchHtmlSourceLinks(source, limit),
      fetchGovbrApiLinks(source, limit),
    ]);
    return sortNewsLinksByDate(dedupeNewsLinks([
      ...(htmlLinks.status === "fulfilled" ? htmlLinks.value : []),
      ...(apiLinks.status === "fulfilled" ? apiLinks.value : []),
    ])).slice(0, Math.max(limit, limit * 2));
  }

  return fetchHtmlSourceLinks(source, limit);
}

async function fetchHtmlSourceLinks(source: NewsSourceConfig, limit: number): Promise<NewsLink[]> {
  const listingPages = await fetchListingPages(source, limit);
  const seen = new Set<string>();
  const links: NewsLink[] = [];

  for (const page of listingPages) {
    // O seletor configurável (linkSelector) é aplicado no caminho govbr, cujos
    // anchors carregam os atributos da tag; ARTESP usa parser especializado próprio.
    const anchors = source.strategy === "artesp"
      ? extractArtespNewsAnchors(page.html, page.url)
      : filterAnchorsBySelector(extractAnchors(page.html, page.url), source.linkSelector, page.url);
    for (const anchor of anchors) {
      const url = normalizeNewsUrl(anchor.href);
      if (!url || !isNewsDetailUrl(source, url)) continue;

      const title = cleanTitle(anchor.text);
      if (title.length < 12 || isNavigationTitle(title) || seen.has(url.toString())) continue;

      seen.add(url.toString());
      links.push({
        url: url.toString(),
        title,
        imageUrl: anchor.imageUrl ?? null,
        imageSource: anchor.imageSource ?? null,
        publishedAt: anchor.publishedAt ?? null,
      });
      if (links.length >= Math.max(250, limit * 2)) return links;
    }
  }

  if (links.length === 0 && source.strategy === "govbr") {
    return fetchGovbrApiLinks(source, limit);
  }

  return sortNewsLinksByDate(links);
}

async function fetchGovbrApiLinks(source: NewsSourceConfig, limit: number): Promise<NewsLink[]> {
  const apiUrl = buildGovbrSearchApiUrl(source.url, limit);
  if (!apiUrl) return [];
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(apiUrl, {
      headers: {
        "User-Agent": "IRIS-Regulacao-Noticias/1.0 (+https://iris-oficial.vercel.app)",
        Accept: "application/json",
      },
      next: { revalidate: 0 },
      signal: controller.signal,
    });
    if (!res.ok) return [];
    const payload = await res.json().catch(() => null);
    const items = Array.isArray(payload?.items) ? payload.items : [];
    const seen = new Set<string>();
    return items
      .map((item: Record<string, unknown>) => {
        const rawUrl = typeof item["@id"] === "string" ? item["@id"] : null;
        const rawTitle = typeof item.title === "string" ? item.title : null;
        const url = rawUrl ? normalizeNewsUrl(rawUrl) : null;
        const title = rawTitle ? cleanTitle(rawTitle) : "";
        if (!url || !isNewsDetailUrl(source, url) || title.length < 12 || seen.has(url.toString())) return null;
        seen.add(url.toString());
        const publishedAt = typeof item.effective === "string"
          ? item.effective
          : typeof item.created === "string" ? item.created : null;
        return { url: url.toString(), title, imageUrl: null, imageSource: null, publishedAt };
      })
      .filter((item: NewsLink | null): item is NewsLink => Boolean(item));
  } catch {
    return [];
  } finally {
    clearTimeout(timeout);
  }
}

function dedupeNewsLinks(links: NewsLink[]) {
  const seen = new Set<string>();
  const deduped: NewsLink[] = [];
  for (const link of links) {
    const url = normalizeNewsUrl(link.url);
    if (!url) continue;
    const key = url.toString();
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push({ ...link, url: key });
  }
  return deduped;
}

function sortNewsLinksByDate(links: NewsLink[]) {
  return [...links].sort((left, right) => {
    const rightTime = publishedLinkTime(right);
    const leftTime = publishedLinkTime(left);
    if (rightTime !== leftTime) return rightTime - leftTime;
    return left.title.localeCompare(right.title, "pt-BR");
  });
}

function publishedLinkTime(link: NewsLink) {
  const normalized = normalizeDate(link.publishedAt ?? null);
  const value = normalized ? new Date(normalized).getTime() : 0;
  return Number.isFinite(value) ? value : 0;
}

function buildGovbrSearchApiUrl(sourceUrl: string, limit: number) {
  try {
    const url = new URL(sourceUrl);
    const parts = url.pathname.split("/").filter(Boolean);
    const site = parts.shift();
    if (!site) return null;
    const api = new URL(`/${site}/++api++/${parts.join("/")}/@search`, url.origin);
    api.searchParams.set("portal_type", "News Item");
    api.searchParams.set("metadata_fields", "effective");
    api.searchParams.append("metadata_fields", "created");
    api.searchParams.set("sort_on", "effective");
    api.searchParams.set("sort_order", "reverse");
    api.searchParams.set("b_size", String(Math.min(60, Math.max(10, limit * 2))));
    return api.toString();
  } catch {
    return null;
  }
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

  const pages = await mapWithConcurrency([...pageUrls], 2, async (url) => ({ url, html: url === source.url ? firstHtml : await fetchHtml(url) }));
  return pages;
}

async function fetchNewsDetail(
  source: NewsSourceConfig,
  link: { url: string; title: string; imageUrl?: string | null; imageSource?: string | null; publishedAt?: string | null },
): Promise<CollectedRegulatoryNews | null> {
  let html: string;
  try {
    html = await fetchHtml(link.url);
  } catch {
    return null;
  }
  const parsed = parseNewsDetail(html, link, source);
  if (!parsed) return null;

  // Validação de imagem é a única etapa de rede do detalhe — feita aqui (fora de
  // parseNewsDetail, que é puro/testável). O candidato vem em imagem_url.
  const image = await validateOfficialImage({ url: parsed.imagem_url, source: (parsed.metadata.image_source as string | null) ?? null });
  const imagem_url = image.status === "official_image_found" || image.status === "official_image_unverified" ? image.url : null;
  return {
    ...parsed,
    imagem_url,
    metadata: {
      ...parsed.metadata,
      image_source: image.source,
      image_status: image.status,
      image_content_type: image.contentType ?? null,
      image_content_length: image.contentLength ?? null,
      image_quality: image.url ? classifyImageQuality(image.url, image.contentLength ?? null) : "absent",
      image_proxy_path: image.url ? `/api/v1/noticias/imagem?url=${encodeURIComponent(image.url)}` : null,
    },
  };
}

/**
 * Parsing PURO (sem rede) de uma página de detalhe → CollectedRegulatoryNews.
 * `imagem_url` carrega o candidato de imagem ainda NÃO validado (a validação HTTP
 * é feita por fetchNewsDetail). Exportado para os testes do golden-set.
 */
export function parseNewsDetail(
  html: string,
  link: { url: string; title: string; imageUrl?: string | null; imageSource?: string | null; publishedAt?: string | null },
  source: NewsSourceConfig,
): CollectedRegulatoryNews | null {
  const root = parseHtml(html);
  // Página de manutenção/erro (às vezes servida com HTTP 200) → não parsear lixo.
  if (isMaintenanceOrErrorPage(root)) return null;
  const jsonld = extractJsonLd(root);

  const h1Title = textOf(safeQuery(root, "h1"));
  const rawTitle = source.strategy === "artesp"
    ? h1Title ?? link.title
    : metaContent(root, "property", "og:title") ??
      metaContent(root, "name", "twitter:title") ??
      jsonld.headline ??
      h1Title ??
      link.title;
  const ogDescription = metaContent(root, "property", "og:description") ?? metaContent(root, "name", "description") ?? jsonld.description;
  let conteudo = extractArticleText(root);
  // Quando nao ha corpo extraivel, usa a og:description/JSON-LD como conteudo minimo.
  if (!conteudo && ogDescription) {
    const cleanedOg = cleanText(ogDescription);
    if (cleanedOg.length >= 80) conteudo = cleanedOg.slice(0, 6000);
  }
  const rawResumo = ogDescription ?? firstParagraphFromRoot(root);
  const titulo = isGenericArtespTitle(source, rawTitle) ? link.title : rawTitle;
  // Resumo sempre cai para o corpo do texto quando a metatag faltar ou for generica.
  const hasUsableResumo = Boolean(cleanText(rawResumo ?? "").trim()) && !isGenericArtespDescription(source, rawResumo);
  const resumo = hasUsableResumo ? rawResumo : (excerptFromText(conteudo) ?? rawResumo);
  const rawCanonicalUrl = normalizeNewsUrl(absolutize(metaContent(root, "property", "og:url"), link.url) ?? link.url);
  const canonicalUrl = rawCanonicalUrl && source.strategy === "artesp"
    ? normalizeArtespNewsUrl(rawCanonicalUrl) ?? rawCanonicalUrl
    : rawCanonicalUrl;
  const canonical = canonicalUrl && isNewsDetailUrl(source, canonicalUrl) ? canonicalUrl.toString() : link.url;
  const extractedImage = source.strategy === "artesp"
    ? extractArtespMainImage(root, link.url)
    : extractMainImage(root, link.url, jsonld.image);
  const imageCandidate = extractedImage.url
    ? extractedImage
    : link.imageUrl && isLikelyContentImage(link.imageUrl)
      ? { url: link.imageUrl, source: link.imageSource ?? "listing thumbnail verified fallback" }
      : { url: null, source: link.imageUrl ? "listing thumbnail skipped" : null };
  // Data: JSON-LD (fonte mais confiável no gov.br) → meta → <time> → listagem → texto.
  const publicado_em =
    jsonld.datePublished ??
    jsonld.dateModified ??
    metaContent(root, "property", "article:published_time") ??
    metaContent(root, "name", "DC.date.created") ??
    metaContent(root, "name", "dcterms.created") ??
    metaContent(root, "name", "date") ??
    safeQuery(root, "time[datetime]")?.getAttribute("datetime") ??
    link.publishedAt ??
    extractDateFromText(root.text);
  const normalizedDate = normalizeDate(publicado_em);
  const normalizedTitle = cleanText(titulo).slice(0, 500);
  if (source.tier === "expanded" && (!canonical || !normalizedTitle || !normalizedDate)) return null;
  const hash_item = sha256(`${source.agencia_sigla}|${canonical}`);

  return {
    agencia_sigla: source.agencia_sigla,
    titulo: normalizedTitle,
    url: canonical,
    fonte: source.fonte,
    // Candidato ainda NÃO validado por rede; fetchNewsDetail revalida e ajusta.
    imagem_url: imageCandidate.url,
    resumo: resumo ? cleanText(resumo).slice(0, 900) : null,
    conteudo,
    publicado_em: normalizedDate,
    hash_item,
    metadata: {
      source_url: source.url,
      source_id: source.id ?? null,
      collector: source.strategy,
      collection_mode: "enrich",
      news_tier: source.tier ?? "core",
      news_profile: source.profile ?? source.strategy,
      image_source: imageCandidate.source,
      image_status: imageCandidate.url ? "candidate" : "official_image_absent",
      image_content_type: null,
      image_content_length: null,
      image_quality: imageCandidate.url ? classifyImageQuality(imageCandidate.url, null) : "absent",
      image_proxy_path: imageCandidate.url ? `/api/v1/noticias/imagem?url=${encodeURIComponent(imageCandidate.url)}` : null,
      content_length: conteudo?.length ?? 0,
      resumo_length: resumo?.length ?? 0,
      content_status: classifyNewsContent(conteudo, resumo),
      batch_offset: null,
    },
  };
}

/** Extração pública de âncoras de notícia de uma listagem (para testes). */
export function extractNewsAnchors(html: string, baseUrl: string, strategy: "artesp" | "govbr") {
  return strategy === "artesp"
    ? extractArtespNewsAnchors(html, baseUrl)
    : extractAnchors(html, baseUrl);
}

function textOf(el: HTMLElement | null): string | null {
  if (!el) return null;
  const text = cleanText(el.text);
  return text || null;
}

function firstParagraphFromRoot(root: HTMLElement): string | null {
  for (const p of safeQueryAll(root, "p")) {
    const text = cleanText(p.text);
    if (text.length >= 40 && text.length <= 900) return text;
  }
  return null;
}

// Detecta páginas de manutenção/erro servidas com HTTP 200 (ex.: "Estamos em
// manutenção" do gov.br): exige múltiplos sinais para não descartar notícia real.
function isMaintenanceOrErrorPage(root: HTMLElement): boolean {
  const title = normalizeText(textOf(safeQuery(root, "title")) ?? "");
  const titleLooksBad = /manutencao|indisponivel|temporariamente|erro 5\d\d|service unavailable|not found|nao encontrad/.test(title);
  if (!titleLooksBad) return false;
  const hasH1 = Boolean(safeQuery(root, "h1"));
  const hasJsonLdArticle = Boolean(extractJsonLd(root).headline || extractJsonLd(root).datePublished);
  const bodyLen = cleanText(safeQuery(root, "body")?.text ?? root.text).length;
  // Título ruim + (sem H1 e sem JSON-LD de artigo) OU corpo muito curto.
  return (!hasH1 && !hasJsonLdArticle) || bodyLen < 600;
}

function buildListingFallbackItem(
  source: NewsSourceConfig,
  link: { url: string; title: string; imageUrl?: string | null; imageSource?: string | null; publishedAt?: string | null },
): CollectedRegulatoryNews | null {
  const canonicalUrl = normalizeNewsUrl(link.url);
  const canonical = canonicalUrl?.toString() ?? link.url;
  const titulo = cleanTitle(link.title).slice(0, 500);
  const normalizedDate = normalizeDate(link.publishedAt ?? null);
  if (!canonical || !titulo || !normalizedDate) return null;
  const hash_item = sha256(`${source.agencia_sigla}|${canonical}`);
  return {
    agencia_sigla: source.agencia_sigla,
    titulo,
    url: canonical,
    fonte: source.fonte,
    imagem_url: null,
    resumo: null,
    conteudo: null,
    publicado_em: normalizedDate,
    hash_item,
    metadata: {
      source_url: source.url,
      source_id: source.id ?? null,
      collector: source.strategy,
      collection_mode: "discover",
      news_tier: source.tier ?? "core",
      news_profile: source.profile ?? source.strategy,
      image_source: link.imageUrl ? link.imageSource ?? "listing thumbnail" : null,
      image_status: link.imageUrl ? "listing_image_unverified" : "official_image_absent",
      image_quality: "unverified",
      image_proxy_path: null,
      content_length: 0,
      resumo_length: 0,
      content_status: "detail_unavailable",
      detail_fallback: true,
      batch_offset: null,
    },
  };
}

async function fetchHtml(url: string) {
  // Portais governamentais (ex.: ARTESP/Liferay) bloqueiam User-Agents de bot com 403,
  // fazendo a coleta retornar zero links. Usamos um UA de navegador real + Accept-Language
  // pt-BR para evitar o bloqueio, com retry/backoff para instabilidades transitórias.
  const headers = {
    "User-Agent":
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
    "Accept-Language": "pt-BR,pt;q=0.9,en;q=0.8",
  };
  try {
    return await resilientFetchText(url, { headers, timeoutMs: FETCH_TIMEOUT_MS });
  } catch (error) {
    // Em bloqueio/instabilidade de rede (403/429/5xx/timeout) tentamos o fallback headless
    // antes de desistir. Falhas de conteúdo (404 etc.) sobem direto.
    if (error instanceof FetchFailureError && error.kind === "falha_rede") {
      const rendered = await tryRenderHtmlFallback(url, "HTML oficial");
      if (rendered) return rendered;
    }
    const message = error instanceof Error ? error.message : "falha desconhecida";
    throw new Error(`Falha ao coletar HTML oficial (${message}): ${url}`);
  }
}

function isNewsDetailUrl(source: NewsSourceConfig, url: URL) {
  const sourceUrl = new URL(source.url);
  if (url.host !== sourceUrl.host) return false;

  const normalizedUrl = source.strategy === "artesp" ? normalizeArtespNewsUrl(url) ?? url : url;
  const path = stripTrailingSlash(normalizedUrl.pathname);
  const sourcePath = stripTrailingSlash(sourceUrl.pathname);
  if (path === sourcePath) return false;
  if (!path.startsWith(`${sourcePath}/`)) return false;
  if (source.strategy === "artesp" && normalizedUrl === url && /\/(?:!ut|dz|p0)\//i.test(path)) return false;

  const relativeSegments = path.slice(sourcePath.length).split("/").filter(Boolean);
  const agency = source.agencia_sigla.toUpperCase();
  if (agency === "ANS" && relativeSegments.length < 2) return false;
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

function normalizeArtespNewsUrl(value: URL) {
  const sourceUrl = new URL("https://www.artesp.sp.gov.br/artesp/noticias");
  if (value.host !== sourceUrl.host) return null;

  const urile = value.searchParams.get("urile");
  const decodedUrile = urile ? decodeURIComponent(urile) : "";
  const match = /\/wcm\/connect\/artesp_content\/artesp\/noticias\/([^/?#]+)/i.exec(decodedUrile);
  const slug = match?.[1];
  if (slug) {
    return new URL(`/artesp/noticias/${slug}`, sourceUrl);
  }

  const path = stripTrailingSlash(value.pathname);
  if (path.startsWith("/artesp/noticias/") && !/\/(?:!ut|dz)\//i.test(path)) {
    const normalized = new URL(value.toString());
    normalized.hash = "";
    normalized.search = "";
    return normalized;
  }

  return null;
}

// Atributos onde imagens (incl. lazy-load) costumam aparecer, do mais para o
// menos preferível. A varredura genérica de data-* (scanElementForImageUrl)
// cobre variantes custom não listadas aqui.
const IMAGE_ATTR_NAMES = [
  "srcset", "data-srcset", "data-lazy-srcset", "data-large-src", "data-original-src",
  "data-original", "data-lazy-src", "data-image", "data-bg", "data-src", "src",
];

type AnchorInfo = { href: string; text: string; attrs: string; imageUrl: string | null; imageSource: string | null; publishedAt: string | null };

// Extração de âncoras via DOM (robusta a HTML malformado, aspas simples e
// atributos multilinha que quebravam o regex anterior). Mantém a forma de saída.
function extractAnchors(html: string, baseUrl: string): AnchorInfo[] {
  return extractAnchorsFromRoot(parseHtml(html), baseUrl);
}

function extractAnchorsFromRoot(root: HTMLElement, baseUrl: string): AnchorInfo[] {
  const anchors: AnchorInfo[] = [];
  for (const a of safeQueryAll(root, "a[href]")) {
    const text = cleanText(a.text);
    if (!text) continue;
    const rawHref = a.getAttribute("href");
    if (!rawHref) continue;
    let href: string;
    try {
      href = new URL(decodeHtml(rawHref), baseUrl).toString();
    } catch {
      continue;
    }
    const card = cardElementOf(a);
    const image = card ? firstImageUrlFromElement(card, baseUrl) : null;
    anchors.push({
      href,
      text,
      attrs: serializeAttributes(a),
      imageUrl: image,
      imageSource: image ? "listing card thumbnail" : null,
      publishedAt: (card ? extractDateFromText(card.text) : null) ?? extractDateFromText(text),
    });
  }
  return anchors;
}

// Sobe até o "card" da notícia para escopar a thumbnail/data corretas.
function cardElementOf(a: HTMLElement): HTMLElement | null {
  return (
    a.closest("article") ??
    a.closest("li") ??
    a.closest(".tile") ??
    a.closest(".card") ??
    a.closest(".tileItem") ??
    a.parentNode ??
    null
  );
}

function serializeAttributes(el: HTMLElement): string {
  const attrs = el.attributes ?? {};
  return Object.entries(attrs).map(([key, value]) => `${key}="${value}"`).join(" ");
}

// Procura a melhor URL de imagem dentro de um elemento (img/source/background),
// cobrindo lazy-load por atributos data-* e srcset.
function firstImageUrlFromElement(el: HTMLElement, baseUrl: string): string | null {
  for (const node of [...safeQueryAll(el, "source"), ...safeQueryAll(el, "img")]) {
    const raw = firstAttrValue(node, IMAGE_ATTR_NAMES) ?? scanElementForImageUrl(node);
    const value = raw ? pickSrcsetFirst(decodeHtml(raw)) : null;
    const absolute = absolutize(value, baseUrl);
    if (absolute && isLikelyContentImage(absolute)) return absolute;
  }
  const style = el.getAttribute("style") ?? "";
  const bg = /url\((['"]?)([^'")]+)\1\)/i.exec(style)?.[2];
  const bgAbsolute = absolutize(bg ? decodeHtml(bg) : null, baseUrl);
  if (bgAbsolute && isLikelyContentImage(bgAbsolute)) return bgAbsolute;
  return null;
}

// Varre todos os atributos do elemento por um valor que pareça URL de imagem
// (cobre lazy-load custom como data-flickity-lazyload, data-hi-res, etc.).
function scanElementForImageUrl(el: HTMLElement): string | null {
  for (const [key, value] of Object.entries(el.attributes ?? {})) {
    if (!value || key === "class" || key === "id") continue;
    if (/\.(png|jpe?g|webp|gif|avif)(?:[?#]|$)|@@images|@@download|\/media\//i.test(value)) return value;
  }
  return null;
}

function extractArtespNewsAnchors(html: string, baseUrl: string) {
  const source: NewsSourceConfig = {
    agencia_sigla: "ARTESP",
    fonte: "ARTESP",
    url: "https://www.artesp.sp.gov.br/artesp/noticias",
    strategy: "artesp",
  };
  const seen = new Set<string>();
  const links: Array<{ href: string; text: string; imageUrl: string | null; imageSource: string | null; publishedAt: string | null }> = [];

  for (const anchor of extractAnchors(html, baseUrl)) {
    try {
      const rawUrl = new URL(anchor.href);
      const url = normalizeArtespNewsUrl(rawUrl) ?? rawUrl;
      const path = stripTrailingSlash(url.pathname);
      const lastSegment = decodeURIComponent(path.split("/").filter(Boolean).at(-1) ?? "");
      if (/\/(?:!ut|dz|p0)\//i.test(path)) continue;
      if (!lastSegment || lastSegment.includes(".") || /^z[0-9a-z_]+$/i.test(lastSegment)) continue;
      if (!isNewsDetailUrl(source, url)) continue;
      const href = url.toString();
      if (seen.has(href)) continue;
      seen.add(href);
      links.push({
        href,
        text: cleanTitle(anchor.text) || slugToTitle(lastSegment),
        imageUrl: anchor.imageUrl,
        imageSource: anchor.imageSource,
        publishedAt: anchor.publishedAt ?? extractDateFromText(anchor.text),
      });
    } catch {
      // Ignora hrefs malformados do CMS.
    }
  }

  return links;
}

function extractMainImage(root: HTMLElement, baseUrl: string, jsonLdImage?: string | null): { url: string | null; source: string | null } {
  const candidates: Array<{ value: string | null; source: string }> = [
    { value: jsonLdImage ?? extractJsonLdImage(root), source: "json-ld image" },
    { value: metaContent(root, "property", "og:image"), source: "og:image" },
    { value: metaContent(root, "property", "og:image:url"), source: "og:image:url" },
    { value: metaContent(root, "name", "twitter:image"), source: "twitter:image" },
    { value: metaContent(root, "name", "twitter:image:src"), source: "twitter:image:src" },
    { value: metaContent(root, "name", "thumbnail"), source: "meta thumbnail" },
    { value: metaContent(root, "itemprop", "image"), source: "itemprop:image" },
    { value: extractLinkImage(root), source: "link image" },
    { value: firstImageUrlFromElement(safeQuery(root, "article") ?? root, baseUrl), source: "article img" },
    { value: firstImageUrlFromElement(safeQuery(root, "main") ?? root, baseUrl), source: "main img" },
    { value: firstImageUrlFromElement(root, baseUrl), source: "body img" },
  ];
  const valid: Array<{ url: string; source: string; score: number }> = [];

  for (const candidate of candidates) {
    const value = candidate.value ? pickSrcsetFirst(candidate.value) : null;
    const absolute = absolutize(value, baseUrl);
    if (absolute && isLikelyContentImage(absolute)) {
      valid.push({ url: absolute, source: candidate.source, score: imageScaleScore(absolute) });
    }
  }

  const best = valid.sort((left, right) => right.score - left.score)[0];
  return best ? { url: best.url, source: best.source } : { url: null, source: null };
}

interface JsonLdInfo {
  datePublished: string | null;
  dateModified: string | null;
  headline: string | null;
  image: string | null;
  description: string | null;
}

// JSON-LD (NewsArticle/Article) é a fonte estruturada mais estável das páginas
// gov.br/Plone — sobretudo para a DATA, ausente nas metatags (verificado ao vivo).
// Lê todos os blocos, resolve @graph/arrays e extrai os campos do nó de artigo.
function extractJsonLd(root: HTMLElement): JsonLdInfo {
  const empty: JsonLdInfo = { datePublished: null, dateModified: null, headline: null, image: null, description: null };
  for (const block of jsonLdBlocks(root)) {
    let json: unknown;
    try {
      json = JSON.parse(decodeHtml(block));
    } catch {
      continue; // JSON-LD malformado não deve impedir a coleta.
    }
    const node = findJsonLdArticleNode(json) ?? json;
    const info: JsonLdInfo = {
      datePublished: jsonLdString(node, ["datePublished", "dateCreated"]),
      dateModified: jsonLdString(node, ["dateModified"]),
      headline: jsonLdString(node, ["headline", "name"]),
      image: findJsonLdImage(node) ?? findJsonLdImage(json),
      description: jsonLdString(node, ["description"]),
    };
    if (info.datePublished || info.headline || info.image) return info;
  }
  return empty;
}

function extractJsonLdImage(root: HTMLElement) {
  for (const block of jsonLdBlocks(root)) {
    try {
      const image = findJsonLdImage(JSON.parse(decodeHtml(block)));
      if (image) return image;
    } catch {
      // ignora bloco malformado
    }
  }
  return null;
}

function findJsonLdArticleNode(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object") return null;
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = findJsonLdArticleNode(item);
      if (found) return found;
    }
    return null;
  }
  const record = value as Record<string, unknown>;
  const type = record["@type"];
  const types = Array.isArray(type) ? type.map(String) : [String(type ?? "")];
  if (types.some((t) => /article|newsarticle|blogposting/i.test(t))) return record;
  return findJsonLdArticleNode(record["@graph"]);
}

function jsonLdString(node: unknown, keys: string[]): string | null {
  if (!node || typeof node !== "object") return null;
  const record = node as Record<string, unknown>;
  for (const key of keys) {
    const raw = record[key];
    if (typeof raw === "string" && raw.trim()) return raw.trim();
  }
  return null;
}

function findJsonLdImage(value: unknown): string | null {
  if (!value || typeof value !== "object") return null;
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = findJsonLdImage(item);
      if (found) return found;
    }
    return null;
  }

  const record = value as Record<string, unknown>;
  for (const key of ["image", "thumbnailUrl", "contentUrl", "url"]) {
    const raw = record[key];
    if (typeof raw === "string" && isLikelyContentImage(raw)) return raw;
    const nested = findJsonLdImage(raw);
    if (nested) return nested;
  }
  const graph = findJsonLdImage(record["@graph"]);
  if (graph) return graph;
  return null;
}

function extractLinkImage(root: HTMLElement) {
  for (const link of safeQueryAll(root, "link")) {
    const rel = normalizeText(link.getAttribute("rel") ?? "");
    if (!rel.includes("image") && !rel.includes("preload")) continue;
    const href = link.getAttribute("href");
    if (href) return decodeHtml(href);
  }
  return null;
}

function extractScopedThumbnail(html: string, anchorIndex: number, anchorEnd: number, baseUrl: string): { url: string | null; source: string | null } {
  const snippets = [
    containingElementSnippet(html, anchorIndex, anchorEnd, "article", 8000),
    containingElementSnippet(html, anchorIndex, anchorEnd, "li", 6500),
    containingElementSnippet(html, anchorIndex, anchorEnd, "section", 6500),
    containingElementSnippet(html, anchorIndex, anchorEnd, "div", 4200),
  ].filter((snippet): snippet is string => Boolean(snippet));

  for (const snippet of snippets) {
    const image = firstImageFromBlock(snippet, /([\s\S]*)/i);
    const absolute = absolutize(image ? pickSrcsetFirst(image) : null, baseUrl);
    if (absolute && isLikelyContentImage(absolute)) {
      return { url: absolute, source: "listing card thumbnail" };
    }
  }

  const fallbackSnippet = html.slice(Math.max(0, anchorIndex - 900), anchorEnd + 900);
  const fallbackImage = firstImageFromBlock(fallbackSnippet, /([\s\S]*)/i);
  const fallbackAbsolute = absolutize(fallbackImage ? pickSrcsetFirst(fallbackImage) : null, baseUrl);
  if (fallbackAbsolute && isLikelyContentImage(fallbackAbsolute)) {
    return { url: fallbackAbsolute, source: "nearby fallback thumbnail" };
  }

  return { url: null, source: null };
}

function containingElementSnippet(html: string, anchorIndex: number, anchorEnd: number, tag: string, maxLength: number) {
  const openRe = new RegExp(`<${tag}\\b[^>]*>`, "gi");
  let open: RegExpExecArray | null;
  let start = -1;
  while ((open = openRe.exec(html)) !== null && open.index <= anchorIndex) {
    start = open.index;
  }
  if (start < 0) return null;

  const closeRe = new RegExp(`</${tag}>`, "gi");
  closeRe.lastIndex = anchorEnd;
  const close = closeRe.exec(html);
  if (!close) return null;
  const end = close.index + close[0].length;
  if (end <= anchorEnd || end - start > maxLength) return null;
  return html.slice(start, end);
}

function extractNearbyListingDate(html: string, anchorIndex: number) {
  const before = html.slice(Math.max(0, anchorIndex - 700), anchorIndex);
  const after = html.slice(anchorIndex, anchorIndex + 2200);
  const snippet = cleanText(stripTags(`${before} ${after}`));
  return extractDateFromText(snippet);
}

// Fontes de imagem de alta confianca: metatags declaradas pelo proprio site.
// Quando a validacao HTTP falha (HEAD bloqueado / timeout), preservamos a URL
// em vez de descartar, marcando como "unverified" (o proxy serve a imagem).
const HIGH_CONFIDENCE_IMAGE_SOURCES = new Set([
  "og:image",
  "og:image:url",
  "twitter:image",
  "twitter:image:src",
  "itemprop:image",
  "itemprop:thumbnailUrl",
  "json-ld image",
  "link image",
]);

async function validateOfficialImage(candidate: { url: string | null; source: string | null }) {
  if (!candidate.url) {
    return { ...candidate, status: "official_image_absent" as const };
  }
  const highConfidence = candidate.source ? HIGH_CONFIDENCE_IMAGE_SOURCES.has(candidate.source) : false;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), IMAGE_TIMEOUT_MS);
  try {
    const response = await fetch(candidate.url, {
      method: "GET",
      headers: {
        "User-Agent": "IRIS-Regulacao-Noticias/1.0 (+https://iris-oficial.vercel.app)",
        Accept: "image/*",
        Range: "bytes=0-1023",
      },
      next: { revalidate: 0 },
      signal: controller.signal,
    });
    const contentType = response.headers.get("content-type") ?? "";
    const contentRange = response.headers.get("content-range") ?? "";
    const rangeTotal = Number(/\/(\d+)$/.exec(contentRange)?.[1] ?? 0);
    const contentLength = rangeTotal || Number(response.headers.get("content-length") ?? 0) || null;
    await response.body?.cancel();
    if (response.ok && contentType.toLowerCase().startsWith("image/")) {
      return { ...candidate, status: "official_image_found" as const, contentType, contentLength };
    }
    // Metatag declarada pelo site: confia na URL mesmo sem confirmar o content-type.
    if (highConfidence) {
      return { ...candidate, status: "official_image_unverified" as const, contentType, contentLength };
    }
    return { url: null, source: candidate.source, status: "image_fetch_failed" as const, contentType, contentLength };
  } catch {
    if (highConfidence) {
      return { ...candidate, status: "official_image_unverified" as const, contentType: null, contentLength: null };
    }
    return { url: null, source: candidate.source, status: "image_fetch_failed" as const, contentType: null, contentLength: null };
  } finally {
    clearTimeout(timeout);
  }
}

async function mapWithConcurrency<T, R>(items: T[], concurrency: number, fn: (item: T, index: number) => Promise<R>): Promise<R[]> {
  const results: R[] = [];
  let cursor = 0;
  const workers = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      results[index] = await fn(items[index], index);
    }
  });
  await Promise.all(workers);
  return results;
}

function extractArtespMainImage(root: HTMLElement, baseUrl: string): { url: string | null; source: string | null } {
  // A foto real costuma estar no corpo (article/main); firstImageUrlFromElement já
  // pula logos/decorativos. Mantemos os fallbacks de og:image / genérico.
  const region = safeQuery(root, "article") ?? safeQuery(root, "main") ?? root;
  const contentImage = firstImageUrlFromElement(region, baseUrl);
  if (contentImage && !isGenericCmsImage(contentImage)) {
    return { url: contentImage, source: "artesp body img" };
  }

  // Fallback de alta confianca: a og:image/twitter:image da pagina de detalhe da
  // ARTESP costuma ser a foto real da materia. Aceitamos desde que nao seja a
  // imagem generica do CMS (logo/placeholder).
  const ogImage = absolutize(
    metaContent(root, "property", "og:image") ??
      metaContent(root, "property", "og:image:url") ??
      metaContent(root, "name", "twitter:image") ??
      metaContent(root, "name", "twitter:image:src"),
    baseUrl,
  );
  if (ogImage && !isGenericCmsImage(ogImage)) {
    return { url: ogImage, source: "artesp og:image" };
  }

  const generic = extractMainImage(root, baseUrl);
  if (generic.url && !isGenericCmsImage(generic.url)) return generic;
  return { url: null, source: generic.source };
}

function firstImageFromBlock(html: string, blockRe: RegExp) {
  const block = blockRe.exec(html)?.[1] ?? html;
  const sourceRe = /<source\b[^>]*>/gi;
  let sourceMatch: RegExpExecArray | null;

  while ((sourceMatch = sourceRe.exec(block)) !== null) {
    const tag = sourceMatch[0];
    const value = pickBestImageCandidate(
      attr(tag, "srcset") ??
      attr(tag, "data-srcset") ??
      attr(tag, "data-lazy-srcset") ??
      attr(tag, "data-src"),
    );
    if (value && !isDecorativeImage(value)) return value;
  }

  const imgRe = /<img\b[^>]*>/gi;
  let match: RegExpExecArray | null;

  while ((match = imgRe.exec(block)) !== null) {
    const tag = match[0];
    const value = pickBestImageCandidate(
      attr(tag, "srcset") ??
      attr(tag, "data-srcset") ??
      attr(tag, "data-lazy-srcset") ??
      attr(tag, "data-large-src") ??
      attr(tag, "data-original-src") ??
      attr(tag, "data-original") ??
      attr(tag, "data-lazy-src") ??
      attr(tag, "data-image") ??
      attr(tag, "data-src") ??
      attr(tag, "src"),
    );
    if (value && !isDecorativeImage(value)) return value;
  }

  const background = firstBackgroundImageFromBlock(block);
  if (background && !isDecorativeImage(background)) return background;

  return null;
}

function firstBackgroundImageFromBlock(html: string) {
  for (const match of html.matchAll(/style=["'][^"']*url\((['"]?)([^'")]+)\1\)[^"']*["']/gi)) {
    const value = decodeHtml(match[2]).trim();
    if (value) return value;
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

function attr(html: string, name: string) {
  const match = new RegExp(`\\b${escapeRegExp(name)}=["']([^"']+)["']`, "i").exec(html);
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

function extractArticleText(root: HTMLElement) {
  const region =
    safeQuery(root, "article") ??
    safeQuery(root, "[itemprop=articleBody]") ??
    safeQuery(root, "main") ??
    root;
  const paragraphs = safeQueryAll(region, "p")
    .map((p) => cleanText(p.text))
    .filter((text) => text.length >= 30);
  if (paragraphs.length) return paragraphs.join("\n\n").slice(0, 6000);

  const text = cleanText(region.text)
    .replace(/\bAumentar fonte\b[\s\S]*$/i, "")
    .replace(/\bUltimas\s+Noticias\b[\s\S]*$/i, "")
    .replace(/\bÚltimas\s+Notícias\b[\s\S]*$/i, "");
  return text.length >= 80 ? text.slice(0, 6000) : null;
}

// Meses por extenso (PT) para datas no formato "23 de junho de 2026".
const PT_MONTHS: Record<string, string> = {
  janeiro: "01", fevereiro: "02", marco: "03", abril: "04", maio: "05", junho: "06",
  julho: "07", agosto: "08", setembro: "09", outubro: "10", novembro: "11", dezembro: "12",
};

export function extractDateFromText(text: string) {
  // 1) ISO (ex.: do JSON-LD que tenha vazado para texto): 2026-06-23
  const iso = /(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2}))?/.exec(text);
  if (iso) {
    const [, year, month, day, hour = "12", minute = "00"] = iso;
    return `${year}-${month}-${day}T${hour}:${minute}:00-03:00`;
  }
  // 2) Por extenso em português: "23 de junho de 2026"
  const ext = /(\d{1,2})\s+de\s+([a-zç]+)\s+de\s+(\d{4})/i.exec(normalizeText(text));
  if (ext) {
    const month = PT_MONTHS[ext[2]];
    if (month) return `${ext[3]}-${month}-${ext[1].padStart(2, "0")}T12:00:00-03:00`;
  }
  // 3) DD/MM/YYYY (com hora opcional)
  const br = /(\d{2})\/(\d{2})\/(\d{4})(?:\s*(?:-|às|as)?\s*(\d{1,2})(?::|h)(\d{2}))?/i.exec(text);
  if (br) {
    const [, day, month, year, hour = "12", minute = "00"] = br;
    return `${year}-${month}-${day}T${hour.padStart(2, "0")}:${minute}:00-03:00`;
  }
  return null;
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

function latestPublishedAt(items: CollectedRegulatoryNews[]) {
  return items
    .map((item) => item.publicado_em)
    .filter((value): value is string => Boolean(value))
    .sort()
    .at(-1) ?? null;
}

function latestItem(items: CollectedRegulatoryNews[]) {
  return [...items].sort((left, right) => {
    const rightTime = publishedTime(right);
    const leftTime = publishedTime(left);
    return rightTime - leftTime;
  })[0] ?? null;
}

function publishedTime(item: CollectedRegulatoryNews) {
  const value = item.publicado_em ? new Date(item.publicado_em).getTime() : 0;
  return Number.isFinite(value) ? value : 0;
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
  return pickBestImageCandidate(value) ?? value;
}

function pickBestImageCandidate(value: string | null) {
  if (!value) return null;
  const candidates = value
    .split(",")
    .map((part) => {
      const [url, descriptor = ""] = part.trim().split(/\s+/);
      const width = Number(/(\d+)w/i.exec(descriptor)?.[1] ?? 0);
      const density = Number(/([\d.]+)x/i.exec(descriptor)?.[1] ?? 0);
      const score = width || Math.round(density * 1000) || imageScaleScore(url);
      return { url, score };
    })
    .filter((candidate) => Boolean(candidate.url));
  const best = candidates.sort((left, right) => right.score - left.score)[0]?.url ?? value.trim();
  return upgradeImageScale(best);
}

function imageScaleScore(value: string) {
  const normalized = normalizeText(value);
  const explicitWidth = Number(/(?:image-|[?&](?:w|width)=|[_-])(\d{3,5})(?=[._?&#/-]|$)/i.exec(value)?.[1] ?? 0);
  if (Number.isFinite(explicitWidth) && explicitWidth > 0) return Math.min(explicitWidth, 5000);
  if (normalized.includes("large") || normalized.includes("grande")) return 1600;
  if (normalized.includes("preview")) return 1000;
  if (normalized.includes("mini") || normalized.includes("thumb")) return 200;
  return 600;
}

function classifyImageQuality(value: string, contentLength: number | null) {
  const scaleScore = imageScaleScore(value);
  if (scaleScore >= 1600 || (contentLength ?? 0) >= 80_000) return "high";
  if (scaleScore >= 1000 || (contentLength ?? 0) >= 25_000) return "medium";
  if (scaleScore <= 200 || (contentLength !== null && contentLength < 12_000)) return "low";
  return "unknown";
}

function classifyNewsContent(conteudo: string | null, resumo: string | null) {
  const contentLength = conteudo?.length ?? 0;
  const summaryLength = resumo?.length ?? 0;
  if (contentLength >= 900 && summaryLength >= 80) return "complete";
  if (contentLength >= 350 || summaryLength >= 120) return "partial";
  if (contentLength > 0 || summaryLength > 0) return "short";
  return "missing";
}

function upgradeImageScale(value: string) {
  return value
    .replace(/\/@@images\/image\/(?:mini|thumb|tile|preview)(?=\/|$|\?)/i, "/@@images/image/large")
    .replace(/\/@@images\/[^/?#]+\/(?:mini|thumb|tile|preview)(?=\/|$|\?)/i, (match) => match.replace(/\/(?:mini|thumb|tile|preview)$/i, "/large"));
}

function isDecorativeImage(value: string) {
  const normalized = normalizeText(value);
  return normalized.includes("logo") ||
    normalized.includes("logo-meta") ||
    normalized.includes("logo-footer") ||
    normalized.includes("logo-gov") ||
    normalized.includes("warnings/") ||
    normalized.includes("e-mail-novos-grupos") ||
    normalized.includes("acessibilidade") ||
    normalized.includes("vlibras") ||
    normalized.includes("avatar") ||
    normalized.includes("icone") ||
    normalized.includes("icon");
}

function isGenericCmsImage(value: string) {
  const normalized = normalizeText(value);
  return normalized.includes("sggd.sp.gov.br/statics/img/logo-meta") ||
    normalized.includes("/statics/img/logo") ||
    normalized.includes("/statics/img/warnings/") ||
    normalized.includes("/statics/img/acessibilidade");
}

function isLikelyContentImage(value: string) {
  if (isDecorativeImage(value)) return false;
  try {
    const path = new URL(value).pathname.toLowerCase();
    return /\.(png|jpe?g|webp|gif)$/i.test(path) ||
      path.includes("@@images") ||
      path.includes("@@download") ||
      path.includes("@@display-file") ||
      path.includes("/image") ||
      path.includes("/imagem") ||
      path.includes("/media");
  } catch {
    return /\.(png|jpe?g|webp|gif)(?:\?|$)/i.test(value) ||
      /@@(?:images|download|display-file)|\/(?:image|imagem|media)\b/i.test(value);
  }
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function sha256(value: string) {
  return crypto.createHash("sha256").update(value).digest("hex");
}
