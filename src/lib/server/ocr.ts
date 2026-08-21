/**
 * OCR externo OPCIONAL para PDFs escaneados (Etapa 10-B; chunking ago/2026).
 *
 * OCR robusto no serverless da Vercel é inviável com libs nativas (imagemagick/canvas/
 * tesseract não rodam). A via viável é um provedor HTTP. Usamos o OCR.space (tem tier
 * grátis) só via chamada HTTP — sem dependência nativa. Gated por `OCR_SPACE_API_KEY`:
 * se não configurado ou se falhar, retorna null e o documento segue apenas SINALIZADO
 * como escaneado (comportamento anterior, mais explícito). OCR nunca auto-confirma.
 *
 * CHUNKING (ago/2026): o tier FREE do OCR.space limita PDF a 3 páginas — e quase todo
 * documento das agências tem mais. PDFs com >3 páginas são divididos em blocos de 3
 * páginas com pdf-lib (JS puro, roda no serverless) e cada bloco vai numa chamada; os
 * textos são concatenados na ordem. Falha em um bloco não derruba o resto.
 */

import { hasBudget } from "@/lib/server/time-budget";

const OCR_ENDPOINT = "https://api.ocr.space/parse/image";
export const MAX_OCR_BYTES = 5 * 1024 * 1024; // teto do provedor para PDF
const OCR_TIMEOUT_MS = 40_000; // dentro do orçamento de 60s da Vercel
const FREE_TIER_MAX_PAGES = 3; // limite de páginas por PDF no tier grátis
const MAX_CHUNKS = 10; // teto de chamadas por documento (30 páginas OCRizadas)

export function isOcrConfigured(): boolean {
  return Boolean(process.env.OCR_SPACE_API_KEY);
}

/** Uma chamada ao provedor com um PDF de até 3 páginas/5MB. */
async function ocrRequest(apiKey: string, pdf: Uint8Array): Promise<string | null> {
  if (pdf.length > MAX_OCR_BYTES) return null;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), OCR_TIMEOUT_MS);
  try {
    const form = new FormData();
    form.append("apikey", apiKey);
    form.append("language", "por");
    form.append("OCREngine", "2");
    form.append("filetype", "PDF");
    form.append("scale", "true");
    form.append("file", new Blob([new Uint8Array(pdf)], { type: "application/pdf" }), "documento.pdf");

    const res = await fetch(OCR_ENDPOINT, { method: "POST", body: form, signal: controller.signal });
    if (!res.ok) return null;
    const json = (await res.json().catch(() => null)) as
      | { IsErroredOnProcessing?: boolean; ParsedResults?: Array<{ ParsedText?: string }> }
      | null;
    if (!json || json.IsErroredOnProcessing) return null;
    const text = (json.ParsedResults ?? []).map((r) => r.ParsedText ?? "").join("\n").trim();
    return text.length > 0 ? text : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Divide o PDF em blocos de até `FREE_TIER_MAX_PAGES` páginas (pdf-lib). Retorna null se o
 * PDF não puder ser aberto (criptografado/corrompido) — o chamador cai no envio inteiro.
 */
async function splitPdfInChunks(buffer: Buffer): Promise<Uint8Array[] | null> {
  try {
    const { PDFDocument } = await import("pdf-lib");
    const src = await PDFDocument.load(new Uint8Array(buffer), { ignoreEncryption: true });
    const total = src.getPageCount();
    if (total <= FREE_TIER_MAX_PAGES) return null; // sem necessidade de dividir
    const chunks: Uint8Array[] = [];
    for (let start = 0; start < total && chunks.length < MAX_CHUNKS; start += FREE_TIER_MAX_PAGES) {
      const out = await PDFDocument.create();
      const idx = Array.from(
        { length: Math.min(FREE_TIER_MAX_PAGES, total - start) },
        (_, i) => start + i,
      );
      const pages = await out.copyPages(src, idx);
      for (const p of pages) out.addPage(p);
      chunks.push(await out.save());
    }
    return chunks;
  } catch {
    return null;
  }
}

/**
 * Extrai texto de um PDF escaneado via OCR externo. Retorna null se não configurado,
 * grande demais, ou em qualquer falha (degrada com segurança).
 * `deadlineAt` (opcional): para de enviar blocos quando o orçamento da função acabar —
 * o texto parcial já obtido é devolvido.
 */
export async function extractTextViaOcr(buffer: Buffer, deadlineAt?: number): Promise<string | null> {
  const apiKey = process.env.OCR_SPACE_API_KEY;
  if (!apiKey) return null;
  if (buffer.length > MAX_OCR_BYTES) return null;

  // >3 páginas: divide em blocos de 3 (tier free) e concatena os textos.
  const chunks = await splitPdfInChunks(buffer);
  if (chunks && chunks.length > 0) {
    const partes: string[] = [];
    for (const chunk of chunks) {
      if (deadlineAt && !hasBudget(deadlineAt, OCR_TIMEOUT_MS + 2_000)) break;
      const t = await ocrRequest(apiKey, chunk);
      if (t) partes.push(t);
    }
    const text = partes.join("\n").trim();
    return text.length > 0 ? text : null;
  }

  return ocrRequest(apiKey, new Uint8Array(buffer));
}
