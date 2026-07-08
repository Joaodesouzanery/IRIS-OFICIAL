---
name: context-budget
description: Audit Claude Code context consumption across agents, skills, MCP servers, and CLAUDE.md. Identify bloat and produce prioritized token-savings recommendations. Use to keep the .claude/ setup lean.
metadata:
  origin: ECC
---

# Context Budget

Keep the IRIS `.claude/` setup lean — the whole point of the curated install.

## Inventory (estimate tokens ≈ words × 1.3)
- **Agents** (`.claude/agents/*.md`): their `description` loads on EVERY Task invocation — most
  expensive. Flag files >200 lines or descriptions >30 words. IRIS keeps ~5 agents on purpose.
- **Skills** (`.claude/skills/*/SKILL.md`): loaded on demand by description — cheap until triggered.
  Flag files >400 lines.
- **CLAUDE.md**: loaded every session — keep under ~150 lines.
- **MCP** (`.mcp.json`): ~500 tokens per tool schema. IRIS has 1 server (`supabase`).

## Rule for IRIS
If overhead grows, **cut agents before skills** (agents are always-on). Don't add agents/skills that
duplicate built-ins (Explore/Plan/general-purpose already exist) or that don't match the stack (the
CLAUDE.md "Fora de propósito" list). Re-run this audit after adding anything.

## Report
```
Agents: N (~X tok)   Skills: M (~Y tok)   CLAUDE.md (~Z tok)   MCP tools: K (~W tok)
Top savings: [action → tokens]
```
