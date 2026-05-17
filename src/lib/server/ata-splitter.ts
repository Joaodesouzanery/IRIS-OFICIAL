/**
 * ata-splitter.ts
 * Divide o texto de uma Ata de Reunião Pública (ANM e similares)
 * em items individuais, cada um representando uma deliberação.
 *
 * Formatos suportados:
 *   - Romano: "I- Processo: ...", "II- Processo: ..."
 *   - Numerado: "1.1.1. Processo nº ...", "1.2.3. Processo nº ..."
 *   - Misto: ambos em um mesmo documento
 */

import type { TipoDocumento } from "@/types";

// ─── Detecção de tipo de documento ──────────────────────────────────────
export function detectDocumentType(text: string): TipoDocumento {
  if (/ATA\s+\d+[ªa°º]?\s*REUNI[AÃ]O/i.test(text)) return "ata";
  if (/DELIBERA[ÇC][AÃ]O\s*(?:ARTESP\s*)?N[ºo°]/i.test(text)) return "deliberacao";
  if (/RESOLU[ÇC][AÃ]O\s*N[ºo°]/i.test(text)) return "resolucao";
  if (/PORTARIA\s*N[ºo°]/i.test(text)) return "portaria";
  return "deliberacao";
}

// ─── Item de ata extraído ───────────────────────────────────────────────
export interface AtaItem {
  item_numero: string;          // "I", "II", "1.1.1", etc.
  processo: string | null;
  assunto: string | null;
  interessado: string | null;
  relator: string | null;
  decisao: string | null;       // texto completo da decisão
  resultado: string | null;     // normalizado: "Aprovado", "Indeferido", etc.
  unanimidade: boolean;
  raw_text: string;             // texto bruto do item
}

// ─── Metadados globais da ata ───────────────────────────────────────────
export interface AtaMetadata {
  numero_reuniao: string | null;
  tipo_reuniao: "Ordinaria" | "Extraordinaria" | null;
  data_reuniao: string | null;   // ISO: "YYYY-MM-DD"
  agencia_nome: string | null;   // ex: "Agência Nacional de Mineração"
  signatarios: string[];
}

// ─── Números por extenso → dígito ──────────────────────────────────────
const NUMEROS_EXTENSO: Record<string, number> = {
  um: 1, uma: 1, dois: 2, duas: 2, três: 3, tres: 3, quatro: 4,
  cinco: 5, seis: 6, sete: 7, oito: 8, nove: 9, dez: 10,
  onze: 11, doze: 12, treze: 13, quatorze: 14, catorze: 14,
  quinze: 15, dezesseis: 16, dezessete: 17, dezoito: 18,
  dezenove: 19, vinte: 20, "vinte e um": 21, "vinte e uma": 21,
  "vinte e dois": 22, "vinte e duas": 22, "vinte e três": 23,
  "vinte e tres": 23, "vinte e quatro": 24, "vinte e cinco": 25,
  "vinte e seis": 26, "vinte e sete": 27, "vinte e oito": 28,
  "vinte e nove": 29, trinta: 30, "trinta e um": 31,
  primeiro: 1, segundo: 2, terceiro: 3, quarto: 4, quinto: 5,
  sexto: 6, sétimo: 7, setimo: 7, oitavo: 8, nono: 9, décimo: 10, decimo: 10,
};

const MESES_EXTENSO: Record<string, number> = {
  janeiro: 1, fevereiro: 2, março: 3, marco: 3, abril: 4,
  maio: 5, junho: 6, julho: 7, agosto: 8,
  setembro: 9, outubro: 10, novembro: 11, dezembro: 12,
};

const ANOS_EXTENSO: Record<string, number> = {
  "dois mil e dezenove": 2019, "dois mil e vinte": 2020,
  "dois mil e vinte e um": 2021, "dois mil e vinte e dois": 2022,
  "dois mil e vinte e três": 2023, "dois mil e vinte e tres": 2023,
  "dois mil e vinte e quatro": 2024, "dois mil e vinte e cinco": 2025,
  "dois mil e vinte e seis": 2026, "dois mil e vinte e sete": 2027,
  "dois mil e dezoito": 2018, "dois mil e dezessete": 2017,
  "dois mil e dezesseis": 2016,
};

