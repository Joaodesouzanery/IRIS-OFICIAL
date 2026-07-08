---
name: coding-standards
description: Baseline cross-project coding conventions for naming, readability, immutability, and code-quality review. Use detailed frontend or backend skills for framework-specific patterns.
metadata:
  origin: ECC
---

# Coding Standards

Baseline conventions. For React/UI use `frontend-patterns`/`react-patterns`; for server use
`backend-patterns`; for IRIS route/API rules use `iris-api-conventions`.

## Principles
- **Readability first** — clear names; self-documenting over comments (comment WHY, not WHAT).
- **KISS / DRY / YAGNI** — simplest solution; extract on real duplication; no speculative generality.

## TypeScript/JavaScript
- **Descriptive names**; verb-noun functions (`fetchMarketData`, `isValidEmail`).
- **Immutability**: spread over mutation (`{...user, name}`, `[...items, x]`); copy before `sort()`.
- **Error handling**: no bare/empty catch; surface or log with context (but see IRIS intentional
  degradation in `iris-api-conventions` — those are by design).
- **Async**: `Promise.all` for independent calls; avoid needless sequential awaits.
- **Types**: proper interfaces over `any`; narrow before deref.

## Red flags
Functions >50 lines (extract), nesting >4 (early returns), duplicated logic, hardcoded magic numbers
(name them), dead/commented code, stray `console.log` in committed code.

## IRIS notes
- Validation is **manual (no zod)** by choice — don't introduce schema libs.
- Match the surrounding file's style; the codebase favors small server modules in `src/lib/server/`.
