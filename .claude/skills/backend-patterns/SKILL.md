---
name: backend-patterns
description: Backend architecture patterns, API design, database optimization, and server-side best practices for Node.js and Next.js API routes.
metadata:
  origin: ECC
---

# Backend Patterns

Server-side patterns for Next.js API routes + Supabase. **For IRIS-specific route rules use
`iris-api-conventions` (it takes precedence over the generic advice here).**

## Layering
- Keep business logic in `src/lib/server/*` modules; route handlers stay thin (guard → call lib →
  respond). Reuse existing helpers before adding new ones.
- **Repository-ish access**: Supabase query builder; select only needed columns; avoid `select('*')`
  on user-facing paths.

## Query hygiene
- Parameterized/builder queries only (never string-concat SQL).
- **N+1 prevention**: batch with `.in(ids)` + build a `Map`, or a single joined select — don't query
  inside a loop over rows.
- Upserts are idempotent: IRIS `votos` uses `onConflict: "deliberacao_id,diretor_id"`.

## Resilience
- External calls need timeouts + bounded retries. IRIS uses `src/lib/server/resilient-fetch.ts`
  (`resilientFetch`/`resilientFetchText`) and `time-budget.ts` (`hasBudget`/`budgetRetries`) to stay
  under the 120s Vercel `maxDuration` (SIGKILL). Long crawl/PDF routes must declare `maxDuration` in
  `vercel.json` and carry a deadline.
- Prefer resumable `{parcial}` contracts for long jobs; the front loops until `parcial=false`.

## Errors
- Centralized shape at the route boundary: `NextResponse.json({ error }, { status })`. Internal
  details stay in `console.error`; users get generic messages. (Client normalizes via `src/lib/api.ts`.)

## Auth
- Guards in `src/lib/server/request-guards.ts` (`requireAdmin`/`requireAdminOrCron`/`requireCron`).
  See `iris-security-lgpd`.
