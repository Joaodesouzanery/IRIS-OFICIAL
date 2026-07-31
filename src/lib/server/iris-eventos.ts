/**
 * Próximos eventos do IRIS — auto-fetch de https://irisregulacao.org/eventos/ (site próprio,
 * "The Events Calendar"/WordPress) para a seção de eventos da newsletter. Parseia JSON-LD Event
 * (schema.org), filtra futuros e devolve os próximos N. Degrade PROPOSITAL → [] em qualquer falha.
 */

import { parse } from "node-html-parser";
import { resilientFetchText } from "@/lib/server/resilient-fetch";

export interface IrisEvento {
  titulo: string;
  data: string; // ISO date (YYYY-MM-DD)
  local: string | null;
  url: string;
}

export const IRIS_EVENTOS_URL = "https://irisregulacao.org/eventos/";
export const IRIS_SITE_URL = "https://irisregulacao.org/";

// Mesmo padrão do projeto (upload-queue db: any) — JSON-LD externo não é tipado.
type JsonObj = Record<string, any>;

function flattenJsonLd(json: unknown): JsonObj[] {
  const out: JsonObj[] = [];
  const visit = (v: unknown) => {
    if (Array.isArray(v)) return v.forEach(visit);
    if (v && typeof v === "object") {
      const o = v as JsonObj;
      out.push(o);
      if (o["@graph"]) visit(o["@graph"]);
    }
  };
  visit(json);
  return out;
}

function extractLocal(location: unknown): string | null {
  const loc = Array.isArray(location) ? location[0] : location;
  if (typeof loc === "string") return loc.trim() || null;
  if (loc && typeof loc === "object") {
    const o = loc as JsonObj;
    if (typeof o.name === "string" && o.name.trim()) return o.name.trim();
    const addr = o.address;
    if (typeof addr === "string") return addr.trim() || null;
    if (addr && typeof addr === "object") {
      const a = addr as JsonObj;
      const parts = [a.addressLocality, a.addressRegion].filter((x): x is string => typeof x === "string" && x.trim().length > 0);
      if (parts.length) return parts.join(" – ");
    }
  }
  return null;
}

/** Parse puro (sem rede) — exportado para teste. */
export function parseEventosFromHtml(html: string): IrisEvento[] {
  const root = parse(html);
  const out: IrisEvento[] = [];
  const seen = new Set<string>();
  for (const script of root.querySelectorAll('script[type="application/ld+json"]')) {
    let json: unknown;
    try {
      json = JSON.parse(script.text);
    } catch {
      continue;
    }
    for (const node of flattenJsonLd(json)) {
      const type = node["@type"];
      const isEvent = type === "Event" || (Array.isArray(type) && type.includes("Event"));
      if (!isEvent) continue;
      const titulo = typeof node.name === "string" ? node.name.trim() : "";
      const startDate = typeof node.startDate === "string" ? node.startDate : "";
      if (!titulo || !startDate) continue;
      const data = startDate.slice(0, 10);
      const key = `${titulo}|${data}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({
        titulo,
        data,
        local: extractLocal(node.location),
        url: typeof node.url === "string" && node.url ? node.url : IRIS_EVENTOS_URL,
      });
    }
  }
  return out;
}

/** Próximos `limit` eventos (data >= hoje), ordenados. `todayIso` só para teste determinístico. */
export async function fetchIrisEventos(limit = 4, todayIso?: string): Promise<IrisEvento[]> {
  let html: string;
  try {
    html = await resilientFetchText(IRIS_EVENTOS_URL, { timeoutMs: 15_000 });
  } catch {
    return [];
  }
  const hoje = todayIso ?? new Date().toISOString().slice(0, 10);
  return parseEventosFromHtml(html)
    .filter((e) => e.data >= hoje)
    .sort((a, b) => a.data.localeCompare(b.data))
    .slice(0, Math.max(0, limit));
}
