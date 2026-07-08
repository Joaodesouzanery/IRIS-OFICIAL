---
name: database-migrations
description: Database migration best practices — safe schema changes, data migrations, rollbacks, zero-downtime. Use when creating/altering tables, adding columns/indexes, or running backfills.
metadata:
  origin: ECC
---

# Database Migrations

> **IRIS uses no ORM.** Migrations are raw SQL in `supabase/migrations/*.sql`, applied MANUALLY in the
> Supabase SQL Editor, idempotent and forward-only. The project-specific flow, checklist, and the real
> gotchas (orphan FK to `reunioes_regulatorias`, incomplete CHECK, `ON CONFLICT` double-touch) live in
> **`iris-migrations` — use that skill for IRIS work.** The Prisma/Drizzle/Django/Go sections of the
> generic skill are **N/A** here.

## Universal principles (still apply)
1. Every schema change is a migration file — never hand-edit prod ad hoc.
2. Forward-only in prod; fix with a new migration, don't edit an applied one.
3. Separate schema (DDL) from large data (DML) migrations.
4. Test against production-sized data — a migration fine on 100 rows can lock on 10M.

## PostgreSQL safety (the parts IRIS uses)
- **Add column**: nullable, or `NOT NULL DEFAULT` (Postgres 11+ instant). Never `NOT NULL` without
  default on a big existing table (full rewrite + lock).
- **Add index** on a large existing table: `CREATE INDEX CONCURRENTLY` (cannot run inside a txn).
- **Rename/move**: expand-contract (add nullable → backfill → switch reads → drop old).
- **Large backfill**: batch with `FOR UPDATE SKIP LOCKED` + `LIMIT`, not one transaction.
- **Idempotency**: `IF NOT EXISTS` / `ON CONFLICT` / `DROP CONSTRAINT IF EXISTS ... ADD CONSTRAINT`.

For IRIS specifics (varredura de `pg_constraint`, `DISTINCT ON` no backfill, deploy-before-migration,
checklist de entrega ao usuário) → **`iris-migrations`**.
