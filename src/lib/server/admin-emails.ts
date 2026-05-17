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
