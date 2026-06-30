/**
 * pdf-extractor.ts
 * Port de worker/app/pipeline/pdf_reader.py + text_cleaner.py
 * Extrai e limpa texto de PDFs usando pdf-parse (sem API externa).
 */

import pdfParse from "pdf-parse";

// ─── Limpeza de encoding ──────────────────────────────────────────────────
const ENCODING_FIXES: [RegExp, string][] = [
  [/Ã£/g, "ã"],
  [/Ã¢/g, "â"],
  [/Ã /g, "à"],
  [/Ã¡/g, "á"],
  [/Ã©/g, "é"],
  [/Ãª/g, "ê"],
  [/Ã­/g, "í"],
  [/Ã³/g, "ó"],
  [/Ã´/g, "ô"],
  [/Ãº/g, "ú"],
  [/Ã§/g, "ç"],
  [/Ã\u0083/g, "Ã"],
  [/Ã\u0082/g, "Â"],
  [/â€œ/g, '"'],
  [/â€/g, '"'],
  [/â€™/g, "'"],
  [/â€"/g, "–"],
  [/â€"/g, "—"],
  [/\u00a0/g, " "], // non-breaking space
];

function fixEncoding(text: string): string {
  let result = text;
  for (const [pattern, replacement] of ENCODING_FIXES) {
    result = result.replace(pattern, replacement);
  }
  return result;
}

// ─── Remoção de linhas muito repetidas (cabeçalhos/rodapés) ─────────────
// pdf-parse não separa por página, então trabalhamos sobre o texto completo.
// Linhas que aparecem 3+ vezes no documento são provavelmente cabeçalho/rodapé.
function removeRepeatedLines(text: string, minRepeat = 3): string {
  const lines = text.split("\n");
  if (lines.length < minRepeat * 2) return text; // documento curto demais

  const freq = new Map<string, number>();
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.length > 8) {
      freq.set(trimmed, (freq.get(trimmed) ?? 0) + 1);
    }
  }

  const repeated = new Set(
    [...freq.entries()]
      .filter(([, count]) => count >= minRepeat)
      .map(([line]) => line)
  );

  if (repeated.size === 0) return text;
  return lines.filter((line) => !repeated.has(line.trim())).join("\n");
}

// ─── Remoção de cabeçalhos/rodapés SEI ───────────────────────────────────
// Deliberações ARTESP no formato SEI repetem timestamps, números SEI e URLs
// em cada página. Esses textos poluem a extração de campos.
function removeSeiHeadersFooters(text: string): string {
  return text
    // Linha de timestamp + número SEI: "23/01/2026, 09:14 SEI/GESP - 0095528423 - DOE: ..."
    .replace(/\d{2}\/\d{2}\/\d{4},?\s*\d{2}:\d{2}\s+SEI\/GESP\s*-\s*\d+\s*-\s*DOE:[^\n]*/g, "")
    // URLs do SEI no rodapé
    .replace(/https?:\/\/sei\.sp\.gov\.br\/sei\/controlador\.php[^\n]*/g, "")
    // Indicador de página "1/2", "2/2" isolado em linha
    .replace(/^\s*\d+\/\d+\s*$/gm, "")
    // Linha de verificação DOE
    .replace(/Este documento pode ser verificado[^\n]*/g, "")
    .replace(/em https?:\/\/www\.doe\.sp\.gov\.br\/autenticidade[^\n]*/g, "")
    // Assinatura digital MP
    .replace(/Documento assinado digitalmente conforme MP[^\n]*/g, "")
    .replace(/que institui a Infraestrutura de Chaves P[úu]blicas[^\n]*/g, "")
    // Rodapé de paginação "Página N de M" (paginação variável escapa do dedup por frequência).
    .replace(/^.*\bP[áa]gina\s+\d+\s+de\s+\d+\b.*$/gim, "");
}

