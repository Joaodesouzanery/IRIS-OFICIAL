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

  // Rede de segurança por FILENAME p/ QUALQUER iniciais de diretor ANTT (antes só DAA hardcoded;
  // "Voto DFQ 035-2026" escapava e virava documento_apoio genérico). QA ago/2026.
  if (input.documento_antt_tipo === "voto_individual" || /\bvoto[\s_-]+(?:vista[\s_-]+)?d[a-z]{1,2}\b/i.test(filename)) {
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

  // Nota de RETIFICAÇÃO do DOE ("Onde se lê / Leia-se") — corrige dados de uma
  // deliberação já publicada, NÃO é uma decisão. O cabeçalho contém "DELIBERAÇÃO ARTESP
  // Nº X", então sem esta guarda o isArtespDeliberacao a contaria como decisão final (e o
  // roster de 1 signatário não-diretor não geraria voto, mas o count inflaria). Precede e
  // desliga a classificação de deliberação.
  const retificacao = isRetificacaoPublicacao(normName, normText);
  if (retificacao) {
    tipo = "documento_apoio";
    subtipo = "retificacao";
    countsAsFinal = false;
    warnings.push("Retificação de publicação do DOE: corrige uma deliberação; não conta como decisão final nem gera voto.");
  }

  if (!retificacao && isArtespDeliberacao(normName, normText)) {
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

// Sub-select PostgREST das 3 sub-chaves do raw_extraction que este predicado usa — para as
// rotas de analytics selecionarem SÓ isso em vez do JSON inteiro de todas as linhas.
// Uso: `.select(\`...outras colunas..., ${FINAL_DECISION_RAW_SELECT}\`)`.
export const FINAL_DECISION_RAW_SELECT =
  "import_counts_as_final:raw_extraction->import_counts_as_final,documento_subtipo:raw_extraction->>documento_subtipo,documento_antt_tipo:raw_extraction->>documento_antt_tipo";

type FinalDecisionRow = {
  tipo_documento?: string | null;
  documento_pai_id?: string | null;
  resultado?: string | null;
  // Formato completo (raw_extraction inteiro) OU achatado (sub-select acima). O predicado
  // aceita os dois: se raw_extraction vier projetado, lê dele; senão, dos campos achatados.
  raw_extraction?: Record<string, unknown> | null;
  import_counts_as_final?: unknown;
  documento_subtipo?: unknown;
  documento_antt_tipo?: unknown;
};

export function isFinalDecisionRecord(row: FinalDecisionRow): boolean {
  const hasRaw = row.raw_extraction != null;
  const raw = (row.raw_extraction ?? {}) as Record<string, unknown>;
  const importCountsAsFinal = hasRaw ? raw.import_counts_as_final : row.import_counts_as_final;
  if (importCountsAsFinal === false) return false;
  const tipo = String(row.tipo_documento ?? "");
  const subtipo = String(
    (hasRaw
      ? (raw.documento_subtipo ?? raw.documento_antt_tipo)
      : (row.documento_subtipo ?? row.documento_antt_tipo)) ?? "",
  );

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

/**
 * Ju\u00edzo do dispositivo: M\u00c9RITO (padr\u00e3o) ou ADMISSIBILIDADE (etapa54).
 *
 * "N\u00c3O CONHECER do recurso, por intempestividade" n\u00e3o julga o pedido \u2014 julga se ele podia sequer
 * ser apreciado. Mape\u00e1-lo para "Indeferido", como se fazia, mistura duas coisas distintas na mesma
 * conta: a `taxa_deferimento` passa a medir prazo processual junto com jurisprud\u00eancia. S\u00f3 na 83\u00aa
 * ROP s\u00e3o 10 itens de n\u00e3o-conhecimento.
 *
 * Devolve `null` (= m\u00e9rito) sempre que houver d\u00favida, inclusive quando o MESMO dispositivo tamb\u00e9m
 * julga o m\u00e9rito ("n\u00e3o conhecer \u2026 e, no m\u00e9rito, negar provimento"): a\u00ed existe ju\u00edzo de m\u00e9rito e
 * ele prevalece. `CONHECER` isolado \u00e9 pr\u00e9-requisito do m\u00e9rito, nunca desfecho \u2014 n\u00e3o vira resultado.
 */
export function detectJuizo(text: string): "admissibilidade" | null {
  const flat = text.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
  if (!/\bnao\s+(?:se\s+)?conhec(?:er|e|eu|ida?|ido|imento)\b|\bnao\s+conhecimento\b/.test(flat)) {
    return null;
  }
  if (/\bno\s+merito\b|\bprovimento\b|\bindefer|\bdefer/.test(flat)) return null;
  return "admissibilidade";
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

// Nota de retificação do DOE. Específica ("retificacao da publicacao"): NÃO casa com
// "Rerratificação"/"retifica" que aparecem no ASSUNTO de deliberações reais (ex.: Nº 32,
// "1º Termo de Rerratificação ao 10º TAM"). O "onde se le/leia se" é corroboração.
function isRetificacaoPublicacao(normName: string, normText: string) {
  const normHead = normText.slice(0, 600);
  return normHead.includes("retificacao da publicacao") ||
    (normName.includes("retificacao") && normHead.includes("onde se le") && normHead.includes("leia se"));
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
