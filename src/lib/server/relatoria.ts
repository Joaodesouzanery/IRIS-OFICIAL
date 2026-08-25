/**
 * relatoria.ts — a RELATORIA como métrica (etapa67).
 *
 * ═══ Por que este eixo importa mais do que parece ═══
 *
 * A relatoria é NOMINAL em 100% dos itens, nas três agências — é o único eixo que não depende dos
 * ~7% de dissenso nominal:
 *   · ANM   — o bloco "1. DIRETOR-GERAL MAURO HENRIQUE MOREIRA SOUSA" nomeia o relator de todos
 *             os itens que se seguem;
 *   · ANTT  — a sigla do voto (Voto DLA-3/2026, DFQ-1/2026) e o campo RELATORIA identificam o
 *             relator sem ambiguidade;
 *   · ARTESP — parcial: procedência DIR-* nomeia a diretoria relatora.
 *
 * O dado sempre esteve no banco (`deliberacoes.relator`, extraído desde a migration 015) — e tinha
 * ZERO consumidores de métrica. Com ele, todo diretor tem perfil PREENCHIDO mesmo em agência de
 * 0% de cobertura de dissenso: volume relatado, taxa de deferimento do que relatou, retiradas.
 *
 * ═══ Disciplina de denominador (etapa60) ═══
 *
 * A taxa de deferimento das relatadas divide DEFERIDAS por DECIDIDAS NO MÉRITO — nunca pelo
 * pautado. Item retirado ou de admissibilidade não entra em nenhum dos dois lados.
 */

import { findBestMatch, MATCH_THRESHOLD } from "@/lib/server/name-matcher";
import { decisionStatus } from "@/lib/server/regulatory-documents";
import { isResultadoPositivo } from "@/lib/utils";
import type { DiretorVoteRecord } from "@/lib/server/vote-inference";

export interface DelibRelatoria {
  relator?: string | null;
  resultado?: string | null;
  juizo?: string | null;
  juizo_raw?: string | null;
  raw_extraction?: Record<string, unknown> | null;
}

export interface RelatoriaStats {
  /** Matérias relatadas por este diretor (match ≥0.85 do campo `relator`). */
  relatadas: number;
  /** Das relatadas, quantas foram DECIDIDAS no mérito (denominador da taxa). */
  decididas: number;
  deferidas: number;
  retiradas: number;
  /** % de deferimento sobre as DECIDIDAS. `null` sem base — nunca 0 fabricado. */
  taxa_deferimento: number | null;
}

/**
 * O campo `relator` costuma vir com o CARGO colado ("DIRETOR-GERAL MAURO…", "Diretor Substituto
 * Fábio…", "Diretoria DIR-RC"). Remove os prefixos de cargo antes do match — o matcher compara
 * NOMES, e "Diretor-Geral" na frente derruba o score de um match legítimo.
 */
export function limparRelator(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const bruto = raw.replace(/\s+/g, " ").trim();
  // "Diretoria DIR-RC" (ARTESP) não é pessoa — checar ANTES do strip: sem a fronteira `\b`, o
  // prefixo "DIRETOR" casava dentro de "Diretoria" e sobrava "ia DIR-RC" (pego pelo teste).
  if (/^diretoria\b/i.test(bruto)) return null;
  const limpo = bruto
    .replace(/^(?:DIRETOR(?:A)?[-\s](?:GERAL|PRESIDENTE)\b|DIRETOR(?:A)?\s+SUBSTITUT[OA]\b|DIRETOR(?:A)?\b|CONSELHEIR[OA]\b|RELATOR(?:A)?\b)[:\s-]*/i, "")
    .trim();
  if (!limpo || /^DIR-[A-Z]{1,4}$/i.test(limpo)) return null;
  return limpo;
}

/**
 * Estatísticas de relatoria de UM diretor sobre um conjunto de deliberações finais.
 * Função PURA — o caller filtra por agência e por `isFinalDecisionRecord` antes.
 */
export function computeRelatoria(
  delibs: DelibRelatoria[],
  diretor: DiretorVoteRecord,
): RelatoriaStats {
  let relatadas = 0;
  let decididas = 0;
  let deferidas = 0;
  let retiradas = 0;

  for (const d of delibs) {
    const nomeRelator = limparRelator(d.relator);
    if (!nomeRelator) continue;
    const m = findBestMatch(nomeRelator, [diretor]);
    if (!m.diretorId || m.score < MATCH_THRESHOLD) continue;

    relatadas += 1;
    const status = decisionStatus(d as never);
    if (status === "retirado") retiradas += 1;
    if (status !== "decidido") continue;
    decididas += 1;
    if (isResultadoPositivo(d.resultado ?? null)) deferidas += 1;
  }

  return {
    relatadas,
    decididas,
    deferidas,
    retiradas,
    taxa_deferimento: decididas > 0 ? Math.round((deferidas / decididas) * 1000) / 10 : null,
  };
}

/**
 * Contagem de relatorias para VÁRIOS diretores de uma vez (o caso do overview).
 * Um único passe pelas deliberações; cada matéria é atribuída ao MELHOR diretor (não a todos os
 * que casam ≥0.85 — uma matéria tem UM relator).
 */
export function contarRelatoriasPorDiretor(
  delibs: DelibRelatoria[],
  diretores: DiretorVoteRecord[],
): Map<string, number> {
  const out = new Map<string, number>();
  if (diretores.length === 0) return out;
  for (const d of delibs) {
    const nomeRelator = limparRelator(d.relator);
    if (!nomeRelator) continue;
    const m = findBestMatch(nomeRelator, diretores);
    if (!m.diretorId || m.score < MATCH_THRESHOLD) continue;
    out.set(m.diretorId, (out.get(m.diretorId) ?? 0) + 1);
  }
  return out;
}