// ─── Normalização de espaços ──────────────────────────────────────────────
function normalizeWhitespace(text: string): string {
  return text
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    // De-hifenização de quebra de linha: "Conces-\nsionária" → "Concessionária".
    // Só continuação MINÚSCULA → não cola "Diretor-\nGeral" nem hífens de lista.
    .replace(/([A-Za-zÀ-ÿ])-\n([a-zà-ÿ])/g, "$1$2")
    // Zero-width/BOM → remover (quebram o casamento de rótulos como "Assunto:").
    .replace(/[\u200B\u200C\u200D\u2060\uFEFF]/g, "")
    // Espaços unicode visíveis (nbsp, en/em space, narrow nbsp, ideográfico) → espaço comum.
    .replace(/[\u00A0\u2000-\u200A\u202F\u205F\u3000]/g, " ")
    .replace(/[ \t]+/g, " ")          // múltiplos espaços/tabs → um espaço
    .replace(/\n{3,}/g, "\n\n")       // mais de 2 quebras → 2
    .trim();
}

// ─── Validação de tipo via magic bytes ───────────────────────────────────
export function isPdfBuffer(buffer: Buffer): boolean {
  // PDF começa com %PDF-
  return (
    buffer.length >= 5 &&
    buffer[0] === 0x25 && // %
    buffer[1] === 0x50 && // P
    buffer[2] === 0x44 && // D
    buffer[3] === 0x46 && // F
    buffer[4] === 0x2d    // -
  );
}

const PDF_PARSE_TIMEOUT_MS = 25_000; // 25s — deixa margem para o timeout de 60s do Vercel
const MAX_PDF_STREAMS = 500;         // PDFs legítimos raramente têm mais de 500 streams
// Abaixo deste nº de chars/página o PDF é provavelmente escaneado (imagem sem OCR).
export const SCANNED_CHARS_PER_PAGE_THRESHOLD = 80;

// ─── Extração principal ───────────────────────────────────────────────────
export interface PdfExtractionResult {
  text: string;
  pageCount: number;
  charsPerPage: number;
}

export async function extractPdfText(
  buffer: Buffer
): Promise<PdfExtractionResult> {
  if (!isPdfBuffer(buffer)) {
    throw new Error("Arquivo inválido: não é um PDF (magic bytes incorretos)");
  }

  // Proteção básica contra PDF bomb: conta streams no início do arquivo
  // PDFs maliciosos com compressão excessiva têm centenas de streams aninhados
  const sample = buffer.toString("binary", 0, Math.min(buffer.length, 200_000));
  const streamCount = sample.match(/\bstream\b/g)?.length ?? 0;
  if (streamCount > MAX_PDF_STREAMS) {
    throw new Error(
      `PDF rejeitado: ${streamCount} streams detectados (máx ${MAX_PDF_STREAMS}). ` +
      "Possível PDF bomb ou documento corrompido."
    );
  }

  // Timeout de 25s — evita DoS por PDFs malformados que travam o parser
  const data = await Promise.race([
    pdfParse(buffer),
    new Promise<never>((_, reject) =>
      setTimeout(
        () => reject(new Error("Timeout ao processar PDF (>25s). O arquivo pode estar corrompido.")),
        PDF_PARSE_TIMEOUT_MS
      )
    ),
  ]);
  const pageCount = data.numpages;

  // Divide por página para limpeza de cabeçalhos/rodapés
  // pdf-parse não separa por página nativamente — usamos o texto completo
  const rawText = data.text;

  // Aplicar pipeline de limpeza
  let text = fixEncoding(rawText);
  text = removeSeiHeadersFooters(text);
  text = normalizeWhitespace(text);
  text = removeRepeatedLines(text); // remove cabeçalhos/rodapés repetidos por página

  const charsPerPage = pageCount > 0 ? Math.floor(text.length / pageCount) : 0;

  // Se menos de 80 chars/página, o PDF provavelmente é scaneado (imagem)
  // Neste caso retornamos o texto que temos (sem OCR — futura melhoria)
  return { text, pageCount, charsPerPage };
}

// ─── Hash SHA-256 para deduplicação ──────────────────────────────────────
export async function sha256Hex(buffer: Buffer): Promise<string> {
  const hashBuffer = await crypto.subtle.digest("SHA-256", new Uint8Array(buffer));
  return Array.from(new Uint8Array(hashBuffer))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}
