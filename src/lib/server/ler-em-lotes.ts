/**
 * Leitura por `.in()` em LOTES, com o erro checado (Fase 31).
 *
 * ═══ O defeito que motivou este módulo, medido em produção ═══
 * `auditoria/votos/route.ts` consultava os votantes com um `.in("deliberacao_id", idsDeDelib)`
 * único, sem lote e sem paginação. No caminho da TELA (50 linhas → ≤50 ids) a URL dava 2.057
 * chars e sempre funcionou. No caminho do CSV, `lerTudo` traz o universo inteiro: **820 ids →
 * 32.087 chars**, e a consulta voltou vazia. Como o erro era descartado e o consumidor fazia
 * `(res.data ?? []).length`, a falha total virou **`0` em 100% das 2.726 linhas** — um número
 * plausível, que é a pior forma de errar.
 *
 * ⚠️ O experimento que prova a causa já tinha rodado, na MESMA requisição: `assinarPdfsDas-
 * Deliberacoes` faz um `.in()` idêntico em forma, mas com a lista colapsada por
 * `documento_pai_id` — **595 ids → 23.312 chars — e essa coluna veio preenchida em 100%**. Duas
 * consultas iguais, uma passou e a outra não; o limiar do gateway está entre as duas. O default
 * de `urlLengthLimit` do próprio postgrest-js é 8.000.
 *
 * ═══ Por que LOTE, e por que 100 ═══
 * São DOIS defeitos, e consertar um só deixa o outro de pé:
 *  1. a URL cresce com a lista, sem teto;
 *  2. sem `.range()`, o PostgREST corta em ~1.000 linhas — e aí o número sai SUBCONTADO, que é
 *     ainda mais difícil de detectar do que zerado.
 * Lote de 100 resolve os dois: a URL fica em ~4 KB (metade do limite da biblioteca) e, mesmo que
 * cada id renda 5 linhas, são ~500 por requisição — com folga sobre o teto de ~1.000.
 *
 * ⚠️ E o custo NÃO cresce com a tabela. A alternativa seria `lerTudo` sobre `votos` inteiro (o que
 * `materializar-faltantes` faz, e lá é o certo, porque ele precisa de todos). Aqui a lista é o que
 * manda: 820 ids são 9 requisições hoje e 9 requisições quando a tabela dobrar.
 *
 * O repo tinha CINCO cópias inline deste laço (`diagnostico-coleta:107` lote 300,
 * `diagnostico-direcao:96` lote 200, `recalcular-divergencia:150` lote 100, `deliberacoes/[id]:194`,
 * `reprocessar-abstencoes:96`) e nenhum utilitário — e nenhuma delas checa o erro de todos os
 * lotes. Foi assim que a sexta cópia nasceu sem lote nenhum.
 */

/** O tamanho do lote. Não é ajustável por chamador de propósito: um número, um comportamento. */
export const TAMANHO_DO_LOTE = 100;

export interface ResultadoEmLotes<T> {
  data: T[];
  /** O erro do PRIMEIRO lote que falhou. Não-nulo significa que `data` está INCOMPLETO. */
  error: unknown;
  /** Algum lote devolveu página cheia — o `max_rows` do PostgREST pode ter cortado. */
  truncated: boolean;
  lotes: number;
}

/**
 * Lê `select` da `tabela` para todos os `valores` de `coluna`, em lotes.
 *
 * ⚠️ Para no PRIMEIRO lote que falhar, devolvendo o erro. Seguir com os demais produziria um
 * resultado parcial com cara de completo — exatamente o defeito que este módulo existe para matar.
 * Quem chama TEM de checar `error`; devolver `[]` em silêncio é o que custou 2.726 zeros.
 */
export async function lerEmLotes<T = any>(
  db: { from: (t: string) => any },
  entrada: { tabela: string; select: string; coluna: string; valores: string[]; label: string },
): Promise<ResultadoEmLotes<T>> {
  const unicos = [...new Set(entrada.valores)].filter(Boolean);
  if (unicos.length === 0) return { data: [], error: null, truncated: false, lotes: 0 };

  const data: T[] = [];
  let truncated = false;
  let lotes = 0;

  for (let i = 0; i < unicos.length; i += TAMANHO_DO_LOTE) {
    const fatia = unicos.slice(i, i + TAMANHO_DO_LOTE);
    lotes++;
    const { data: linhas, error } = await db
      .from(entrada.tabela)
      .select(entrada.select)
      .in(entrada.coluna, fatia);
    if (error) {
      console.error(`[${entrada.label}] lote ${lotes} de ${fatia.length} ids falhou:`, error);
      return { data, error, truncated, lotes };
    }
    const batch = (linhas ?? []) as T[];
    // ⚠️ Página cheia é SUSPEITA de corte, não prova de sucesso: o PostgREST devolve exatamente
    // `max_rows` quando trunca. Avisar é melhor que fingir que veio tudo.
    if (batch.length >= 1000) {
      console.warn(`[${entrada.label}] lote ${lotes} devolveu ${batch.length} linhas — pode ter sido cortado pelo max_rows.`);
      truncated = true;
    }
    data.push(...batch);
  }
  return { data, error: null, truncated, lotes };
}
