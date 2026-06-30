import type { AtaPreviewItem, PreviewResultFields, TipoDocumento } from "@/types";
import { classifyAreaRegulatoria } from "@/lib/server/area-regulatoria";

export type AnttManualDocumentType =
  | "pauta"
  | "ata"
  | "voto_individual"
  | "reuniao_deliberativa_eletronica"
  | "reuniao_diretoria_publica"
  | "reuniao_extraordinaria"
  | "outro";

export interface AnttManualParseResult {
  isAntt: boolean;
  documentType: AnttManualDocumentType;
  fields: Partial<PreviewResultFields>;
  ataItems?: AtaPreviewItem[];
  confidenceBoost: number;
  warnings: string[];
  raw: Record<string, unknown>;
}

const ANTT_DIRECTOR_INITIALS: Record<string, string> = {
  DLA: "Lucas Asfor",
  DFQ: "Felipe Queiroz",
  DAA: "Alex Azevedo",
  DAB: "Alessandro Baumgartner",
  DSM: "Severino Medeiros",
  DG: "Guilherme Sampaio",
  DGS: "Guilherme Sampaio",
};

const ANTT_DIRECTOR_ALIASES: Array<{ canonical: string; aliases: string[] }> = [
  { canonical: "Guilherme Sampaio", aliases: ["Guilherme Sampaio", "Guilherme Theo Rodrigues da Rocha Sampaio", "Diretor-Geral Guilherme"] },
  { canonical: "Lucas Asfor", aliases: ["Lucas Asfor", "Lucas Asfor Rocha Lima"] },
  { canonical: "Felipe Queiroz", aliases: ["Felipe Queiroz", "Felipe Fernandes Queiroz"] },
  { canonical: "Alex Azevedo", aliases: ["Alex Azevedo", "Alex Antonio de Azevedo Cruz", "Alex AntÃ´nio de Azevedo Cruz"] },
  { canonical: "Alessandro Baumgartner", aliases: ["Alessandro Baumgartner"] },
  { canonical: "Severino Medeiros", aliases: ["Severino Medeiros", "Severino Medeiros Ramos Neto"] },
];

const RESULTADO_APROVADO = "Aprovado";

export function parseAnttManualDocument(text: string, filename: string): AnttManualParseResult {
  const clean = cleanText(text);
  const normalized = normalize(`${filename} ${clean.slice(0, 5000)}`);
  const isAntt = /\bantt\b/.test(normalized) || normalized.includes("agencia nacional de transportes terrestres");

  if (!isAntt) {
    return {
      isAntt: false,
      documentType: "outro",
      fields: {},
      confidenceBoost: 0,
      warnings: [],
      raw: {},
    };
  }

  const documentType = classifyAnttDocument(clean, filename);
  const meeting = extractMeeting(clean, filename, documentType);
  const date = extractAnttDate(clean, filename);
  const director = extractDirector(clean, filename, documentType);
  const attendance = extractAnttAttendance(clean);
  const processes = extractAnttProcessesV2(clean);
  const enrichedProcesses = processes.map((item) => enrichAnttItem(item, documentType, attendance.present, attendance.absent));
  const firstProcess = enrichedProcesses[0] ?? extractSingleProcess(clean, filename, documentType);
  const area_regulatoria = classifyAreaRegulatoria([
    firstProcess.assunto,
    firstProcess.interessado,
    firstProcess.decisao,
    clean.slice(0, 8000),
  ].filter(Boolean).join(" "));
  const seiUrl = extractSeiUrl(clean);
  const warnings = buildWarnings(documentType, meeting, firstProcess, director, processes);
  const tipoDocumento = mapToPlatformDocumentType(documentType);

  const fields: Partial<PreviewResultFields> = {
    numero_deliberacao: extractAnttDocumentNumber(clean, filename, documentType),
    numero_reuniao: meeting.numero,
    reuniao_ordinaria: meeting.titulo,
    tipo_reuniao: meeting.tipo_reuniao,
    tipo_documento: tipoDocumento,
    data_reuniao: date,
    interessado: firstProcess.interessado,
    assunto: firstProcess.assunto,
    procedencia: "ANTT",
    relator: documentType === "voto_individual" ? director : firstProcess.relator ?? director,
    item_numero: firstProcess.item_numero,
    processo: firstProcess.processo,
    resultado: documentType === "voto_individual"
      ? inferResultado(`${firstProcess.assunto ?? ""} ${firstProcess.decisao ?? ""} ${extractVoteConclusion(clean) ?? ""}`) ?? RESULTADO_APROVADO
      : (documentType === "ata" || documentType.startsWith("reuniao_")) ? firstProcess.resultado : null,
    microtema: firstProcess.microtema ?? classifyAnttMicrotema(`${firstProcess.assunto ?? ""} ${firstProcess.decisao ?? ""}`),
    pauta_interna: false,
    area_regulatoria,
    resumo_pleito: firstProcess.decisao,
    fundamento_decisao: documentType === "voto_individual" ? extractVoteConclusion(clean) : firstProcess.decisao,
    nomes_votacao: documentType === "voto_individual" && director ? [director] : [],
    nomes_votacao_contra: [],
  };

  return {
    isAntt: true,
    documentType,
    fields,
    ataItems: shouldExposeItems(documentType) ? enrichedProcesses : undefined,
    confidenceBoost: confidenceFor(documentType, meeting.numero, firstProcess.processo, director, enrichedProcesses),
    warnings,
    raw: {
      agencia_sigla: "ANTT",
      documento_antt_tipo: documentType,
      documento_anttl_tipo: documentType,
      reuniao_numero: meeting.numero,
      reuniao_tipo: meeting.tipo_reuniao,
      diretor_autor_voto: director,
      processo: firstProcess.processo,
      relator: documentType === "voto_individual" ? director : firstProcess.relator,
      interessado: firstProcess.interessado,
      assunto: firstProcess.assunto,
      decisao: firstProcess.decisao,
      area_regulatoria,
      numero_voto: documentType === "voto_individual" ? extractVoteNumber(clean, filename) : null,
      origem: documentType === "voto_individual" ? extractVoteOrigin(clean) : null,
      source_url: seiUrl,
      warnings,
      processos_detectados: enrichedProcesses.length,
      diretores_presentes: attendance.present,
      diretores_ausentes: attendance.absent,
      dedupe_semantic_key: [
        "ANTT",
        meeting.numero ?? "",
        firstProcess.processo ?? "",
        director ?? "",
        documentType,
      ].join("|"),
    },
  };
}

