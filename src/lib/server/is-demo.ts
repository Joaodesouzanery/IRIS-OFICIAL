/**
 * isDemo — verifica se a aplicação está em modo demo (sem Supabase configurado).
 * NUNCA usar query params para determinar modo demo — isso permitiria bypass em produção.
 */
export function isDemo(): boolean {
  return !process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY;
}
