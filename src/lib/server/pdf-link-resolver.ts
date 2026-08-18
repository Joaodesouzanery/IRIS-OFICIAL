/**
 * Ponte item-monitorado → PDF (QA ago/2026, "208 detectados / 0 na fila").
 *
 * O gate antigo do enqueue era um regex de URL (`.pdf` | `@@download/file`) — que
 * NUNCA casa com a ARTESP (CMS-SP DAM, URL sem extensão) nem com páginas Plone da
 * ANM (`/view`). Aqui o critério vira CONTEÚDO:
 *  - `sniffIsPdf`: content-type OU magic bytes `%PDF-` (aceita DAM sem extensão);
 *  - `resolvePdfLinksFromHtml`: quando a URL devolve HTML (página de reunião ANTT,
 *    página de documento Plone), extrai os links de PDF de dentro (âncoras `.pdf`,
 *    `@@download/file`, e o padrão Plone `<pagina>/view` → `<pagina>/@@download/file`).
 */

import { parse } from "node-html-parser";

const PDF_HREF_RE = /\.pdf(?:$|[/?#])|\/@@download\/file(?:$|[/?#])/i;
const PLONE_VIEW_RE = /^(.*?)\/view(?:$|[?#])/i;
/** Âncoras irrelevantes (navegação/rodapé) — corta ruído sem perder decisão. */
const SKIP_HREF_RE = /^(#|mailto:|javascript:|tel:)/i;
const MAX_LINKS = 12;

export function sniffIsPdf(contentType: string | null | undefined, buffer: Buffer): boolean {
  if (contentType && contentType.toLowerCase().includes("pdf")) return true;
  return buffer.length >= 5 && buffer.subarray(0, 5).toString("latin1") === "%PDF-";
}

export function sniffIsHtml(contentType: string | null | undefined, buffer: Buffer): boolean {
  if (contentType && /html|xml/i.test(contentType)) return true;
  const head = buffer.subarray(0, 512).toString("latin1").trimStart().toLowerCase();
  return head.startsWith("<!doctype") || head.startsWith("<html") || head.includes("<head");
}

/** `<pagina>/view` (Plone) → URL de download direto. Passthrough para o resto. */
export function ploneDownloadUrl(url: string): string {
  const m = url.match(PLONE_VIEW_RE);
  return m ? `${m[1]}/@@download/file` : url;
}

/**
 * Extrai da página HTML os links prováveis de PDF de decisão, em ordem de aparição:
 * âncoras que já são PDF/download, e âncoras Plone `/view` convertidas para download.
 * Relativas são resolvidas contra `baseUrl`. Dedup preservando ordem; cap MAX_LINKS.
 */
export function resolvePdfLinksFromHtml(html: string, baseUrl: string): string[] {
  let root: ReturnType<typeof parse>;
  try {
    root = parse(html);
  } catch {
    return [];
  }
  const out: string[] = [];
  const seen = new Set<string>();
  for (const a of root.querySelectorAll("a[href]")) {
    if (out.length >= MAX_LINKS) break;
    const href = (a.getAttribute("href") ?? "").trim();
    if (!href || SKIP_HREF_RE.test(href)) continue;
    let abs: string;
    try {
      abs = new URL(href, baseUrl).toString();
    } catch {
      continue;
    }
    const candidate = PDF_HREF_RE.test(abs) ? abs : PLONE_VIEW_RE.test(abs) ? ploneDownloadUrl(abs) : null;
    if (!candidate || seen.has(candidate)) continue;
    seen.add(candidate);
    out.push(candidate);
  }
  return out;
}
