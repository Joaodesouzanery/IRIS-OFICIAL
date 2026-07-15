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
  return EMAIL_FORMAT_RE.test(email);
}
