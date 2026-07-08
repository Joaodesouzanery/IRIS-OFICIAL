---
name: error-handling
description: Patterns for robust error handling in TypeScript — typed errors, error boundaries, retries, circuit breakers, and user-facing messages. Use when designing error types, adding retry logic, or reviewing endpoints for missing error handling.
metadata:
  origin: ECC
---

# Error Handling (TypeScript)

## Principles
- Fail loudly at the boundary; don't bury errors.
- User message ≠ developer message: generic to the user, full context in `console.error` server-side.
- Never swallow silently — a `catch` must handle, re-throw, or log. **Exception in IRIS**: several
  catches degrade ON PURPOSE (see `iris-api-conventions` and the `silent-failure-hunter` agent) — a
  best-effort audit or a deploy-before-migration guard that returns `null`/empty is by design. Only a
  swallowed error on a real WRITE is a bug.

## Patterns
- **Typed errors**: `class AppError extends Error { code; statusCode }` (IRIS has `ApiError` in
  `src/lib/api.ts` for the client fetch layer). At the route boundary, respond
  `NextResponse.json({ error }, { status })`.
- **Result style** for expected failures (parsing/external): return `{ ok, value }|{ ok, error }`
  instead of throwing.
- **Retry with backoff** only on transient/5xx/timeout, never on 4xx. IRIS uses `resilient-fetch.ts`
  (bounded retries + throttle) and `time-budget.ts` (`budgetRetries` scales retries to remaining
  budget against the 120s SIGKILL).

## Checklist
- Every `catch` handles/rethrows/logs — or is a documented intentional degradation.
- API errors → `{ error }` + status; no stack traces to users.
- Retries only for retriable errors; external calls have timeouts.
- Transactional/multi-step work has rollback or idempotent re-run.
