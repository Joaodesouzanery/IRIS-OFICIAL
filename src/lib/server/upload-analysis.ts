import type { PreviewResult } from "@/types";
import { classifyAreaRegulatoria } from "@/lib/server/area-regulatoria";
import { detectDocumentType, extractAtaMetadata, splitAtaItems } from "@/lib/server/ata-splitter";
import { classifyMicrotema, classifyPautaInterna, detectAgenciaSigla } from "@/lib/server/classifier";
import { extractFields, calcConfidence } from "@/lib/server/nlp-extractor";
import { parseAnttManualDocument } from "@/lib/server/antt-manual-parser";
import { extractPdfText, isPdfBuffer, sha256Hex } from "@/lib/server/pdf-extractor";
import { classifyRegulatoryDocument, extractAnmMeetingMetadata } from "@/lib/server/regulatory-documents";
import {
  buildVoteSuggestions,
  getActiveDiretoresForVote,
  shouldInferVotesFromMandate,
  type DiretorVoteRecord,
} from "@/lib/server/vote-inference";

export type UploadAnalysisAgency = { id: string; sigla: string };

export type UploadAnalysisDb = {
  from: (table: string) => {
    select: (columns: string) => any;
  };
};

export type UploadAnalysisInput = {
  name: string;
  buffer: Buffer;
  source_archive?: string | null;
  size: number;
};

