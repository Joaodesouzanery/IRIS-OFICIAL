-- Auditoria 5ª rodada (jul/2026) — hardening das VIEWS security_definer.
-- Idempotente / forward-only. Aplicar no SQL Editor. NENHUMA ação muda o caminho
-- service_role do servidor (que ignora RLS/REVOKE) — só GARANTE que anon/authenticated
-- NÃO leem estas views via /rest/v1. Rodar `get_advisors` (security) depois para confirmar.
--
-- ─────────────────────────────────────────────────────────────────────────────
-- 🔴 ACHADO (auditoria B4/M2): as views `reunioes_consolidadas` (20260624130000) e
-- `coleta_execucoes` (20260622130000) foram criadas com `CREATE OR REPLACE VIEW` SEM
-- `WITH (security_invoker = true)` e SEM `REVOKE ... FROM anon, authenticated`. View sem
-- security_invoker roda com o privilégio do DONO (postgres) e IGNORA a RLS das tabelas-base
-- (deliberacoes, votos, monitoramento_runs, regulatory_news_collection_runs). Se o
-- default-privilege do Supabase conceder SELECT a `anon` sobre a view, um anônimo lê os
-- agregados via /rest/v1 apesar das tabelas estarem trancadas — viola "anon não lê nada".
-- Sensibilidade baixa (só contagens/status, sem dado pessoal), mas fecha o vetor.
--
-- Fix: (1) security_invoker=true → a view passa a respeitar a RLS de quem consulta; como
-- anon/authenticated não têm SELECT nas tabelas-base, a view não retorna nada para eles;
-- (2) REVOKE explícito como cinto-e-suspensório. O servidor usa service_role (bypassa ambos),
-- então impacto no app = ZERO. Guardado por existência da view (no-op onde ausente).
-- ─────────────────────────────────────────────────────────────────────────────

BEGIN;

DO $$
DECLARE v text;
BEGIN
  FOREACH v IN ARRAY ARRAY['reunioes_consolidadas', 'coleta_execucoes']
  LOOP
    IF EXISTS (SELECT 1 FROM pg_views WHERE schemaname = 'public' AND viewname = v) THEN
      EXECUTE format('ALTER VIEW public.%I SET (security_invoker = true)', v);
      EXECUTE format('REVOKE ALL ON public.%I FROM anon, authenticated', v);
    END IF;
  END LOOP;
END $$;

COMMIT;

NOTIFY pgrst, 'reload schema';

-- VERIFICAÇÃO pós-aplicação:
--   1. `get_advisors` (security) → NÃO deve mais listar `security_definer_view` para estas views.
--   2. Smoke com a ANON key (não a service_role):
--        curl "$NEXT_PUBLIC_SUPABASE_URL/rest/v1/reunioes_consolidadas?select=*&limit=1" \
--          -H "apikey: $ANON" -H "Authorization: Bearer $ANON"
--      → deve retornar [] (ou 401/permissão negada) — NUNCA linhas reais.
--
-- AÇÃO MANUAL à parte (painel, não-SQL): Authentication → habilitar
-- "Leaked Password Protection" (advisor auth_leaked_password_protection), se ainda não estiver.
