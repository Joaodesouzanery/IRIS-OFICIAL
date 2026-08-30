// Orçamento de tempo para rotas sob maxDuration do Vercel (SIGKILL incatchável).
// deadlineAt = epoch ms; undefined = sem orçamento (comportamento legado inalterado).
// A regra é nunca INICIAR uma unidade de trabalho sem saldo — unidade em voo termina
// (cada fetch já tem timeout próprio), preservando progresso e checkpoints.

// Orçamento padrão de crawl. No plano Hobby a função é morta (SIGKILL) aos 60s,
// INDEPENDENTE do `maxDuration: 120` do vercel.json (o 120 vale só no Pro). 50s deixa
// folga para o corte gracioso + flush da resposta antes do limite; o trabalho que não
// couber fica pendente e é retomado na próxima chamada. Usar via `Date.now() + HOBBY_BUDGET_MS`.
// Fase 12 — 50s → 70s. O teto de 60s NUNCA foi medido (as duas "provas" que circulavam não
// provam: o Vercel aceita maxDuration acima do plano e rebaixa em runtime, e ver a função viva
// aos 90s é piso, não teto). O limite REAL hoje é o abort de 90s do CLIENTE (api.ts), que não
// mata a função no servidor — acima de ~86s o laço dispararia a rodada seguinte sobre a MESMA
// run. 70s fica sob esse teto com 16s de margem. Para subir além: aumentar REQUEST_TIMEOUT_MS
// em src/lib/api.ts ANTES, nessa ordem.
export const HOBBY_BUDGET_MS = 70_000;

export function msLeft(deadlineAt?: number): number {
  if (deadlineAt === undefined) return Number.POSITIVE_INFINITY;
  return deadlineAt - Date.now();
}

export function hasBudget(deadlineAt: number | undefined, reserveMs: number): boolean {
  return msLeft(deadlineAt) > reserveMs;
}

// Orçamento vindo do chamador via query `?budget_ms=` (capado no Hobby). A pipeline
// zero-toque encadeia várias rotas na MESMA função — cada uma precisa trabalhar só a
// fatia que o orquestrador tem de saldo, senão a soma estoura o SIGKILL de 60s.
export function budgetFromRequest(req: { nextUrl: { searchParams: URLSearchParams } }): number {
  const raw = Number(req.nextUrl.searchParams.get("budget_ms"));
  return Number.isFinite(raw) && raw > 0 ? Math.min(raw, HOBBY_BUDGET_MS) : HOBBY_BUDGET_MS;
}

// Quantos retries cabem no saldo, dado o custo estimado de UMA tentativa.
export function budgetRetries(deadlineAt: number | undefined, attemptMs: number, max = 2): number {
  const left = msLeft(deadlineAt);
  if (!Number.isFinite(left)) return max;
  if (left > attemptMs * 3) return Math.min(max, 2);
  if (left > attemptMs * 2) return Math.min(max, 1);
  return 0;
}
