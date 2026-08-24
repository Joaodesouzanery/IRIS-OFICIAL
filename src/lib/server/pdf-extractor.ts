/**
 * pdf-extractor.ts
 * Port de worker/app/pipeline/pdf_reader.py + text_cleaner.py
 * Extrai e limpa texto de PDFs usando pdf-parse (sem API externa).
 */

import pdfParse from "pdf-parse";
import { extractTextViaOcr, isOcrConfigured } from "@/lib/server/ocr";

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
  // Ligadura "ti" corrompida em "7" (fonte com cmap quebrado \u2014 visto em PDF real da
  // ANTT: "Ins7tui\u00e7\u00e3o", "Pol\u00ed7ca"). Entre letras min\u00fasculas, "7" nunca \u00e9 d\u00edgito leg\u00edtimo.
  [/(?<=[a-z\u00e0-\u00fa])7(?=[a-z\u00e0-\u00fa])/g, "ti"],
];

function fixEncoding(text: string): string {
  let result = text;
  for (const [pattern, replacement] of ENCODING_FIXES) {
    result = result.replace(pattern, replacement);
  }
  return result;
}

// ─── Reparo da ligadura "ti", ANCORADO EM VOCABULÁRIO ─────────────────────
// MEDIDO em 16 PDFs oficiais: o caractere que sobra no lugar de "ti" depende da FONTE EMBUTIDA —
// `7` na pauta 1.036, `%` na ata 1.024 e `,` na 264ª RDE. Três documentos da MESMA agência, três
// substitutos diferentes. Uma regra por caractere nunca vai acompanhar isso.
//
// E "qualquer caractere entre minúsculas → ti" também não serve. Medido, destruiria:
//   · a ênclise da ANM   — "devendo-se", "restituiu-lhe", "Trata-se" (33 casos só na 79ª);
//   · as URLs do SEI     — "acao_origem", "id_documento" (29 no voto DAB);
//   · e o caso decisivo  — "exposto,voto" na 32ª (espaço perdido depois da vírgula), que viraria
//     "expostotivoto", corrompendo o dispositivo de um item real.
//
// A saída é INVERTER a âncora: o substituto é curinga, mas o CONTEXTO é um vocabulário FECHADO de
// lemas que contêm "ti". "exposto,voto" não casa lema nenhum e sai intacto; "Delibera,va" casa
// `delibera[X]v` e vira "Deliberativa". Isso também sobrevive a um QUARTO substituto aparecer —
// que é justamente o que aconteceu entre a etapa49 (só `7` conhecido) e a chegada destes PDFs.
//
// A MESMA tabela serve de reparo e de probe: o que não for reparado aparece como aviso, e os dois
// não podem sair de sincronia.
const LIGATURE_TI: Array<{ re: RegExp; fix: string; label: string }> = [
  { re: /\b(subs)[^a-zà-ÿ](tu)/gi,            fix: "$1ti$2", label: "substitu…" },
  { re: /\b(par)[^a-zà-ÿ](cipa)/gi,           fix: "$1ti$2", label: "participa…" },
  { re: /\b(ins)[^a-zà-ÿ](tu)/gi,             fix: "$1ti$2", label: "institu…" },
  { re: /\b(re)[^a-zà-ÿ](rad[oa])/gi,         fix: "$1ti$2", label: "retirad…" },
  { re: /\b(delibera)[^a-zà-ÿ](v)/gi,         fix: "$1ti$2", label: "deliberativ…" },
  { re: /\b(obje)[^a-zà-ÿ](v)/gi,             fix: "$1ti$2", label: "objetiv…" },
  { re: /\b(norma)[^a-zà-ÿ](v)/gi,            fix: "$1ti$2", label: "normativ…" },
  { re: /\b(administra)[^a-zà-ÿ](v)/gi,       fix: "$1ti$2", label: "administrativ…" },
  { re: /\b(transmi)[^a-zà-ÿ](d[oa])/gi,      fix: "$1ti$2", label: "transmitid…" },
  { re: /\b(pol[íi])[^a-zà-ÿ](c)/gi,          fix: "$1ti$2", label: "polític…" },
  { re: /\b(adi)[^a-zà-ÿ](v)/gi,              fix: "$1ti$2", label: "aditiv…" },
  { re: /\b(compar)[^a-zà-ÿ](lhamento)/gi,    fix: "$1ti$2", label: "compartilhamento" },
  { re: /\b(rela)[^a-zà-ÿ](v)/gi,             fix: "$1ti$2", label: "relativ…" },
  { re: /\b(des)[^a-zà-ÿ](na[dr])/gi,         fix: "$1ti$2", label: "destina…" },
  { re: /\b(inves)[^a-zà-ÿ](mento)/gi,        fix: "$1ti$2", label: "investimento" },
  { re: /\b(mo)[^a-zà-ÿ](va)\b/gi,            fix: "$1ti$2", label: "motiva…" },
  { re: /\b(cole)[^a-zà-ÿ](v)/gi,             fix: "$1ti$2", label: "coletiv…" },
  { re: /\b(respec)[^a-zà-ÿ](v)/gi,           fix: "$1ti$2", label: "respectiv…" },
  { re: /\b(compe)[^a-zà-ÿ]{1,2}(v)/gi,       fix: "$1ti$2", label: "competitiv…" },
];

