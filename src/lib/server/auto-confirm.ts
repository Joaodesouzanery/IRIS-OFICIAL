/**
 * Auto-confirmação de deliberações de ALTA CONFIANÇA (Etapa 10-A).
 *
 * Hoje `votos` só é gravado no confirm manual → matches fracos/escaneados ficam pendentes
 * ("deliberações sem voto"). Este gate seleciona apenas os documentos INEQUÍVOCOS para
 * confirmar automaticamente (reusando 100% a lógica do /upload/confirm); qualquer dúvida
 * permanece na fila manual. É conservador de propósito (erra para a revisão).
 */

import { isWarningInformativo } from "@/lib/server/upload-analysis";

export const AUTO_CONFIRM_MIN_CONFIDENCE = 0.9;
// Atas têm a confiança estruturalmente CAPADA em 0.72 na análise (import_counts_as_final=false
// até revisão dos itens) — um limiar próprio, compensado por exigências fortes por ITEM
// (todo item com voto precisa de resultado + matches confiáveis).
export const AUTO_CONFIRM_MIN_CONFIDENCE_ATA = 0.7;
// Voto individual ANTT: confiança também estruturalmente menor (doc curto); o gate
// compensa exigindo relator casado ≥0.85 + resultado + chave de dedup + zero warnings.
export const AUTO_CONFIRM_MIN_CONFIDENCE_VOTO = 0.7;
export const AUTO_CONFIRM_MIN_CHARS_PER_PAGE = 50; // abaixo disso = provável escaneado
/**
 * Tipos IMPORTÁVEIS pelo auto-confirm — NÃO é o predicado "final" (`isFinalDecisionRecord`).
 * Inclui `ata` de propósito: a ata-MÃE (envelope) é importável, e são os FILHOS dela que o
 * predicado final julga um a um. Fase 21 — chamava-se FINAL_TIPOS e a varredura a listou como
 * "sétima variante de final"; o nome estava errado, a regra não.
 */
const TIPOS_IMPORTAVEIS = new Set(["deliberacao", "ata", "resolucao", "portaria"]);

type Suggestion = { diretor_id?: string | null; needs_review?: boolean } & Record<string, unknown>;
type AtaItem = { votos_sugeridos?: Suggestion[]; resultado?: string | null } & Record<string, unknown>;

export interface AutoConfirmDoc {
  id?: string;
  status?: string | null;
  tipo_documento?: string | null;
  extraction_confidence?: number | null;
  chars_per_page?: number | null;
  is_duplicate?: boolean | null;
  agencia_id?: string | null;
  ata_items?: AtaItem[] | null;
  warnings?: string[] | null;
  campos_detectados?: { preview?: Record<string, any> } | null;
  /** Voto individual: a rota verifica se o relator casa ≥0.85 com diretor cadastrado. */
  relator_match_ok?: boolean | null;
}

function suggestionsConfident(list: Suggestion[] | undefined | null): boolean {
  const arr = list ?? [];
  // Toda sugestão presente precisa ter match a um diretor cadastrado e sem needs_review.
  return arr.every((v) => Boolean(v?.diretor_id) && v?.needs_review !== true);
}

/**
 * Decide se o documento pode ser confirmado automaticamente. Retorna o motivo quando não.
 */