export async function analyzeUploadPdf(input: {
  file: UploadAnalysisInput;
  agencias: UploadAnalysisAgency[];
  db?: any | null;
  currentDocumentoId?: string | null;
  currentUploadJobId?: string | null;
}): Promise<PreviewResult> {
  const { file, agencias, db, currentDocumentoId = null, currentUploadJobId = null } = input;

  if (!isPdfBuffer(file.buffer)) {
    return {
      ...errorResult(file.name),
      error: file.source_archive
        ? `Entrada do ZIP ${file.source_archive} nao e um PDF valido`
        : "Arquivo invalido: nao e um PDF valido",
    };
  }

  const file_hash = await sha256Hex(file.buffer);
  let is_duplicate = false;
  let duplicate_job_id: string | null = null;

  if (db) {
    const { data: existingDoc } = await db
      .from("documentos_regulatorios")
      .select("id, upload_job_id, status")
      .eq("file_hash", file_hash)
      .maybeSingle();

    if (existingDoc && existingDoc.id !== currentDocumentoId && existingDoc.status === "confirmed") {
      is_duplicate = true;
      duplicate_job_id = (existingDoc.upload_job_id as string | null) ?? (existingDoc.id as string);
    } else {
      const { data: existingJob } = await db
        .from("upload_jobs")
        .select("id, status")
        .eq("file_hash", file_hash)
        .maybeSingle();
      if (existingJob && existingJob.id !== currentUploadJobId && existingJob.status === "done") {
        is_duplicate = true;
        duplicate_job_id = existingJob.id as string;
      }
    }
  }

  let extraction: Awaited<ReturnType<typeof extractPdfText>>;
  try {
    extraction = await extractPdfText(file.buffer);
  } catch {
    return {
      ...errorResult(file.name, file_hash),
      error: "Falha ao extrair texto do PDF",
    };
  }

  if (!extraction.text || extraction.text.length < 50) {
    return {
      ...errorResult(file.name, file_hash),
      error: "PDF sem texto extraivel. Possivel documento digitalizado.",
      page_count: extraction.pageCount,
    };
  }

  let tipo_documento = detectDocumentType(extraction.text);
  const fields = extractFields(extraction.text);
  const antt = parseAnttManualDocument(extraction.text, file.name);
  if (antt.isAntt) {
    Object.assign(fields, withoutUndefined(antt.fields as Record<string, unknown>));
    if (antt.fields.tipo_documento) tipo_documento = antt.fields.tipo_documento;
  }

  let { microtema } = classifyMicrotema(extraction.text);
  let area_regulatoria = classifyAreaRegulatoria(extraction.text);
  let confidence = calcConfidence(fields);
  if (antt.isAntt) confidence = Math.max(confidence, antt.confidenceBoost);

  let agencia_sigla_detected = detectAgenciaSigla(extraction.text, agencias.map((a) => a.sigla));
  if (antt.isAntt) agencia_sigla_detected = "ANTT";
  const agencia_id_detected = agencia_sigla_detected
    ? agencias.find((a) => a.sigla === agencia_sigla_detected)?.id ?? null
    : null;
  const diretoresList = await getDiretoresList(db, agencia_id_detected);

  const pauta_interna = antt.isAntt
    ? Boolean(antt.fields.pauta_interna)
    : fields.pauta_interna || classifyPautaInterna(extraction.text, fields.interessado, agencia_sigla_detected);

  const regulatoryClass = classifyRegulatoryDocument({
    text: extraction.text,
    filename: file.name,
    tipo_documento,
    agencia_sigla: agencia_sigla_detected,
    documento_antt_tipo: antt.documentType,
    numero_deliberacao: fields.numero_deliberacao,
    numero_reuniao: fields.numero_reuniao,
    data_reuniao: fields.data_reuniao,
    processo: fields.processo,
  });
  tipo_documento = regulatoryClass.tipo_documento;

  const documentWarnings = [
    ...(antt.isAntt ? antt.warnings : []),
    ...regulatoryClass.warnings,
  ];
  if (!regulatoryClass.import_counts_as_final) confidence = Math.min(confidence, 0.72);

  if (agencia_sigla_detected === "ANM" || regulatoryClass.documento_subtipo?.startsWith("anm_")) {
    const anmMeta = extractAnmMeetingMetadata(extraction.text, file.name);
    if (anmMeta.numero_reuniao && !fields.numero_reuniao) fields.numero_reuniao = anmMeta.numero_reuniao;
    if (anmMeta.tipo_reuniao && !fields.tipo_reuniao) fields.tipo_reuniao = anmMeta.tipo_reuniao;
    if (anmMeta.data_reuniao) fields.data_reuniao = anmMeta.data_reuniao;
  }

  let semantic_duplicate = false;
  if (db && !is_duplicate) {
    if (fields.numero_deliberacao && agencia_id_detected) {
      const { data: existingDelib } = await db
        .from("deliberacoes")
        .select("id")
        .eq("numero_deliberacao", fields.numero_deliberacao)
        .eq("agencia_id", agencia_id_detected)
        .maybeSingle();
      if (existingDelib) semantic_duplicate = true;
    }

    if (!semantic_duplicate && fields.data_reuniao && agencia_id_detected && fields.interessado) {
      const { data: existingByDate } = await db
        .from("deliberacoes")
        .select("id")
        .eq("data_reuniao", fields.data_reuniao)
        .eq("agencia_id", agencia_id_detected)
        .eq("interessado", fields.interessado)
        .maybeSingle();
      if (existingByDate) semantic_duplicate = true;
    }
  }

  let ata_items: PreviewResult["ata_items"] | undefined;
  if (tipo_documento === "ata") {
    const rawItems = splitAtaItems(extraction.text);
    const ataMeta = extractAtaMetadata(extraction.text);
    ata_items = rawItems.map((item) => ({
      item_numero: item.item_numero,
      processo: item.processo,
      assunto: item.assunto,
      interessado: item.interessado,
      relator: item.relator,
      decisao: item.decisao?.slice(0, 500) ?? null,
      resultado: item.resultado,
      microtema: classifyMicrotema(item.raw_text, agencia_sigla_detected).microtema,
      area_regulatoria: classifyAreaRegulatoria(item.raw_text),
      votos_detectados: [],
      votos_contra_detectados: [],
      votos_ausentes_detectados: [],
      unanimidade_detectada: item.unanimidade,
    }));
    if (!fields.data_reuniao && ataMeta.data_reuniao) fields.data_reuniao = ataMeta.data_reuniao;
    confidence = Math.max(confidence, calcAtaPreviewConfidence({
      numero_reuniao: fields.numero_reuniao,
      tipo_reuniao: fields.tipo_reuniao,
      data_reuniao: fields.data_reuniao,
      agencia_sigla_detected,
      ata_items,
    }));
  }

  if (antt.ataItems?.length) {
    ata_items = antt.ataItems.map((item) => ({
      ...item,
      microtema: item.microtema && item.microtema !== "outros"
        ? item.microtema
        : classifyMicrotema([item.assunto, item.interessado, item.decisao].filter(Boolean).join(" "), agencia_sigla_detected).microtema,
      area_regulatoria: item.area_regulatoria ?? classifyAreaRegulatoria([item.assunto, item.interessado, item.decisao].filter(Boolean).join(" ")),
    }));
    microtema = ata_items[0]?.microtema ?? microtema;
    area_regulatoria = (ata_items[0]?.area_regulatoria ?? area_regulatoria) as typeof area_regulatoria;
  }

  const activeDiretoresList = db && agencia_id_detected
    ? await getActiveDiretoresForVote(db, agencia_id_detected, fields.data_reuniao, diretoresList)
    : [];
  const mainInferFromMandate = shouldInferVotesFromMandate({
    resultado: fields.resultado,
    tipo_documento,
    import_counts_as_final: regulatoryClass.import_counts_as_final,
    unanimidadeDetectada: fields.unanimidade_detectada,
    nomes: fields.nomes_votacao,
    nomesContra: fields.nomes_votacao_contra,
  });
  const mainVotosSugeridos = buildVoteSuggestions({
    nomes: fields.nomes_votacao,
    nomesContra: fields.nomes_votacao_contra,
    nomesAbstencao: fields.nomes_votacao_abstencao,
    nomesAusente: fields.nomes_votacao_ausente,
    diretoresList,
    activeDiretoresList,
    inferFromMandate: mainInferFromMandate,
  });

  if (ata_items?.length) {
    ata_items = ata_items.map((item) => {
      const inferFromMandate = shouldInferVotesFromMandate({
        resultado: item.resultado,
        tipo_documento: "ata",
        import_counts_as_final: Boolean(item.resultado),
        unanimidadeDetectada: item.unanimidade_detectada,
        nomes: item.votos_detectados ?? [],
        nomesContra: item.votos_contra_detectados ?? [],
      });
      return {
        ...item,
        votos_sugeridos: buildVoteSuggestions({
          nomes: item.votos_detectados ?? [],
          nomesContra: item.votos_contra_detectados ?? [],
          nomesAusente: item.votos_ausentes_detectados ?? [],
          diretoresList,
          activeDiretoresList,
          inferFromMandate,
        }),
      };
    });
  }

  const warnings = documentWarnings;
  const semantic_duplicate_key = antt.raw.dedupe_semantic_key
    ? String(antt.raw.dedupe_semantic_key)
    : regulatoryClass.semantic_duplicate_key;

  return {
    filename: file.name,
    source_archive: file.source_archive ?? null,
    status: confidence >= 0.5 && warnings.length === 0 ? "ok" : "low_confidence",
    fields: {
      numero_deliberacao: fields.numero_deliberacao,
      numero_reuniao: fields.numero_reuniao,
      reuniao_ordinaria: fields.reuniao_ordinaria,
      tipo_reuniao: fields.tipo_reuniao,
      tipo_documento,
      data_reuniao: fields.data_reuniao,
      data_publicacao: fields.data_publicacao,
      interessado: fields.interessado,
      assunto: fields.assunto,
      procedencia: fields.procedencia,
      relator: (fields as { relator?: string | null }).relator ?? null,
      item_numero: (fields as { item_numero?: string | null }).item_numero ?? null,
      processo: fields.processo,
      resultado: fields.resultado,
      decisoes_todas: fields.decisoes_todas,
      microtema,
      area_regulatoria: (fields as { area_regulatoria?: string }).area_regulatoria ?? area_regulatoria,
      pauta_interna,
      resumo_pleito: fields.resumo_pleito,
      fundamento_decisao: fields.fundamento_decisao,
      diretores_detectados: fields.diretores_detectados,
      nomes_votacao: fields.nomes_votacao,
      nomes_votacao_contra: fields.nomes_votacao_contra,
      nomes_votacao_abstencao: fields.nomes_votacao_abstencao,
      nomes_votacao_ausente: fields.nomes_votacao_ausente,
      votos_sugeridos: mainVotosSugeridos,
    },
    confidence,
    page_count: extraction.pageCount,
    chars_per_page: extraction.charsPerPage,
    file_hash,
    is_duplicate: is_duplicate || semantic_duplicate,
    duplicate_job_id,
    agencia_id_detected,
    agencia_sigla_detected,
    documento_subtipo: regulatoryClass.documento_subtipo,
    import_counts_as_final: regulatoryClass.import_counts_as_final,
    semantic_duplicate_key,
    warnings,
    ...(antt.isAntt ? { documento_antt_tipo: antt.documentType, warnings } : {}),
    ...(ata_items ? { ata_items } : {}),
    extraction_raw: {
      numero_deliberacao: fields.numero_deliberacao,
      reuniao_ordinaria: fields.reuniao_ordinaria,
      numero_reuniao: fields.numero_reuniao,
      tipo_reuniao: fields.tipo_reuniao,
      data_reuniao: fields.data_reuniao,
      interessado: fields.interessado,
      procedencia: fields.procedencia,
      processo: fields.processo,
      assunto: fields.assunto,
      resultado: fields.resultado,
      decisoes_todas: fields.decisoes_todas,
      microtema,
      area_regulatoria: (fields as { area_regulatoria?: string }).area_regulatoria ?? area_regulatoria,
      pauta_interna,
      resumo_pleito: fields.resumo_pleito,
      fundamento_decisao: fields.fundamento_decisao,
      diretores_detectados: fields.diretores_detectados,
      nomes_votacao: fields.nomes_votacao,
      nomes_votacao_favor: fields.nomes_votacao_favor,
      nomes_votacao_contra: fields.nomes_votacao_contra,
      nomes_votacao_abstencao: fields.nomes_votacao_abstencao,
      nomes_votacao_ausente: fields.nomes_votacao_ausente,
      votos_sugeridos: mainVotosSugeridos,
      signatarios: fields.signatarios,
      unanimidade_detectada: fields.unanimidade_detectada,
      confidence,
      page_count: extraction.pageCount,
      chars_per_page: extraction.charsPerPage,
      agencia_sigla_detected,
      source_archive: file.source_archive ?? null,
      documento_subtipo: regulatoryClass.documento_subtipo,
      import_counts_as_final: regulatoryClass.import_counts_as_final,
      semantic_duplicate,
      semantic_duplicate_key,
      warnings,
      raw_text: extraction.text.slice(0, 50000),
      ...(antt.isAntt ? {
        antt: antt.raw,
        documento_antt_tipo: antt.documentType,
      } : {}),
    },
  };
}