function classifyAnttDocument(text: string, filename: string): AnttManualDocumentType {
  const value = normalize(`${filename} ${text.slice(0, 2000)}`);
  const valuePlain = plain(`${filename} ${text.slice(0, 2000)}`);
  if (valuePlain.includes("ata da") && valuePlain.includes("reuniao")) return "ata";
  if (
    value.includes("declaracao de voto") ||
    /\bvoto\s+(?:vista\s+)?(?:d[a-z]{1,3}|dg)\b/.test(value) ||
    valuePlain.includes("termo voto a diretoria colegiada") ||
    (valuePlain.includes("relatoria") && valuePlain.includes("numero") && valuePlain.includes("objeto") && valuePlain.includes("processo"))
  ) return "voto_individual";
  if (valuePlain.includes("ata da") && valuePlain.includes("reuniao")) return "ata";
  if (value.includes("ata da reuniao deliberativa eletronica") || value.includes("ata da reuniao de diretoria")) return "ata";
  if (value.includes("reuniao extraordinaria de diretoria")) return "reuniao_extraordinaria";
  if (value.includes("reuniao deliberativa eletronica") || /\brde\b/.test(value)) return "reuniao_deliberativa_eletronica";
  if (value.includes("reuniao de diretoria publica") || value.includes("reuniao de diretoria")) return "reuniao_diretoria_publica";
  if (value.includes("pauta")) return "pauta";
  return "outro";
}

function mapToPlatformDocumentType(type: AnttManualDocumentType): TipoDocumento {
  if (type === "ata" || type === "pauta" || type.startsWith("reuniao_")) return "ata";
  return "deliberacao";
}

function shouldExposeItems(type: AnttManualDocumentType) {
  return type === "pauta" || type === "ata" || type.startsWith("reuniao_");
}

function extractMeeting(text: string, filename: string, type: AnttManualDocumentType) {
  const source = `${filename} ${text.slice(0, 2000)}`;
  const normalizedMeeting = extractMeetingFromPlain(source);
  if (normalizedMeeting.numero || normalizedMeeting.kind) {
    const numero = normalizedMeeting.numero;
    let label = "Reuniao ANTT";
    let tipo_reuniao: string | null = "Ordinaria";
    if (normalizedMeeting.kind === "rde") {
      label = numero ? `${numero}Âª Reuniao Deliberativa Eletronica` : "Reuniao Deliberativa Eletronica";
    } else if (normalizedMeeting.kind === "extraordinaria") {
      label = numero ? `${numero}Âª Reuniao Extraordinaria de Diretoria` : "Reuniao Extraordinaria de Diretoria";
      tipo_reuniao = "Extraordinaria";
    } else if (normalizedMeeting.kind === "publica") {
      label = numero ? `${numero}Âª Reuniao de Diretoria Publica` : "Reuniao de Diretoria Publica";
    }
    return { numero, titulo: formatMeetingTitle(normalizedMeeting.kind, numero, label), tipo_reuniao };
  }
  const rde = firstMatch(source, /(\d{1,3})\s*(?:Âª|a)?\s*(?:RDE|REUNI[AÃƒ]O\s+DELIBERATIVA\s+ELETR[OÃ”]NICA)/i);
  const publica = firstMatch(source, /(\d{1,4}(?:\.\d{3})?)\s*(?:Âª|a)?\s*REUNI[AÃƒ]O\s+DE\s+DIRETORIA\s+P[UÃš]BLICA/i);
  const extraordinaria = firstMatch(source, /(\d{1,3})\s*(?:Âª|a)?\s*REUNI[AÃƒ]O\s+EXTRAORDIN[AÃ]RIA\s+DE\s+DIRETORIA/i);
  const ataDiretoria = firstMatch(source, /REUNI[AÃƒ]O\s+DE\s+DIRETORIA\s+N[ÂºO_ ]+(\d{1,4})/i);
  const ataRde = firstMatch(source, /REUNI[AÃƒ]O\s+DELIBERATIVA\s+ELETRONICA\s+N[ÂºO_ ]+(\d{1,4})/i);
  const numero = rde ?? publica ?? extraordinaria ?? ataDiretoria ?? ataRde ?? null;

  let label = "Reuniao ANTT";
  let tipo_reuniao: string | null = "Ordinaria";
  if (type === "reuniao_deliberativa_eletronica" || rde || ataRde) {
    label = numero ? `${numero}Âª Reuniao Deliberativa Eletronica` : "Reuniao Deliberativa Eletronica";
    tipo_reuniao = "Ordinaria";
  } else if (type === "reuniao_extraordinaria" || extraordinaria) {
    label = numero ? `${numero}Âª Reuniao Extraordinaria de Diretoria` : "Reuniao Extraordinaria de Diretoria";
    tipo_reuniao = "Extraordinaria";
  } else if (type === "reuniao_diretoria_publica" || publica || ataDiretoria) {
    label = numero ? `${numero}Âª Reuniao de Diretoria Publica` : "Reuniao de Diretoria Publica";
    tipo_reuniao = "Ordinaria";
  }

  return { numero, titulo: label, tipo_reuniao };
}

