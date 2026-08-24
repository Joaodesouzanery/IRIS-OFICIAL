import type { AtaPreviewItem, PreviewResultFields, TipoDocumento } from "@/types";
import { classifyAreaRegulatoria } from "@/lib/server/area-regulatoria";
import { RE_RETIRADA, RE_SUSPENSAO } from "@/lib/server/ata-splitter";

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

// Códigos de PESSOA: "D" + inicial do 1º nome + inicial de um sobrenome. Identificam alguém.
// "DG" NÃO está aqui — ver ANTT_SIGLAS_CARGO logo abaixo.
const ANTT_DIRECTOR_INITIALS: Record<string, string> = {
  DLA: "Lucas Asfor",
  DFQ: "Felipe Queiroz",
  DAA: "Alex Azevedo",
  DAB: "Alessandro Baumgartner",
  DSM: "Severino Medeiros",
  DGS: "Guilherme Sampaio",
};

// CARGO ≠ PESSOA (etapa55). "DG" é a sigla do cargo Diretor-Geral, não o código de uma pessoa.
// Enquanto "DG" apontava para um nome FIXO, todo "Voto DG" era gravado no mesmo diretor para
// sempre — inclusive depois da troca de diretoria, e inclusive quando quem assinava era o
// Diretor-Geral SUBSTITUTO. O cargo é resolvido por evidência (texto → cargo exercido → mandato
// vigente na data) e, sem evidência, NÃO vira voto.
const ANTT_SIGLAS_CARGO: Record<string, string> = {
  DG: "diretor-geral",
  DGA: "diretor-geral-adjunto",
};

// "na condição de Diretor-Geral substituto, NOME" / "o Diretor-Geral, NOME," — o documento
// dizendo QUEM exercia o cargo. Depende da etapa49: sem o conserto da ligadura, "substituto" vem
// quebrado ("subs7tuto") e esta regex não casa.
const RE_ANTT_CARGO_EXERCIDO =
  /(?:na\s+condi[çc][ãa]o\s+de\s+|pelo\s+|o\s+)?Diretor[-\s]Geral(?:\s+(?:substitut[oa]|interin[oa]|em\s+exerc[íi]cio))?\s*,?\s+([A-ZÁÉÍÓÚÂÊÔÃÕÇÀÜ][A-Za-zÁ-Üá-ü]+(?:\s+(?:d[aeo]s?|[A-ZÁÉÍÓÚÂÊÔÃÕÇÀÜ][A-Za-zÁ-Üá-ü]+)){1,5})/;

/**
 * Mandatos por CARGO e data, injetados pelo chamador (mesmo padrão de `setAnttDynamicInitials`):
 * `{ "diretor-geral": [{ nome, inicio, fim }] }`. Último recurso da cascata — só é consultado
 * quando o próprio documento não diz quem exercia o cargo.
 */
export type AnttCargoMandato = { nome: string; inicio: string; fim: string | null };
let CARGO_MANDATOS: Record<string, AnttCargoMandato[]> = {};

export function setAnttCargoMandatos(map: Record<string, AnttCargoMandato[]>) {
  CARGO_MANDATOS = map ?? {};
}

/** Quem exercia `cargo` em `data` (null se não houver exatamente UM mandato vigente). */
export function resolveCargoPorMandato(cargo: string, data: string | null): string | null {
  if (!data) return null;
  const vigentes = (CARGO_MANDATOS[cargo] ?? []).filter(
    (m) => m.inicio <= data && (!m.fim || m.fim >= data),
  );
  // Dois mandatos vigentes para o mesmo cargo na mesma data = dado ambíguo. Escolher um seria
  // exatamente o erro que esta etapa existe para acabar.
  return vigentes.length === 1 ? vigentes[0].nome : null;
}

// Iniciais DINÂMICAS derivadas do CADASTRO (ago/2026): na troca de diretoria, o novo
// "Voto DXY" passa a resolver sem deploy — deriva-se "D"+iniciais (1º nome + cada sobrenome)
// dos diretores ANTT aprovados. O hardcode curado acima sempre VENCE em conflito; código
// ambíguo (2 diretores gerariam a mesma sigla) é descartado.
let DYNAMIC_INITIALS: Record<string, string> = {};

export function setAnttDynamicInitials(map: Record<string, string>) {
  DYNAMIC_INITIALS = map ?? {};
}

export function buildAnttDirectorInitials(
  diretores: Array<{ nome: string; nome_variantes?: string[] }>,
): Record<string, string> {
  const porCodigo = new Map<string, Set<string>>();
  for (const d of diretores) {
    const nomes = [d.nome, ...(d.nome_variantes ?? [])].filter(Boolean);
    for (const nome of nomes) {
      const tokens = nome.trim().split(/\s+/).filter((t) => t.length > 2 || /^[A-ZÁ-Ü]/.test(t));
      const conteudo = tokens.filter((t) => !/^(de|da|do|dos|das|e)$/i.test(t));
      if (conteudo.length < 2) continue;
      const primeiro = conteudo[0][0]?.toUpperCase();
      if (!primeiro) continue;
      // Nome de exibição: 1º nome + último sobrenome do nome PRINCIPAL (não da variante).
      const principalTokens = d.nome.trim().split(/\s+/).filter((t) => !/^(de|da|do|dos|das|e)$/i.test(t));
      const display = principalTokens.length >= 2 ? `${principalTokens[0]} ${principalTokens[principalTokens.length - 1]}` : d.nome;
      for (let i = 1; i < conteudo.length; i++) {
        const codigo = `D${primeiro}${conteudo[i][0]?.toUpperCase() ?? ""}`;
        if (!/^D[A-Z]{2}$/.test(codigo)) continue;
        const set = porCodigo.get(codigo) ?? new Set<string>();
        set.add(display);
        porCodigo.set(codigo, set);
      }
    }
  }
  const out: Record<string, string> = {};
  for (const [codigo, nomes] of porCodigo) {
    if (nomes.size === 1) out[codigo] = [...nomes][0]; // ambíguo (2 diretores) → fora
  }
  return out;
}

