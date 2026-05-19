import crypto from "crypto";
import type { MonitoramentoTipoItem } from "@/types";
import { fetchAntt2026MonitoringItems } from "@/lib/server/antt-2026-collector";

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
  /\b(reuniao|reunioes|pauta|ata|deliberacao|deliberacoes|diretoria|diretores?|mandato|nomeacao|exoneracao|composicao)\b/i;
const PDF_RE = /\.pdf(?:$|[/?#])|\/@@download\/file(?:$|[/?#])/i;
const DATE_RE = /\b(\d{2})\/(\d{2})\/(\d{4})\b/;
const REUNIAO_RE = /(\d{1,4})\s*(?:a|o|ª|º)?\s*reuniao[^<\n\r]*/i;

export async function fetchMonitoringSite(
  site: MonitoringSiteInput,
): Promise<MonitoringFetchResult> {
  if (site.estrategia === "antt-2026") {
    const items = await fetchAntt2026MonitoringItems();
    return {
      contentHash: sha256(JSON.stringify(items.map((item) => item.hash_item).sort())),
      needsHeadless: false,
      items,
    };
  }

  const res = await fetch(site.url, {
    headers: {
      "User-Agent": "IRIS-Regulacao-Monitor/1.0",
      Accept: "text/html,application/xhtml+xml",
    },
    next: { revalidate: 0 },
  });

  if (!res.ok) {
    throw new Error(`HTTP ${res.status} ao consultar site monitorado`);
  }

  const html = await res.text();
  const contentHash = sha256(html);
  const items = site.estrategia === "govbr-news" || /gov\.br\//i.test(site.url)
    ? parseGovBrNewsHtml(html, site.url)
    : parseMonitoringHtml(html, site.url);
  const hasAnchors = /<a\b/i.test(html);

  return {
    contentHash,
    needsHeadless:
      items.length === 0 &&
      (!hasAnchors || /javascript is disabled|requires javascript|__next|webpackJsonp/i.test(html)),
    items,
  };
}

export function parseMonitoringHtml(
  html: string,
  baseUrl: string,
): DiscoveredMonitoringItem[] {
  const anchors = extractAnchors(html, baseUrl)
    .filter((a) => {
      const combined = normalizeText(`${a.text} ${decodeURIComponentSafe(a.href)}`);
      return DOC_LABEL_RE.test(combined) || PDF_RE.test(a.href) || /\/view(?:$|[/?#])|sei|deliber|pauta|ata|reunio/.test(combined);
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
): DiscoveredMonitoringItem[] {
  const anchors = extractAnchors(html, baseUrl)
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

function extractAnchors(html: string, baseUrl: string) {
  const anchors: Array<{ href: string; text: string; index: number }> = [];
  const re = /<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  let match: RegExpExecArray | null;

  while ((match = re.exec(html)) !== null) {
    const hrefRaw = decodeHtml(match[1]);
    const text = cleanText(stripTags(match[2])) || inferLinkText(hrefRaw);
    if (!text) continue;
    try {
      anchors.push({
        href: new URL(hrefRaw, baseUrl).toString(),
        text,
        index: match.index,
      });
    } catch {
      // Ignore malformed links from government CMS fragments.
    }
  }

  return anchors;
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
  if (value.includes("pauta")) return "pauta";
  if (/\bvoto\b/.test(value)) return "voto";
  if (/\bata\b/.test(value)) return "ata";
  if (value.includes("delibera")) return "deliberacao";
  if (value.includes("reuniao")) return "reuniao";
  return "documento";
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
