---
name: security-review
description: Use when adding authentication, handling user input, working with secrets, creating API endpoints, or implementing sensitive features. Provides a security checklist and patterns.
metadata:
  origin: ECC
---

# Security Review

> **For IRIS, apply `iris-security-lgpd` FIRST** (service_role server-only, CRON_SECRET, admin guards,
> RLS, LGPD for public officials, commit-email rule). This skill is the generic backstop.

## Checklist
1. **Secrets**: none hardcoded; env vars only; `.env.local` gitignored; no secrets in git history or
   logs. IRIS: only `NEXT_PUBLIC_SUPABASE_URL`/`ANON_KEY` are client-safe; `service_role` is server-only.
2. **Input validation**: validate everything (IRIS does it manually — no zod); whitelist over blacklist;
   file uploads restricted by size/type/extension (PDF pipeline).
3. **SQL injection**: parameterized/query-builder only (Supabase builder is safe); never concat SQL.
4. **AuthN/AuthZ**: check authorization before sensitive ops; IRIS uses `requireAdmin`/
   `requireAdminOrCron`; RLS on tables; tokens not in `localStorage`.
5. **XSS**: sanitize user HTML (DOMPurify) / rely on React escaping; set CSP; no unvalidated
   `dangerouslySetInnerHTML`.
6. **CSRF / cookies**: `HttpOnly; Secure; SameSite=Strict` on session cookies.
7. **Rate limiting**: throttle public/expensive endpoints (use a shared store, not per-process memory).
8. **Sensitive data**: never log passwords/tokens/PII; generic error messages to users, detail in
   server logs only.
9. **Dependencies**: `npm audit`; commit lock file; `npm ci` in CI.

## Common false positives
Env names in `.env.example`; the Supabase anon key (meant to be public); checksum hashes; **manual
validation without zod (IRIS project choice)**; intentional graceful-degradation catches
(`iris-api-conventions`).

## Emergency
On a real leaked credential: document, alert the user, provide the fix, and rotate the secret.
