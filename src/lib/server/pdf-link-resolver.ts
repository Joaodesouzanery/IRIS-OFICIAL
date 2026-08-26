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
// Fase 8: 12 -> 30. O maior número medido no corpus real é 7 (a 1.036ª Reunião de Diretoria da
// ANTT: pauta + ata + 5 votos). O teto antigo empatava com o teto do chamador, o que criava um
// corte ESCONDIDO: quem lê `links.length` não distingue "a página tinha 12" de "a página tinha 40
// e eu cortei". Com folga, o corte volta a ser exceção — e quando acontecer, `resolvePdfLinks`
// devolve o total encontrado para que ninguém precise adivinhar.
const MAX_LINKS = 30;

/**
 * O buffer e um arquivo ZIP? (assinatura local `PK\x03\x04`)
 *
 * ⚠️ Isto responde TRUE para DOCX, XLSX e PPTX — todo pacote OOXML e um ZIP. Quem usa isto para
 * decidir "extrair PDFs de dentro" TEM de testar DOCX antes, senao um .docx entra no caminho do
 * ZIP, sai com zero entradas .pdf e e arquivado como se a pagina nao tivesse documento — que e
 * exatamente o diagnostico errado que este modulo existe para evitar.
 */
export function sniffIsZip(buffer: Buffer): boolean {
  return buffer.length >= 4 &&
    buffer[0] === 0x50 && buffer[1] === 0x4b && buffer[2] === 0x03 && buffer[3] === 0x04;
}

/**
 * O buffer/URL e um DOCX? Tres sinais, do mais barato ao mais confiavel.
 *
 * Medido na pagina de reunioes da ARTESP (26/08/2026): das 256 URLs de documento, 32 sao DOCX —
 * todas rotuladas "Pauta". Nenhum caminho do projeto LE .docx (so gera, em docx-export.ts), entao
 * o objetivo aqui nao e ingerir: e dar a esses 32 um motivo terminal HONESTO, em vez de deixa-los
 * se disfarcarem de "pagina sem PDF".
 */
export function sniffIsDocx(contentType: string | null | undefined, url: string, buffer: Buffer): boolean {
  if (contentType && contentType.toLowerCase().includes("wordprocessingml")) return true;
  if (/\.docx(?:$|[?#])/i.test(url)) return true;
  // O diretorio central de um DOCX sempre cita `word/document.xml`. Procurar no fim do arquivo
  // (onde vive o central directory) e barato e nao depende de content-type nem de extensao — as
  // URLs de DAM da ARTESP nao tem nenhum dos dois.
  if (!sniffIsZip(buffer)) return false;
  const cauda = buffer.subarray(Math.max(0, buffer.length - 4_000)).toString("latin1");
  return cauda.includes("word/document.xml");
}

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
/**
 * Como `resolvePdfLinksFromHtml`, mas devolve também QUANTOS links de PDF a página tinha antes do
 * teto. Sem esse número, o chamador não consegue distinguir "esta página tem 12 documentos" de
 * "esta página tem 40 e eu descartei 28 em silêncio" — e descarte silencioso foi exatamente o que
 * fez a esteira perder um voto de diretor por reunião.
 */
export function resolvePdfLinks(html: string, baseUrl: string): { links: string[]; totalEncontrado: number } {
  let root: ReturnType<typeof parse>;
  try {
    root = parse(html);
  } catch {
    return { links: [], totalEncontrado: 0 };
  }
  const out: string[] = [];
  const seen = new Set<string>();
  let totalEncontrado = 0;
  for (const a of root.querySelectorAll("a[href]")) {
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
    totalEncontrado++;
    if (out.length < MAX_LINKS) out.push(candidate);
  }
  return { links: out, totalEncontrado };
}

/** Compatível com o contrato antigo (só os links). Preservado: há teste que trava esta forma. */
export function resolvePdfLinksFromHtml(html: string, baseUrl: string): string[] {
  return resolvePdfLinks(html, baseUrl).links;
}
