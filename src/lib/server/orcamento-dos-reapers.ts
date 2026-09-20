/**
 * Quanto saldo cada reaper precisa DEIXAR para quem vem depois (Fase 29) — folha pura.
 *
 * ═══ O defeito, em aritmética ═══
 * O laço de religação parava com `hasBudget(deadlineAt, 2_000)`. Esses 2 s protegiam o custo de
 * UMA iteração (1-2 escritas, ~400-600 ms) — folgado para isso. O que eles NÃO protegiam é o que
 * vem depois: no modo `"ambos"`, a fila de extração, cuja reserva de admissão é
 * `RESERVA_POR_JOB_MS = 13_000`. Sair do laço com 2.001 ms deixa `jobsPermitidos(2_001, 4) = 0`:
 * a extração roda, paga o round-trip de auth e devolve ZERO.
 *
 * É a regra da Fase 7 do CLAUDE.md ("nenhum passo recebe fatia menor que a reserva que exige")
 * violada um nível abaixo, dentro de uma função só.
 *
 * ═══ A escada ═══
 * Cada etapa guarda a SUA reserva mais a soma das reservas das etapas seguintes — a mesma ideia
 * do `protecao` que `planejarRodada` devolve ao orquestrador, um nível abaixo. No modo `"ambos"`
 * a última proteção é a reserva de um job de extração.
 */

import { RESERVA_POR_JOB_MS } from "@/lib/server/orcamento-do-parse";

/** Uma unidade do reaper de fila: ler o job, decidir, 1-2 escritas. */
export const RESERVA_RELIGACAO_MS = 1_000;
/**
 * Uma unidade do reaper do poço: 1 UPDATE com jsonb montado.
 * Era 400 ms — abaixo do custo de um round-trip real, então o guard deixava o laço entrar numa
 * iteração que não tinha como terminar.
 */
export const RESERVA_CARIMBO_MS = 600;
/** O bloco de reconciliação de volta: 2 leituras + 1 escrita em lote. */
export const RESERVA_RECONCILIACAO_MS = 1_500;

export type EtapaDoReaper = "religacao" | "carimbo" | "reconciliacao";

const RESERVA_DA_ETAPA: Readonly<Record<EtapaDoReaper, number>> = {
  religacao: RESERVA_RELIGACAO_MS,
  carimbo: RESERVA_CARIMBO_MS,
  reconciliacao: RESERVA_RECONCILIACAO_MS,
};

/** O que vem DEPOIS de cada etapa, dentro do próprio reaper. */
const DEPOIS_DE: Readonly<Record<EtapaDoReaper, readonly EtapaDoReaper[]>> = {
  religacao: ["carimbo", "reconciliacao"],
  carimbo: ["reconciliacao"],
  reconciliacao: [],
};

/**
 * O saldo mínimo para ENTRAR em mais uma iteração desta etapa: a reserva dela, mais o que as
 * etapas seguintes ainda vão exigir, mais — no modo `"ambos"` — a reserva de um job de extração,
 * que é o trabalho caro que vem no fim.
 */
export function protecaoDepoisDe(etapa: EtapaDoReaper, modo: "reaper" | "extracao" | "ambos"): number {
  const proprio = RESERVA_DA_ETAPA[etapa];
  const seguintes = DEPOIS_DE[etapa].reduce((soma, e) => soma + RESERVA_DA_ETAPA[e], 0);
  const extracao = modo === "ambos" ? RESERVA_POR_JOB_MS : 0;
  return proprio + seguintes + extracao;
}