function extractAnttDocumentNumber(text: string, filename: string, type: AnttManualDocumentType) {
  if (type === "voto_individual") return null;
  if (false) {
    return firstMatch(`${filename} ${text.slice(0, 500)}`, /DECLARA[Ã‡C][AÃƒ]O\s+DE\s+VOTO\s+([A-Z]{3}\s+N[ÂºO]?\s*\d+)[,\s]/i)
      ?? firstMatch(filename, /Declara[Ã§c][aÃ£]o\s+de\s+Voto\s+([^.-]+?\d{3,4})/i);
  }
  return null;
}

function extractAnttDate(text: string, filename: string) {
  const source = `${filename} ${text.slice(0, 2500)}`;
  const sourcePlain = plain(source);
  const periodo = /periodo:\s*(\d{1,2})[./](\d{1,2})\s+a\s+\d{1,2}[./]\d{1,2}[./](2026)/i.exec(sourcePlain);
  if (periodo) return iso(periodo[1], periodo[2], periodo[3]);

  const wordRange = /do\s+([a-z\s]+?)\s+ao\s+[a-z\s]+?\s+dia\s+do\s+mes\s+de\s+([a-z]+)\s+do\s+ano\s+de\s+dois\s+mil\s+e\s+vinte\s+e\s+seis/i.exec(sourcePlain);
  if (wordRange) {
    const day = portugueseDayNumber(wordRange[1]) ?? portugueseDayNumber(lastWordDateCandidate(wordRange[1], "do"));
    const month = monthNumber(wordRange[2]);
    if (day && month) return iso(day, month, "2026");
  }

  const wordSingle = /ao\s+([a-z\s]+?)\s+dia\s+do\s+mes\s+de\s+([a-z]+)\s+do\s+ano\s+de\s+dois\s+mil\s+e\s+vinte\s+e\s+seis/i.exec(sourcePlain);
  if (wordSingle) {
    const day = portugueseDayNumber(wordSingle[1]) ?? portugueseDayNumber(lastWordDateCandidate(wordSingle[1], "ao"));
    const month = monthNumber(wordSingle[2]);
    if (day && month) return iso(day, month, "2026");
  }
  const rangeWithImplicitStart = /de\s+(\d{1,2})\s+a\s+\d{1,2}[./](\d{1,2})[./](2026)/i.exec(source);
  if (rangeWithImplicitStart) return iso(rangeWithImplicitStart[1], rangeWithImplicitStart[2], rangeWithImplicitStart[3]);

  const rangeWithExplicitStart = /de\s+(\d{1,2})[./](\d{1,2})\s+a\s+\d{1,2}[./]\d{1,2}[./](2026)/i.exec(source);
  if (rangeWithExplicitStart) return iso(rangeWithExplicitStart[1], rangeWithExplicitStart[2], rangeWithExplicitStart[3]);

  const numeric = /(\d{1,2})[./](\d{1,2})[./](2026)/.exec(source);
  if (numeric) return iso(numeric[1], numeric[2], numeric[3]);

  const long = /(\d{1,2})\s+DE\s+([A-ZÃ‡ÃƒÃ‰]+)\s+DE\s+(2026)/i.exec(source);
  if (long) return iso(long[1], monthNumber(long[2]) ?? "01", long[3]);

  return null;
}

