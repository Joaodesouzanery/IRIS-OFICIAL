---
name: postgres-patterns
description: PostgreSQL best practices for query optimization, schema design, indexing, and security (Supabase). Use when writing SQL/queries, designing schema, troubleshooting slow queries, or implementing RLS.
metadata:
  origin: ECC
---

# PostgreSQL Patterns (Supabase)

For the IRIS migration WORKFLOW and its hard-won gotchas, use `iris-migrations`. Deep RLS/indexing/
pooling references already live in `.agents/skills/supabase-postgres-best-practices/` — consult those,
don't restate them. This skill is the quick reference.

## Index cheat sheet
| Query | Index |
|---|---|
| `WHERE col = v` / `> v` | B-tree |
| `WHERE a = x AND b > y` | Composite `(a, b)` — equality first, range last |
| `jsonb @> '{}'` / FTS | GIN |
| time-series ranges | BRIN |
Partial index for hot subsets: `... WHERE deleted_at IS NULL`. Index foreign keys used in joins.

## Types
`bigint`/uuid ids · `text` over `varchar(n)` · `timestamptz` over `timestamp` · `numeric` for money.

## Patterns
- **UPSERT**: `INSERT ... ON CONFLICT (cols) DO UPDATE SET x = EXCLUDED.x`. If the source SELECT can
  repeat the conflict key, use `SELECT DISTINCT ON (key) ... ORDER BY key, <tiebreak>`.
- **Queue**: `... FOR UPDATE SKIP LOCKED` to claim rows safely.
- **Cursor pagination** (`WHERE id > $last ORDER BY id LIMIT n`) beats large OFFSET.
- **RLS** (optimized): wrap `auth.uid()` in a subselect. IRIS tables use a `..._service_role_all`
  policy (server operates via service_role; anon reads nothing).

## Anti-patterns
`select('*')` on hot paths; unindexed FKs; NOT NULL without default on a big existing table (locks +
rewrites — add nullable, backfill, then constrain); giant single-transaction backfills (loop/batch).
