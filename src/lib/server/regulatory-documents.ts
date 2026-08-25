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
  "import_counts_as_final:raw_extraction->import_counts_as_final,documento_subtipo:raw_extraction->>documento_subtipo,documento_antt_tipo:raw_extraction->>documento_antt_tipo,"
  // `juizo_raw` vem do JSON, NÃO da coluna: as rotas de analytics usam este sub-select para não
  // puxar `raw_extraction` inteiro, e sem esta projeção `decisionStatus` nunca enxergaria
  // admissibilidade em produção — todo o tratamento do não-conhecimento ficaria inerte, mesmo
  // com a extração marcando certo. Ler do JSON também mantém o código funcionando sem a migration.
  + "juizo_raw:raw_extraction->>juizo";

/**
 * O mesmo sub-select, MAIS a coluna `juizo` (etapa66).
 *
 * Por que as duas fontes: a coluna é o armazenamento AUTORITATIVO (foi ela que a migration
 * `20260824120000` criou, e é nela que vive o índice parcial de admissibilidade), mas o filho de
 * ata gravava só a coluna e nunca o JSON — e como toda rota projetava só o JSON, a admissibilidade
 * de item de ata era invisível. Medido nas 16 fixtures: 13 de 320 itens, 100% deles invisíveis.
 *
 * ⚠️ Só use através de `selectComJuizo`. Projetar coluna inexistente não devolve `null`: o
 * PostgREST derruba a QUERY INTEIRA, então sem o fallback um deploy antes da migration deixaria
 * todos os dashboards em erro 500.
 */
export const FINAL_DECISION_SELECT_COM_JUIZO = `juizo,${FINAL_DECISION_RAW_SELECT}`;

/** O erro do PostgREST/Postgres é "coluna não existe"? (`PGRST204` / `42703`) */
function erroDeColunaAusente(error: unknown, coluna: string): boolean {
  const err = error as { code?: unknown; message?: unknown } | null;
  const code = String(err?.code ?? "");
  if (code !== "PGRST204" && code !== "42703") return false;
  const msg = String(err?.message ?? "");
  return msg.includes(`'${coluna}'`) || msg.includes(`"${coluna}"`) || new RegExp(`\\b${coluna}\\b`).test(msg);
}

/**
 * `true` = a coluna existe · `false` = não existe · `null` = ainda não sondado.
 * Memoizado por processo: a resposta não muda dentro de um deploy, e a migration só ADICIONA.
 */
let colunaJuizoPresente: boolean | null = null;

/** Reseta a sonda (uso em teste). */
export function resetSondaJuizo() {
  colunaJuizoPresente = null;
}

/**
 * Devolve o sub-select a usar, sondando UMA vez se a coluna `juizo` existe.
 *
 * Por que sonda em vez de retry: as consultas de analytics vivem dentro de paginadores
 * (`selectAllPaged`) e de `Promise.all`, então um wrapper de "tenta e repete" não encaixa na forma
 * do builder. Uma consulta `select("juizo").limit(1)` por processo é barata e resolve para todas.
 *
 * ⚠️ Projetar coluna inexistente NÃO devolve `null` — o PostgREST derruba a query inteira. Sem
 * isto, um deploy antes da migration deixaria todos os dashboards em 500.
 */
export async function juizoSelect(db: { from: (t: string) => any }): Promise<string> {
  if (colunaJuizoPresente === null) {
    try {
      const { error } = await db.from("deliberacoes").select("juizo").limit(1);
      colunaJuizoPresente = !erroDeColunaAusente(error, "juizo");
    } catch {
      // Falha de rede/permissão não é ausência de coluna — degrada para o caminho seguro sem
      // memoizar, para sondar de novo na próxima requisição.
      return FINAL_DECISION_RAW_SELECT;
    }
  }
  return colunaJuizoPresente ? FINAL_DECISION_SELECT_COM_JUIZO : FINAL_DECISION_RAW_SELECT;
}

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

/**
 * Tipos de documento que NUNCA viram decisão final (etapa65) — fonte única.
 *
 * Estava copiado em 14 lugares: 6 `Set` locais com 3 nomes diferentes (`NAO_FINAL`, `TIPOS_APOIO`,
 * `tiposApoio`), 5 arrays inline e 3 strings de filtro PostgREST. Todos idênticos, e um deles
 * divergente — ver a nota abaixo.
 *
 * ⚠️ EXCEÇÃO DELIBERADA, não unificar: `admin/upload/pendencias-voto` omite `voto_individual` do
 * seu conjunto de resíduo DE PROPÓSITO, porque classifica voto individual numa categoria própria
 * antes de consultar os sets. Unificação cega ali quebra a tela.
 */
export const TIPOS_NAO_FINAIS = ["pauta", "voto_individual", "documento_apoio"] as const;

/** Mesma lista, pronta para `.has()`. */
export const TIPOS_NAO_FINAIS_SET: ReadonlySet<string> = new Set<string>(TIPOS_NAO_FINAIS);

/** Mesma lista no formato do filtro `not("tipo_documento","in", …)` do PostgREST. */
export const TIPOS_NAO_FINAIS_PG = `(${TIPOS_NAO_FINAIS.join(",")})`;

/** O tipo de documento é um dos que nunca viram decisão final? */
export function isTipoNaoFinal(tipo: unknown): boolean {
  return TIPOS_NAO_FINAIS_SET.has(String(tipo ?? ""));
}

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

  if (TIPOS_NAO_FINAIS_SET.has(tipo)) return false;
  if (["pauta", "voto_individual", "reuniao_deliberativa_eletronica", "reuniao_diretoria_publica", "reuniao_extraordinaria"].includes(subtipo)) {
    return false;
  }
  if (tipo === "ata") {
    return Boolean(row.documento_pai_id && row.resultado);
  }
  return ["deliberacao", "resolucao", "portaria"].includes(tipo);
}

