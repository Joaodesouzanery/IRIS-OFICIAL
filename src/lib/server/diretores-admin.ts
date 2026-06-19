/**
 * diretores-admin.ts
 * Validações compartilhadas para o CRUD admin de diretores/mandatos.
 */

export const VALID_SITUACAO = new Set(["titular", "substituto", "interino", "inativo", "designado"]);

const RE_ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** Normaliza nome_variantes: array de strings, sem vazios/duplicatas, máx. 30 itens de 100 chars. */
export function sanitizeNomeVariantes(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const cleaned = value
    .map((v) => String(v ?? "").trim().slice(0, 100))
    .filter((v) => v.length > 0);
  return [...new Set(cleaned)].slice(0, 30);
}

/** Valida data no formato ISO (YYYY-MM-DD); retorna null se inválida/ausente. */
export function isoDateOrNull(value: unknown): string | null {
  return typeof value === "string" && RE_ISO_DATE.test(value) ? value : null;
}
