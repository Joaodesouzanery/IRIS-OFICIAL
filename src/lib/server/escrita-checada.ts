/**
 * A escrita no Supabase que NÃO falha em silêncio (Fase 24).
 *
 * `supabase-js` devolve `{ error }` em vez de lançar. Um `await db.from(...).update(...)` sem
 * ler o resultado é uma escrita que pode não ter acontecido e ninguém sabe — foi assim que um
 * alarme ficou mudo por um dia (Fase 18) e um reparo reparou zero com cara de sucesso (Fase 20).
 * Medido na etapa133: 93 de 187 escritas do repo não checavam.
 *
 * Uso: `const ok = await exigirEscrita(db.from("x").update(...).eq(...), "contexto");` — loga o
 * erro com o contexto e devolve `false`; quem tem contador só incrementa se `ok`.
 */
export async function exigirEscrita(
  escrita: PromiseLike<{ error: { message?: string } | null }>,
  contexto: string,
): Promise<boolean> {
  const { error } = await escrita;
  if (error) {
    console.error(`[escrita] ${contexto} falhou: ${error.message ?? String(error)}`);
    return false;
  }
  return true;
}