/** Aplica o reparo de ligadura ancorado em vocabulário. Exportado para teste. */
export function repairLigatures(text: string): string {
  let out = text;
  for (const { re, fix } of LIGATURE_TI) {
    re.lastIndex = 0;
    out = out.replace(re, fix);
  }
  return out;
}

const LIGATURE_LEMMAS: [RegExp, string][] = LIGATURE_TI.map(({ re, label }) => [re, label]);

export interface LigatureProbe {
  /** Lemas que continuam quebrados DEPOIS da limpeza (vazio = tudo certo). */
  lemasQuebrados: string[];
  /** Total de ocorrências residuais. */
  ocorrencias: number;
}

export function probeLigatureDefects(cleanText: string): LigatureProbe {
  const lemasQuebrados: string[] = [];
  let ocorrencias = 0;
  for (const [pattern, label] of LIGATURE_LEMMAS) {
    const hits = cleanText.match(pattern);
    if (hits && hits.length > 0) {
      lemasQuebrados.push(label);
      ocorrencias += hits.length;
    }
  }
  return { lemasQuebrados, ocorrencias };
}

// ─── Achatamento para casamento narrativo ────────────────────────────────
// Gatilhos narrativos quebram entre linhas no PDF. Medido na 83ª ROP da ANM:
// "encontrava-se impedido de votar" aparece 3× no texto com quebras e 7× com os espaços
// colapsados — mais da metade dos impedimentos se perderia, e cada um perdido vira um
// "Favorável" FABRICADO pela inferência por mandato.
// ⚠️ NUNCA aplicar ao texto que o ata-splitter segmenta: a segmentação depende de âncoras
// `^`/`$` multiline (item numerado, "DELIBERAÇÃO:", cabeçalho de seção) e achatar o documento
// inteiro as destruiria. O uso correto é sobre a JANELA de um item já recortado.
export function flattenForMatch(text: string): string {
  return text.replace(/\s+/g, " ");
}

// ─── Remoção de linhas muito repetidas (cabeçalhos/rodapés) ─────────────
// pdf-parse não separa por página, então trabalhamos sobre o texto completo.
// Linhas que aparecem 3+ vezes no documento são provavelmente cabeçalho/rodapé.
// EXCEÇÃO (bug pego pelo corpus real): linhas DECISÓRIAS padronizadas repetem-se de
// verdade — a ata 82ª da ANM tem "DELIBERAÇÃO: Voto aprovado por unanimidade pelos
// diretores presentes." 28×, uma por item. Apagá-las destruía o voto de quase todos
// os itens. Conteúdo decisório nunca é tratado como cabeçalho/rodapé.
const DECISION_LINE_RE = /DELIBERA[ÇC][AÃ]O|DECIS[AÃ]O|\bVOTO\b|APROVAD|INDEFERID|DEFERID|unanimidade|RETIRAD[OA]\s+DE\s+PAUTA/i;

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
      .filter(([line]) => !DECISION_LINE_RE.test(line))
      .map(([line]) => line)
  );

  if (repeated.size === 0) return text;
  return lines.filter((line) => !repeated.has(line.trim())).join("\n");
}