/**
 * Parseia data no formato ANM por extenso:
 * "Aos dezenove dias do mês de fevereiro do ano de dois mil e dezenove"
 */
export function parseDataExtensoANM(text: string): string | null {
  const re = /[Aa]os?\s+(.+?)\s+dias?\s+do\s+m[eê]s\s+de\s+(\w+)\s+do\s+ano\s+de\s+(.+?)(?:[,.]|\s+[,.]|\s+às)/i;
  const match = re.exec(text);
  if (!match) return null;

  const diaRaw = match[1].toLowerCase().trim();
  const mesRaw = match[2].toLowerCase().trim();
  const anoRaw = match[3].toLowerCase().trim();

  const dia = NUMEROS_EXTENSO[diaRaw] ?? parseInt(diaRaw, 10);
  const mes = MESES_EXTENSO[mesRaw];
  const ano = ANOS_EXTENSO[anoRaw] ?? parseInt(anoRaw, 10);

  if (!dia || !mes || !ano || dia < 1 || dia > 31 || ano < 1990) return null;
  return `${ano}-${String(mes).padStart(2, "0")}-${String(dia).padStart(2, "0")}`;
}

// ─── Extração de metadados globais da ata ───────────────────────────────
export function extractAtaMetadata(text: string): AtaMetadata {
  // Número da reunião: "ATA 1ª REUNIÃO" ou "ATA 3ª REUNIÃO"
  const reNumero = /ATA\s+(\d+)[ªa°º]?\s*REUNI[AÃ]O/i;
  const numero_reuniao = reNumero.exec(text)?.[1] ?? null;

  // Tipo: Ordinária ou Extraordinária
  const reTipo = /REUNI[AÃ]O\s+(ORDIN[AÁ]RIA|EXTRAORDIN[AÁ]RIA)/i;
  const tipoMatch = reTipo.exec(text);
  let tipo_reuniao: "Ordinaria" | "Extraordinaria" | null = null;
  if (tipoMatch) {
    tipo_reuniao = tipoMatch[1].toLowerCase().startsWith("extraordin")
      ? "Extraordinaria" : "Ordinaria";
  }

  // Data: formato extenso ANM
  const data_reuniao = parseDataExtensoANM(text);

  // Nome da agência
  const reAgencia = /(?:AG[ÊE]NCIA\s+NACIONAL\s+DE\s+\w+(?:\s+\w+)?)/i;
  const agencia_nome = reAgencia.exec(text)?.[0] ?? null;

  // Signatários: formato "Nome - Cargo" (ANM) e "Nome\nCargo" (ARTESP)
  const signatarios: string[] = [];
  // Formato ANM: "Nome - Diretor(a)"
  const reSignDash = /^\s*([A-ZÁÉÍÓÚÂÊÔÃÕÇÀÜ][a-záéíóúâêôãõçàü\s]+)\s*[-–]\s*(?:Diretor[a]?(?:[- ]Geral)?(?:\s*Substitut[oa])?|Conselheiro|Presidente)/gm;
  // Remove bloco de assinatura eletrônica antes
  const textSemSEI = text.replace(/Documento assinado eletronicamente[\s\S]*?(?=A autenticidade|$)/g, "");

  let sig: RegExpExecArray | null;
  while ((sig = reSignDash.exec(textSemSEI)) !== null) {
    const nome = sig[1].trim();
    if (nome.length > 4 && !signatarios.includes(nome)) signatarios.push(nome);
  }

  return { numero_reuniao, tipo_reuniao, data_reuniao, agencia_nome, signatarios };
}

// ─── Split da ata em items ──────────────────────────────────────────────