export function markBatchDuplicates(results: PreviewResult[]) {
  const byHash = new Map<string, PreviewResult[]>();
  const bySemantic = new Map<string, PreviewResult[]>();

  for (const result of results) {
    if (result.status === "error") continue;
    if (result.file_hash) {
      const items = byHash.get(result.file_hash) ?? [];
      items.push(result);
      byHash.set(result.file_hash, items);
    }
    const semanticKey = result.semantic_duplicate_key ?? result.extraction_raw?.semantic_duplicate_key;
    if (typeof semanticKey === "string" && semanticKey.length > 8) {
      const items = bySemantic.get(semanticKey) ?? [];
      items.push(result);
      bySemantic.set(semanticKey, items);
    }
  }

  for (const items of byHash.values()) {
    if (items.length <= 1) continue;
    items.forEach((item, index) => {
      if (index === 0) return;
      item.is_duplicate = true;
      item.duplicate_reason = `Duplicata binaria no lote: igual a ${items[0].filename}`;
    });
  }

  for (const items of bySemantic.values()) {
    if (items.length <= 1) continue;
    items.forEach((item, index) => {
      if (index === 0 || item.is_duplicate) return;
      item.is_duplicate = true;
      item.duplicate_reason = `Possivel duplicata semantica no lote: mesmo numero/processo de ${items[0].filename}`;
    });
  }
}

