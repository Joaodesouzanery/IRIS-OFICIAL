/**
 * OCR externo OPCIONAL para PDFs escaneados (Etapa 10-B).
 *
 * OCR robusto no serverless da Vercel é inviável com libs nativas (imagemagick/canvas/
 * tesseract não rodam). A via viável é um provedor HTTP. Usamos o OCR.space (tem tier
 * grátis) só via chamada HTTP — sem dependência nativa. Gated por `OCR_SPACE_API_KEY`:
 * se não configurado ou se falhar, retorna null e o documento segue apenas SINALIZADO
 * como escaneado (comportamento anterior, mais explícito). OCR nunca auto-confirma.
 */

const OCR_ENDPOINT = "https://api.ocr.space/parse/image";
const MAX_OCR_BYTES = 5 * 1024 * 1024; // teto do provedor para PDF
const OCR_TIMEOUT_MS = 40_000; // dentro do orçamento de 60s da Vercel

export function isOcrConfigured(): boolean {
  return Boolean(process.env.OCR_SPACE_API_KEY);
}

/**
 * Extrai texto de um PDF escaneado via OCR externo. Retorna null se não configurado,
 * grande demais, ou em qualquer falha (degrada com segurança).
 */
export async function extractTextViaOcr(buffer: Buffer): Promise<string | null> {
  const apiKey = process.env.OCR_SPACE_API_KEY;
  if (!apiKey) return null;
  if (buffer.length > MAX_OCR_BYTES) return null;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), OCR_TIMEOUT_MS);
  try {
    const form = new FormData();
    form.append("apikey", apiKey);
    form.append("language", "por");
    form.append("OCREngine", "2");
    form.append("filetype", "PDF");
    form.append("scale", "true");
    form.append("file", new Blob([new Uint8Array(buffer)], { type: "application/pdf" }), "documento.pdf");

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