// Padrões de separação de items
// Formato romano: "I- Processo:", "II- Processo:", "XIII- Processo:"
const RE_ITEM_ROMANO = /^(?:([IVXLC]+)\s*[-–.])\s*/;
// Formato numerado: "1.1.1.", "1.2.3.", "2.4.1."
const RE_ITEM_NUMERADO = /^(\d+\.\d+(?:\.\d+)?)\s*[.)]?\s*/;
// Processo isolado com número romano prefixo: "I- Processo: 27214-848248/2014"
const RE_PROCESSO_LINE = /Processo(?:\s*n[ºo°]?)?\s*:?\s*([\d][\d\.\-\/]+)/i;

/**
 * Divide o texto de uma ata em items individuais.
 * Cada item corresponde a um processo/deliberação.
 */
export function splitAtaItems(text: string): AtaItem[] {
  const lines = text.split("\n");
  const items: AtaItem[] = [];
  let currentItem: { numero: string; lines: string[] } | null = null;

  // Fase 1: Segmentar por marcadores de item
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) {
      if (currentItem) currentItem.lines.push("");
      continue;
    }

    // Tenta detectar início de novo item
    let itemStart = false;
    let itemNumero = "";

    // Formato romano: "I- Processo:" ou "VII- Processo:"
    const romanoMatch = RE_ITEM_ROMANO.exec(trimmed);
    if (romanoMatch && /processo|assunto|aprova[çc]/i.test(trimmed)) {
      itemStart = true;
      itemNumero = romanoMatch[1];
    }

    // Formato numerado: "1.1.1. Processo nº" ou "2.3.1. Processo nº"
    if (!itemStart) {
      const numMatch = RE_ITEM_NUMERADO.exec(trimmed);
      if (numMatch && /processo|interessado|assunto/i.test(trimmed)) {
        itemStart = true;
        itemNumero = numMatch[1];
      }
    }

    if (itemStart) {
      // Salva item anterior se existir
      if (currentItem && currentItem.lines.length > 0) {
        const parsed = parseAtaItem(currentItem.numero, currentItem.lines.join("\n"));
        if (parsed) items.push(parsed);
      }
      currentItem = { numero: itemNumero, lines: [trimmed] };
    } else if (currentItem) {
      currentItem.lines.push(trimmed);
    }
  }

  // Último item
  if (currentItem && currentItem.lines.length > 0) {
    const parsed = parseAtaItem(currentItem.numero, currentItem.lines.join("\n"));
    if (parsed) items.push(parsed);
  }

  return normalizeNumericAtaHierarchy(items);
}

// ─── Parser de item individual ──────────────────────────────────────────

function parseAtaItem(numero: string, rawText: string): AtaItem | null {
  // Processo
  const processoMatch = RE_PROCESSO_LINE.exec(rawText);
  const processo = processoMatch?.[1]?.trim() ?? null;

  // Assunto
  const reAssunto = /Assunto:\s*([\s\S]+?)(?=\n\s*(?:Processo|Interessad[oa]|Relat(?:or|ora)|VOTO|Decis[aã]o)\b|$)/i;
  const assunto = cleanAtaField(reAssunto.exec(rawText)?.[1]) ?? null;

  // Interessado(a)
  const reInteressado = /Interessad[oa]\(?a?\)?\s*:\s*([\s\S]+?)(?=\n\s*(?:Relat(?:or|ora)|VOTO|Decis[aã]o|Processo)\b|$)/i;
  const interessado = cleanAtaField(reInteressado.exec(rawText)?.[1]) ?? null;

  // Relator(a)
  const reRelator = /Relat(?:or|ora)\s*:\s*(?:Diretor[a]?(?:[- ]Geral)?\s+)?([^.]+)/i;
  const relator = reRelator.exec(rawText)?.[1]?.trim() ?? null;

  // Decisão (texto completo)
  const reDecisao = /Decis[aã]o:\s*([\s\S]+?)(?=\bVoto:|$)/i;
  const decisao = reDecisao.exec(rawText)?.[1]?.trim() ?? null;

  // Resultado / Voto
  const reVoto = /Voto:\s*([\s\S]+?)(?=\n[A-Z]|\n\d|$)/i;
  const votoText = reVoto.exec(rawText)?.[1]?.trim() ?? null;

  let resultado: string | null = null;
  const unanimidade = /unanimidade/i.test(rawText);

  if (votoText) {
    if (/aprovad[oa]/i.test(votoText)) resultado = "Aprovado";
    else if (/indeferid[oa]|negad[oa]|improcedente|não\s+dar\s+provimento|negar\s+provimento/i.test(votoText)) resultado = "Indeferido";
    else if (/deferido|provimento/i.test(votoText)) resultado = "Deferido";
    else if (/retirad[oa]\s+de\s+pauta/i.test(rawText)) resultado = "Retirado de Pauta";
  }

  if (!resultado) {
    resultado = inferResultadoFromText(decisao ?? rawText, unanimidade);
  }

  // Pular items sem conteúdo útil (ex: "Aprovação das atas")
  if (!processo && !assunto && !interessado && !decisao) return null;

  return {
    item_numero: numero,
    processo,
    assunto,
    interessado,
    relator,
    decisao,
    resultado,
    unanimidade,
    raw_text: rawText,
  };
}

