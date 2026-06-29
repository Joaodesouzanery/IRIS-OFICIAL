import crypto from "crypto";
import type { MonitoramentoTipoItem } from "@/types";
import { fetchAntt2026MonitoringItems } from "@/lib/server/antt-2026-collector";
import { resilientFetchText } from "@/lib/server/resilient-fetch";
import { tryRenderHtmlFallback } from "@/lib/server/headless";

// Teto de páginas seguidas por site na paginação ANM/ARTESP. O fim real é
// detectado quando uma página não traz nenhum item novo; este teto só limita o
// custo caso o portal tenha "próxima" cíclica.
const MAX_MONITORING_PAGES = 12;

const BROWSER_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

export interface MonitoringSiteInput {
  id: string;
  agencia_id: string | null;
  nome: string;
  url: string;
  estrategia?: string | null;
  seletor_links?: string | null;
}

export interface DiscoveredMonitoringItem {
  tipo: MonitoramentoTipoItem;
  titulo: string;
  url_item: string;
  reuniao: string | null;
  data_reuniao: string | null;
  hash_item: string;
  metadata: Record<string, unknown>;
}

export interface MonitoringFetchResult {
  contentHash: string;
  needsHeadless: boolean;
  items: DiscoveredMonitoringItem[];
}

const DOC_LABEL_RE =
  /\b(reuniao|reunioes|pauta|ata|atas|voto|votos|votacao|sessao|colegiad[ao]|deliberacao|deliberacoes|diretoria|diretores?|mandato|nomeacao|exoneracao|composicao)\b/i;
