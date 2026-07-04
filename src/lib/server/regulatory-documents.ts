import type { AnttManualDocumentType, Deliberacao, TipoDocumento } from "@/types";
import { parseDataExtensoANM } from "@/lib/server/ata-splitter";

export type ExtendedTipoDocumento = TipoDocumento | "pauta" | "voto_individual" | "documento_apoio";

export interface RegulatoryDocumentClassification {
  tipo_documento: ExtendedTipoDocumento;
  documento_subtipo: string | null;
  import_counts_as_final: boolean;
  warnings: string[];
  semantic_duplicate_key: string | null;
}

export function classifyRegulatoryDocument(input: {
  text: string;
  filename: string;
  tipo_documento: TipoDocumento;
  agencia_sigla?: string | null;
  documento_antt_tipo?: AnttManualDocumentType | null;
  numero_deliberacao?: string | null;
  numero_reuniao?: string | null;
  data_reuniao?: string | null;
  processo?: string | null;
}): RegulatoryDocumentClassification {
  const text = input.text;
  const filename = input.filename;
  const normName = normalize(filename);
  const normText = normalize(text.slice(0, 12_000));
  const warnings: string[] = [];
  let tipo: ExtendedTipoDocumento = input.tipo_documento;
  let subtipo: string | null = input.documento_antt_tipo ?? null;
  let countsAsFinal = true;

  if (input.documento_antt_tipo === "voto_individual" || /\bvoto\s+daa\b/i.test(filename)) {
    tipo = "voto_individual";
    subtipo = input.documento_antt_tipo ?? "voto_individual";
    countsAsFinal = false;
    warnings.push("Voto individual tratado como documento de apoio; nao entra nos dashboards como decisao final.");
  } else if (input.documento_antt_tipo === "pauta" || normName.includes("pauta")) {
    tipo = "pauta";
    subtipo = input.documento_antt_tipo ?? "pauta";
    countsAsFinal = false;
    warnings.push("Pauta tratada como documento de apoio; confirme somente apos revisar a ata/decisao final.");
  } else if (input.documento_antt_tipo && input.documento_antt_tipo !== "outro" && input.documento_antt_tipo !== "ata") {
    tipo = "ata";
    subtipo = input.documento_antt_tipo;
    countsAsFinal = false;
    warnings.push("Reuniao ANTT tratada como envelope de apoio; itens so contam se houver decisao final revisada.");
  }

  if (isArtespDeliberacao(normName, normText)) {
    tipo = "deliberacao";
    subtipo = "artesp_deliberacao";
    countsAsFinal = true;
  }

  if (isAnmPauta(normName, normText)) {
    tipo = "pauta";
    subtipo = "anm_pauta";
    countsAsFinal = false;
    warnings.push("Pauta ANM tratada como documento de apoio; nao entra nos dashboards como decisao final.");
  } else if (isAnmAta(normName, normText) && tipo !== "deliberacao") {
    tipo = "ata";
    subtipo = "anm_ata";
    countsAsFinal = false;
    warnings.push("Ata ANM precisa de revisao dos itens antes de alimentar metricas finais.");
  }

  if (tipo === "ata" && !isArtespDeliberacao(normName, normText)) {
    countsAsFinal = false;
  }

  return {
    tipo_documento: tipo,
    documento_subtipo: subtipo,
    import_counts_as_final: countsAsFinal,
    warnings,
    semantic_duplicate_key: buildSemanticDuplicateKey({
      agencia_sigla: input.agencia_sigla,
      tipo_documento: tipo,
      numero_deliberacao: input.numero_deliberacao,
      numero_reuniao: input.numero_reuniao,
      data_reuniao: input.data_reuniao,
      processo: input.processo,
      filename,
    }),
  };
}

export function isFinalDecisionRecord(row: Pick<Deliberacao, "tipo_documento" | "documento_pai_id" | "resultado" | "raw_extraction">): boolean {
  const raw = row.raw_extraction ?? {};
  if (raw.import_counts_as_final === false) return false;
  const tipo = String(row.tipo_documento ?? "");
  const subtipo = String(raw.documento_subtipo ?? raw.documento_antt_tipo ?? "");

  if (["pauta", "voto_individual", "documento_apoio"].includes(tipo)) return false;
  if (["pauta", "voto_individual", "reuniao_deliberativa_eletronica", "reuniao_diretoria_publica", "reuniao_extraordinaria"].includes(subtipo)) {
    return false;
  }
  if (tipo === "ata") {
    return Boolean(row.documento_pai_id && row.resultado);
  }
  return ["deliberacao", "resolucao", "portaria"].includes(tipo);
}