function extractDirector(text: string, filename: string, type: AnttManualDocumentType) {
  if (type === "voto_individual") {
    const source = `${filename} ${text.slice(0, 1500)}`;
    const vistaInitials = firstMatch(source, /VISTA:\s*([A-Z]{2,3})\b/i)
      ?? firstMatch(source, /VOTO\s+VISTA\s+([A-Z]{2,3})\b/i);
    if (vistaInitials && ANTT_DIRECTOR_INITIALS[vistaInitials]) return ANTT_DIRECTOR_INITIALS[vistaInitials];

    const initials = firstMatch(source, /VOTO\s+([A-Z]{2,3})\b/i)
      ?? firstMatch(source, /RELATORIA:\s*(?:Diretoria\s+)?(?:[^\n:]+?\s+-\s*)?([A-Z]{2,3})\b/i)
      ?? firstMatch(source, /RELATORIA:\s*([A-Z]{2,3})\b/i);
    if (initials && ANTT_DIRECTOR_INITIALS[initials]) return ANTT_DIRECTOR_INITIALS[initials];

    const relatoriaNome = firstMatch(source, /RELATORIA:\s*Diretoria\s+([^\n:]+?)(?:\s+-\s*[A-Z]{2,3}|\s+TERMO:|\s+N[ÚU]MERO:|$)/i)
      ?? firstMatch(source, /RELATORIA:\s*([^\n:]{5,90})(?:\s+TERMO:|\s+N[ÚU]MERO:|$)/i);
    if (relatoriaNome) return titleCase(relatoriaNome);
  }

  const signature = firstMatch(text.slice(-3000), /Documento assinado eletronicamente por\s+([^,]+),\s+Diretor/i)
    ?? firstMatch(text.slice(-2000), /([A-ZÁÉÍÓÚÂÊÔÃÕÇ ]{8,})\s+Diretor(?:a)?\b/i);
  return signature ? titleCase(signature) : null;
}
function extractAnttProcesses(text: string): AtaPreviewItem[] {
  const normalizedBreaks = text
    // Repara nº SEI quebrado por espaços: "50500.123456 /2026-11" → "50500.123456/2026-11".
    .replace(/([0-9]{5})\s*\.\s*([0-9]{6})\s*\/\s*([0-9]{4})\s*-\s*([0-9]{2})/g, "$1.$2/$3-$4")
    .replace(/\s+(?=\d+\.\d+(?:\.\d+)?\s+Processo)/g, "\n")
    .replace(/\s+(?=Processo\s+n?[Âºo]?\s*\d{5}\.)/gi, "\n");
  const re = /(?:(\d+\.\d+(?:\.\d+)?)\s+)?Processo\s*(?:n[Âºo]\s*)?([0-9]{5}\.[0-9]{6}\/[0-9]{4}-[0-9]{2}|[0-9][0-9.\-/]{10,})/gi;
  const matches = [...normalizedBreaks.matchAll(re)];
  const items: AtaPreviewItem[] = [];

  for (let i = 0; i < matches.length; i++) {
    const match = matches[i];
    const start = match.index ?? 0;
    const end = matches[i + 1]?.index ?? Math.min(normalizedBreaks.length, start + 3000);
    const block = cleanText(normalizedBreaks.slice(start, end));
    const interessado = between(block, /Interessado:\s*/i, /\s+Assunto:\s*/i);
    const assunto = between(block, /Assunto:\s*/i, /\s+(?:\d+\.\d+|Processo\s+n?[Âºo]?|Documento assinado|Pauta da Reuni|$)/i);
    const relator = extractRelatorForBlock(block) ?? extractNearestRelator(normalizedBreaks.slice(0, start));
    const decisao = between(block, /Decis[aÃ£]o:\s*/i, /\s+(?:Documento assinado|Refer[eÃª]ncia:|$)/i);

    if (isSeiReferenceProcess(block, interessado, assunto)) {
      continue;
    }

    items.push({
      item_numero: match[1] ?? String(i + 1),
      processo: cleanText(match[2]),
      interessado,
      relator,
      assunto,
      decisao,
      resultado: decisao ? inferResultado(`${assunto ?? ""} ${decisao}`) : null,
      microtema: "outros",
      area_regulatoria: classifyAreaRegulatoria(`${interessado ?? ""} ${assunto ?? ""} ${decisao ?? ""}`),
    });
  }

  return dedupeItems(items);
}

function extractSingleProcess(text: string, filename = "", type: AnttManualDocumentType = "outro"): AtaPreviewItem {
  if (type === "voto_individual") {
    const processo = firstMatch(text, /PROCESSO\s*\(?S?\)?\s*:\s*([0-9]{5}\.[0-9]{6}\/[0-9]{4}-[0-9]{2}|[0-9][0-9.\-/]{10,})/i)
      ?? firstMatch(text, /Processo\s*(?:n[Ã‚Âºo]\s*)?([0-9]{5}\.[0-9]{6}\/[0-9]{4}-[0-9]{2}|[0-9][0-9.\-/]{10,})/i);
    const interessado = extractVoteInterested(text)
      ?? between(text, /interposto pela\s+/i, /,\s+inscrit[ao]|\s+contra\s+a\s+Delibera/i)
      ?? between(text, /Interessado:\s*/i, /\s+Assunto:\s*/i);
    const assunto = extractVoteObject(text)
      ?? between(text, /Tratam os autos do\s+/i, /\.\s*2\.|$/i)
      ?? between(text, /Assunto:\s*/i, /\s+Documento assinado|$/i);
    const decisao = extractVoteConclusion(text);
    const relator = firstMatch(`${filename} ${text.slice(0, 1200)}`, /Voto\s+([A-Z]{2,3})\b/i);
    return {
      item_numero: "1",
      processo,
      interessado,
      relator: relator && ANTT_DIRECTOR_INITIALS[relator] ? ANTT_DIRECTOR_INITIALS[relator] : null,
      assunto,
      decisao,
      resultado: inferResultado(`${assunto ?? ""} ${decisao ?? ""}`),
      microtema: classifyAnttMicrotema(`${assunto ?? ""} ${decisao ?? ""}`),
      area_regulatoria: classifyAreaRegulatoria(`${interessado ?? ""} ${assunto ?? ""} ${decisao ?? ""}`),
    };
  }
  const processo = firstMatch(text, /(?:Refer[eÃª]ncia:\s*)?Processo\s*(?:n[Âºo]\s*)?([0-9]{5}\.[0-9]{6}\/[0-9]{4}-[0-9]{2}|[0-9][0-9.\-/]{10,})/i);
  const interessado = between(text, /interposto pela\s+/i, /,\s+inscrit[ao]|\s+contra\s+a\s+Delibera/i)
    ?? between(text, /Interessado:\s*/i, /\s+Assunto:\s*/i);
  const assunto = between(text, /Tratam os autos do\s+/i, /\.\s*2\.|$/i)
    ?? between(text, /Assunto:\s*/i, /\s+Documento assinado|$/i);
  const decisao = extractVoteConclusion(text);
  const relator = firstMatch(text, /Voto\s+([A-Z]{3})\s+\d+/i);
  return {
    item_numero: "1",
    processo,
    interessado,
    relator: relator && ANTT_DIRECTOR_INITIALS[relator] ? ANTT_DIRECTOR_INITIALS[relator] : null,
    assunto,
    decisao,
    resultado: inferResultado(`${assunto ?? ""} ${decisao ?? ""}`),
    microtema: "outros",
  };
}