// ─── Etapa 60: os QUATRO estados de uma deliberação ──────────────────────────
/**
 * Estado de uma deliberação para fins de DENOMINADOR.
 *
 * O problema que isto resolve: hoje `resultado` carrega DUAS coisas no mesmo campo — o desfecho
 * ("Deferido"/"Indeferido") e o ANDAMENTO ("Retirado de Pauta"). Nenhuma rota de produção exclui
 * retirado nem `resultado` NULL do denominador, então itens que NINGUÉM julgou puxam a
 * `taxa_deferimento` para baixo como se fossem indeferimentos. E o não-conhecimento
 * (`juizo='admissibilidade'`), que a Fase 1 passou a detectar, entrava no balde de mérito: a taxa
 * media prazo processual junto com jurisprudência.
 *
 *  · `decidido`         — houve juízo de MÉRITO. Só este entra na taxa de deferimento.
 *  · `admissibilidade`  — o colegiado não conheceu; não julgou o pedido. Sai dos DOIS lados.
 *  · `retirado`         — saiu de pauta/sobrestado. Não foi decidido.
 *  · `sem_resultado`    — nada foi extraído. Lacuna de dado, não decisão.
 */
export type DecisionStatus = "decidido" | "admissibilidade" | "retirado" | "sem_resultado";

type DecisionStatusRow = {
  resultado?: string | null;
  /** Coluna nova (migration 20260824120000). Pode não existir em linhas antigas. */
  juizo?: string | null;
  /** Projeção achatada do JSON (`FINAL_DECISION_RAW_SELECT`) — usada pelas rotas de analytics. */
  juizo_raw?: string | null;
  raw_extraction?: Record<string, unknown> | null;
};

export function decisionStatus(row: DecisionStatusRow): DecisionStatus {
  // Lê a COLUNA e cai para o JSON: entre o deploy da Fase 1 e a migration, `juizo` só existe
  // dentro de `raw_extraction`. Sem este fallback, todo documento ingerido nesse intervalo seria
  // classificado como mérito — silenciosamente.
  // Três formas de o valor chegar: a COLUNA, a projeção achatada do sub-select, ou o JSON inteiro.
  // As rotas de analytics usam a segunda — foi ela que faltava, e sem ela o tratamento da
  // admissibilidade não valia nada em produção.
  const juizo = row.juizo ?? row.juizo_raw ?? (row.raw_extraction as Record<string, unknown> | null)?.juizo;
  if (juizo === "admissibilidade") return "admissibilidade";
  if (!row.resultado) return "sem_resultado";
  if (row.resultado === "Retirado de Pauta") return "retirado";
  return "decidido";
}

/** Houve juízo de mérito — o único estado que entra na taxa de deferimento. */
export function isDecidedOnMerits(row: DecisionStatusRow): boolean {
  return decisionStatus(row) === "decidido";
}

/**
 * Item SANCIONATÓRIO — multa aplicada ou pedido indeferido.
 *
 * Fonte ÚNICA (etapa65). A expressão vivia copiada em 4 lugares e já tinha divergido em TRÊS
 * semânticas: `mandatos/analytics` e `governanca-agencias` contavam dentro do filtro de mérito;
 * o `analytics-engine` contava sobre TODAS as linhas e dividia pelos decididos — o que fazia
 * `taxa_sancao` passar de 100% (medido: 120%, com item retirado carregando `microtema='multa'`);
 * e `demo-data` dividia pelo pautado, semântica pré-etapa60.
 *
 * ⚠️ O predicado sozinho não basta: ele só faz sentido aplicado ao MESMO universo do divisor.
 * Quem conta sanção conta sobre `isDecidedOnMerits`, nunca sobre o pautado.
 */
export function isSancao(row: { microtema?: string | null; resultado?: string | null }): boolean {
  return row.microtema === "multa" || row.resultado === "Indeferido";
}

/**
 * A deliberação tem EVIDÊNCIA de votação (ao menos um voto registrado).
 *
 * Existe por causa de um defeito específico e muito caro: `!votos.some(v => v.is_divergente)` é
 * `true` para array VAZIO, então item com ZERO voto era contado como CONSENSUAL em todos os
 * agregados. "Consenso de 100%" podia significar "ninguém votou" — e significava, para toda
 * deliberação recém-coletada sem voto extraído.
 */
export function hasVoteEvidence(votos: Array<unknown> | null | undefined): boolean {
  return Array.isArray(votos) && votos.length > 0;
}

/**
 * Consenso com base: NÃO diverge E tem voto. Um item sem voto não é consensual — é desconhecido.
 * Devolve `null` quando não há base, para o chamador poder tirá-lo do denominador em vez de
 * contá-lo como concordância.
 */
export function isConsensual(
  votos: Array<{ is_divergente?: boolean | null; tipo_voto?: string | null }> | null | undefined,
): boolean | null {
  if (!hasVoteEvidence(votos)) return null;
  // O MESMO bug com outra roupa: `isDivergentVote` devolve false para "Ausente", então uma
  // deliberação em que TODOS estavam ausentes ou impedidos tem votos.length > 0, nenhuma
  // divergência — e era contada como consenso perfeito. Ninguém votou; não houve concordância.
  const efetivos = votos!.filter((v) => v.tipo_voto == null || v.tipo_voto !== "Ausente");
  if (efetivos.length === 0) return null;
  return !efetivos.some((v) => v.is_divergente);
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