/** Mapa efetivo: dinâmico (cadastro) + curado (hardcode VENCE em conflito). */
function anttInitials(): Record<string, string> {
  return { ...DYNAMIC_INITIALS, ...ANTT_DIRECTOR_INITIALS };
}

/**
 * O código é um IDENTIFICADOR de voto da ANTT — de pessoa OU de cargo (etapa55).
 * Usado só para RECONHECER o documento. A ATRIBUIÇÃO do autor é outra coisa: um código de cargo
 * ("DG") passa pela cascata de evidência e pode terminar sem autor. Sem esta separação, tirar "DG"
 * da tabela de pessoas faria o voto do Diretor-Geral deixar de ser reconhecido como voto — de
 * atribuído-ao-errado ele passaria a INVISÍVEL, que é pior.
 */
function isAnttCodigoDeVoto(codigo: string): boolean {
  const c = codigo.toUpperCase();
  return Object.prototype.hasOwnProperty.call(anttInitials(), c)
    || Object.prototype.hasOwnProperty.call(ANTT_SIGLAS_CARGO, c);
}

const ANTT_DIRECTOR_ALIASES: Array<{ canonical: string; aliases: string[] }> = [
  { canonical: "Guilherme Sampaio", aliases: ["Guilherme Sampaio", "Guilherme Theo Rodrigues da Rocha Sampaio", "Diretor-Geral Guilherme"] },
  { canonical: "Lucas Asfor", aliases: ["Lucas Asfor", "Lucas Asfor Rocha Lima"] },
  { canonical: "Felipe Queiroz", aliases: ["Felipe Queiroz", "Felipe Fernandes Queiroz"] },
  { canonical: "Alex Azevedo", aliases: ["Alex Azevedo", "Alex Antonio de Azevedo Cruz", "Alex AntÃ´nio de Azevedo Cruz"] },
  { canonical: "Alessandro Baumgartner", aliases: ["Alessandro Baumgartner"] },
  { canonical: "Severino Medeiros", aliases: ["Severino Medeiros", "Severino Medeiros Ramos Neto"] },
];

const RESULTADO_APROVADO = "Aprovado";

// Filename no padrão dos votos ANTT ("Voto DFQ 035-2026.pdf", "Voto-DLA-37-2026...", "Declaracao
// de Voto DAB 12-2026"): iniciais de diretor + número/ano. Upload manual do SEI muitas vezes NÃO
// tem a string "ANTT" nem no nome nem nos primeiros 5000 chars — sem este sinal o parser nem
// rodava e o voto real virava "? · documento_apoio" (perdido). Aditivo: só LIGA o parser; a
// direção do voto continua nunca sendo chutada.
const RE_ANTT_VOTO_FILENAME = /\bvoto[\s_-]+(?:vista[\s_-]+)?(D[A-Z]{1,2}|DG)[\s_-]*\d{1,4}[\s_-]*[-_/]?[\s_-]*20\d{2}/i;

export function isAnttVotoFilename(filename: string): boolean {
  const m = RE_ANTT_VOTO_FILENAME.exec(filename);
  if (!m) return false;
  return isAnttCodigoDeVoto(m[1]);
}

