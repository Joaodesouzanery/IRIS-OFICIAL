---
name: verification-loop
description: Quality-gate verification after a feature, change, or refactor and before a PR/commit. Runs build, type-check, lint, tests, and a security/diff pass. Tuned to the IRIS ritual.
metadata:
  origin: ECC
---

# Verification Loop (IRIS)

Run before committing/pushing (push to `main` auto-deploys to Vercel).

## The IRIS ritual (single command)
```bash
export PATH="$HOME/.nvm/versions/node/v24.17.0/bin:$PATH" \
  && npm run type-check && npm run test && npm run build && npm run lint
```
- **type-check** (`tsc --noEmit`) — if it complains about deleted pages/routes, `rm -rf .next/types`
  and re-run.
- **test** (`vitest run`) — the certification harness (`vote-certification.test.ts`) must stay green.
- **build** (`next build`) — must complete.
- **lint** (`next lint`) — one pre-existing warning in `governanca/page.tsx` is expected/allowed.

## Extra passes
- **Diff review**: `git status --short` + `git diff` — confirm only intended files changed; watch for
  accidental edits and stray `console.log`.
- **Security quick scan**: grep for `sk-`, `service_role`, tokens in `src/`; ensure no secret is
  staged. See `iris-security-lgpd`.
- **Prod probe** (after deploy, since Vercel auto-publishes on push to main): hit a route the change
  added and confirm the new deploy is live (auth-gated routes return the guard status, not 405).

## Report
```
Types: PASS/FAIL   Tests: X/Y (cert 46/46)   Build: PASS/FAIL   Lint: PASS(+1 known)   Diff: N files
Verdict: READY / NOT READY
```
Never commit with a red gate. Commit e-mail must be the GitHub noreply (gmail blocks Vercel deploy).
