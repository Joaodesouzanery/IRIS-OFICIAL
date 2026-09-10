/**
 * Pagina uma query PostgREST/Supabase até esgotar as linhas, contornando o `max_rows`
 * default do PostgREST (~1000). Sem isto, rotas que agregam a tabela inteira em JS
 * (`dashboard/overview`, `reunioes/stats`, `diretores/overview`) SUBcontam em SILÊNCIO
 * quando a base cresce além do teto — PERF-4. Recebe uma FACTORY porque cada página é
 * uma query nova com `.range()` (o builder do supabase-js não é reutilizável entre ranges).
 *
 * Teto de segurança (`maxRows`): nunca roda ilimitado e AVISA no log se truncar, para o
 * corte nunca passar por "cobri tudo" silenciosamente.
 */
export async function selectAllPaged<T = any>(
  queryFactory: () => any,
  opts: { pageSize?: number; maxRows?: number; label?: string } = {},
): Promise<{ rows: T[]; error: unknown; truncated: boolean }> {
  const pageSize = opts.pageSize ?? 1000;
  const maxRows = opts.maxRows ?? 100000;
  const label = opts.label ?? "selectAllPaged";
  const rows: T[] = [];
  let from = 0;

  for (;;) {
    const { data, error } = await queryFactory().range(from, from + pageSize - 1);
    if (error) return { rows, error, truncated: false };
    const batch = (data ?? []) as T[];
    rows.push(...batch);
    // Última página: veio menos que uma página cheia → esgotou.
    if (batch.length < pageSize) return { rows, error: null, truncated: false };
    if (rows.length >= maxRows) {
      console.warn(`[${label}] teto de ${maxRows} linhas atingido — resultado TRUNCADO; a agregação pode subcontar.`);
      return { rows, error: null, truncated: true };
    }
    from += pageSize;
  }
}

/**
 * A leitura que AGREGA em JS lê a tabela INTEIRA — adaptador com a forma `{ data, error }` que as
 * rotas já consomem, mais `truncated` (Fase 25).
 *
 * ═══ O instrumento que subcontava ═══
 * `completude-2026`, `saude-dados`, `governanca-agencias` e `mandatos/stats` liam `deliberacoes`
 * com `.limit(40000)` e `votos` com `.limit(80000)` — e o PostgREST corta em ~1.000. Com 3.859
 * votos e mais de 1.000 deliberações, cada rota via 1.000 de cada, chamava de "órfão" todo voto
 * cuja deliberação ficou fora da fatia (537 em produção) e SUBCONTAVA todas as colunas da tabela
 * "Completude 2026". O número grande não era o problema; o pequeno é que estava errado.
 * `.limit(N)` grande não é paginação: é um teto que a plataforma ignora. Aqui, é `.range()`.
 */
export async function lerTudo<T = any>(
  queryFactory: () => any,
  label: string,
  maxRows = 100000,
): Promise<{ data: T[]; error: unknown; truncated: boolean }> {
  const r = await selectAllPaged<T>(queryFactory, { label, maxRows });
  return { data: r.rows, error: r.error, truncated: r.truncated };
}