export function canAutoConfirm(doc: AutoConfirmDoc): { ok: boolean; reason: string } {
  const preview = doc?.campos_detectados?.preview ?? {};
  const fields: Record<string, any> = preview.fields ?? {};
  const tipo = String(fields.tipo_documento ?? doc.tipo_documento ?? "");
  const ataItems = (doc.ata_items ?? preview.ata_items ?? []) as AtaItem[];
  const isImportableAta = tipo === "ata" && ataItems.length > 0;

  // Voto individual ANTT (QA D2): auto-confirmável com gate DEDICADO conservador —
  // é o que fecha o fluxo zero-toque (antes, cada "Voto DXX" exigia clique manual).
  // Gate de IMPORTAÇÃO do voto individual (é o tipo, e só). O gate de CAPTURA — resultado +
  // relator casado — mora no `upload/confirm` (`isAnttVotoCapturavel`) e roda depois deste.
  const isVotoIndividualImportavel = tipo === "voto_individual";

  if (doc.status && doc.status !== "review_pending") return { ok: false, reason: `status=${doc.status}` };
  if (!TIPOS_IMPORTAVEIS.has(tipo) && !isVotoIndividualImportavel) return { ok: false, reason: `tipo não-final (${tipo || "?"})` };
  // Ata com itens (e voto individual) é importável mesmo com a flag false (o confirm
  // materializa; só o que tem resultado conta como final nas métricas).
  if (!isImportableAta && !isVotoIndividualImportavel && (fields.import_counts_as_final === false || preview.import_counts_as_final === false)) {
    // Fase 23 — a ata sem itens fica em revisão DE PROPÓSITO (confirm/route.ts: ata real cujo
    // splitter não achou itens não pode ser arquivada em silêncio — foi o buraco da ANM). Mas
    // "não conta como final" escondia a causa: 20 atas (18 ARTESP, 2 ANTT) giravam a cada run
    // sem ninguém saber que o defeito é o splitter ter devolvido ZERO itens. O motivo agora diz.
    if (tipo === "ata") return { ok: false, reason: "ata sem itens parseados (splitter=0) — abrir o PDF: ata real ou capa/anexo?" };
    return { ok: false, reason: "não conta como final" };
  }
  const minConfidence = isVotoIndividualImportavel
    ? AUTO_CONFIRM_MIN_CONFIDENCE_VOTO
    : isImportableAta ? AUTO_CONFIRM_MIN_CONFIDENCE_ATA : AUTO_CONFIRM_MIN_CONFIDENCE;
  if (Number(doc.extraction_confidence ?? 0) < minConfidence) {
    return { ok: false, reason: `confiança ${Number(doc.extraction_confidence ?? 0).toFixed(2)} < ${minConfidence}` };
  }
  if (Number(doc.chars_per_page ?? 0) < AUTO_CONFIRM_MIN_CHARS_PER_PAGE) {
    return { ok: false, reason: "provável escaneado (baixa densidade de texto)" };
  }
  if (doc.is_duplicate) return { ok: false, reason: "possível duplicata" };
  if (!doc.agencia_id) return { ok: false, reason: "sem agência detectada" };
  // ZERO warnings de QUALIDADE: as checagens de consistência (contradição favor×contra,
  // unanimidade com contras, data implausível, sangria de itens, presença ambígua…)
  // marcam exatamente os casos onde "extraiu, mas pode estar errado" → revisão humana.
  const allWarnings = [
    ...(doc.warnings ?? []),
    ...((preview.warnings as string[] | undefined) ?? []),
  ];
  // Fase 23 — o NÍVEL do achado decide: `[AVISO·]`/`[INFO·]` passam; `[BLOQUEANTE·]` e prosa de
  // qualidade seguram. Antes, todo achado era "warning de qualidade" por acidente de texto (85 docs).
  const qualityWarnings = allWarnings.filter((w) => typeof w === "string" && !isWarningInformativo(w));
  if (qualityWarnings.length > 0) {
    return { ok: false, reason: `warning de qualidade: ${qualityWarnings[0].slice(0, 90)}` };
  }

  // Etapa63: o gate BLOQUEANTE vale também aqui — e com mais razão. O confirm manual admite
  // `override_motivo` porque há uma pessoa olhando o documento; o auto-confirm não tem ninguém.
  // Sem esta guarda, o caminho automático seria justamente o que contorna o bloqueio.
  const bloqueado = (preview as { bloqueado?: boolean }).bloqueado === true;
  const codigos = (preview as { achados_bloqueantes?: string[] }).achados_bloqueantes ?? [];
  if (bloqueado || codigos.length > 0) {
    return { ok: false, reason: `bloqueado pela validação (${codigos.join(", ") || "achado bloqueante"})` };
  }

  if (isVotoIndividualImportavel) {
    // Gate do voto: relator presente E casando ≥0.85 (verificado pela rota via
    // relator_match_ok) + resultado extraído + chave de dedup (processo ou data).
    if (!fields.relator) return { ok: false, reason: "voto sem relator identificado" };
    if (doc.relator_match_ok !== true) return { ok: false, reason: "relator sem match ≥0.85 no cadastro" };
    if (!fields.resultado) return { ok: false, reason: "voto sem resultado extraído" };
    if (!fields.processo && !fields.data_reuniao) return { ok: false, reason: "voto sem processo e sem data (sem chave de dedup)" };
    return { ok: true, reason: "voto de alta confiança (relator lido)" };
  }

  if (tipo === "ata") {
    if (!ataItems.length) return { ok: false, reason: "ata sem itens" };
    const anyVote = ataItems.some((it) => (it.votos_sugeridos ?? []).length > 0);
    if (!anyVote) return { ok: false, reason: "ata sem nenhum voto sugerido" };
    const allConfident = ataItems.every((it) => suggestionsConfident(it.votos_sugeridos));
    if (!allConfident) return { ok: false, reason: "há item com voto não-confiável/sem match" };
    // Todo item COM voto precisa ter resultado — é o resultado que torna o item
    // "decisão final" nas métricas; voto sem resultado ficaria invisível/ambíguo.
    const votedWithoutResult = ataItems.some((it) => (it.votos_sugeridos ?? []).length > 0 && !it.resultado);
    if (votedWithoutResult) return { ok: false, reason: "há item com voto mas sem resultado" };
  } else {
    const votos = (fields.votos_sugeridos ?? []) as Suggestion[];
    if (!votos.length) return { ok: false, reason: "sem votos sugeridos" };
    if (!suggestionsConfident(votos)) return { ok: false, reason: "voto sem match confiável (≥0.85)" };
  }

  return { ok: true, reason: "alta confiança" };
}

/**
 * Monta o payload ConfirmDelib (o mesmo que a UI envia) a partir do documento armazenado.
 */
export function buildConfirmDelibFromDoc(doc: AutoConfirmDoc): Record<string, unknown> {
  const preview = doc?.campos_detectados?.preview ?? {};
  const fields: Record<string, any> = preview.fields ?? {};
  return {
    ...fields,
    documento_id: doc.id ?? null,
    agencia_id: doc.agencia_id ?? preview.agencia_id_detected ?? null,
    filename: preview.filename ?? `${doc.id ?? "documento"}.pdf`,
    tipo_documento: fields.tipo_documento ?? doc.tipo_documento ?? "deliberacao",
    ata_items: doc.ata_items ?? preview.ata_items ?? undefined,
    extraction_confidence: doc.extraction_confidence ?? preview.confidence ?? null,
    import_counts_as_final: fields.import_counts_as_final ?? preview.import_counts_as_final ?? true,
    extraction_raw: preview.extraction_raw ?? null,
  };
}