const PDF_RE = /\.pdf(?:$|[/?#])|\/@@download\/file(?:$|[/?#])/i;
const DATE_RE = /\b(\d{2})\/(\d{2})\/(\d{4})\b/;
const REUNIAO_RE = /(\d{1,4})\s*(?:a|o|ª|º)?\s*reuniao[^<\n\r]*/i;

export async function fetchMonitoringSite(
  site: MonitoringSiteInput,
  options: { maxPages?: number; maxMeetings?: number } = {},
): Promise<MonitoringFetchResult> {
  if (site.estrategia === "antt-2026") {
    const items = await fetchAntt2026MonitoringItems(options);
    return {
      contentHash: sha256(JSON.stringify(items.map((item) => item.hash_item).sort())),
      needsHeadless: false,
      items,
    };
  }

  // Respeita a estrategia explicita: fontes "html-static" (ex.: ANM/ARTESP de
  // reunioes colegiadas) usam o parser de documentos mesmo estando em gov.br.
  // Sem isso, a pagina de reunioes da ANM caía no parser de NOTICIAS (filtra
  // apenas links /noticias/) e nao encontrava pautas/atas/votos.
  const isDocStatic = site.estrategia === "html-static";
  const parseFor = (pageHtml: string, pageUrl: string): DiscoveredMonitoringItem[] =>
    isDocStatic
      ? parseMonitoringHtml(pageHtml, pageUrl, site.seletor_links)
      : site.estrategia === "govbr-news" || /gov\.br\//i.test(site.url)
        ? parseGovBrNewsHtml(pageHtml, pageUrl, site.seletor_links)
        : parseMonitoringHtml(pageHtml, pageUrl, site.seletor_links);

  // Paginação: segue "próxima"/rel=next até o teto, parando quando uma página
  // não traz item novo. Antes só a 1ª página era lida (perdia 2+ de ANM/ARTESP).
  const maxPages = Math.max(1, Math.min(options.maxPages ?? MAX_MONITORING_PAGES, 30));
  const visited = new Set<string>();
  const collected = new Map<string, DiscoveredMonitoringItem>();
  let pageUrl: string | null = site.url;
  let firstHtml = "";
  let usedHeadless = false;
  let pageCount = 0;

  while (pageUrl && pageCount < maxPages && !visited.has(pageUrl)) {
    visited.add(pageUrl);
    pageCount += 1;

    let html: string;
    try {
      // UA de navegador + retry/backoff/throttle (reduz 403/429 de portais como ARTESP).
      html = await resilientFetchText(pageUrl, {
        headers: {
          "User-Agent": BROWSER_UA,
          Accept: "text/html,application/xhtml+xml",
          "Accept-Language": "pt-BR,pt;q=0.9,en;q=0.8",
        },
      });
    } catch (err) {
      if (pageCount === 1) throw err; // 1ª página falhou → erro real do site (sobe para o runner)
      break; // páginas seguintes: encerra a paginação sem descartar o já coletado
    }

    let items = parseFor(html, pageUrl);

    // Fallback headless quando o estático não rende NENHUM doc (ARTESP/ANM atrás
    // de iframe/JS). Só para html-static (evita acionar render nas fontes de
    // notícia) e só adota o resultado se ele realmente trouxer itens.
    if (items.length === 0 && pageCount === 1 && isDocStatic) {
      const rendered = await tryRenderHtmlFallback(pageUrl, site.nome);
      if (rendered) {
        const headlessItems = parseFor(rendered, pageUrl);
        if (headlessItems.length > 0) {
          usedHeadless = true;
          html = rendered;
          items = headlessItems;
        }
      }
    }

    if (pageCount === 1) firstHtml = html;

    let added = 0;
    for (const item of items) {
      if (!collected.has(item.hash_item)) {
        collected.set(item.hash_item, item);
        added += 1;
      }
    }
    // Fim da lista: página seguinte sem novidade encerra a paginação.
    if (pageCount > 1 && added === 0) break;

    const next = findNextMonitoringPageUrl(html, pageUrl);
    pageUrl = next && !visited.has(next) ? next : null;
  }

  const items = [...collected.values()];
  const hasAnchors = /<a\b/i.test(firstHtml);

  return {
    contentHash: sha256(firstHtml),
    needsHeadless:
      items.length === 0 && !usedHeadless &&
      (!hasAnchors || /javascript is disabled|requires javascript|__next|webpackJsonp/i.test(firstHtml)),
    items,
  };
}

/**
 * Acha o link da PRÓXIMA página de listagem (paginação ANM Plone / ARTESP Liferay).
 * Prioriza rel="next"; senão, âncora cujo texto seja "próxima/seguinte/next/»/›".
 * Só segue links no MESMO host (evita sair do portal) e diferentes da URL atual.
 */
export function findNextMonitoringPageUrl(html: string, baseUrl: string): string | null {
  let baseHost: string;
  try {
    baseHost = new URL(baseUrl).host;
  } catch {
    return null;
  }
  const anchors = extractAnchors(html, baseUrl);
  const relNext = anchors.find((a) => /\brel\s*=\s*["'][^"']*\bnext\b/i.test(a.attrs));
  const NEXT_TEXT = /^(proxim[oa]|seguinte|next|»|›|>>?)$/;
  const textNext = anchors.find((a) => {
    const t = normalizeText(a.text);
    return NEXT_TEXT.test(t) || /\b(proxim[oa]|seguinte)\b/.test(t);
  });

  for (const candidate of [relNext, textNext]) {
    if (!candidate) continue;
    try {
      const u = new URL(candidate.href, baseUrl);
      if (u.host === baseHost && u.toString() !== baseUrl) return u.toString();
    } catch {
      // ignora href inválido
    }
  }
  return null;
}

export function parseMonitoringHtml(
  html: string,
  baseUrl: string,
  linkSelector?: string | null,
): DiscoveredMonitoringItem[] {
  const anchors = applyLinkSelector(extractAnchors(html, baseUrl), linkSelector, baseUrl)
    .filter((a) => {
      const combined = normalizeText(`${a.text} ${decodeURIComponentSafe(a.href)}`);
      return DOC_LABEL_RE.test(combined) || PDF_RE.test(a.href) || /\/view(?:$|[/?#])|sei|deliber|pauta|ata|voto|reunio|colegiad|sessao/.test(combined);
    });

  const seen = new Set<string>();
  const items: DiscoveredMonitoringItem[] = [];

  for (const anchor of anchors) {
    const context = contextAround(html, anchor.index, 900);
    const normalizedContext = normalizeText(context);
    const tipo = classifyLinkType(anchor.text, anchor.href);
    const reuniao = extractReuniao(normalizedContext);
    const data_reuniao = extractIsoDate(normalizedContext);
    const titleParts = [anchor.text];
    if (reuniao) titleParts.push(reuniao);
    if (data_reuniao) titleParts.push(formatPtDate(data_reuniao));

    const hash_item = sha256(`${tipo}|${anchor.href}|${reuniao ?? ""}|${data_reuniao ?? ""}`);
    if (seen.has(hash_item)) continue;
    seen.add(hash_item);

    items.push({
      tipo,
      titulo: cleanText(titleParts.join(" - ")).slice(0, 500),
      url_item: anchor.href,
      reuniao,
      data_reuniao,
      hash_item,
      metadata: {
        link_text: anchor.text,
        source: baseUrl,
      },
    });
  }

  return items;
}

export function parseGovBrNewsHtml(
  html: string,
  baseUrl: string,
  linkSelector?: string | null,
): DiscoveredMonitoringItem[] {
  const anchors = applyLinkSelector(extractAnchors(html, baseUrl), linkSelector, baseUrl)
    .filter((a) => /\/noticias\//i.test(a.href) || /\/assuntos\/noticias\//i.test(a.href))
    .filter((a) => normalizeText(a.text).length >= 18);

  const seen = new Set<string>();
  const items: DiscoveredMonitoringItem[] = [];

  for (const anchor of anchors) {
    const context = contextAround(html, anchor.index, 700);
    const data_reuniao = extractIsoDate(context);
    const categoria = extractGovBrCategory(context);
    const resumo = extractGovBrSummary(context, anchor.text);
    const tipo = classifyGovBrType(`${anchor.text} ${context}`);
    const hash_item = sha256(`${tipo}|${anchor.href}|${data_reuniao ?? ""}|${anchor.text}`);
    if (seen.has(hash_item)) continue;
    seen.add(hash_item);

    items.push({
      tipo,
      titulo: cleanText(anchor.text).slice(0, 500),
      url_item: anchor.href,
      reuniao: categoria,
      data_reuniao,
      hash_item,
      metadata: {
        link_text: anchor.text,
        source: baseUrl,
        categoria,
        resumo,
        connector: "govbr-news",
      },
    });
  }

  return items;
}

interface ExtractedAnchor {
  href: string;
  text: string;
  index: number;
  attrs: string;
}

function extractAnchors(html: string, baseUrl: string): ExtractedAnchor[] {
  const anchors: ExtractedAnchor[] = [];
  const re = /<a\b([^>]*?)href=["']([^"']+)["']([^>]*)>([\s\S]*?)<\/a>/gi;
  let match: RegExpExecArray | null;

  while ((match = re.exec(html)) !== null) {
    const hrefRaw = decodeHtml(match[2]);
    const text = cleanText(stripTags(match[4])) || inferLinkText(hrefRaw);
    if (!text) continue;
    try {
      anchors.push({
        href: new URL(hrefRaw, baseUrl).toString(),
        text,
        index: match.index,
        attrs: `${match[1]} ${match[3]}`,
      });
    } catch {
      // Ignore malformed links from government CMS fragments.
    }
  }

  return anchors;
}

// Seletor de links configurável via banco (monitoramento_sites.seletor_links).
// Suporta formas restritas: ".classe", "[atributo]", "tag.classe". Quando vazio,
// "a[href]" ou não-parseável, mantém todos os anchors. Se o seletor zerar a lista
// (provável regressão de config), faz fallback para a lista completa e loga.
function applyLinkSelector(
  anchors: ExtractedAnchor[],
  selector: string | null | undefined,
  baseUrl: string,
): ExtractedAnchor[] {
  const sel = selector?.trim();
  if (!sel || sel === "a[href]" || sel === "a") return anchors;

  const filtered = anchors.filter((a) => matchesLinkSelector(a.attrs, sel));
  if (filtered.length === 0 && anchors.length > 0) {
    console.warn(`[monitoring] seletor "${sel}" não casou nenhum link em ${baseUrl}; usando todos os links`);
    return anchors;
  }
  return filtered;
}

function matchesLinkSelector(attrs: string, selector: string): boolean {
  const classMatch = selector.match(/\.([\w-]+)/);
  if (classMatch) {
    const cls = classMatch[1];
    const classAttr = attrs.match(/class=["']([^"']*)["']/i)?.[1] ?? "";
    if (!new RegExp(`(^|\\s)${cls}(\\s|$)`).test(classAttr)) return false;
  }
  const attrMatch = selector.match(/\[([\w-]+)/);
  if (attrMatch) {
    const attr = attrMatch[1];
    if (!new RegExp(`(^|\\s)${attr}(=|\\s|$)`, "i").test(attrs)) return false;
  }
  return true;
}

function inferLinkText(href: string) {
  const decoded = decodeURIComponentSafe(href);
  const lower = normalizeText(decoded);
  if (lower.includes("pauta")) return "Pauta";
  if (/\bata\b/.test(lower)) return "Ata";
  if (lower.includes("deliber")) return "Deliberacoes";
  if (lower.includes("reunio")) return "Reuniao";
  if (lower.includes(".pdf")) return decoded.split("/").pop() ?? "PDF";
  return "";
}

function contextAround(html: string, index: number, radius: number) {
  return cleanText(stripTags(html.slice(Math.max(0, index - radius), index + radius)));
}

function classifyLinkType(text: string, href: string): MonitoramentoTipoItem {
  const value = normalizeText(`${text} ${href}`);
  if (/\b(nomea|exonera)/.test(value)) return "ato_nomeacao";
  if (/\bmandato/.test(value)) return "mandato";
  if (/\b(diretoria|diretores?|composi)/.test(value)) return "diretoria";
  // Decisoes tem prioridade sobre pautas: voto > ata > deliberacao > pauta.
  // Uma pauta e a agenda do que sera discutido; voto/ata sao a decisao em si.
  if (/\bvoto\b|\bvotos\b/.test(value)) return "voto";
  if (/\bata\b|\batas\b/.test(value)) return "ata";
  if (value.includes("delibera")) return "deliberacao";
  if (value.includes("pauta")) return "pauta";
  if (value.includes("reuniao")) return "reuniao";
  return "documento";
}

// Prioridade de processamento/exibicao: decisoes antes de agendas.
export function tipoPrioridade(tipo: string): number {
  switch (tipo) {
    case "voto": return 5;
    case "ata": return 4;
    case "deliberacao": return 3;
    case "pauta": return 2;
    case "documento": return 1;
    default: return 0;
  }
}

function classifyGovBrType(value: string): MonitoramentoTipoItem {
  const text = normalizeText(value);
  if (/consulta publica|audiencia publica|tomada de subsidios/.test(text)) return "consulta_publica";
  if (/politica|programa|plano|diretriz|portaria|resolucao|decreto|marco regulatorio/.test(text)) {
    return "politica_publica";
  }
  return "noticia";
}

function extractReuniao(text: string): string | null {
  const match = REUNIAO_RE.exec(text);
  return match ? cleanText(match[0]).slice(0, 180) : null;
}

function extractIsoDate(text: string): string | null {
  const match = DATE_RE.exec(text);
  if (!match) return null;
  const day = Number(match[1]);
  const month = Number(match[2]);
  const year = Number(match[3]);
  if (day < 1 || day > 31 || month < 1 || month > 12 || year < 1990 || year > 2099) {
    return null;
  }
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function extractGovBrCategory(text: string): string | null {
  const cleaned = cleanText(text);
  const parts = cleaned.split(/\s{2,}|##|Publicado|publicado|\d{2}\/\d{2}\/\d{4}/i)
    .map((p) => cleanText(p))
    .filter(Boolean);
  const category = parts.find((p) => p.length >= 3 && p.length <= 60 && p === p.toUpperCase());
  return category ?? null;
}

function extractGovBrSummary(context: string, title: string): string | null {
  const cleaned = cleanText(context).replace(cleanText(title), " ");
  const sentences = cleaned.split(/(?<=[.!?])\s+/).map((s) => cleanText(s)).filter((s) => s.length > 40);
  return sentences[0]?.slice(0, 500) ?? null;
}

function formatPtDate(iso: string) {
  const [year, month, day] = iso.split("-");
  return `${day}/${month}/${year}`;
}

function stripTags(value: string) {
  return value
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ");
}

function decodeHtml(value: string) {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/&ccedil;/g, "c")
    .replace(/&atilde;/g, "a")
    .replace(/&otilde;/g, "o")
    .replace(/&aacute;/g, "a")
    .replace(/&eacute;/g, "e")
    .replace(/&iacute;/g, "i")
    .replace(/&oacute;/g, "o")
    .replace(/&uacute;/g, "u");
}

function decodeURIComponentSafe(value: string) {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function cleanText(value: string) {
  return decodeHtml(value).replace(/\s+/g, " ").trim();
}

function normalizeText(value: string) {
  return cleanText(value)
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

function sha256(value: string) {
  return crypto.createHash("sha256").update(value).digest("hex");
}