// ─── Remoção de cabeçalhos/rodapés SEI ───────────────────────────────────
// Deliberações ARTESP no formato SEI repetem timestamps, números SEI e URLs
// em cada página. Esses textos poluem a extração de campos.
/**
 * Protocolo SEI do PRÓPRIO documento, do rodapé federal (etapa65):
 *   "Ata 83ª Reunião Ordinária Pública da DIRC (19543269)  SEI 48051.003447/2026-17 / pg. 1"
 *
 * Medido nas 16 fixtures: ANM e ANTT carimbam esse rodapé, e o ano dele é IGUAL ao ano da reunião
 * em 9/9 dos documentos que o têm — não é um limite, é uma igualdade, sinal muito mais forte que
 * qualquer heurística sobre o número do processo. A ARTESP não tem o rodapé (devolve `null`, e o
 * validador fica silencioso lá em vez de inventar).
 *
 * ⚠️ Só pode ser chamado ANTES de `removeSeiHeadersFooters`, que apaga esta linha.
 */
export function extractProtocoloSei(text: string): string | null {
  const m = /\bSEI\s+(\d{5}\.\d{6}\/(?:19|20)\d{2}-\d{2})\s*\/\s*pg\./i.exec(text);
  return m?.[1] ?? null;
}

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
    .replace(/^.*\bP[áa]gina\s+\d+\s+de\s+\d+\b.*$/gim, "")
    // Rodapé do SEI federal (ANM/ANTT), no MEIO do fluxo de texto:
    //   "Ata 82ª Reunião Ordinária Pública da DIRC (19151138)   SEI 48051.002035/2026-51 / pg. 1"
    //   "Pauta da Reunião de Diretoria 43562478   SEI 50500.040179/2026-12 / pg. 1"
    // Medido no corpus: 12 linhas na 82ª, 19 na 32ª, 2 na pauta ANTT, 0 na ARTESP. A paginação
    // muda a cada linha, então o rodapé ESCAPA do dedup por frequência (removeRepeatedLines exige
    // igualdade exata 3×) e era injetado entre as frases do item — partindo palavras e truncando
    // a janela do "VOTO:", que fecha na primeira linha iniciada por maiúscula.
    .replace(/^[^\n]*\bSEI\s+[\d.]+\/\d{4}-\d{2}\s*\/\s*pg\.\s*\d+[^\n]*$/gim, "");
}