function enrichAnttItem(
  item: AtaPreviewItem,
  documentType: AnttManualDocumentType,
  presentDirectors: string[],
  absentDirectors: string[],
): AtaPreviewItem {
  const text = `${item.assunto ?? ""} ${item.decisao ?? ""}`;
  // Inclui RDE / reunião deliberativa eletrônica: também têm decisão e voto unânime
  // (antes só "ata" contava → RDE perdia votos unânimes e zerava o resultado).
  const isDeliberativa = documentType === "ata" || documentType.startsWith("reuniao_");
  const retirada = isRetiradaDePauta(item.decisao);
  const unanimidade = isDeliberativa && Boolean(item.decisao) && !retirada && /unanimidade/i.test(normalize(item.decisao ?? ""));
  const votos = unanimidade ? presentDirectors : [];
  const warnings = [
    ...(item.warnings ?? []),
    ...(unanimidade && votos.length === 0 ? ["ANTT: decisÃ£o unÃ¢nime, mas diretores presentes nÃ£o foram identificados com seguranÃ§a."] : []),
  ];

  return {
    ...item,
    resultado: isDeliberativa ? item.resultado : null,
    microtema: classifyAnttMicrotema(text),
    area_regulatoria: classifyAreaRegulatoria(`${item.interessado ?? ""} ${text}`),
    votos_detectados: votos,
    votos_contra_detectados: [],
    votos_ausentes_detectados: unanimidade ? absentDirectors : [],
    unanimidade_detectada: unanimidade,
    needs_review: warnings.length > 0,
    warnings,
  };
}

function extractAnttAttendance(text: string) {
  const intro = cleanText(text.slice(0, Math.min(text.length, 2500)));
  const absentMatch = /\bAusente\b/i.exec(intro);
  const presentSlice = absentMatch ? intro.slice(0, absentMatch.index) : intro;
  const absentRaw = absentMatch ? intro.slice(absentMatch.index) : "";
  const absentEnd = absentRaw.search(/\s(?:1\.|I\.|MAT|ORDEM|PAUTA)\b/i);
  const absentSentenceEnd = absentRaw.indexOf(".");
  const absentLimit = [absentEnd, absentSentenceEnd]
    .filter((index) => index > 0)
    .sort((a, b) => a - b)[0] ?? 450;
  const absentSlice = absentRaw.slice(0, absentLimit);
  const present = detectDirectorAliases(presentSlice);
  const absent = detectDirectorAliases(absentSlice);
  return {
    present: present.filter((name) => !absent.includes(name)),
    absent,
  };
}

function detectDirectorAliases(value: string) {
  const source = normalize(value);
  return ANTT_DIRECTOR_ALIASES
    .filter((entry) => entry.aliases.some((alias) => source.includes(normalize(alias))))
    .map((entry) => entry.canonical);
}

function isRetiradaDePauta(value: string | null) {
  const text = normalize(value ?? "");
  return text.includes("retir") && text.includes("pauta");
}

function classifyAnttMicrotema(text: string) {
  const value = normalize(text);
  const scores: Array<[string, number]> = [
    ["tarifa", scoreKeywords(value, ["tarifa", "tarifario", "pedagio", "reajuste", "free flow", "tbp"])],
    ["contrato", scoreKeywords(value, ["contrato", "concessao", "termo aditivo", "aditivo", "permissao", "arrendamento"])],
    ["obras", scoreKeywords(value, ["obra", "infraestrutura", "rodovia", "ferrovia", "faixa de dominio", "demolicao", "programa de exploracao"])],
    ["fiscalizacao", scoreKeywords(value, ["fiscalizacao", "auto de infracao", "infracao", "penalidade", "sancao", "revogacao da habilitacao"])],
    ["usuario", scoreKeywords(value, ["passageiros", "linha", "mercado", "autorizacao para operar", "transporte rodoviario de passageiros"])],
    ["outorga", scoreKeywords(value, ["outorga", "ato de outorga", "autorizacao ferroviaria", "renuncia da outorga"])],
    ["regulacao", scoreKeywords(value, ["resolucao", "regulatorio", "sandbox", "avaliacao de resultado regulatorio", "audiencia publica"])],
    ["credenciamento", scoreKeywords(value, ["credenciamento", "certificado digital", "transportador autonomo de cargas", "tac"])],
  ];
  const [best, score] = scores.sort((a, b) => b[1] - a[1])[0];
  if (score <= 0) return "outros";
  if (best === "outorga" || best === "regulacao" || best === "credenciamento") return "contrato";
  return best;
}