export function parseAnttManualDocument(text: string, filename: string): AnttManualParseResult {
  const clean = cleanText(text);
  const normalized = normalize(`${filename} ${clean.slice(0, 5000)}`);
  const isAntt =
    /\bantt\b/.test(normalized) ||
    normalized.includes("agencia nacional de transportes terrestres") ||
    isAnttVotoFilename(filename);

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
  const date = extractAnttDate(clean, filename, documentType);
  const directorInfo = extractDirector(clean, filename, documentType, date);
  const director = directorInfo.nome;
  const attendance = extractAnttAttendance(clean);
  const processes = extractAnttProcessesV2(clean);
  const enrichedProcesses = processes.map((item) => enrichAnttItem(item, documentType, attendance.present, attendance.absent, attendance.ambiguous));
  const firstProcess = enrichedProcesses[0] ?? extractSingleProcess(clean, filename, documentType);
  const area_regulatoria = classifyAreaRegulatoria([
    firstProcess.assunto,
    firstProcess.interessado,
    firstProcess.decisao,
    clean.slice(0, 8000),
  ].filter(Boolean).join(" "));
  const seiUrl = extractSeiUrl(clean);
  // Resultado do voto individual: NUNCA defaulta para "Aprovado" — a direção do voto
  // (favorável/contrário) é exatamente o dado que não pode ser chutado. Sem conclusão
  // parseada → null + warning de qualidade (vai para revisão humana).
  const voteConclusion = documentType === "voto_individual"
    ? extractVoteConclusion(clean)
    : { text: null as string | null, fromTail: false };
  const votoResultado = documentType === "voto_individual"
    ? inferResultado(`${firstProcess.assunto ?? ""} ${firstProcess.decisao ?? ""} ${voteConclusion.text ?? ""}`)
    : null;
  const warnings = buildWarnings(documentType, meeting, firstProcess, director, processes, {
    votoResultado,
    directorAmbiguo: directorInfo.ambiguo,
    cargoNaoResolvido: directorInfo.cargoNaoResolvido ?? null,
    directorSoIniciais: directorInfo.soIniciais,
    iniciaisDesconhecidas: directorInfo.iniciaisDesconhecidas ?? null,
    resultadoSoCauda: documentType === "voto_individual" && votoResultado !== null && voteConclusion.fromTail,
  });
  const tipoDocumento = mapToPlatformDocumentType(documentType);
  const numeroDeliberacao = extractAnttDocumentNumber(clean, filename, documentType);
  // Chave de dedup do voto: data da reunião OU número VOTO-* estável.
  const hasDedupKey = Boolean(date || numeroDeliberacao || firstProcess.processo);

  const fields: Partial<PreviewResultFields> = {
    numero_deliberacao: numeroDeliberacao,
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
      ? votoResultado
      : (documentType === "ata" || documentType.startsWith("reuniao_")) ? firstProcess.resultado : null,
    microtema: firstProcess.microtema ?? classifyAnttMicrotema(`${firstProcess.assunto ?? ""} ${firstProcess.decisao ?? ""}`),
    pauta_interna: false,
    area_regulatoria,
    resumo_pleito: firstProcess.decisao,
    fundamento_decisao: documentType === "voto_individual" ? voteConclusion.text : firstProcess.decisao,
    nomes_votacao: documentType === "voto_individual" && director ? [director] : [],
    nomes_votacao_contra: [],
  };

  return {
    isAntt: true,
    documentType,
    fields,
    ataItems: shouldExposeItems(documentType) ? enrichedProcesses : undefined,
    confidenceBoost: confidenceFor(documentType, meeting.numero, firstProcess.processo, director, enrichedProcesses, hasDedupKey),
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
  if (type === "voto_individual") {
    // "Voto DFQ 043-2026" / "Voto DAB 030/2026" → "VOTO-DFQ-043-2026": chave
    // ESTÁVEL de dedup (o mesmo voto reprocessado 2× casa a unique parcial;
    // não colide com os "ATA-*" dos itens de ata).
    const m = /voto\s+(?:vista\s+)?(d[a-z]{1,3}|dg)\s*n?[ºo]?\s*(\d{1,4})\s*[-/.]\s*(20\d{2})/i.exec(`${filename} ${text.slice(0, 800)}`);
    if (m) return `VOTO-${m[1].toUpperCase()}-${m[2].padStart(3, "0")}-${m[3]}`;
    return null;
  }
  return null;
}

// Aceita qualquer ano 20xx (antes hardcodava 2026 → documentos de outros anos ficavam
// sem data e a extenso "dois mil e vinte e seis" era o único caso coberto).
function extractAnttDate(text: string, filename: string, type?: AnttManualDocumentType) {
  // VOTO INDIVIDUAL: a data do voto é a do FECHO assinado pelo diretor ("Brasília, 09 de março de
  // 2026." / "Documento assinado eletronicamente por X, Diretor, em 09/03/2026"), que fica no FIM
  // da peça. O cabeçalho de um voto é relatório e está cheio de datas do PROCESSO — a varredura
  // dos primeiros 2.500 caracteres pescava a primeira delas. Medido no Voto DAB 002/2026: saía
  // 05/11/2025 (data em que a empresa protocolou o pedido) em vez de 09/03/2026.
  if (type === "voto_individual") {
    const cauda = text.slice(-2500);
    const fecho = /Bras[ií]lia,?\s*(\d{1,2})\s+de\s+([A-Za-zÀ-ÿ]+)\s+de\s+(20\d{2})/i.exec(cauda);
    if (fecho) {
      const mes = monthNumber(plain(fecho[2]));
      if (mes) return iso(fecho[1], mes, fecho[3]);
    }
    const assinatura = /assinado eletronicamente por[^,]{0,80},\s*Diretor[^,]{0,40},\s*em\s*(\d{1,2})\/(\d{1,2})\/(20\d{2})/i.exec(cauda);
    if (assinatura) return iso(assinatura[1], assinatura[2], assinatura[3]);
  }

  const source = `${filename} ${text.slice(0, 2500)}`;
  const sourcePlain = plain(source);
  const periodo = /periodo:\s*(\d{1,2})[./](\d{1,2})\s+a\s+\d{1,2}[./]\d{1,2}[./](20\d{2})/i.exec(sourcePlain);
  if (periodo) return iso(periodo[1], periodo[2], periodo[3]);

  // A captura do ANO era GULOSA e sem limite: `([a-z\s]+)` engolia "vinte e seis as dezesseis
  // horas e cinquenta minutos realizou se por videoconferencia..." e portugueseYearNumber devolvia
  // null. A data caía no fallback NUMÉRICO, que pega o primeiro dd/mm/aaaa dos 2.500 primeiros
  // caracteres — normalmente uma data CITADA. Medido: a ata da 1.024ª (19/01/2026) saía 26/12/2025.
  // Bounded a 4 palavras, que cobre "vinte e seis" com folga e para antes da vírgula.
  const wordRange = /do\s+([a-z\s]+?)\s+ao\s+[a-z\s]+?\s+dia\s+do\s+mes\s+de\s+([a-z]+)\s+do\s+ano\s+de\s+dois\s+mil\s+e\s+((?:[a-z]+\s+){0,3}[a-z]+?)(?=[,.]|\s+as\s|\s+realizou|$)/i.exec(sourcePlain);
  if (wordRange) {
    const day = portugueseDayNumber(wordRange[1]) ?? portugueseDayNumber(lastWordDateCandidate(wordRange[1], "do"));
    const month = monthNumber(wordRange[2]);
    const year = portugueseYearNumber(wordRange[3]);
    if (day && month && year) return iso(day, month, year);
  }

  const wordSingle = /ao\s+([a-z\s]+?)\s+dia\s+do\s+mes\s+de\s+([a-z]+)\s+do\s+ano\s+de\s+dois\s+mil\s+e\s+((?:[a-z]+\s+){0,3}[a-z]+?)(?=[,.]|\s+as\s|\s+realizou|$)/i.exec(sourcePlain);
  if (wordSingle) {
    const day = portugueseDayNumber(wordSingle[1]) ?? portugueseDayNumber(lastWordDateCandidate(wordSingle[1], "ao"));
    const month = monthNumber(wordSingle[2]);
    const year = portugueseYearNumber(wordSingle[3]);
    if (day && month && year) return iso(day, month, year);
  }
  const rangeWithImplicitStart = /de\s+(\d{1,2})\s+a\s+\d{1,2}[./](\d{1,2})[./](20\d{2})/i.exec(source);
  if (rangeWithImplicitStart) return iso(rangeWithImplicitStart[1], rangeWithImplicitStart[2], rangeWithImplicitStart[3]);

  const rangeWithExplicitStart = /de\s+(\d{1,2})[./](\d{1,2})\s+a\s+\d{1,2}[./]\d{1,2}[./](20\d{2})/i.exec(source);
  if (rangeWithExplicitStart) return iso(rangeWithExplicitStart[1], rangeWithExplicitStart[2], rangeWithExplicitStart[3]);

  const numeric = /(\d{1,2})[./](\d{1,2})[./](20\d{2})/.exec(source);
  if (numeric) return iso(numeric[1], numeric[2], numeric[3]);

  const long = /(\d{1,2})\s+DE\s+([A-ZÇÃÉ]+)\s+DE\s+(20\d{2})/i.exec(source);
  if (long) return iso(long[1], monthNumber(long[2]) ?? "01", long[3]);

  return null;
}

// "vinte e seis" → "2026"; "vinte e cinco" → "2025"; "trinta" → "2030".
function portugueseYearNumber(value: string): string | null {
  const tail = plain(value).trim().replace(/\.$/, "");
  const n = NUMEROS_ANO_EXTENSO[tail];
  return n ? String(2000 + n) : null;
}

const NUMEROS_ANO_EXTENSO: Record<string, number> = {
  "vinte": 20, "vinte e um": 21, "vinte e dois": 22, "vinte e tres": 23, "vinte e quatro": 24,
  "vinte e cinco": 25, "vinte e seis": 26, "vinte e sete": 27, "vinte e oito": 28,
  "vinte e nove": 29, "trinta": 30,
};

// O diretor-autor de um voto_individual vira o ÚNICO votante do documento — errar aqui
// é registrar o voto no nome errado. Por isso as INICIAIS (2-3 letras, corrompíveis e de
// tabela fixa) são só uma DICA: quando também há um nome textual (RELATORIA/assinatura)
// e ele DIVERGE do canônico das iniciais, retornamos ambíguo (sem voto automático).
function extractDirector(
  text: string,
  filename: string,
  type: AnttManualDocumentType,
  dataReuniao: string | null = null,
): { nome: string | null; ambiguo: boolean; soIniciais: boolean; iniciaisDesconhecidas?: string | null; cargoNaoResolvido?: string | null } {
  const signature = firstMatch(text.slice(-3000), /Documento assinado eletronicamente por\s+([^,]+),\s+Diretor/i)
    // SEM a flag `i` (etapa55): com ela o macro de nome em CAIXA ALTA virava case-insensitive e
    // casava prosa comum — "Apresentado na condição de Diretor-Geral…" saía como se fosse o nome
    // do signatário. Mesmo defeito que o RE_VOTO_AUSENTE do nlp-extractor já documentava.
    ?? firstMatch(text.slice(-2000), /([A-ZÁÉÍÓÚÂÊÔÃÕÇÀÜ ]{8,})\s+(?:Diretor|DIRETOR)(?:a|A)?\b/);
  const signatureName = signature ? titleCase(signature) : null;

  if (type === "voto_individual") {
    const source = `${filename} ${text.slice(0, 1500)}`;
    // Fronteira `(?![A-Za-zÀ-ÿ])` no lugar de `\b`: em JS o `\b` é ASCII, então "É" conta como
    // fronteira e "VOTO JOSÉ FERNANDO…" era lido como iniciais "JOS". Sem a flag `i`, também: um
    // código de diretor é MAIÚSCULO por definição, e o `i` fazia "voto por…" virar candidato.
    const FIM_SIGLA = "(?![A-Za-zÀ-ÿ])";
    const initials = firstMatch(source, new RegExp(`VISTA:\\s*([A-Z]{2,3})${FIM_SIGLA}`))
      ?? firstMatch(source, new RegExp(`VOTO\\s+VISTA\\s+([A-Z]{2,3})${FIM_SIGLA}`))
      ?? firstMatch(source, new RegExp(`VOTO\\s+([A-Z]{2,3})${FIM_SIGLA}`))
      ?? firstMatch(source, new RegExp(`RELATORIA:\\s*(?:Diretoria\\s+)?(?:[^\\n:]+?\\s+-\\s*)?([A-Z]{2,3})${FIM_SIGLA}`))
      ?? firstMatch(source, new RegExp(`RELATORIA:\\s*([A-Z]{2,3})${FIM_SIGLA}`));
    const relatoriaNome = firstMatch(source, /RELATORIA:\s*Diretoria\s+([^\n:]+?)(?:\s+-\s*[A-Z]{2,3}|\s+TERMO:|\s+N[ÚU]MERO:|$)/i)
      ?? firstMatch(source, /RELATORIA:\s*([^\n:]{5,90})(?:\s+TERMO:|\s+N[ÚU]MERO:|$)/i);
    const textualName = relatoriaNome ? titleCase(relatoriaNome) : signatureName;

    // CARGO (etapa55): "DG" identifica a função, não a pessoa. Cascata de evidência — nome no
    // próprio texto → cargo exercido declarado → mandato vigente na data. Esgotada a cascata, o
    // documento vai para revisão SEM autor: atribuir o voto a um nome fixo era registrar o voto
    // do Diretor-Geral SUBSTITUTO no titular, e o do titular novo no antigo.
    const cargo = initials ? ANTT_SIGLAS_CARGO[initials] ?? null : null;
    if (cargo) {
      const exercido = RE_ANTT_CARGO_EXERCIDO.exec(text.slice(0, 4000))?.[1]?.trim() ?? null;
      const porMandato = resolveCargoPorMandato(cargo, dataReuniao);
      // O documento DIZENDO quem exercia o cargo é a evidência mais forte e vem primeiro: o nome
      // "textual" genérico vem de heurística de assinatura/relatoria e é o mais frágil dos três.
      const nome = (exercido ? titleCase(exercido) : null) ?? porMandato ?? textualName;
      if (nome) return { nome, ambiguo: false, soIniciais: false };
      return { nome: null, ambiguo: true, soIniciais: false, cargoNaoResolvido: cargo };
    }

    const fromInitials = initials ? anttInitials()[initials] ?? null : null;

    if (fromInitials && textualName) {
      // Cruzamento: o nome textual precisa pertencer ao mesmo diretor das iniciais.
      return sameAnttDirector(fromInitials, textualName)
        ? { nome: fromInitials, ambiguo: false, soIniciais: false }
        : { nome: null, ambiguo: true, soIniciais: false };
    }
    // Só iniciais, SEM nome textual p/ conferir → DAA↔DAB (1 letra) grava no diretor errado sem
    // aviso. Marca soIniciais p/ o buildWarnings mandar à revisão (não bloqueia). F3.
    if (fromInitials) return { nome: fromInitials, ambiguo: false, soIniciais: true };
    // Iniciais no padrão de diretor, mas AUSENTES da tabela (ex.: diretoria mudou e entrou "DXY"):
    // sinaliza para o buildWarnings — sem isto o voto de um diretor NOVO perde o autor em silêncio.
    if (initials && /^D[A-Z]{1,2}$/.test(initials)) {
      return { nome: textualName ?? null, ambiguo: false, soIniciais: false, iniciaisDesconhecidas: initials };
    }
    if (textualName) return { nome: textualName, ambiguo: false, soIniciais: false };
    return { nome: null, ambiguo: false, soIniciais: false };
  }

  return { nome: signatureName, ambiguo: false, soIniciais: false };
}

function sameAnttDirector(canonical: string, textualName: string): boolean {
  const entry = ANTT_DIRECTOR_ALIASES.find((item) => item.canonical === canonical);
  const aliases = entry ? entry.aliases : [canonical];
  const textual = normalize(textualName);
  return aliases.some((alias) => {
    const a = normalize(alias);
    return textual.includes(a) || a.includes(textual);
  });
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
    const decisao = extractVoteConclusion(text).text;
    const relator = firstMatch(`${filename} ${text.slice(0, 1200)}`, /Voto\s+([A-Z]{2,3})\b/i);
    return {
      item_numero: "1",
      processo,
      interessado,
      // Cargo não resolve para nome aqui: `extractDirector` é quem aplica a cascata de evidência.
      relator: relator && !ANTT_SIGLAS_CARGO[relator.toUpperCase()] ? anttInitials()[relator] ?? null : null,
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
  const decisao = extractVoteConclusion(text).text;
  const relator = firstMatch(text, /Voto\s+([A-Z]{3})\s+\d+/i);
  return {
    item_numero: "1",
    processo,
    interessado,
    relator: relator && !ANTT_SIGLAS_CARGO[relator.toUpperCase()] ? anttInitials()[relator] ?? null : null,
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
  attendanceAmbiguous = false,
): AtaPreviewItem {
  const text = `${item.assunto ?? ""} ${item.decisao ?? ""}`;
  // Inclui RDE / reunião deliberativa eletrônica: também têm decisão e voto unânime
  // (antes só "ata" contava → RDE perdia votos unânimes e zerava o resultado).
  const isDeliberativa = documentType === "ata" || documentType.startsWith("reuniao_");
  const retirada = isRetiradaDePauta(item.decisao);
  const unanimidade = isDeliberativa && Boolean(item.decisao) && !retirada && /unanimidade/i.test(normalize(item.decisao ?? ""));
  // Presença ambígua (marcador "Ausente" sem ausentes identificados): NÃO atribui votos
  // — um ausente registrado como favorável é pior que mandar o item para revisão.
  const votos = unanimidade && !attendanceAmbiguous ? presentDirectors : [];
  const warnings = [
    ...(item.warnings ?? []),
    ...(unanimidade && attendanceAmbiguous ? ["ANTT: presença/ausência ambígua no cabeçalho — votos unânimes não atribuídos; revisar presença."] : []),
    ...(unanimidade && !attendanceAmbiguous && votos.length === 0 ? ["ANTT: decisão unânime, mas diretores presentes não foram identificados com segurança."] : []),
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
  // Ambíguo: o cabeçalho fala em "Ausente" mas nenhum ausente foi identificado — o
  // delimitador pode ter cortado errado (risco de ausente virar voto favorável).
  const ambiguous = Boolean(absentMatch) && absent.length === 0;
  return {
    present: present.filter((name) => !absent.includes(name)),
    absent,
    ambiguous,
  };
}

function detectDirectorAliases(value: string) {
  const source = normalize(value);
  return ANTT_DIRECTOR_ALIASES
    .filter((entry) => entry.aliases.some((alias) => source.includes(normalize(alias))))
    .map((entry) => entry.canonical);
}

function isRetiradaDePauta(value: string | null) {
  // Etapa56: era `includes("retir") && includes("pauta")` — SEM adjacência. Bastava a palavra
  // "pauta" aparecer em qualquer ponto do item para uma "retirada de interferências" marcar o
  // processo como retirado. Agora o objeto da retirada vem de lista FECHADA e colada ao verbo,
  // e "retirado da REUNIÃO/SESSÃO" — que "de pauta" não pegava — passa a contar.
  return RE_RETIRADA.test(value ?? "");
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

function extractVoteConclusion(text: string): { text: string | null; fromTail: boolean } {
  const END = /\s+Documento assinado eletronicamente|$/i;
  // Lead-ins do dispositivo/voto (QA Etapa 19: a maioria dos votos ANTT ficava sem
  // `resultado` porque o dispositivo usa fórmulas variadas). Ordem não importa (1º que casa).
  // "PROPOSIÇÃO FINAL" primeiro: é o rótulo que a ANTT usa para a conclusão do diretor, e ele
  // separa sem ambiguidade o dispositivo PRÓPRIO do que foi apenas transcrito no relatório.
  // Todos os demais usam betweenLast — o dispositivo do voto é o ÚLTIMO, nunca o primeiro.
  const conclusion = between(text, /(?:D[AO]\s+)?PROPOSI[ÇC][ÃA]O\s+FINAL\s*[:.]?\s*/i, END)
    ?? betweenLast(text, /Diante do exposto,?\s*/i, END)
    ?? betweenLast(text, /Assim, concluo que\s*/i, END)
    // "Ante AO exposto" é variante real (Voto DAB 002) que a forma com "o" não cobria.
    ?? betweenLast(text, /Ante\s+a?o\s+exposto,?\s*/i, END)
    ?? betweenLast(text, /(?:Isto|Isso)\s+posto,?\s*/i, END)
    ?? betweenLast(text, /Pelo\s+exposto,?\s*/i, END)
    ?? betweenLast(text, /Por\s+todo\s+o\s+exposto,?\s*/i, END)
    ?? betweenLast(text, /(?:Em\s+face|Face)\s+(?:d?ao?)\s+exposto,?\s*/i, END)
    ?? betweenLast(text, /N[ea]stes?\s+termos,?\s*/i, END)
    ?? betweenLast(text, /Nesses\s+termos,?\s*/i, END)
    ?? betweenLast(text, /VOTO\s+por\s+/i, END)
    ?? betweenLast(text, /Voto\s+pel[ao]\s+/i, END)
    ?? betweenLast(text, /Voto\s+no\s+sentido\s+/i, END)
    ?? betweenLast(text, /Conclui-se\s+/i, END)
    ?? betweenLast(text, /(?:DISPOSITIVO|CONCLUS[AÃ]O)\s*:?\s*/i, END)
    ?? between(text, /ENCAMINHAMENTO:\s*/i, /\s+(?:Bras[ÃƒÃ­i]lia|Documento assinado eletronicamente|$)/i)
    ?? between(text, /EMENTA\s*:\s*/i, /\s+(?:RELAT[ÃƒÃ“O]RIO|I\s+-\s+RELAT|$)/i);
  if (conclusion) return { text: conclusion.slice(0, 2000), fromTail: false };
  // Rede final: o dispositivo assinado fica no FIM do documento. Antes varríamos os últimos 3000
  // chars CRUS, o que podia pescar um verbo de trecho NÃO relacionado ("...que aprovou...") e
  // INVENTAR direção (P6). Agora escopa à janela final (~2500) e, se houver CABEÇALHO de dispositivo
  // nela, começa APÓS a última âncora. Marca fromTail p/ o caller avisar (revisar direção). F4.
  // NÃO ancoramos em "VOTO"/"É O VOTO": "É o voto." é o FECHO da peça (vem DEPOIS do dispositivo) e
  // ancorar nele perderia o verbo decisório anterior (regressão de recall).
  const anchor = /\b(?:DISPOSITIVO|CONCLUS[AÃ]O|DECIDO|DECIS[AÃ]O)\b/gi;
  const window = text.slice(-2500);
  let lastIdx = -1;
  let m: RegExpExecArray | null;
  while ((m = anchor.exec(window)) !== null) lastIdx = m.index;
  const region = (lastIdx >= 0 ? window.slice(lastIdx) : window).trim();
  return region.length >= 40 ? { text: region.slice(0, 2000), fromTail: true } : { text: null, fromTail: false };
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

// Dispositivos de voto ANTT → RESULTADOS válidos (utils.ts RESULTADOS). NEGATIVOS
// primeiro ("negar provimento" contém "provimento"; "recurso improvido" contém "provido").
// O QA achou que a versão anterior só cobria aprov/indefer/autoriz/ratifico — "pelo
// deferimento", "dar provimento", "homologar", "conhecer e prover", "rejeitar", "acolher",
// "desprover", "referendar" voltavam null e o voto era descartado. Princípio inalterado:
// sem padrão claro (ex.: "manter/reformar a decisão", ambíguos) → null + warning (nunca chutar).
export function inferResultado(text: string): string | null {
  const value = normalize(text);
  // RETIRADA/SOBRESTAMENTO PRIMEIRO (QA ago/2026): um voto retirado de pauta cujo assunto cita
  // "recurso contra decisão que indeferiu…" caía no bloco negativo e gravava "Indeferido" —
  // errado e silencioso. Mesma precedência do ata-splitter. Regex com ADJACÊNCIA ("retirad*
  // [de] pauta"): o `includes("retirad") && includes("pauta")` antigo, promovido ao topo,
  // marcaria falso Retirado quando as palavras aparecem longe uma da outra.
  if (RE_SUSPENSAO.test(value)) {
    return "Retirado de Pauta";
  }
  // Negativos — "indefer" (indeferimento/indeferido) E "indefir" (indeferir/indefiro,
  // 1ª pessoa do dispositivo, que "indefer" NÃO casava). Ambos antes dos positivos.
  // "nao prover/provido/provimento", "desprovido", "improvido" precisam SAIR aqui antes
  // do positivo "provido"/"prover"; "rejeitar" e "nao acolher" são recusas claras.
  if (
    value.includes("indefer") || value.includes("indefir") ||
    /\bneg(?:o|ar(?:-se)?|ado)\s+provimento\b/.test(value) ||
    /\bnao\s+prov(?:er|ido|imento|ejo)\b|\bpelo\s+nao\s+provimento\b|\bdesprov\w*|\bimprovid\w*/.test(value) ||
    // Etapa54: `não conhecer` SAIU daqui. Não-conhecimento é juízo de ADMISSIBILIDADE — o
    // colegiado não julgou o pedido, julgou se podia julgá-lo. Enquanto virava "Indeferido", a
    // taxa de deferimento media prazo processual junto com jurisprudência (só na 83ª ROP são 10
    // itens). O caso segue detectado, agora por `detectJuizo` → `raw_extraction.juizo`.
    // Atenção: "não conhecer E, no mérito, negar provimento" continua Indeferido, porque as
    // formas de mérito acima casam primeiro — é o mérito que prevalece quando ele existe.
    /\brejeit\w*|\breprov\w*/.test(value) ||
    /\bnao\s+acolh\w*|\bdeix\w+\s+de\s+acolher\b/.test(value) ||
    value.includes("improcedente") || value.includes("improcedencia") ||
    value.includes("cassacao")
  ) return "Indeferido";
  // Parcial ANTES do deferimento cheio: "dar parcial provimento", "deferimento parcial",
  // "procedente em parte", "acolher parcialmente" → Parcialmente Deferido (não "Deferido").
  if (
    /\bparcial(?:mente)?\s+(?:defer\w+|provid\w+|provimento|procedent\w+|acolh\w+)\b/.test(value) ||
    /\b(?:defer\w+|provimento|acolh\w+|procedent\w+)\s+(?:em\s+parte|parcial\w*)\b/.test(value)
  ) return "Parcialmente Deferido";
  // Positivos — "defer" (deferimento/deferido) E "defir" (deferir/defiro). O indefer/
  // indefir já saiu no bloco negativo acima, então aqui só sobra o positivo. "prover"/
  // "provido"/"provejo" e "acolher" são seguros porque suas formas negativas já saíram.
  if (
    value.includes("defer") || value.includes("defir") ||
    /\bd(?:ar|ou|a)\s+provimento\b|\bprovimento\s+ao\s+recurso\b|\bpelo\s+provimento\b/.test(value) ||
    /\bprover\b|\bprovido\b|\bprovejo\b/.test(value) ||
    /\bconhecer\b.{0,40}\bprov/.test(value) ||  // "conhecer e dar provimento"
    /\bacolh\w*/.test(value) ||  // acolher/acolhimento/acolhido do pedido/recurso
    value.includes("procedente") || value.includes("procedencia do pedido")
  ) return "Deferido";
  if (value.includes("homolog")) return "Ratificado";
  if (value.includes("ratific") || /\breferend\w*/.test(value)) return "Ratificado";
  if (value.includes("aprov")) return RESULTADO_APROVADO;
  if (value.includes("autoriz")) return "Autorizado";
  if (value.includes("recomend")) return "Recomendado";
  if (/\bdetermin(?:ar|o|ada?|ado)\b/.test(value)) return "Determinado";
  return null;
}

function confidenceFor(
  type: AnttManualDocumentType,
  meetingNumber: string | null,
  processo: string | null,
  director: string | null,
  items: AtaPreviewItem[],
  hasDedupKey = false,
) {
  let score = 0.45;
  if (type !== "outro") score += 0.12;
  if (meetingNumber) score += 0.12;
  if (processo) score += 0.14;
  if (director) score += 0.12;
  if (items.length > 0) score += 0.16;
  // Chave de dedup (data OU número VOTO-*): um voto bem-identificado SEM processo nem
  // reunião parava em 0.69 < 0.70 (cap 0.72 do doc não-final) e nunca auto-confirmava —
  // mesmo com relator casado e resultado lido. Este termo o leva ao corte. QA Etapa 19.
  if (hasDedupKey) score += 0.06;
  return Math.min(0.95, score);
}

function buildWarnings(
  type: AnttManualDocumentType,
  meeting: { numero: string | null },
  firstProcess: AtaPreviewItem,
  director: string | null,
  items: AtaPreviewItem[],
  extra?: { votoResultado?: string | null; directorAmbiguo?: boolean; directorSoIniciais?: boolean; iniciaisDesconhecidas?: string | null; resultadoSoCauda?: boolean; cargoNaoResolvido?: string | null },
) {
  const warnings: string[] = [];
  if (!meeting.numero && type !== "voto_individual") warnings.push("ANTT: número da reunião não identificado com alta confiança.");
  if (!firstProcess.processo && items.length === 0) warnings.push("ANTT: processo não identificado.");
  if (type === "voto_individual" && !director) warnings.push("ANTT: diretor autor do voto não identificado.");
  if (type === "voto_individual" && extra?.cargoNaoResolvido) {
    warnings.push(
      `ANTT: o voto identifica apenas o CARGO ("${extra.cargoNaoResolvido}"), não a pessoa, e o documento não diz quem o exercia. ` +
      "Sem mandato vigente na data, o autor fica em aberto — atribuir manualmente. " +
      "(Antes, todo voto do cargo era gravado num nome fixo, inclusive quando quem assinava era o substituto.)",
    );
  } else if (type === "voto_individual" && extra?.directorAmbiguo) {
    warnings.push("ANTT: iniciais e nome do relator DIVERGEM — autor do voto ambíguo; revisar antes de atribuir.");
  }
  if (type === "voto_individual" && extra?.directorSoIniciais) {
    warnings.push("ANTT: autor do voto inferido SÓ pelas iniciais (sem nome textual para conferir) — colisão de iniciais (ex.: DAA↔DAB) possível; revisar.");
  }
  if (type === "voto_individual" && extra?.iniciaisDesconhecidas) {
    warnings.push(`ANTT: iniciais "${extra.iniciaisDesconhecidas}" não mapeadas na tabela de diretores — a diretoria mudou? O cadastro de diretores atualizado resolve sozinho (iniciais dinâmicas); revisar o autor do voto.`);
  }
  if (type === "voto_individual" && extra?.resultadoSoCauda) {
    warnings.push("ANTT: direção do voto inferida da CAUDA do documento (sem fórmula de dispositivo explícita) — revisar favorável/contrário.");
  }
  if (type === "voto_individual" && !extra?.votoResultado) {
    warnings.push("ANTT: conclusão do voto não identificada — resultado NÃO inferido; revisar a direção do voto (favorável/contrário).");
  }
  if (shouldExposeItems(type) && items.length === 0) warnings.push("ANTT: pauta/ata sem processos separados; revisar layout do PDF.");
  if (type !== "voto_individual") warnings.push("ANTT: documento tratado como pauta/ata revisável; votos não são criados automaticamente.");
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

/**
 * Como `between`, mas ancorando na ÚLTIMA ocorrência do lead-in.
 *
 * Numa peça de VOTO o dispositivo é, por construção, o ÚLTIMO — tudo que vem antes é relatório, e
 * relatório CITA dispositivos de outras autoridades. Caso real (Voto DAB 002/2026): a seção "DOS
 * FATOS" transcreve a liminar do juiz — "Ante o exposto, DEFIRO, em parte, a liminar requerida" —
 * enquanto a "PROPOSIÇÃO FINAL" do diretor diz "VOTO pelo indeferimento do pedido". Ancorando na
 * PRIMEIRA ocorrência, o voto do diretor era gravado com o dispositivo do JUIZ: um indeferimento
 * virava deferimento, invertido e sem nenhum aviso.
 */
function betweenLast(value: string, start: RegExp, end: RegExp) {
  const re = new RegExp(start.source, start.flags.includes("g") ? start.flags : `${start.flags}g`);
  let last: RegExpExecArray | null = null;
  let m: RegExpExecArray | null;
  while ((m = re.exec(value)) !== null) {
    last = m;
    if (m.index === re.lastIndex) re.lastIndex++; // guard contra match vazio
  }
  if (!last) return null;
  const rest = value.slice(last.index + last[0].length);
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