function normalizeNumericAtaHierarchy(items: AtaItem[]): AtaItem[] {
  const parentSubjects = new Map<string, string>();
  const parentDecisions = new Map<string, string>();
  const normalized: AtaItem[] = [];

  for (const item of items) {
    if (isNumericParentHeader(item)) {
      if (item.assunto) parentSubjects.set(item.item_numero, item.assunto);
      if (item.decisao) parentDecisions.set(item.item_numero, item.decisao);
      continue;
    }

    const parentKey = findParentKey(item.item_numero);
    const inheritedSubject = parentKey ? parentSubjects.get(parentKey) : undefined;
    const inheritedDecision = parentKey ? parentDecisions.get(parentKey) : undefined;

    const merged: AtaItem = {
      ...item,
      assunto: item.assunto ?? inheritedSubject ?? null,
      decisao: item.decisao ?? inheritedDecision ?? null,
      raw_text: inheritedSubject && !item.raw_text.includes(inheritedSubject)
        ? `${inheritedSubject}\n${item.raw_text}`
        : item.raw_text,
    };

    if (!merged.resultado && merged.decisao) {
      merged.resultado = inferResultadoFromText(merged.decisao, merged.unanimidade);
    }

    if (merged.processo || merged.assunto || merged.interessado || merged.decisao) {
      normalized.push(merged);
    }
  }

  return normalized;
}

function isNumericParentHeader(item: AtaItem): boolean {
  return /^\d+\.\d+$/.test(item.item_numero) && !item.processo && !!item.assunto;
}

function findParentKey(itemNumero: string): string | null {
  const match = /^(\d+\.\d+)\.\d+$/.exec(itemNumero);
  return match?.[1] ?? null;
}

function inferResultadoFromText(text: string, unanimidade: boolean): string | null {
  if (/retirad[oa]\s+de\s+pauta|pediu\s+vistas|voto\s+vistas|sobrest/i.test(text)) {
    return "Retirado de Pauta";
  }
  if (/indeferid[oa]|negad[oa]|improcedente|n[aã]o\s+dar\s+provimento|negar\s+provimento/i.test(text)) {
    return "Indeferido";
  }
  if (/deferid[oa]|dar\s+provimento|provimento\s+ao/i.test(text)) {
    return "Deferido";
  }
  if (/aprovad[oa]/i.test(text) || unanimidade) {
    return unanimidade ? "Aprovado por Unanimidade" : "Aprovado";
  }
  return null;
}

function cleanAtaField(value: string | undefined): string | null {
  if (!value) return null;
  const cleaned = value
    .replace(/\s+/g, " ")
    .replace(/\bVOTO\s*:.*$/i, "")
    .replace(/\bRelat(?:or|ora)\s*:.*$/i, "")
    .replace(/\bDecis[aã]o\s*:.*$/i, "")
    .trim()
    .replace(/[;,.]\s*$/, "");
  return cleaned.length >= 3 ? cleaned : null;
}
