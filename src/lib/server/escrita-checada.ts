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

/**
 * A irmã de `exigirEscrita` para quem precisa da LINHA de volta (Fase 30).
 *
 * `registrarRodada` é a única escrita do caminho quente fora deste módulo, e ela engolia o erro
 * num `catch` mudo — mas não podia usar `exigirEscrita`, que devolve boolean: o orquestrador
 * precisa do snapshot atualizado para avaliar o disjuntor. Faltava o contrato com retorno.
 *
 * Mesmo contrato de log; `null` significa "não gravou", e quem chama TEM de reagir a isso.
 */
export async function exigirEscritaComLinha<T>(
  escrita: PromiseLike<{ data: T | null; error: { message?: string } | null }>,
  contexto: string,
): Promise<T | null> {
  try {
    const { data, error } = await escrita;
    if (error) {
      console.error(`[escrita] ${contexto} falhou: ${error.message ?? String(error)}`);
      return null;
    }
    // ⚠️ Sem erro e sem linha é escrita que não pegou nenhuma linha — silêncio com cara de
    // sucesso, que é exatamente o que este módulo existe para matar.
    if (!data) {
      console.error(`[escrita] ${contexto} não afetou nenhuma linha`);
      return null;
    }
    return data;
  } catch (err) {
    console.error(`[escrita] ${contexto} lançou: ${err instanceof Error ? err.message : String(err)}`);
    return null;
  }
}
