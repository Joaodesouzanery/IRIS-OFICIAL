---
name: tdd-workflow
description: Use when writing new features, fixing bugs, or refactoring. Enforces test-driven development with a RED→GREEN→refactor cycle. Adapted for the IRIS Vitest setup.
metadata:
  origin: ECC
---

# TDD Workflow (IRIS / Vitest)

Tests-first, RED→GREEN→refactor. **IRIS adaptation:** the runner is **Vitest** (`npm run test` =
`vitest run`; watch = `npm run test:watch`). There is **no coverage tooling** (`@vitest/coverage`) and
**no testing-library** yet — so ignore the generic "80% coverage gate"; the real quality bar is the
**certification harness** (`src/lib/server/__tests__/vote-certification.test.ts`, 46 expectations over
real official PDFs). New extraction/parse logic must keep it green. (Optional future: add
`@vitest/coverage-v8`.)

## Cycle
1. **Write the test first** in `src/lib/server/__tests__/<name>.test.ts` (unit/domain; stub Supabase
   with a chainable fake; stub `global.fetch` for collectors; set `COLLECTOR_HOST_THROTTLE_MS="1"` to
   avoid real throttling).
2. **Run it — it must FAIL** for the intended reason (RED gate): `export
   PATH="$HOME/.nvm/versions/node/v24.17.0/bin:$PATH" && npx vitest run <file>`.
3. **Minimal implementation** to pass.
4. **Run again — GREEN.**
5. **Refactor** with tests green.
6. **Full ritual** before done: `npm run type-check && npm run test && npm run build && npm run lint`.

## What to test (patterns already in the repo)
- Pure domain logic: parsers, extractors, name-matcher, time-budget, dedup — direct unit tests.
- Collectors: mock `fetch`; assert skip-set/deadline/truncation behavior.
- DB-touching lib functions: a small chainable Supabase stub returning queued `{data,error}`.
- When adding a labeled PDF to certification: drop the fixture + a `gabarito.json` entry (the test
  requires every fixture labeled).

## Anti-patterns
Testing implementation details over behavior; interdependent tests (shared state); brittle mocks;
asserting nothing. Prefer table-driven cases.
