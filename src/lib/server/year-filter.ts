/**
 * Filtro de ANO honesto para as agregações (QA ago/2026): as abas de Análise/Observatório
 * mandavam `?year=` mas as rotas ignoravam o parâmetro — o usuário trocava o ano e recebia
 * os MESMOS números (falso negativo silencioso). Filtro em JS (pós-fetch) porque o fallback
 * data_reuniao→data_publicacao não é expressável num filtro PostgREST simples.
 * Sem `year` (ou inválido) → passa tudo (comportamento anterior preservado).
 */
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