function scoreKeywords(value: string, keywords: string[]) {
  return keywords.reduce((score, keyword) => score + (value.includes(normalize(keyword)) ? keyword.split(/\s+/).length : 0), 0);
}

function extractAnttProcessesV2(text: string): AtaPreviewItem[] {
  const normalizedBreaks = text
    // Repara nº SEI quebrado por espaços: "50500.123456 /2026-11" → "50500.123456/2026-11".
    .replace(/([0-9]{5})\s*\.\s*([0-9]{6})\s*\/\s*([0-9]{4})\s*-\s*([0-9]{2})/g, "$1.$2/$3-$4")
    .replace(/\s+(?=\d+\.\d+(?:\.\d+)?\s+Processo)/g, "\n")
    .replace(/\s+(?=Processo\s*(?:n[Âºo]\s*)?[:Âºo\s\u200b-\u200f\ufeff]*\d{5}\.)/gi, "\n");
  const processPattern = /(?:(\d+\.\d+(?:\.\d+)?)\s+)?Processo\s*(?:n[Âºo]\s*)?[:Âºo\s\u200b-\u200f\ufeff]*([0-9]{5}\.[0-9]{6}\/[0-9]{4}-[0-9]{2}|[0-9][0-9.\-/]{10,})/gi;
  const matches = [...normalizedBreaks.matchAll(processPattern)];
  const items: AtaPreviewItem[] = [];

  for (let i = 0; i < matches.length; i++) {
    const match = matches[i];
    const start = match.index ?? 0;
    const end = matches[i + 1]?.index ?? Math.min(normalizedBreaks.length, start + 3000);
    const block = cleanText(normalizedBreaks.slice(start, end));
    const interessado = between(block, /Interessado:\s*/i, /\s+Assunto:\s*/i);
    const assunto = between(
      block,
      /Assunto:\s*/i,
      /\s+(?:Decis[aÃ£]o:|\d+\.\d+\s+DIRETOR|\d+\.\d+(?:\.\d+)?\s+Processo|Processo\s*(?:n[Âºo])?|Documento assinado|Pauta da Reuni|Refer[eÃª]ncia:|$)/i,
    );
    const relator = extractNearestRelator(normalizedBreaks.slice(0, start)) ?? extractRelatorForBlock(block);
    const decisao = between(
      block,
      /Decis[aÃ£]o:\s*/i,
      /\s+(?:\d+\.\d+(?:\.\d+)?\s+Processo|Processo\s*(?:n[Âºo])?|Documento assinado|Refer[eÃª]ncia:|Pauta da Reuni|$)/i,
    );

    if (isSeiReferenceProcess(block, interessado, assunto)) {
      continue;
    }

    items.push({
      item_numero: match[1] ?? String(i + 1),
      processo: cleanText(match[2]),
      interessado,
      relator,
      assunto,
      decisao,
      resultado: decisao ? inferResultado(`${assunto ?? ""} ${decisao}`) : null,
      microtema: "outros",
      area_regulatoria: classifyAreaRegulatoria(`${interessado ?? ""} ${assunto ?? ""} ${decisao ?? ""}`),
    });
  }

  return dedupeItems(items);
}

function isSeiReferenceProcess(block: string, interessado: string | null, assunto: string | null) {
  if (interessado || assunto) return false;
  const value = normalize(block);
  return value.includes("referencia: processo") || value.includes("sei") || value.includes("documento assinado eletronicamente");
}

function extractRelatorForBlock(block: string) {
  const sectionRelator = firstMatch(block, /DIRETOR(?:-GERAL)?:\s*([A-ZÃÃ‰ÃÃ“ÃšÃ‚ÃŠÃ”ÃƒÃ•Ã‡ ]{3,80})/i);
  return sectionRelator ? titleCase(sectionRelator) : null;
}

function extractNearestRelator(prefix: string) {
  const matches = [...prefix.slice(-1800).matchAll(/DIRETOR(?:-GERAL)?:\s*([A-ZÃÃ‰ÃÃ“ÃšÃ‚ÃŠÃ”ÃƒÃ•Ã‡ ]{3,80})/gi)];
  const last = matches.at(-1)?.[1];
  return last ? titleCase(last) : null;
}

function extractVoteConclusion(text: string) {
  const conclusion = between(text, /Diante do exposto,?\s*/i, /\s+Documento assinado eletronicamente|$/i)
    ?? between(text, /Assim, concluo que\s*/i, /\s+Documento assinado eletronicamente|$/i)
    ?? between(text, /Ante o exposto,?\s*/i, /\s+Documento assinado eletronicamente|$/i)
    ?? between(text, /VOTO\s+por\s+/i, /\s+Documento assinado eletronicamente|$/i)
    ?? between(text, /Voto\s+pela\s+/i, /\s+Documento assinado eletronicamente|$/i)
    ?? between(text, /ENCAMINHAMENTO:\s*/i, /\s+(?:Bras[ÃƒÃ­i]lia|Documento assinado eletronicamente|$)/i)
    ?? between(text, /EMENTA\s*:\s*/i, /\s+(?:RELAT[ÃƒÃ“O]RIO|I\s+-\s+RELAT|$)/i);
  return conclusion ? conclusion.slice(0, 2000) : null;
}