export function errorResult(filename: string, file_hash = ""): PreviewResult {
  return {
    filename,
    status: "error",
    fields: {
      numero_deliberacao: null,
      numero_reuniao: null,
      reuniao_ordinaria: null,
      tipo_reuniao: null,
      tipo_documento: "documento_apoio",
      data_reuniao: null,
      data_publicacao: null,
      interessado: null,
      assunto: null,
      procedencia: null,
      relator: null,
      item_numero: null,
      processo: null,
      resultado: null,
      decisoes_todas: [],
      microtema: "outros",
      area_regulatoria: "outros",
      pauta_interna: false,
      resumo_pleito: null,
      fundamento_decisao: null,
      diretores_detectados: [],
      nomes_votacao: [],
      nomes_votacao_contra: [],
      nomes_votacao_abstencao: [],
      nomes_votacao_ausente: [],
      votos_sugeridos: [],
    },
    confidence: 0,
    page_count: 0,
    chars_per_page: 0,
    file_hash,
    is_duplicate: false,
    duplicate_job_id: null,
    agencia_id_detected: null,
    agencia_sigla_detected: null,
    import_counts_as_final: false,
  };
}

function withoutUndefined<T extends Record<string, unknown>>(value: T): Partial<T> {
  return Object.fromEntries(
    Object.entries(value).filter(([, entry]) => entry !== undefined),
  ) as Partial<T>;
}

