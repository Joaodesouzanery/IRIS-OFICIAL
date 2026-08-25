/**
 * ata-item-materializacao.ts — o contrato entre o ITEM extraído e a deliberação-filha gravada.
 *
 * ═══ Por que este arquivo existe ═══
 *
 * O `raw_extraction` do filho de ata era montado CHAVE A CHAVE dentro do handler do confirm. O
 * efeito não é estilístico: **todo campo novo do item nasce invisível por omissão**. O mecanismo já
 * produziu duas vítimas, medidas nas 16 fixtures do corpus de certificação:
 *
 *   · `juizo`            — 13 de 320 itens. Ia para a COLUNA e nunca para o JSON; como toda rota
 *                          projeta o JSON, a admissibilidade de item de ata era invisível a todo
 *                          painel. O tratamento inteiro da etapa60 ficou inerte.
 *   · `area_regulatoria` — 320 de 320 itens. O item calcula a sua, e o insert gravava a do
 *                          DOCUMENTO por cima. O valor por item era descartado em 100% dos casos.
 *
 * E o padrão é reincidente: é a TERCEIRA rodada em que a informação morre entre a extração e o
 * consumidor (antes foi a coluna sem write-path, depois a projeção sem `juizo_raw`).
 *
 * ═══ A inversão ═══
 *
 * Aqui se declaram as OMISSÕES, não as inclusões. Campo novo no `AtaPreviewItem` passa a viajar
 * por padrão; para NÃO viajar, alguém precisa escrevê-lo em `OMISSOES_DECLARADAS` com um motivo.
 * `etapa66-materializacao-item.test.ts` compara a união das chaves que o analisador produz nos 16
 * PDFs com este contrato e quebra quando aparece chave não declarada.
 */

import type { AtaPreviewItem } from "@/types";

/**
 * Chaves do item que NÃO entram no `raw_extraction`, e por quê.
 *
 * Duas categorias legítimas — e as duas precisam estar aqui explicitamente:
 *  · `coluna:*`  o valor vira coluna própria do filho (é mais consultável ali que dentro do JSON);
 *  · `tamanho:*` texto que incharia o JSON de TODA linha (a rodada de otimização `3bca9ea` tirou
 *                texto do payload de propósito — reintroduzir aqui desfaria aquilo em silêncio).
 *
 * Omissão por TAMANHO ou por COLUNA é desenho. Omissão por esquecimento é o que o teste barra.
 */
export const OMISSOES_DECLARADAS: Record<string, string> = {
  // ── vira coluna própria da deliberação-filha ────────────────────────────
  item_numero: "coluna: também vai ao raw (é a chave de dedup do item)",
  processo: "coluna: `processo`",
  interessado: "coluna: `interessado`",
  assunto: "coluna: `assunto`",
  relator: "coluna: `relator`",
  microtema: "coluna: `microtema`",
  resultado: "coluna: `resultado`",
  area_regulatoria: "coluna: `area_regulatoria` — desde a etapa66 vem do ITEM, não do documento",
  juizo: "coluna: `juizo` — E TAMBÉM no raw (ver `JUIZO_VAI_AOS_DOIS`)",
  // ── omitido por TAMANHO ────────────────────────────────────────────────
  decisao: "tamanho: vira a coluna `resumo_pleito` (2000 chars). Duplicar incha o JSON de toda linha",
  raw_text: "tamanho: texto integral do item; fora do payload desde a otimização 3bca9ea",
  // ── consumido antes de chegar aqui ─────────────────────────────────────
  votos_sugeridos: "consumido: o confirm materializa as linhas de voto a partir dos NOMES",
  needs_review: "consumido: vira status do documento, não do item",
};

