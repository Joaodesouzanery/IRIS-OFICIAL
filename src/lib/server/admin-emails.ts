export function parseConfiguredAdminEmails(): Set<string> {
  return new Set(
    [process.env.IRIS_OWNER_EMAIL, process.env.ADMIN_EMAILS]
      .filter(Boolean)
      .join(",")
      .split(",")
      .map((email) => email.trim().toLowerCase())
      .filter(Boolean),
  );
}

export function isConfiguredAdminEmail(email: string): boolean {
  const configured = parseConfiguredAdminEmails();
  return configured.size > 0 && configured.has(email.toLowerCase());
}

export function hasConfiguredAdminEmail(): boolean {
  return parseConfiguredAdminEmails().size > 0;
}

// Formato estrito o bastante para (a) validar input de e-mail e (b) barrar os
// metacaracteres de sintaxe do PostgREST (vírgula/parênteses) antes que um e-mail
// forjado vaze para filtros `.or(...)` — ver setup-owner/upsertAdminUser.
const EMAIL_FORMAT_RE = /^[^\s@,()]+@[^\s@,()]+\.[^\s@,()]+$/;

export function isValidEmailFormat(email: string): boolean {
  // Cap RFC 5321 (254) ANTES da regex: sem isto o backtracking O(n²) da regex vira
  // ReDoS alcançável SEM auth — setup-owner é público (bypass do middleware) e valida
  // o e-mail antes do gate de token, então um e-mail gigante travaria a CPU da função.
  if (email.length > 254) return false;
  return EMAIL_FORMAT_RE.test(email);
}