function calcAtaPreviewConfidence(input: {
  numero_reuniao: string | null;
  tipo_reuniao: string | null;
  data_reuniao: string | null;
  agencia_sigla_detected: string | null;
  ata_items: NonNullable<PreviewResult["ata_items"]>;
}): number {
  const itemCount = input.ata_items.length;
  const withProcess = input.ata_items.filter((item) => item.processo).length;
  const withSubject = input.ata_items.filter((item) => item.assunto).length;
  const withInterested = input.ata_items.filter((item) => item.interessado).length;
  const itemQuality = itemCount > 0
    ? Math.min(0.35, ((withProcess + withSubject + withInterested) / (itemCount * 3)) * 0.35)
    : 0;

  return [
    input.numero_reuniao ? 0.18 : 0,
    input.tipo_reuniao ? 0.08 : 0,
    input.data_reuniao ? 0.14 : 0,
    input.agencia_sigla_detected ? 0.10 : 0,
    itemCount > 0 ? 0.15 : 0,
    itemQuality,
  ].reduce((sum, value) => sum + value, 0);
}

async function getDiretoresList(db: any | null | undefined, agenciaId: string | null): Promise<DiretorVoteRecord[]> {
  if (!db || !agenciaId) return [];
  const { data } = await db
    .from("diretores")
    .select("id, nome, nome_variantes")
    .eq("agencia_id", agenciaId);

  return (data ?? []).map((dir: any) => ({
    id: dir.id,
    nome: dir.nome,
    nome_variantes: Array.isArray(dir.nome_variantes) ? dir.nome_variantes : [],
  }));
}
