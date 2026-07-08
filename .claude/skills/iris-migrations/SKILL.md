---
name: iris-migrations
description: Fluxo de migrations do IRIS (Supabase, SQL Editor manual, idempotente, forward-only) e as armadilhas já vividas em produção. Use ao criar, alterar ou revisar qualquer arquivo em supabase/migrations/, ou ao mexer em schema/constraints/backfill.
---

# Migrations do IRIS (Supabase)

As migrations vivem em `supabase/migrations/*.sql` e são **aplicadas MANUALMENTE pelo usuário no
SQL Editor do Supabase** — não há ORM, nem `supabase db push` automático no fluxo. Portanto:

## Regras inegociáveis
1. **Idempotente sempre.** Reaplicar não pode quebrar. Use `CREATE TABLE IF NOT EXISTS`,
   `ADD COLUMN IF NOT EXISTS`, `CREATE [UNIQUE] INDEX IF NOT EXISTS`, `CREATE OR REPLACE
   VIEW/FUNCTION/TRIGGER`, `DROP CONSTRAINT IF EXISTS ... ADD CONSTRAINT`, `INSERT ... ON CONFLICT`.
2. **Forward-only.** Nunca editar uma migration já aplicada em produção; criar uma nova.
3. **Deploy antes da migration é seguro.** O código TypeScript degrada sem a migration (ex.:
   `ensureReuniao` retorna `null`, inserts só incluem a coluna nova quando disponível). Ao adicionar
   uma coluna que o código passa a gravar, garanta que o código só a inclua condicionalmente até a
   migration existir.
4. **Envelope transacional** (`BEGIN; ... COMMIT;`) + `NOTIFY pgrst, 'reload schema';` no fim para o
   PostgREST recarregar o schema.
5. **Não reescrever RLS/indexação/pooling do zero** — consultar `.agents/skills/
   supabase-postgres-best-practices` (referência já no repo).
6. **Ao entregar SQL ao usuário**: dizer exatamente qual arquivo colar, em que ordem, e alertar o
   que REVISAR (ex.: dados de seed pesquisados). O usuário é o gate de qualidade do dado.

## Armadilhas REAIS já vividas (não repetir)
- **FK órfã fora do repo.** Produção pode ter colunas/constraints criadas por scripts manuais
  antigos que NÃO estão no repo (caso real: `deliberacoes.reuniao_id` tinha FK para
  `reunioes_regulatorias`, tabela ausente do repo). `ADD COLUMN IF NOT EXISTS` **preserva** a FK
  antiga → backfill viola a constraint velha. **Nunca confie no nome da constraint**: varra o
  catálogo e derrube TODA FK sobre a coluna antes de recriar a sua:
  ```sql
  DO $$ DECLARE v_con TEXT; BEGIN
    FOR v_con IN
      SELECT con.conname FROM pg_constraint con
      JOIN pg_class rel ON rel.oid = con.conrelid
      JOIN pg_namespace nsp ON nsp.oid = rel.relnamespace
      WHERE nsp.nspname='public' AND rel.relname='<tabela>' AND con.contype='f'
        AND EXISTS (SELECT 1 FROM unnest(con.conkey) k
                    JOIN pg_attribute a ON a.attrelid=rel.oid AND a.attnum=k
                    WHERE a.attname='<coluna_fk>')
    LOOP EXECUTE format('ALTER TABLE public.<tabela> DROP CONSTRAINT %I', v_con); END LOOP;
  END $$;
  ```
  Depois: zere vínculos órfãos (`SET <coluna_fk> = NULL WHERE NOT EXISTS (...)`), recrie a FK
  explícita, e re-derive os vínculos por **chave natural** no backfill.
- **CHECK constraint incompleta.** A `documentos_coletados.tipo` não incluía `'ata'` → todo insert
  de ata falhava em silêncio e o cron re-baixava. Ao criar um enum-via-CHECK, garanta que cobre
  TODOS os valores que o código emite (conferir o tipo TS correspondente).
- **`ON CONFLICT DO UPDATE` que toca a mesma linha 2×.** Se o SELECT de origem pode ter chaves
  repetidas, use `SELECT DISTINCT ON (chave) ... ORDER BY chave, <desempate>` senão dá
  "cannot affect row a second time".
- **Backfill grande em uma transação** trava tabela — para volumes altos, lotear (`FOR UPDATE SKIP
  LOCKED` + `LIMIT`).

## Padrões que funcionam (do próprio repo)
- Expand-contract para renomear/mover coluna (adiciona nullable → backfill → troca leitura → dropa).
- `iris_seed_director(...)` e migrations de seed casam registro por nome via `ILIKE` + só inserem se
  não existir (idempotência de dado).
- Trigger de `updated_at`: `CREATE OR REPLACE TRIGGER ... EXECUTE FUNCTION update_updated_at()`
  (função criada na `001`).
- RLS espelhando o padrão: `ENABLE ROW LEVEL SECURITY` + `DROP POLICY IF EXISTS` +
  `CREATE POLICY <x>_service_role_all ... FOR ALL TO service_role USING (true) WITH CHECK (true)`.

## Checklist antes de entregar uma migration
- [ ] Idempotente (roda 2× sem erro)?
- [ ] Toca coluna "nova" de tabela antiga? → não usar `REFERENCES` inline; varrer `pg_constraint`.
- [ ] CHECK/enum cobre todos os valores que o código emite?
- [ ] Backfill com risco de chave repetida? → `DISTINCT ON`.
- [ ] Código degrada sem a migration (deploy-antes seguro)?
- [ ] `BEGIN/COMMIT` + `NOTIFY pgrst`?
- [ ] Instruções claras ao usuário (arquivo, ordem, o que revisar)?
