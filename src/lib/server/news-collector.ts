import crypto from "crypto";
import type { HTMLElement } from "node-html-parser";
import { FetchFailureError, resilientFetchText } from "@/lib/server/resilient-fetch";
import { hasBudget } from "@/lib/server/time-budget";
import { isPublicUrl } from "@/lib/server/url-guard";
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
  /** Falha transitória (rate-limit 403/429, timeout, render JS). Não deve pintar a
   *  fonte de vermelho quando ela já tem notícias recentes — será re-tentada. */
  transient?: boolean;
  /** Listagem efetivamente usada quando a configurada falhou/zerou e uma IRMÃ
   *  (ex.: noticias-defeso-eleitoral) respondeu. Sinal de que a seção mudou. */
  effective_url?: string;
}

// Uma falha é "transitória" quando é de rede/limite/instabilidade (não um problema
// definitivo da fonte). Cobre rate-limit/timeout/render E os sintomas de página
// DEGRADADA do gov.br: 200 mas "magra" (0 links / detalhe sem título/data), servida
// de forma intermitente ao IP de datacenter. O health route só rebaixa (não pinta de
// vermelho) quando a fonte também tem notícias recentes — logo não esconde fonte morta.
export function isTransientCollectionError(error: unknown, _source?: NewsSourceConfig): boolean {
  const message = error instanceof Error ? error.message : String(error ?? "");
  if (/HTTP\s*4(?:03|08|25|29)\b|HTTP\s*5\d\d\b|Timeout|falha_rede|render|Falha ao coletar HTML oficial/i.test(message)) {
    return true;
  }
  // Página degradada / listagem-detalhe vazia (intermitente) — vale para gov.br e ARTESP.
  if (/Nenhum link de noticia valido|Nenhuma noticia valida foi extraida|Detalhe indispon[ií]vel e listagem sem/i.test(message)) {
    return true;
  }
  return false;
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

const SOURCE_CONCURRENCY = 2;
const DETAIL_CONCURRENCY = 3;
const FETCH_TIMEOUT_MS = 12_000;
const IMAGE_TIMEOUT_MS = 8_000;
// Espaçamento mínimo entre requests ao MESMO host (ex.: www.gov.br). Coletar as
// ~11 fontes gov.br em rajada de um IP de datacenter (Vercel) leva a rate-limit
// (403/429) → "algumas fontes falharam"/ANAC vermelha. O throttle serializa por
// host e elimina a rajada. Ajustável por COLLECTOR_HOST_THROTTLE_MS; default 900ms
// (subido de 500→900 porque a coleta profunda da Etapa 5 faz mais requisições por
// fonte; um IP de datacenter do Vercel é mais sujeito a 403/429 que um residencial).
const NEWS_HOST_THROTTLE_MS = Number(process.env.COLLECTOR_HOST_THROTTLE_MS ?? "900") || 900;

// Nº máximo de páginas da LISTAGEM de notícias a seguir (paginação Plone ?b_start:int=).
// Antes o gov.br lia só a pág.1 (30 notícias) → notícias além disso se perdiam
// (ex.: artigo da ANA de 20/05/2026 estava na pág.2). Ajustável por NEWS_LISTING_MAX_PAGES.
const NEWS_LISTING_MAX_PAGES = Math.max(1, Math.min(Number(process.env.NEWS_LISTING_MAX_PAGES ?? "5") || 5, 12));
// Teto absoluto de páginas da listagem no modo PROFUNDO (cobrir a janela de recência).
const NEWS_LISTING_MAX_PAGES_HARD = 10;
// Janela de recência coberta na coleta profunda (dias). O que for mais velho não é
// buscado (casa com o filtro de exibição e o stale de 120d). Ajustável por env.
export const NEWS_WINDOW_DAYS = Math.max(7, Math.min(Number(process.env.NEWS_WINDOW_DAYS ?? "45") || 45, 180));
// Teto de detalhes buscados por fonte por run (limita carga; só artigos NOVOS contam).
const DEEP_MAX_DETAIL_PER_SOURCE = Math.max(10, Math.min(Number(process.env.NEWS_DEEP_MAX_DETAIL ?? "60") || 60, 150));

export type DeepCollectOptions = {
  windowDays?: number;
  knownUrls?: Set<string>;
  /** Orçamento de tempo (Date.now()+ms). No plano Hobby a função morre aos 60s
   *  (SIGKILL) — sem deadline, uma fonte com muitos itens novos derrubava a coleta
   *  inteira ("An error occurred with your deployment"). Itens não processados
   *  ficam como pending → o front re-chama ("Buscar mais notícias"). */
  deadlineAt?: number;
};

export async function collectRegulatoryNews(
  sources: NewsSourceConfig[],
  limitPerSource = 24,
  offsetPerSource = 0,
  options: { mode?: NewsCollectionMode; deep?: DeepCollectOptions } = {},
): Promise<RegulatoryNewsCollectResult> {
  const mode = options.mode ?? "enrich";
  const sourceResults = await mapWithConcurrency(
    sources,
    SOURCE_CONCURRENCY,
    (source) => collectNewsSource(source, limitPerSource, offsetPerSource, mode, options.deep),
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

// Listagens IRMÃS de uma fonte gov.br. Durante o DEFESO ELEITORAL (04/07–25/10/2026)
// os órgãos reorganizaram as seções: a ANTT congelou `ultimas-noticias` (virou
// "Conteúdo Restrito") e publica em `noticias-defeso-eleitoral`; a ANEEL mantém a
// canônica E publica também na subseção defeso. Sem tentar as irmãs, a coleta "para
// no dia X" silenciosamente quando a seção muda. Verificado ao vivo em 10/07/2026.
export function siblingListingVariants(source: NewsSourceConfig): NewsSourceConfig[] {
  if (source.strategy !== "govbr") return [];
  try {
    const url = new URL(source.url);
    const segs = url.pathname.replace(/\/+$/, "").split("/");
    const last = segs[segs.length - 1];
    return ["noticias-defeso-eleitoral", "noticias"]
      .filter((candidate) => candidate !== last)
      .map((candidate) => {
        const variant = new URL(url.toString());
        variant.pathname = [...segs.slice(0, -1), candidate].join("/");
        return { ...source, url: variant.toString() };
      });
  } catch {
    return [];
  }
}

async function collectNewsSource(
  source: NewsSourceConfig,
  limitPerSource: number,
  offsetPerSource: number,
  mode: NewsCollectionMode,
  deep?: DeepCollectOptions,
): Promise<{ items: CollectedRegulatoryNews[]; report: NewsSourceCollectReport }> {
  try {
    const windowDays = deep?.windowDays;
    // No modo PROFUNDO descobrimos bem mais links (várias páginas) para cobrir a janela.
    const discoveryLimit = windowDays ? Math.max(limitPerSource, DEEP_MAX_DETAIL_PER_SOURCE * 3) : (limitPerSource + offsetPerSource);
    // Grupos de links, cada um atrelado à LISTAGEM de origem (o parse de detalhe usa a
    // URL da listagem para escopar isNewsDetailUrl): primária + irmãs (defeso).
    let effectiveSource = source;
    let links: NewsLink[] = [];
    let primaryError: unknown = null;
    try {
      links = await fetchSourceLinks(source, discoveryLimit);
      // O gov.br às vezes serve uma página DEGRADADA (HTTP 200 mas "magra", 0 links)
      // ao IP de datacenter (soft rate-limit) — re-tenta uma vez após pausa.
      if (links.length === 0 && source.strategy === "govbr") {
        await new Promise((resolve) => setTimeout(resolve, 1500));
        links = await fetchSourceLinks(source, discoveryLimit);
      }
    } catch (err) {
      primaryError = err;
    }
    const extraGroups: Array<{ src: NewsSourceConfig; links: NewsLink[] }> = [];
    const variants = siblingListingVariants(source);
    if (links.length === 0) {
      // FALLBACK: a listagem configurada falhou/zerou (caso ANTT: restrita no defeso).
      for (const variant of variants) {
        if (!hasBudget(deep?.deadlineAt, 15_000)) break;
        const variantLinks = await fetchSourceLinks(variant, discoveryLimit).catch(() => [] as NewsLink[]);
        if (variantLinks.length > 0) { effectiveSource = variant; links = variantLinks; break; }
      }
    } else if (hasBudget(deep?.deadlineAt, 25_000)) {
      // ADITIVO: a principal funciona, mas a irmã DEFESO pode ter notícias exclusivas
      // (caso ANEEL). Sondagem BARATA (1-2 páginas, limite pequeno) — a completa só no
      // fallback. Tolera 404 em silêncio — a irmã pode não existir.
      const defeso = variants.find((v) => v.url.includes("noticias-defeso-eleitoral"));
      if (defeso) {
        const defesoLinks = await fetchSourceLinks(defeso, Math.min(discoveryLimit, 24)).catch(() => [] as NewsLink[]);
        if (defesoLinks.length > 0) extraGroups.push({ src: defeso, links: defesoLinks });
      }
    }
    if (links.length === 0) {
      if (primaryError) throw primaryError;
      throw new Error("Nenhum link de noticia valido encontrado na fonte oficial");
    }
    const linkGroups: Array<{ src: NewsSourceConfig; links: NewsLink[] }> = [
      { src: effectiveSource, links },
      ...extraGroups,
    ];
    // Achata mantendo a origem de cada link; dedupe entre grupos por URL.
    const seenUrls = new Set<string>();
    const allLinks: Array<{ src: NewsSourceConfig; link: NewsLink }> = [];
    for (const group of linkGroups) {
      for (const link of group.links) {
        if (seenUrls.has(link.url)) continue;
        seenUrls.add(link.url);
        allLinks.push({ src: group.src, link });
      }
    }
    let pageLinks: Array<{ src: NewsSourceConfig; link: NewsLink }>;
    if (windowDays) {
      // Profundo: pega os links DENTRO da janela (ou sem data) que ainda NÃO estão
      // no banco (novos), do mais novo ao mais velho, com teto por run.
      const cutoff = Date.now() - windowDays * 24 * 60 * 60 * 1000;
      const known = deep?.knownUrls;
      pageLinks = allLinks
        .filter(({ link }) => { const t = publishedLinkTime(link); return t === 0 || t >= cutoff; })
        .filter(({ link }) => !known?.has(link.url))
        .slice(0, DEEP_MAX_DETAIL_PER_SOURCE);
    } else {
      pageLinks = allLinks.slice(offsetPerSource, offsetPerSource + limitPerSource);
    }
    // Detalhes em LOTES com orçamento de tempo: cada detalhe custa ~1-2s (throttle
    // 900ms/host + parse + probe de imagem). Sem o corte, uma fonte com muitos itens
    // novos (ex.: ANTT pós-defeso) estourava os 60s do Hobby e a função morria com
    // "An error occurred with your deployment". O que não coube fica pending →
    // "Buscar mais notícias" continua de onde parou. QA Etapa 22-b.
    const detailResults: Array<{ item: CollectedRegulatoryNews | null; error: string | null }> = [];
    for (let i = 0; i < pageLinks.length; i += DETAIL_CONCURRENCY) {
      if (!hasBudget(deep?.deadlineAt, 8_000)) break; // o resto fica pending (re-chamar)
      const chunk = pageLinks.slice(i, i + DETAIL_CONCURRENCY);
      const chunkResults = await mapWithConcurrency(
        chunk,
        DETAIL_CONCURRENCY,
        ({ src, link }) => collectNewsLink(src, link, mode),
      );
      detailResults.push(...chunkResults);
    }
    const rawItems = detailResults.map((result) => result.item).filter((item): item is CollectedRegulatoryNews => Boolean(item));
    const items = dedupeListingImages(rawItems);
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
      links_found: allLinks.length,
      items_collected: freshItems.length,
      items_processed: detailResults.length,
      items_pending: Math.max(0, allLinks.length - offsetPerSource - detailResults.length),
      batch_offset: offsetPerSource,
      images_found: freshItems.filter((item) => item.metadata.image_status === "official_image_found" || item.metadata.image_status === "official_image_unverified").length,
      images_absent: freshItems.filter((item) => item.metadata.image_status === "official_image_absent").length,
      images_failed: freshItems.filter((item) => item.metadata.image_status === "image_fetch_failed").length,
      latest_urls: freshItems.length ? freshItems.slice(0, 5).map((item) => item.url) : allLinks.slice(0, 5).map(({ link }) => link.url),
      latest_publicado_em: latestPublishedAt(freshItems),
      latest_title: latestItem(freshItems)?.titulo ?? null,
      detail_errors: detailErrors,
      ...(effectiveSource.url !== source.url ? { effective_url: effectiveSource.url } : {}),
    };
    if (freshItems.length === 0) {
      report.error = detailErrors[0] ?? "Nenhuma noticia valida foi extraida dos links encontrados";
      // Detalhe/listagem vazios costumam ser página degradada (200 magro) → transitório.
      report.transient = isTransientCollectionError(new Error(report.error), source);
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
        transient: isTransientCollectionError(error, source),
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

// Dedup de imagem SEM rede, para TODAS as agências: a mesma imagem repetida em
// vários artigos (ex.: logo/banner da agência servido como og:image genérica)
// polui o feed/Newsletter. Mantém a 1ª ocorrência e zera as repetidas (o artigo
// aparece SEM foto em vez de repetir a mesma imagem). Não faz requisições.
export function dedupeListingImages(items: CollectedRegulatoryNews[]): CollectedRegulatoryNews[] {
  const firstArticleByImage = new Map<string, string>();
  return items.map((item) => {
    if (!item.imagem_url) return item;
    const firstUrl = firstArticleByImage.get(item.imagem_url);
    if (!firstUrl) {
      firstArticleByImage.set(item.imagem_url, item.url);
      return item;
    }
    if (firstUrl === item.url) return item;
    return {
      ...item,
      imagem_url: null,
      metadata: {
        ...item.metadata,
        image_duplicate_detected: true,
        image_duplicate_of: firstUrl,
        image_deduped: true,
      },
    };
  });
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

// ─── BACKFILL cronológico (Etapa 8) ─────────────────────────────────────────
// Varre o arquivo paginado da fonte até uma data-início (ex.: 2026-01-01), SEM a
// janela de 45d e SEM o filtro de 120d (que descartariam 2026). Foca no que importa
// ao prêmio: só busca detalhe de itens cujo TÍTULO casa com termos regulatórios.
// Resumável por cursor (b_start). Só faz sentido para fontes gov.br (paginação Plone).

// Termos por dimensão IMQN (para marcar prize_dims) + termos regulatórios gerais.
const PRIZE_DIM_TERMS: Record<number, RegExp> = {
  1: /an[aá]lise de impacto regulat|impacto regulat[oó]rio|\bair\b/i,
  2: /consulta p[uú]blica|audi[eê]ncia p[uú]blica|participa[cç][aã]o social|tomada de subs[ií]dios/i,
  3: /estoque regulat[oó]rio|consolida[cç][aã]o normativa|revis[aã]o de normas|acervo normativo/i,
  4: /agenda regulat[oó]ria/i,
  5: /processo normativo|regimento interno/i,
  6: /an[aá]lise de resultado regulat|\barr\b|resultado regulat[oó]rio/i,
};
const PRIZE_GENERAL_TERMS = /resolu[cç][aã]o|portaria|delibera[cç][aã]o|\bnorma(?:s|tiva)?\b|regulament/i;

export function prizeDimsForTitle(title: string): number[] {
  return Object.entries(PRIZE_DIM_TERMS).filter(([, re]) => re.test(title)).map(([id]) => Number(id));
}
export function isPrizeRelevantTitle(title: string): boolean {
  return prizeDimsForTitle(title).length > 0 || PRIZE_GENERAL_TERMS.test(title);
}

// Passo da paginação Plone (menor b_start visível na página) — default 30.
function detectListingStep(html: string, sourceUrl: string): number {
  try {
    const src = new URL(sourceUrl);
    const path = stripTrailingSlash(src.pathname);
    const steps: number[] = [];
    for (const anchor of extractAnchors(html, sourceUrl)) {
      let u: URL;
      try { u = new URL(anchor.href, sourceUrl); } catch { continue; }
      if (u.host !== src.host || stripTrailingSlash(u.pathname) !== path) continue;
      const m = /b_start:int=(\d+)/.exec(u.search);
      if (m) { const n = Number(m[1]); if (n > 0) steps.push(n); }
    }
    return steps.length ? Math.min(...steps) : 30;
  } catch {
    return 30;
  }
}

export interface BackfillOptions {
  since: string; // ISO date (ex.: "2026-01-01")
  cursor?: number; // b_start onde retomar
  maxPagesPerRun?: number;
  knownUrls?: Set<string>;
}

export interface BackfillSourceResult {
  agencia_sigla: string;
  items: CollectedRegulatoryNews[];
  collected: number;
  nextCursor: number | null; // null = varredura completa (chegou a `since`)
  reachedSince: boolean;
  oldestDate: string | null;
  undated: number;
  pagesFetched: number;
  relevantesEncontrados: number;
}

export async function backfillNewsSource(source: NewsSourceConfig, opts: BackfillOptions): Promise<BackfillSourceResult> {
  const base: BackfillSourceResult = {
    agencia_sigla: source.agencia_sigla, items: [], collected: 0, nextCursor: null,
    reachedSince: true, oldestDate: null, undated: 0, pagesFetched: 0, relevantesEncontrados: 0,
  };
  // ARTESP e afins (portais JS) não têm arquivo paginado estático — não backfillável aqui.
  if (source.strategy !== "govbr") return base;

  const sinceMs = Date.parse(opts.since);
  const maxPages = Math.max(1, Math.min(opts.maxPagesPerRun ?? 8, 20));
  const known = opts.knownUrls ?? new Set<string>();
  let cursor = Math.max(0, opts.cursor ?? 0);
  let step = 0;
  let reachedSince = false;
  let pagesFetched = 0;
  let oldestMs = Infinity;
  const inRange: NewsLink[] = [];
  const seen = new Set<string>();

  for (let p = 0; p < maxPages; p += 1) {
    const bstart = cursor;
    const pageUrl = bstart === 0 ? source.url : `${source.url}${source.url.includes("?") ? "&" : "?"}b_start:int=${bstart}`;
    let html: string;
    try {
      html = await fetchHtml(pageUrl);
    } catch {
      break; // falha de rede → interrompe; retoma no cursor atual na próxima chamada
    }
    pagesFetched += 1;
    if (step === 0) step = detectListingStep(html, source.url);

    const anchors = filterAnchorsBySelector(extractAnchors(html, pageUrl), source.linkSelector, pageUrl);
    const pageLinks: NewsLink[] = [];
    pushAnchorsAsLinks(anchors, source, new Set<string>(), pageLinks, 1000);
    if (pageLinks.length === 0) { reachedSince = true; break; } // fim do arquivo

    let datedCount = 0;
    let olderThanSince = 0;
    for (const link of pageLinks) {
      const t = publishedLinkTime(link);
      if (t > 0) { datedCount += 1; oldestMs = Math.min(oldestMs, t); }
      if (t > 0 && t < sinceMs) { olderThanSince += 1; continue; }
      // dentro da janela (ou sem data) → considera; dedup por url
      if (!seen.has(link.url) && !known.has(link.url)) { seen.add(link.url); inRange.push(link); }
    }
    cursor = bstart + step;
    // A página inteira já é anterior a `since` (todos datados e < since) → completou.
    if (datedCount > 0 && olderThanSince === datedCount) { reachedSince = true; break; }
  }

  // Filtro de relevância (prêmio) + busca de detalhe só dos relevantes desta janela de páginas.
  const relevant = dedupeNewsLinks(inRange).filter((l) => isPrizeRelevantTitle(l.title));
  const detailResults = await mapWithConcurrency(relevant, DETAIL_CONCURRENCY, (link) => collectNewsLink(source, link, "enrich"));
  const rawItems = detailResults.map((r) => r.item).filter((item): item is CollectedRegulatoryNews => Boolean(item));
  let undated = 0;
  const items = dedupeListingImages(rawItems).map((item) => {
    const isUndated = publishedTime(item) === 0;
    if (isUndated) undated += 1;
    return {
      ...item,
      metadata: {
        ...item.metadata,
        backfill_2026: true,
        prize_dims: prizeDimsForTitle(item.titulo),
        undated: isUndated,
      },
    };
  });

  return {
    agencia_sigla: source.agencia_sigla,
    items: sortNewsItemsByDate(items),
    collected: items.length,
    nextCursor: reachedSince ? null : cursor,
    reachedSince,
    oldestDate: oldestMs === Infinity ? null : new Date(oldestMs).toISOString(),
    undated,
    pagesFetched,
    relevantesEncontrados: relevant.length,
  };
}

async function fetchSourceLinks(source: NewsSourceConfig, limit: number): Promise<NewsLink[]> {
  if (source.strategy === "govbr") {
    const [htmlLinks, apiLinks] = await Promise.allSettled([
      fetchHtmlSourceLinks(source, limit),
      fetchGovbrApiLinks(source, limit),
    ]);
    // Mantém links suficientes para o offset caminhar pelas páginas seguintes
    // (a paginação em fetchListingPages agora descobre além da pág.1).
    return sortNewsLinksByDate(pruneNewsLinks(dedupeNewsLinks([
      ...(htmlLinks.status === "fulfilled" ? htmlLinks.value : []),
      ...(apiLinks.status === "fulfilled" ? apiLinks.value : []),
    ]))).slice(0, Math.max(limit * 2, NEWS_LISTING_MAX_PAGES * 30));
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
    if (pushAnchorsAsLinks(anchors, source, seen, links, limit)) return sortNewsLinksByDate(pruneNewsLinks(links));
  }

  // Listagem renderizada por JS (ex.: ARTESP/Liferay, cujo HTML estático só traz
  // lixo de portlet): tenta o render headless antes de desistir. govbr usa a API.
  if (links.length === 0 && source.strategy === "artesp") {
    const rendered = await tryRenderHtmlFallback(source.url, "listagem de notícias (render JS)");
    if (rendered) pushAnchorsAsLinks(extractArtespNewsAnchors(rendered, source.url), source, seen, links, limit);
  }

  if (links.length === 0 && source.strategy === "govbr") {
    return fetchGovbrApiLinks(source, limit);
  }

  return sortNewsLinksByDate(pruneNewsLinks(links));
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
    if (!res.ok) {
      // Muitas fontes gov.br NÃO expõem a REST API do Plone (ex.: ANA → 404).
      // Nesses casos a cobertura depende 100% do HTML paginado — deixa visível no log.
      console.warn(`[news] Volto API indisponível (${res.status}) em ${source.agencia_sigla}: ${apiUrl} — usando só HTML paginado`);
      return [];
    }
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
        // Fontes Volto não têm og:image no detalhe → a imagem vem da lead image do item.
        return { url: url.toString(), title, imageUrl: leadImageFromArticleUrl(url.toString()), imageSource: "govbr api lead image", publishedAt };
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

// Lead image de um News Item Plone/Volto: a foto principal fica em
// <url>/@@images/image/large. Usado para fontes Volto (ANATEL/ANCINE/ANPD), cujas
// páginas de detalhe NÃO expõem og:image (corpo é React) — a imagem vem da API.
function leadImageFromArticleUrl(articleUrl: string): string | null {
  try {
    const u = new URL(articleUrl);
    u.hash = "";
    u.search = "";
    return `${u.toString().replace(/\/+$/, "")}/@@images/image/large`;
  } catch {
    return null;
  }
}

// Último segmento que parece asset/mídia social (não é notícia). Cobre o ruído do
// ANAC: imagens e cards aninhados sob o artigo (whatsapp-image, linkedin-1200x600…).
function isAssetLikeSlug(slug: string): boolean {
  const s = slug.toLowerCase();
  if (/^(image|imagem|fotos?|midia|media|galeria|anexos?)$/.test(s)) return true;
  if (/\d{2,4}x\d{2,4}/.test(s)) return true; // dimensões: 1200x600
  if (/-at-\d/.test(s)) return true; // "...-at-19-02-22" (WhatsApp)
  return /(?:^|[-_])(?:whatsapp|telegram|linkedin|facebook|twitter|instagram|youtube|banner|thumb|logo|card)(?:[-_]|$)/.test(s);
}

// Remove ruído de links de notícia: (1) slugs de asset/mídia; (2) sub-recursos
// aninhados sob outro artigo (Plone serve imagens/sub-páginas em <artigo>/<algo>).
function pruneNewsLinks(links: NewsLink[]): NewsLink[] {
  const pathOf = (u: string) => {
    try { return new URL(u).pathname.replace(/\/+$/, ""); } catch { return u; }
  };
  const noAssets = links.filter((l) => {
    const seg = decodeURIComponent(pathOf(l.url).split("/").filter(Boolean).at(-1) ?? "");
    return seg ? !isAssetLikeSlug(seg) : true;
  });
  const paths = noAssets.map((l) => pathOf(l.url));
  return noAssets.filter((_, i) => {
    const p = paths[i];
    // descarta se for descendente estrito de outro candidato (sub-recurso do artigo)
    return !paths.some((other, j) => j !== i && other.length < p.length && p.startsWith(`${other}/`));
  });
}

// Converte âncoras extraídas em NewsLinks válidos (filtros de detalhe/título/dedup).
// Retorna true se atingiu o teto de links (sinal para encerrar cedo).
function pushAnchorsAsLinks(
  anchors: Array<{ href: string; text: string; imageUrl: string | null; imageSource: string | null; publishedAt: string | null }>,
  source: NewsSourceConfig,
  seen: Set<string>,
  links: NewsLink[],
  limit: number,
): boolean {
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
    if (links.length >= Math.max(250, limit * 2)) return true;
  }
  return false;
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
  const sourceUrl = new URL(source.url);
  const sourcePath = stripTrailingSlash(sourceUrl.pathname);
  const pageUrls = new Set<string>([source.url]);

  if (source.strategy === "artesp") {
    for (const anchor of extractAnchors(firstHtml, source.url)) {
      const pageUrl = normalizeNewsUrl(anchor.href);
      if (!pageUrl) continue;
      if (pageUrl.host !== sourceUrl.host) continue;
      if (stripTrailingSlash(pageUrl.pathname) !== sourcePath) continue;
      if (!pageUrl.search && !/^\d+$|^>|pr[oó]ximo/i.test(anchor.text.trim())) continue;
      pageUrls.add(pageUrl.toString());
      if (pageUrls.size >= Math.min(8, Math.max(3, Math.ceil(limit / 4)))) break;
    }
  } else {
    // Paginação Plone (gov.br): descobre o PASSO (menor b_start = tamanho do lote)
    // e monta as páginas 2..N (b_start = passo, 2*passo, ...). O nº de páginas
    // escala com o `limit` pedido (modo profundo cobre a janela de recência).
    // O b_start é lido do href CRU (normalizeNewsUrl remove esse parâmetro).
    const byBstart = new Map<number, string>();
    for (const anchor of extractAnchors(firstHtml, source.url)) {
      let u: URL;
      try { u = new URL(anchor.href, source.url); } catch { continue; }
      if (u.host !== sourceUrl.host) continue;
      if (stripTrailingSlash(u.pathname) !== sourcePath) continue;
      const m = /b_start:int=(\d+)/.exec(u.search);
      if (!m) continue;
      const n = Number(m[1]);
      if (n > 0 && !byBstart.has(n)) byBstart.set(n, u.toString());
    }
    const discovered = [...byBstart.keys()].sort((a, b) => a - b);
    const step = discovered[0] && discovered[0] > 0 ? discovered[0] : 30;
    const pagesWanted = Math.max(NEWS_LISTING_MAX_PAGES, Math.min(NEWS_LISTING_MAX_PAGES_HARD, Math.ceil(limit / Math.max(20, step))));
    for (let i = 1; i < pagesWanted; i++) {
      const b = step * i;
      pageUrls.add(byBstart.get(b) ?? `${source.url}${source.url.includes("?") ? "&" : "?"}b_start:int=${b}`);
    }
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

/** Detecta agência/estratégia a partir de UMA URL de notícia (para "colar link"). */
export function detectNewsSourceFromUrl(rawUrl: string): { agencia_sigla: string; fonte: string; url: string; strategy: "govbr" | "artesp" } | null {
  let u: URL;
  try { u = new URL(rawUrl); } catch { return null; }
  if (u.protocol !== "https:" && u.protocol !== "http:") return null;
  const host = u.host.toLowerCase();
  const isArtesp = host.includes("artesp.sp.gov.br");
  // sigla: gov.br/<sigla>/... ; ARTESP por host ; senão o rótulo principal do host.
  const govbrSigla = (host === "www.gov.br" || host === "gov.br")
    ? (u.pathname.split("/").filter(Boolean)[0] ?? "").toUpperCase()
    : "";
  const agencia_sigla = isArtesp ? "ARTESP" : (govbrSigla || host.replace(/^www\./, "").split(".")[0].toUpperCase());
  // source.url = caminho-pai do artigo → isNewsDetailUrl aceita a URL colada.
  const parentPath = u.pathname.replace(/\/[^/]+\/?$/, "") || "/";
  return { agencia_sigla, fonte: agencia_sigla, url: `${u.origin}${parentPath}`, strategy: isArtesp ? "artesp" : "govbr" };
}

/**
 * Ingestão por LINK: extrai uma única notícia de uma URL (gov.br/ARTESP/qualquer),
 * reusando o mesmo parser + validação de imagem da coleta automática. Permissivo
 * (tier não-"expanded" → não rejeita por falta de data). Rede: fetch + imagem.
 */
export async function extractNewsFromUrl(rawUrl: string): Promise<{ item: CollectedRegulatoryNews; detected: { agencia_sigla: string; strategy: string } } | null> {
  const detected = detectNewsSourceFromUrl(rawUrl);
  if (!detected) return null;
  const source: NewsSourceConfig = { ...detected }; // sem tier → parseNewsDetail não exige data
  const item = await fetchNewsDetail(source, { url: rawUrl, title: "" });
  if (!item) return null;
  return { item, detected: { agencia_sigla: detected.agencia_sigla, strategy: detected.strategy } };
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
    if (cleanedOg.length >= 80 && !isJunkText(cleanedOg)) conteudo = cleanedOg.slice(0, 6000);
  }
  const titulo = isGenericArtespTitle(source, rawTitle) ? link.title : rawTitle;
  // Resumo: 1º candidato que passe em sanitizeResumo (não-lixo + piso de comprimento).
  // Ordem: og/description (se não-genérica) → 1º parágrafo → excerto do corpo (já sem <script>).
  const ogResumo = isGenericArtespDescription(source, ogDescription) ? null : ogDescription;
  let resumo: string | null = null;
  for (const candidate of [ogResumo, firstParagraphFromRoot(root), excerptFromText(conteudo)]) {
    const clean = sanitizeResumo(candidate);
    if (clean) { resumo = clean; break; }
  }
  const rawCanonicalUrl = normalizeNewsUrl(absolutize(metaContent(root, "property", "og:url"), link.url) ?? link.url);
  const canonicalUrl = rawCanonicalUrl && source.strategy === "artesp"
    ? normalizeArtespNewsUrl(rawCanonicalUrl) ?? rawCanonicalUrl
    : rawCanonicalUrl;
  const canonical = canonicalUrl && isNewsDetailUrl(source, canonicalUrl) ? canonicalUrl.toString() : link.url;
  const extractedImage = source.strategy === "artesp"
    ? extractArtespMainImage(root, link.url)
    : extractMainImage(root, link.url, jsonld.image);
  // gov.br (Volto/Plone) sem og:image útil (ausente ou = logo institucional filtrado):
  // reconstrói a lead-image por-artigo <url>/@@images/image/large. validateOfficialImage
  // valida por probe (nulifica em 404), então artigo sem foto vira placeholder limpo.
  // Cobre ANATEL/ANCINE/ANP/ANVISA/ANTT (o caminho HTML-listing que não reconstruía).
  const reconstructedLead = source.strategy === "govbr" ? leadImageFromArticleUrl(canonical) : null;
  const imageCandidate = extractedImage.url
    ? extractedImage
    : link.imageUrl && isLikelyContentImage(link.imageUrl)
      ? { url: link.imageUrl, source: link.imageSource ?? "listing thumbnail verified fallback" }
      : reconstructedLead
        ? { url: reconstructedLead, source: "govbr lead image reconstructed" }
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
  // Expanded exige só o ESTRUTURAL (canonical + título). Antes descartava também por
  // FALTA DE DATA — o que sumia com notícias legítimas das 10 fontes expanded cujo
  // detalhe (React) não expõe data. Item sem data é mantido (publicado_em null) e a
  // persistência/exibição usa first_seen como fallback de ordenação. QA Etapa 20.
  if (source.tier === "expanded" && (!canonical || !normalizedTitle)) return null;
  const hash_item = sha256(`${source.agencia_sigla}|${canonical}`);

  return {
    agencia_sigla: source.agencia_sigla,
    titulo: normalizedTitle,
    url: canonical,
    fonte: source.fonte,
    // Candidato ainda NÃO validado por rede; fetchNewsDetail revalida e ajusta.
    imagem_url: imageCandidate.url,
    resumo, // já sanitizado (sanitizeResumo): não-lixo + piso de comprimento, ou null
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
    return await resilientFetchText(url, { headers, timeoutMs: FETCH_TIMEOUT_MS, hostThrottleMs: NEWS_HOST_THROTTLE_MS });
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

  // (Removida a regra ANS "≥2 segmentos": descartava notícias legítimas da ANS
  // diretamente sob /noticias/<slug>. Os filtros genéricos abaixo — último segmento
  // não-numérico, sem ".", não-"noticias", + título ≥12/não-navegação em
  // pushAnchorsAsLinks — já barram os links que não são artigo. QA Etapa 20.)
  const lastSegment = decodeURIComponent(path.split("/").filter(Boolean).at(-1) ?? "");
  if (!lastSegment || /^\d+$/.test(lastSegment)) return false;
  if (["noticias", "ultimas-noticias", "noticias-anteriores"].includes(normalizeText(lastSegment))) return false;
  // Listagem/landing de "defeso eleitoral" não é artigo — vinha capturada como item sem
  // resumo e com data FUTURA do calendário eleitoral (ex.: "2026 - Defeso Eleitoral"). Cobre
  // tanto `noticias-defeso-eleitoral` quanto slugs `<ano>-defeso-eleitoral`. QA jul/2026.
  if (/defeso-eleitoral$/.test(normalizeText(lastSegment))) return false;
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

// gov.br (Volto SSR) às vezes emite og:image com o host INTERNO do render grudado na
// frente da URL real: "http://10.164.57.1:3000https://www.gov.br/.../@@images/...". Sem
// reparo, o host vira 10.164.57.1 (RFC1918) e isPublicUrl bloqueia → imagem some (ANATEL).
// Recupera a URL real (2º esquema colado logo após host[:porta], sem "/" no meio); URLs
// normais e URLs com http embutido em query (após "/") passam inalteradas.
function repairGovbrImageUrl(value: string): string {
  const m = /^https?:\/\/[^/]*?(https?:\/\/.+)$/.exec(value);
  return m ? m[1] : value;
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
    const value = candidate.value ? repairGovbrImageUrl(pickSrcsetFirst(candidate.value)) : null;
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

// Média confiança: a URL é construída por nós (lead image da API Plone/Volto do
// gov.br), não declarada numa metatag. Se a validação por rede falhar (a API às
// vezes recusa Range/HEAD), MANTEMOS a URL como "unverified" — o proxy do front
// (/api/v1/noticias/imagem) revalida sob demanda. Antes era descartada → card sem
// imagem para ANATEL/ANCINE/ANPD (páginas React sem og:image).
const MEDIUM_CONFIDENCE_IMAGE_SOURCES = new Set([
  "govbr api lead image",
]);

// Imagem em HOST OFICIAL (gov.br/sp.gov.br) é confiável mesmo sem vir de metatag: a
// ANM (e gov.br clássico sem og:image) traz a foto no 1º <img> do artigo, cujo source
// é "article img"/"main img"/"body img" (fora do conjunto HIGH). Sem esta regra, o
// probe Range que o Plone recusa nulificava a imagem → card sem foto. QA Etapa 20.
export function isOfficialImageHost(url: string): boolean {
  try {
    const host = new URL(url).hostname.toLowerCase();
    return host === "gov.br" || host.endsWith(".gov.br") || host === "sp.gov.br" || host.endsWith(".sp.gov.br");
  } catch {
    return false;
  }
}

// Variantes de escala do lead-image Plone/Volto, da maior para a menor. Quando a maior
// (/large) não valida, tenta as demais antes de desistir — maximiza imagem real.
function leadImageScaleVariants(url: string): string[] {
  const m = /^(.*)\/@@images\/image(?:\/[a-z]+)?$/i.exec(url);
  if (!m) return [url];
  const base = m[1];
  const scales = ["large", "great", "huge", "preview", "image"];
  const variants = scales.map((s) => (s === "image" ? `${base}/@@images/image` : `${base}/@@images/image/${s}`));
  // Garante que a URL original seja a primeira tentativa.
  return [url, ...variants.filter((v) => v !== url)];
}

async function probeImageUrl(url: string) {
  // SSRF: a URL da imagem pode vir de HTML de terceiros (og:image/<img> da página
  // coletada) — barra loopback/RFC1918/169.254 (metadata) antes de qualquer fetch.
  if (!isPublicUrl(url)) {
    return { ok: false, contentType: null as string | null, contentLength: null as number | null };
  }
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), IMAGE_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      method: "GET",
      headers: {
        "User-Agent": "IRIS-Regulacao-Noticias/1.0 (+https://iris-oficial.vercel.app)",
        Accept: "image/*",
        Range: "bytes=0-1023",
      },
      // SSRF: isPublicUrl só valida a URL LITERAL; `redirect:"follow"` (default) seguiria
      // um 302 de host público → 169.254.169.254/127.0.0.1. "manual" não segue: um
      // redirect vira response opaca (ok=false) e a imagem só é nulificada (degrade seguro).
      redirect: "manual",
      next: { revalidate: 0 },
      signal: controller.signal,
    });
    const contentType = response.headers.get("content-type") ?? "";
    const contentRange = response.headers.get("content-range") ?? "";
    const rangeTotal = Number(/\/(\d+)$/.exec(contentRange)?.[1] ?? 0);
    const contentLength = rangeTotal || Number(response.headers.get("content-length") ?? 0) || null;
    await response.body?.cancel();
    const ok = response.ok && contentType.toLowerCase().startsWith("image/");
    return { ok, contentType, contentLength };
  } catch {
    return { ok: false, contentType: null as string | null, contentLength: null as number | null };
  } finally {
    clearTimeout(timeout);
  }
}

async function validateOfficialImage(candidate: { url: string | null; source: string | null }) {
  if (!candidate.url) {
    return { ...candidate, status: "official_image_absent" as const };
  }
  const highConfidence = candidate.source ? HIGH_CONFIDENCE_IMAGE_SOURCES.has(candidate.source) : false;
  const mediumConfidence = candidate.source ? MEDIUM_CONFIDENCE_IMAGE_SOURCES.has(candidate.source) : false;
  // Host oficial OU padrão Plone @@images também são de confiança (a foto do artigo
  // gov.br sem og:image). Mantém a URL como unverified se o probe falhar.
  const officialImage = isOfficialImageHost(candidate.url) || /\/@@images\//i.test(candidate.url);
  // Lead-image/Plone: tenta múltiplas escalas; a 1ª que retornar image/* vence.
  const variants = (mediumConfidence || officialImage) ? leadImageScaleVariants(candidate.url) : [candidate.url];
  let lastProbe: { ok: boolean; contentType: string | null; contentLength: number | null } | null = null;
  for (const url of variants) {
    const probe = await probeImageUrl(url);
    lastProbe = probe;
    if (probe.ok) {
      return { url, source: candidate.source, status: "official_image_found" as const, contentType: probe.contentType, contentLength: probe.contentLength };
    }
  }
  // A lead-image RECONSTRUÍDA (fallback gov.br) só vale se o probe confirmar (200 acima):
  // artigo sem foto retorna 404 em todas as escalas e deve virar placeholder limpo, não uma
  // URL quebrada mantida como unverified.
  const reconstructed = candidate.source === "govbr lead image reconstructed";
  // Metatag declarada, lead-image de média confiança OU imagem de host oficial: mantém
  // a URL (o proxy do front revalida sob demanda; melhor que placeholder).
  if (!reconstructed && (highConfidence || mediumConfidence || officialImage)) {
    return { ...candidate, status: "official_image_unverified" as const, contentType: lastProbe?.contentType ?? null, contentLength: lastProbe?.contentLength ?? null };
  }
  return { url: null, source: candidate.source, status: "image_fetch_failed" as const, contentType: lastProbe?.contentType ?? null, contentLength: lastProbe?.contentLength ?? null };
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

// Lê o texto de uma região DOM SEM o conteúdo de <script>/<style>/<noscript>.
// `parseHtml` preserva o texto de <script> de propósito (JSON-LD já foi extraído
// antes); sem remover esses nós, páginas Volto/React (gov.br) sem <p> deixavam o
// JSON-LD cru (`{"@context":...}`) vazar para o corpo/resumo da notícia.
function regionTextWithoutScripts(region: HTMLElement): string {
  for (const node of safeQueryAll(region, "script, style, noscript")) {
    try { node.remove(); } catch { /* nó já removido/solto */ }
  }
  return cleanText(region.text);
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

  const text = regionTextWithoutScripts(region)
    .replace(/\bAumentar fonte\b[\s\S]*$/i, "")
    .replace(/\bUltimas\s+Noticias\b[\s\S]*$/i, "")
    .replace(/\bÚltimas\s+Notícias\b[\s\S]*$/i, "");
  return text.length >= 80 && !isJunkText(text) ? text.slice(0, 6000) : null;
}

// Texto que claramente NÃO é resumo de notícia: JSON-LD/JSON cru, HTML/CSS/JS, ou
// marcação sem frase. Guarda de qualidade — impede lixo de chegar ao card/newsletter.
export function isJunkText(value: string | null | undefined): boolean {
  const s = (value ?? "").trim();
  if (!s) return true;
  if (/^[{[<]/.test(s)) return true;                               // começa como JSON/HTML
  if (/@context|schema\.org|"@type"|function\s*\(|\bvar\s|\{\s*"/i.test(s)) return true;
  if (/[{}<>]/.test(s) && !/[.!?]/.test(s)) return true;           // marcação sem pontuação de frase
  const letters = (s.match(/[a-zA-ZÀ-ÿ]/g) ?? []).length;
  if (letters / s.length < 0.6) return true;                       // maioria não-letra (código/lixo)
  return false;
}

// Resumo válido: texto limpo, não-lixo, com piso de comprimento (mata "i" e fragmentos).
export function sanitizeResumo(value: string | null | undefined, minLen = 30): string | null {
  const s = cleanText(value ?? "");
  if (!s || s.length < minLen || isJunkText(s)) return null;
  return s.slice(0, 900);
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
  if (!Number.isNaN(parsed.getTime())) return clampFutureDate(parsed.toISOString());
  return clampFutureDate(extractDateFromText(value));
}

// Data > agora + 48h (folga de fuso) é quase sempre parse errado — o último recurso
// extractDateFromText pega a 1ª data do texto e páginas de listagem/calendário (ex.:
// defeso eleitoral) trazem datas de eventos FUTUROS. Trata como sem data confiável
// (null) — senão o item lidera a lista, ordenada por publicado_em DESC.
function clampFutureDate(iso: string | null): string | null {
  if (!iso) return null;
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return null;
  if (t > Date.now() + 48 * 60 * 60 * 1000) return null;
  return iso;
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
