---
name: codebase-onboarding
description: Analyze the codebase and refresh the onboarding guide / CLAUDE.md — architecture map, entry points, conventions. Use when conventions drift or to regenerate CLAUDE.md.
metadata:
  origin: ECC
---

# Codebase Onboarding (IRIS)

Use to keep `CLAUDE.md` and the `iris-*` skills accurate as the project evolves. IRIS is already
onboarded — this skill is for REFRESH, not first-run.

## When to run
- After a structural change (new module area, new pipeline stage, dependency swap).
- When a review keeps hitting a convention not written down.
- Before handing the repo to a new collaborator.

## Refresh procedure
1. **Recon** (Glob/Grep, don't read everything): `package.json` scripts/deps, `vercel.json`
   (crons/maxDuration), `supabase/migrations/` (new tables), `src/app/api/v1/**` (new routes),
   `src/lib/server/**` (new lib modules), `src/lib/server/__tests__/` (test patterns).
2. **Diff against docs**: does `CLAUDE.md` still list the right commands/conventions? Do the `iris-*`
   skills still match reality (route flow, migration gotchas, security model)?
3. **Update, don't replace**: enhance `CLAUDE.md`/skills; call out what changed. Keep `CLAUDE.md`
   under ~150 lines, scannable.
4. **Sync memory**: the project memory index lives at
   `~/.claude/projects/<slug>/memory/MEMORY.md` — keep the roadmap/migrations entries current.

## Guardrails
- Verify every path/command before writing it. Don't restate what a skill already covers — link it.
- Don't invent conventions; document what the code actually does.
