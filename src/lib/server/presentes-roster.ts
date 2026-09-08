/**
 * O roster de PRESENTES lido do documento, casado com o cadastro — uma implementação (Fase 21).
 *
 * Existiam TRÊS cópias do mesmo laço (upload-analysis, upload/confirm, materializar-faltantes) e
 * só uma deduplicava: nas outras duas, um nome que casasse duas vezes punha o mesmo diretor duas
 * vezes no roster — e o roster é o que vira voto inferido. As três agora chamam isto.
 *
 * Regra: casa com `findBestMatch`; entra só quem casou acima do limiar E sem `needsReview`
 * (presente sem match confiável NÃO entra — sem certeza, sem voto); um diretor, uma vez.
 */

import { findBestMatch } from "@/lib/server/name-matcher";
import type { DiretorVoteRecord } from "@/lib/server/vote-inference";

export function resolverPresentesRoster(
  nomes: ReadonlyArray<unknown>,
  diretoresList: ReadonlyArray<DiretorVoteRecord>,
): DiretorVoteRecord[] {
  if (diretoresList.length === 0) return [];
  const roster: DiretorVoteRecord[] = [];
  const vistos = new Set<string>();
  for (const nome of nomes) {
    if (typeof nome !== "string" || !nome.trim()) continue;
    const m = findBestMatch(nome, diretoresList as DiretorVoteRecord[]);
    if (!m.diretorId || m.needsReview || vistos.has(m.diretorId)) continue;
    const dir = diretoresList.find((d) => d.id === m.diretorId);
    if (dir) { roster.push(dir); vistos.add(dir.id); }
  }
  return roster;
}