function extractVoteNumber(text: string, filename: string) {
  const source = `${filename} ${text.slice(0, 1200)}`;
  const initials = firstMatch(source, /VOTO\s+(?:VISTA\s+)?([A-Z]{2,3})\b/i)
    ?? firstMatch(source, /RELATORIA:\s*(?:Diretoria\s+)?(?:[^\n:]+?\s+-\s*)?([A-Z]{2,3})\b/i);
  const number = firstMatch(source, /N[ÚU]MERO:\s*([0-9]{1,3}\/2026)/i)
    ?? firstMatch(filename, /(?:Voto|Declara[cç][aã]o de Voto)\s+(?:Vista\s+)?[A-Z]{2,3}\s+([0-9]{1,3})[-_ ]?2026/i);
  if (!number) return null;
  return initials ? `${initials} ${number}` : number;
}
function extractVoteOrigin(text: string) {
  return between(text, /ORIGEM:\s*/i, /\s+(?:PROCESSO\s*\(?S?\)?\s*:|PROPOSI[ÃƒÃ‡C][ÃƒÃƒA]O|ENCAMINHAMENTO|EMENTA|$)/i);
}

function extractVoteObject(text: string) {
  return between(text, /OBJETO:\s*/i, /\s+(?:ORIGEM:|PROCESSO\s*\(?S?\)?\s*:|PROPOSI[ÃƒÃ‡C][ÃƒÃƒA]O|ENCAMINHAMENTO|EMENTA|RELAT[ÃƒÃ“O]RIO|$)/i)
    ?? between(text, /EMENTA\s*:\s*/i, /\s+(?:RELAT[ÃƒÃ“O]RIO|I\s+-\s+RELAT|$)/i);
}

function extractVoteInterested(text: string) {
  const object = extractVoteObject(text) ?? "";
  return firstMatch(object, /pela\s+(empresa\s+[^,.]{3,140})/i)
    ?? firstMatch(object, /(Concession[ÃƒÃ¡a]ria\s+[^,.]{3,140})/i)
    ?? firstMatch(object, /entre\s+a\s+ANTT\s+e\s+([^,.]{3,140})/i)
    ?? firstMatch(object, /para\s+a\s+([^,.]{3,140})/i)
    ?? firstMatch(object, /junto\s+[aÃ ]\s+([^,.]{3,140})/i)
    ?? null;
}

function extractSeiUrl(text: string) {
  const match = /https?:\/\/sei\.antt\.gov\.br\/[^\s]+/i.exec(text);
  return match?.[0]?.slice(0, 1000) ?? null;
}

function inferResultado(text: string): string | null {
  const value = normalize(text);
  if (value.includes("indefer") || value.includes("negar provimento") || value.includes("cassacao")) return "Indeferido";
  if (value.includes("retirad") && value.includes("pauta")) return "Retirado de Pauta";
  if (value.includes("aprov") || value.includes("ratifico") || value.includes("autoriz")) return RESULTADO_APROVADO;
  return null;
}

function confidenceFor(
  type: AnttManualDocumentType,
  meetingNumber: string | null,
  processo: string | null,
  director: string | null,
  items: AtaPreviewItem[],
) {
  let score = 0.45;
  if (type !== "outro") score += 0.12;
  if (meetingNumber) score += 0.12;
  if (processo) score += 0.14;
  if (director) score += 0.12;
  if (items.length > 0) score += 0.16;
  return Math.min(0.95, score);
}

function buildWarnings(
  type: AnttManualDocumentType,
  meeting: { numero: string | null },
  firstProcess: AtaPreviewItem,
  director: string | null,
  items: AtaPreviewItem[],
) {
  const warnings: string[] = [];
  if (!meeting.numero && type !== "voto_individual") warnings.push("ANTT: nÃºmero da reuniÃ£o nÃ£o identificado com alta confianÃ§a.");
  if (!firstProcess.processo && items.length === 0) warnings.push("ANTT: processo nÃ£o identificado.");
  if (type === "voto_individual" && !director) warnings.push("ANTT: diretor autor do voto nÃ£o identificado.");
  if (shouldExposeItems(type) && items.length === 0) warnings.push("ANTT: pauta/ata sem processos separados; revisar layout do PDF.");
  if (type !== "voto_individual") warnings.push("ANTT: documento tratado como pauta/ata revisÃ¡vel; votos nÃ£o sÃ£o criados automaticamente.");
  return warnings;
}

function firstMatch(value: string, pattern: RegExp) {
  const match = pattern.exec(value);
  return match?.[1] ? cleanText(match[1]) : null;
}

