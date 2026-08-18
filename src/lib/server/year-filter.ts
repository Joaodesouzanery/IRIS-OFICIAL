/**
 * Filtro de ANO honesto para as agregações (QA ago/2026): as abas de Análise/Observatório
 * mandavam `?year=` mas as rotas ignoravam o parâmetro — o usuário trocava o ano e recebia
 * os MESMOS números (falso negativo silencioso). Filtro em JS (pós-fetch) porque o fallback
 * data_reuniao→data_publicacao não é expressável num filtro PostgREST simples.
 * Sem `year` (ou inválido) → passa tudo (comportamento anterior preservado).
 */
/**
 * Mesmo predicado, mas NO SQL (PostgREST .or) — corta ~90% do payload nas rotas que
 * paginavam a tabela inteira para filtrar em memória. Semântica idêntica ao matchesYear:
 * data_reuniao no ano; OU sem data_reuniao e data_publicacao no ano; OU sem data alguma.
 * `matchesYear` continua aplicado depois como cinto de segurança.
 */
export function applyYearFilterSql<T extends { or: (f: string) => T }>(q: T, year: string | null | undefined): T {
  if (!year || !/^20\d{2}$/.test(year)) return q;
  const de = `${year}-01-01`;
  const ate = `${year}-12-31`;
  return q.or(
    `and(data_reuniao.gte.${de},data_reuniao.lte.${ate}),` +
    `and(data_reuniao.is.null,data_publicacao.gte.${de},data_publicacao.lte.${ate}),` +
    `and(data_reuniao.is.null,data_publicacao.is.null)`,
  );
}

export function matchesYear(
  row: { data_reuniao?: string | null; data_publicacao?: string | null },
  year: string | null | undefined,
): boolean {
  if (!year || !/^20\d{2}$/.test(year)) return true;
  const dt = row.data_reuniao ?? row.data_publicacao;
  // Sem data nenhuma: mantém (não sumir registro por falta de metadado; o gap aparece nos alertas).
  if (!dt) return true;
  return String(dt).startsWith(year);
}