export function buildSemanticDuplicateKey(input: {
  agencia_sigla?: string | null;
  tipo_documento?: string | null;
  numero_deliberacao?: string | null;
  numero_reuniao?: string | null;
  data_reuniao?: string | null;
  processo?: string | null;
  filename?: string | null;
}) {
  const agency = normalize(input.agencia_sigla ?? "sem-agencia");
  const tipo = normalize(input.tipo_documento ?? "documento");
  const numero = normalize(input.numero_deliberacao ?? input.numero_reuniao ?? "");
  const processo = normalize(input.processo ?? "");
  const data = normalize(input.data_reuniao ?? "");

  if (agency && tipo && numero) return [agency, tipo, numero].join("|");
  if (agency && processo && data) return [agency, tipo, processo, data].join("|");

  const filenameKey = normalize(input.filename ?? "")
    .replace(/\s*\(\d+\)(?=\.pdf$)/, "")
    .replace(/\.pdf$/, "");
  return [agency, tipo, filenameKey].filter(Boolean).join("|") || null;
}

export function extractAnmMeetingMetadata(text: string, filename: string) {
  const head = `${filename}\n${text.slice(0, 8_000)}`;
  const norm = normalize(head);
  if (!norm.includes("anm") && !norm.includes("agencia nacional de mineracao") && !norm.includes("dirc")) {
    return {};
  }

  const numeroMatch =
    /(?:pauta|ata)\s+(?:da\s+)?(\d{1,3})\s*(?:a|ª|o|º)?\s*(?:rop|reuniao)/i.exec(head) ??
    /(\d{1,3})\s*(?:a|ª|o|º)?\s*reuniao\s+(?:ordinaria|extraordinaria)/i.exec(head);
  const tipoMatch = /(reuniao|reunião)\s+(ordinaria|ordinária|extraordinaria|extraordinária)|\b(rop)\b/i.exec(head);
  // A data OFICIAL da reunião vem por EXTENSO na abertura da ata ("Aos dezesseis dias
  // do mês de julho do ano de dois mil e vinte e cinco…"). O fallback numérico varre
  // 8.000 chars e pescava datas de resoluções CITADAS no corpo (data errada → escolhe
  // a composição errada da diretoria) — por isso o extenso tem prioridade.
  const dataExtenso = parseDataExtensoANM(head);
  const dataMatch = dataExtenso
    ? null
    : /(?:data|realizada?\s+em|dia)\s*:?\s*(\d{1,2})\s+de\s+([a-zçãéêíóôõú]+)\s+de\s+(\d{4})/i.exec(head) ??
      /(\d{1,2})\s+de\s+([a-zçãéêíóôõú]+)\s+de\s+(\d{4})/i.exec(head);

  return {
    numero_reuniao: numeroMatch?.[1] ?? null,
    tipo_reuniao: tipoMatch
      ? normalize(tipoMatch[2] ?? tipoMatch[3] ?? "").startsWith("extra")
        ? "Extraordinaria"
        : "Ordinaria"
      : null,
    data_reuniao: dataExtenso ?? (dataMatch ? parseDateExtenso(dataMatch[1], dataMatch[2], dataMatch[3]) : null),
  };
}

export function normalize(value: string): string {
  return value
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

// Só considera o CABEÇALHO (primeiros ~600 chars normalizados): uma ATA da ARTESP
// CITA várias "Deliberação ARTESP nº" no corpo e era reclassificada como deliberação
// (bug pego pelo corpus de certificação — ata 1201ª virou "deliberacao").
function isArtespDeliberacao(normName: string, normText: string) {
  const normHead = normText.slice(0, 600);
  return normName.includes("deliberacao artesp") ||
    /deliberacao\s+artesp\s+n/.test(normHead) ||
    /deliberacao\s+n/.test(normHead) && normHead.includes("artesp");
}

function isAnmPauta(normName: string, normText: string) {
  return normName.includes("pauta") &&
    (normName.includes("rop") || normName.includes("dirc") || normText.includes("agencia nacional de mineracao"));
}

function isAnmAta(normName: string, normText: string) {
  return (normName.includes("ata") || normText.includes("ata da reuniao")) &&
    (normName.includes("dirc") || normText.includes("agencia nacional de mineracao"));
}

function parseDateExtenso(dayRaw: string, monthRaw: string, yearRaw: string) {
  const meses: Record<string, number> = {
    janeiro: 1,
    fevereiro: 2,
    marco: 3,
    março: 3,
    abril: 4,
    maio: 5,
    junho: 6,
    julho: 7,
    agosto: 8,
    setembro: 9,
    outubro: 10,
    novembro: 11,
    dezembro: 12,
  };
  const day = Number(dayRaw);
  const month = meses[monthRaw.toLowerCase()];
  const year = Number(yearRaw);
  if (!day || !month || !year) return null;
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}
