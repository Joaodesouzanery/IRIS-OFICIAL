/**
 * A NEGAÇÃO da unanimidade — uma implementação, sem imports (Fase 21).
 *
 * "não foi aprovado por unanimidade", "não houve unanimidade", "sem unanimidade". Janela curta
 * ({0,3} palavras entre "não" e "unanimidade") para não capturar um "não" distante; lookahead
 * `(?!obstante)` exclui o concessivo "não obstante a unanimidade", que AFIRMA a unanimidade.
 *
 * ═══ Por que virou módulo ═══
 * O literal vivia em `nlp-extractor.ts` e uma CÓPIA em `ata-splitter.ts`; o parser da ANTT não
 * tinha nenhum: `/unanimidade/i` solto, então "não houve unanimidade" dava
 * `unanimidade_detectada = true` e voto favorável para todos os presentes — o oposto do que a ata
 * diz. Sem ocorrência no corpus de fixtures (etapa124 mediu `negada = 0`), o que não é motivo para
 * deixar a bomba armada: o teste da etapa125 é sintético e diz isso.
 *
 * Funciona sobre texto cru e sobre texto `normalize()`ado (sem acento): `n[aã]o`.
 */
export const RE_UNANIMIDADE_NEGADA = /\bn[aã]o\s+(?!obstante\b)(?:\S+\s+){0,3}unanimidade|\bsem\s+unanimidade/i;

export function isUnanimidadeNegada(text: string): boolean {
  return RE_UNANIMIDADE_NEGADA.test(text);
}
