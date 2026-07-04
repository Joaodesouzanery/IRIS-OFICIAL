// Orçamento de tempo para rotas sob maxDuration do Vercel (SIGKILL incatchável).
// deadlineAt = epoch ms; undefined = sem orçamento (comportamento legado inalterado).
// A regra é nunca INICIAR uma unidade de trabalho sem saldo — unidade em voo termina
// (cada fetch já tem timeout próprio), preservando progresso e checkpoints.

export function msLeft(deadlineAt?: number): number {
  if (deadlineAt === undefined) return Number.POSITIVE_INFINITY;
  return deadlineAt - Date.now();
}

export function hasBudget(deadlineAt: number | undefined, reserveMs: number): boolean {
  return msLeft(deadlineAt) > reserveMs;
}

// Quantos retries cabem no saldo, dado o custo estimado de UMA tentativa.
export function budgetRetries(deadlineAt: number | undefined, attemptMs: number, max = 2): number {
  const left = msLeft(deadlineAt);
  if (!Number.isFinite(left)) return max;
  if (left > attemptMs * 3) return Math.min(max, 2);
  if (left > attemptMs * 2) return Math.min(max, 1);
  return 0;
}