// ─── Normalização de espaços ──────────────────────────────────────────────
function normalizeWhitespace(text: string): string {
  return text
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    // De-hifenização de quebra de linha: "Conces-\nsionária" → "Concessionária".
    // Só continuação MINÚSCULA → não cola "Diretor-\nGeral" nem hífens de lista.
    .replace(/([A-Za-zÀ-ÿ])-\n([a-zà-ÿ])/g, "$1$2")
    // Continuação MAIÚSCULA: remove só a QUEBRA e PRESERVA o hífen. Medido no corpus real, 100%
    // dos casos são siglas ou compostos — "SDM-\nJA", "PFE-\nANM" (32ª), "IP-\nBIM" (ARTESP),
    // "Diretor-\nGeral" — e colar sem hífen destruiria todos. Também conserta o dispositivo
    // "NEGAR-\nLHE PROVIMENTO", que sem isto some da classificação de resultado.
    .replace(/([A-Za-zÀ-ÿ])-\n([A-ZÀ-ÖØ-Þ])/g, "$1-$2")
    // Espaço PERDIDO antes de substantivo de cargo: o pdf-parse cola a última palavra da linha na
    // primeira da seguinte ("presidida peloDiretor-Geral, Mauro…", "presençadoDiretor Substituto").
    // Medido: 4 colagens em TODO o corpus — 2 reais (ambas no preâmbulo da 82ª, ambas impedindo a
    // resolução cargo→nome) e 2 do "YouTube" de uma URL. Por isso a regra é ENUMERADA e não
    // `[a-z][A-Z]` genérico: separar por classe partiria "YouTube" e, pior, nomes de empresa
    // (EcoRodovias, ViaOeste, AutoBAn), quebrando o casamento por empresa.
    .replace(
      /([a-zà-ÿ])(?=(?:Diretor(?:a|ia|es)?|Conselheir[oa]s?|Relator[a]?|Revisor[a]?|Procurador[a]?|Secret[áa]ri[oa]|Ouvidor[a]?|Superintendente|Presidente)\b)/g,
      "$1 ",
    )
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
  ocrApplied?: boolean;
  /**
   * Preenchido só quando a limpeza de ligadura falhou (fonte nova na origem). Quem chama
   * transforma em warning de qualidade — o documento continua sendo processado, mas com o
   * defeito visível em vez de silencioso.
   */
  ligatureWarning?: string;
  /**
   * Protocolo SEI do PRÓPRIO documento, capturado do rodapé ANTES da limpeza (etapa65). `null`
   * quando a agência não usa esse rodapé (ARTESP). O ano dele bate com o ano da reunião em 9/9
   * das fixtures que o têm — é o validador de data mais forte disponível de graça.
   */
  protocoloSei?: string | null;
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
  // ⚠️ ORDEM: o protocolo do PRÓPRIO documento é lido ANTES da limpeza — `removeSeiHeadersFooters`
  // apaga exatamente a linha que o carrega (etapa65).
  const protocoloSei = extractProtocoloSei(text);
  text = removeSeiHeadersFooters(text);
  text = normalizeWhitespace(text);
  // DEPOIS da normalização de espaços: a de-hifenização já juntou o que o PDF quebrou, então o
  // lema chega inteiro para o reparo de ligadura casar.
  text = repairLigatures(text);
  text = removeRepeatedLines(text); // remove cabeçalhos/rodapés repetidos por página

  let charsPerPage = pageCount > 0 ? Math.floor(text.length / pageCount) : 0;

  // Se menos de 80 chars/página, o PDF provavelmente é escaneado (imagem). Tentamos
  // OCR externo (OCR.space) SE configurado (OCR_SPACE_API_KEY); senão, retornamos o
  // que temos (documento segue sinalizado como escaneado na análise, com aviso).
  let ocrApplied = false;
  if (charsPerPage < SCANNED_CHARS_PER_PAGE_THRESHOLD && isOcrConfigured()) {
    const ocrText = await extractTextViaOcr(buffer);
    if (ocrText && ocrText.length > Math.max(200, text.length * 1.5)) {
      text = repairLigatures(removeRepeatedLines(normalizeWhitespace(removeSeiHeadersFooters(fixEncoding(ocrText)))));
      charsPerPage = pageCount > 0 ? Math.floor(text.length / pageCount) : text.length;
      ocrApplied = true;
    }
  }

  // Probe roda por último, sobre o texto FINAL (inclusive o do OCR): é o estado que o parser
  // vai ver. Vazio na esmagadora maioria dos casos — quando não estiver, a fonte mudou.
  const probe = probeLigatureDefects(text);
  const ligatureWarning = probe.lemasQuebrados.length > 0
    ? `Ligadura não reparada na extração (${probe.ocorrencias} ocorrência(s): ` +
      `${probe.lemasQuebrados.join(", ")}). A fonte embutida do PDF provavelmente mudou — ` +
      "o roster, a retirada de pauta e o cargo exercido podem não ser lidos; revisar."
    : undefined;

  return { text, pageCount, charsPerPage, ocrApplied, ligatureWarning, protocoloSei };
}

// ─── Hash SHA-256 para deduplicação ──────────────────────────────────────
export async function sha256Hex(buffer: Buffer): Promise<string> {
  const hashBuffer = await crypto.subtle.digest("SHA-256", new Uint8Array(buffer));
  return Array.from(new Uint8Array(hashBuffer))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}
