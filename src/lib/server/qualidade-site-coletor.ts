/**
 * Coletor de sinais dos SITES das agências para a auto-classificação IMQN.
 *
 * Busca o portal gov.br de cada agência (1 página — o home já traz os links de navegação
 * para as seções) e detecta, por dimensão, se a agência publica a seção correspondente
 * (Agenda Regulatória, AIR, ARR, Consultas/Audiências, Estoque/Consolidação) + a frequência
 * dos termos. É um sinal de maturidade que SOMA às notícias e deliberações. Throttle por
 * host (reusa a fila do gov.br) para não estourar rate-limit. Falha → sinais vazios (degrada).
 */

import { parse } from "node-html-parser";
import { resilientFetchText } from "@/lib/server/resilient-fetch";
import type { QualidadeNivel } from "@/lib/server/qualidade-regulatoria";

export type SiteSignal = { hasSection: boolean; sectionUrls: string[]; termFreq: number };
export type SiteSignals = Record<number, SiteSignal>;

const HOST_THROTTLE_MS = Number(process.env.COLLECTOR_HOST_THROTTLE_MS ?? "900") || 900;
const FETCH_TIMEOUT_MS = 12_000;

// Padrões por dimensão IMQN: href da seção (nav) + termos no texto.
const DIMENSION_PATTERNS: Record<number, { href: RegExp; terms: string[] }> = {
  1: { href: /\/air(?:\/|$|\?)|analise-de-impacto|impacto-regulatorio/i, terms: ["analise de impacto regulatorio", "impacto regulatorio"] },
  2: { href: /participacao-social|consultas-publicas|audiencias-publicas|tomada-de-subsidios/i, terms: ["consulta publica", "audiencia publica", "participacao social"] },
  3: { href: /consolidacao|acervo-normativo|estoque-regulatorio|\/legislacao(?:\/|$)|\/normas(?:\/|$)/i, terms: ["estoque regulatorio", "consolidacao normativa", "acervo normativo"] },
  4: { href: /agenda-regulatoria/i, terms: ["agenda regulatoria"] },
  5: { href: /processo-normativo|regimento-interno/i, terms: ["processo normativo", "regimento interno"] },
  6: { href: /\/arr(?:\/|$|\?)|resultado-regulatorio/i, terms: ["analise de resultado regulatorio", "resultado regulatorio"] },
};

const DIMENSION_IDS = Object.keys(DIMENSION_PATTERNS).map(Number);

function normalize(value: string): string {
  return value.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
}

function countOccurrences(haystack: string, needle: string): number {
  if (!needle) return 0;
  let count = 0;
  let idx = haystack.indexOf(needle);
  while (idx !== -1) {
    count += 1;
    idx = haystack.indexOf(needle, idx + needle.length);
  }
  return count;
}

function absolutize(href: string, baseUrl: string): string | null {
  try {
    const u = new URL(href, baseUrl);
    if (u.protocol !== "https:" && u.protocol !== "http:") return null;
    u.hash = "";
    return u.toString();
  } catch {
    return null;
  }
}

export function emptySiteSignals(): SiteSignals {
  const out: SiteSignals = {};
  for (const id of DIMENSION_IDS) out[id] = { hasSection: false, sectionUrls: [], termFreq: 0 };
  return out;
}

/** Extrai os sinais por dimensão do HTML do portal (função pura, testável). */
export function extractSiteSignals(html: string, baseUrl: string): SiteSignals {
  const root = parse(html);
  const anchors = root.querySelectorAll("a[href]").map((a) => ({ href: a.getAttribute("href") ?? "", text: a.text ?? "" }));
  const bodyText = normalize(root.text ?? "");
  const signals: SiteSignals = {};
  for (const id of DIMENSION_IDS) {
    const pattern = DIMENSION_PATTERNS[id];
    const matchedUrls = anchors
      .filter((a) => pattern.href.test(a.href) || pattern.terms.some((t) => normalize(a.text).includes(t)))
      .map((a) => absolutize(a.href, baseUrl))
      .filter((u): u is string => Boolean(u));
    const sectionUrls = [...new Set(matchedUrls)].slice(0, 5);
    const termFreq = pattern.terms.reduce((sum, t) => sum + countOccurrences(bodyText, t), 0);
    signals[id] = { hasSection: sectionUrls.length > 0, sectionUrls, termFreq };
  }
  return signals;
}

async function fetchAgencyPortal(url: string): Promise<string | null> {
  try {
    return await resilientFetchText(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "pt-BR,pt;q=0.9,en;q=0.8",
      },
      timeoutMs: FETCH_TIMEOUT_MS,
      hostThrottleMs: HOST_THROTTLE_MS,
    });
  } catch {
    return null;
  }
}

/**
 * Coleta os sinais de site para as agências informadas. Só agências com portal gov.br
 * (ARTESP e afins são pulados — portal não-Plone; caem só em notícias/deliberações).
 */
export async function collectSiteSignals(
  agencies: Array<{ sigla: string; site_oficial: string }>,
): Promise<Map<string, SiteSignals>> {
  const out = new Map<string, SiteSignals>();
  for (const ag of agencies) {
    if (!/(^|\.)gov\.br/i.test(safeHost(ag.site_oficial))) {
      out.set(ag.sigla, emptySiteSignals());
      continue;
    }
    const html = await fetchAgencyPortal(ag.site_oficial);
    out.set(ag.sigla, html ? extractSiteSignals(html, ag.site_oficial) : emptySiteSignals());
  }
  return out;
}

function safeHost(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

/**
 * Combina os sinais de uma dimensão (site + notícias) num nível IMQN. Função pura, testável.
 * "Seção existir" sozinha = Inicial; níveis altos exigem também notícia/atividade recente.
 */
export function levelFromSignals(s: { hasSection: boolean; termFreq: number; newsHits: number; recentNews: number }): QualidadeNivel {
  if (s.hasSection && s.recentNews >= 8 && s.termFreq >= 8) return "melhoria_continua";
  if ((s.hasSection && (s.recentNews >= 3 || s.termFreq >= 5)) || s.recentNews >= 6) return "gerenciado";
  if (s.hasSection || s.newsHits >= 1) return "inicial";
  return "inexistente";
}