function extractMeetingFromPlain(value: string) {
  const source = plain(value);
  const rde = firstPlainMatch(source, /(\d{1,4}(?:[.\s]\d{3})?)\s*a?\s*(?:rde|reuniao deliberativa eletronica|reuniao de diretoria eletronica)/i)
    ?? firstPlainMatch(source, /reuniao deliberativa eletronica\s+n\s+(\d{1,4}(?:[.\s]\d{3})?)/i);
  const publica = firstPlainMatch(source, /(\d{1,4}(?:[.\s]\d{3})?)\s*a?\s*(?:reuniao de diretoria publica|reuniao publica de diretoria)/i)
    ?? firstPlainMatch(source, /reuniao de diretoria\s+n\s+(\d{1,4}(?:[.\s]\d{3})?)/i);
  const extraordinaria = firstPlainMatch(source, /(\d{1,3})\s*a?\s*reuniao extraordinaria de diretoria/i);

  if (rde) return { numero: formatMeetingNumber(rde), kind: "rde" as const };
  if (publica) return { numero: formatMeetingNumber(publica), kind: "publica" as const };
  if (extraordinaria) return { numero: formatMeetingNumber(extraordinaria), kind: "extraordinaria" as const };
  return { numero: null, kind: null };
}

function firstPlainMatch(value: string, pattern: RegExp) {
  const match = pattern.exec(value);
  return match?.[1] ? cleanText(match[1]) : null;
}

function formatMeetingNumber(value: string | null) {
  if (!value) return null;
  const cleaned = cleanText(value).replace(/\s+/, ".");
  return /^\d{1,4}\.\d{3}$/.test(cleaned) ? cleaned : cleaned.replace(/\.$/, "");
}

function formatMeetingTitle(kind: "rde" | "publica" | "extraordinaria" | null, numero: string | null, fallback: string) {
  if (kind === "rde") return numero ? `${numero}Âª ReuniÃ£o Deliberativa EletrÃ´nica` : "ReuniÃ£o Deliberativa EletrÃ´nica";
  if (kind === "publica") return numero ? `${numero}Âª ReuniÃ£o de Diretoria PÃºblica` : "ReuniÃ£o de Diretoria PÃºblica";
  if (kind === "extraordinaria") return numero ? `${numero}Âª ReuniÃ£o ExtraordinÃ¡ria de Diretoria` : "ReuniÃ£o ExtraordinÃ¡ria de Diretoria";
  return fallback;
}

function between(value: string, start: RegExp, end: RegExp) {
  const startMatch = start.exec(value);
  if (!startMatch) return null;
  const rest = value.slice(startMatch.index + startMatch[0].length);
  const endMatch = end.exec(rest);
  return cleanText((endMatch ? rest.slice(0, endMatch.index) : rest)).slice(0, 2000) || null;
}

function iso(day: string, month: string, year: string) {
  return `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`;
}

function monthNumber(month: string) {
  const key = normalize(month);
  const months: Record<string, string> = {
    janeiro: "01",
    fevereiro: "02",
    marco: "03",
    abril: "04",
    maio: "05",
    junho: "06",
    julho: "07",
    agosto: "08",
    setembro: "09",
    outubro: "10",
    novembro: "11",
    dezembro: "12",
  };
  return months[key] ?? null;
}

function portugueseDayNumber(value: string) {
  const key = plain(value);
  const days: Record<string, string> = {
    primeiro: "01",
    segundo: "02",
    terceiro: "03",
    quarto: "04",
    quinto: "05",
    sexto: "06",
    setimo: "07",
    oitavo: "08",
    nono: "09",
    decimo: "10",
    "decimo primeiro": "11",
    "decimo segundo": "12",
    "decimo terceiro": "13",
    "decimo quarto": "14",
    "decimo quinto": "15",
    "decimo sexto": "16",
    "decimo setimo": "17",
    "decimo oitavo": "18",
    "decimo nono": "19",
    vigesimo: "20",
    "vigesimo primeiro": "21",
    "vigesimo segundo": "22",
    "vigesimo terceiro": "23",
    "vigesimo quarto": "24",
    "vigesimo quinto": "25",
    "vigesimo sexto": "26",
    "vigesimo setimo": "27",
    "vigesimo oitavo": "28",
    "vigesimo nono": "29",
    trigesimo: "30",
    "trigesimo primeiro": "31",
  };
  return days[key] ?? null;
}

function lastWordDateCandidate(value: string, marker: "ao" | "do") {
  const parts = plain(value).split(new RegExp(`\\b${marker}\\s+`, "i"));
  return parts.at(-1) ?? value;
}

function dedupeItems(items: AtaPreviewItem[]) {
  const seen = new Set<string>();
  return items.filter((item) => {
    const key = `${item.item_numero}|${item.processo}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function titleCase(value: string) {
  return cleanText(value)
    .replace(/\b(HTTPS?|WWW|GOV|BR|SEI)\b.*$/i, "")
    .trim()
    .toLowerCase()
    .split(" ")
    .filter(Boolean)
    .map((part) => part.length <= 2 ? part.toUpperCase() : part[0].toUpperCase() + part.slice(1))
    .join(" ");
}

function cleanText(value: string) {
  // Normaliza o sinal de GRAU (°, U+00B0) para ORDINAL (º, U+00BA): PDFs usam "°" em
  // "Processo n°"/"Reunião n°", que de outro modo zerava a extração de processos ANTT.
  return value.replace(/°/g, "º").replace(/\s+/g, " ").trim();
}

function normalize(value: string) {
  return cleanText(value)
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

function plain(value: string) {
  return normalize(value)
    .replace(/[ÂºÂª]/g, "a")
    .replace(/[_]+/g, " ")
    .replace(/[^a-z0-9./\s-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