/**
 * Campos que vão para a COLUNA **e** para o `raw_extraction`.
 *
 * `juizo` é o caso que motivou este arquivo. A coluna é o armazenamento autoritativo (a migration
 * `20260824120000` criou o índice parcial nela), mas escrever SÓ nela deixou o dado invisível às
 * rotas, que projetam o JSON. Escrever nos dois fecha o laço mesmo sem a migration aplicada — e é
 * o formato que o backfill daquela migration sabe ler.
 */
export const JUIZO_VAI_AOS_DOIS = true;

/**
 * Renomeações item → `raw_extraction`. Não são omissões: o valor viaja, com outro nome.
 * ⚠️ Os nomes de destino são LIDOS por `applyRetroactiveVotes` — mudá-los quebra o backfill
 * retroativo em silêncio.
 */
const RENOMEACOES: Record<string, string> = {
  votos_detectados: "nomes_votacao",
  votos_contra_detectados: "nomes_votacao_contra",
  votos_abstencao_detectados: "nomes_votacao_abstencao",
  votos_ausentes_detectados: "nomes_votacao_ausente",
  votos_impedidos_detectados: "nomes_votacao_impedido",
  votos_em_autos_detectados: "votos_em_autos",
};

/** Toda chave do item que este contrato conhece — omitida, renomeada, ou propagada como está. */
export function chavesConhecidasDoItem(): Set<string> {
  return new Set([...Object.keys(OMISSOES_DECLARADAS), ...Object.keys(RENOMEACOES), "unanimidade_detectada", "warnings"]);
}

export interface RawExtractionItemInput {
  item: AtaPreviewItem & Record<string, unknown>;
  /** Campos herdados do DOCUMENTO pai (não vêm do item). */
  documentoAnttTipo?: unknown;
  documentoSubtipo?: unknown;
  /** Derivado no handler (precisa de `diretoresList`, que não existe aqui). */
  votosInferidosPorMandato: boolean;
}

/**
 * Monta o `raw_extraction` do filho de ata a partir do ITEM, por propagação.
 *
 * A ordem importa: o spread do restante vem PRIMEIRO, para que renomeação e campos derivados
 * tenham a última palavra sobre uma chave de mesmo nome.
 */
export function buildRawExtractionDoItem(input: RawExtractionItemInput): Record<string, unknown> {
  const { item } = input;
  const out: Record<string, unknown> = {};

  // 1. Propagação por padrão: tudo que não é omissão declarada nem renomeação.
  for (const [k, v] of Object.entries(item)) {
    if (k in OMISSOES_DECLARADAS) continue;
    if (k in RENOMEACOES) continue;
    out[k] = v;
  }

  // 2. Renomeações — os baldes de nome que o backfill retroativo lê.
  out.nomes_votacao = item.votos_detectados ?? [];
  out.nomes_votacao_contra = item.votos_contra_detectados ?? [];
  out.nomes_votacao_abstencao = item.votos_abstencao_detectados ?? [];
  out.nomes_votacao_ausente = item.votos_ausentes_detectados ?? [];
  out.nomes_votacao_impedido = item.votos_impedidos_detectados ?? [];
  // Alias histórico, lido por consumidores antigos. Mesma origem, nome diferente.
  out.impedimentos = item.votos_impedidos_detectados ?? [];
  out.votos_em_autos = (item.votos_em_autos_detectados ?? []).map((nome) => ({ nome, sessao: null }));

  // 3. Campos que vão aos DOIS destinos (coluna e JSON).
  if (JUIZO_VAI_AOS_DOIS) out.juizo = item.juizo ?? null;

  // 4. Derivados e herdados do documento.
  out.item_numero = item.item_numero;
  out.documento_antt_tipo = input.documentoAnttTipo;
  out.documento_subtipo = input.documentoSubtipo;
  out.import_counts_as_final = Boolean(item.resultado);
  out.unanimidade_detectada = Boolean(item.unanimidade_detectada);
  out.votos_inferidos_por_mandato = input.votosInferidosPorMandato;
  out.warnings = item.warnings ?? [];

  return out;
}
