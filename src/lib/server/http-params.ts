// Parse de inteiro vindo de query param, com fallback e clamp. Sem isto, `?limit=abc`
// vira NaN (`Number("abc")`/`parseInt("abc")`) que propaga pelos Math.min/max até o
// `.range()`/`.slice()` do Supabase — virando erro 500 ou resultado vazio em vez de
// cair no default. `?? default` só cobre `null`, não string inválida.
export function parseIntParam(
  raw: string | null | undefined,
  fallback: number,
  min = Number.MIN_SAFE_INTEGER,
  max = Number.MAX_SAFE_INTEGER,
): number {
  if (raw == null || raw.trim() === "") return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.trunc(n)));
}
