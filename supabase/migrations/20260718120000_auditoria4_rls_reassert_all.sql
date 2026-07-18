-- Auditoria 4ª rodada (jul/2026) — RE-ASSERT de RLS em TODAS as tabelas de dados.
-- Idempotente / forward-only. Aplicar no SQL Editor. NENHUMA ação muda o caminho
-- service_role do servidor — só GARANTE que anon/authenticated NÃO leem/escrevem via
-- /rest/v1. Rodar `get_advisors` (security) depois para confirmar zerado.
--
-- ─────────────────────────────────────────────────────────────────────────────
-- 🔴 CAUSA-RAIZ (drift de produção): a migration 010 tentou endurecer 24 tabelas num
-- ÚNICO bloco `DO $$` SEM guarda `IF EXISTS` por tabela e SEM `ENABLE RLS`/`REVOKE`.
-- Se QUALQUER tabela da lista não existia quando a 010 rodou (ex.: antt_*/documentos_
-- coletados criadas depois), o FOREACH aborta o bloco INTEIRO → NENHUMA das 24 é
-- endurecida. Prova: o get_advisors de jul/2026 re-sinalizou antt_*/documentos_coletados
-- (que ESTÃO na lista da 010), o que só é possível se a 010 não aplicou em produção.
--
-- Consequência: tabelas cujo único endurecimento vivia no bloco da 010 podem seguir com
-- a policy `allow_all_service_role USING(true)` aplicável a TODAS as roles (anon lê e
-- escreve via /rest/v1) — inclui votos/diretores/mandatos/deliberacoes (a esteira) e,
-- pior p/ LGPD, associados/documentos_associado/lista_triplice/documento_fontes.
--
-- Fix: re-assert do padrão service_role em CADA tabela, guardado por existência (no-op
-- onde já está correto; FECHA onde a 010 não pegou). Espelha exatamente a 20260716.
-- ─────────────────────────────────────────────────────────────────────────────

BEGIN;

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    -- origem 001 (esteira de votos — fonte única)
    'agencias',
    'diretores',
    'mandatos',
    'upload_jobs',
    'deliberacoes',
    'votos',
    -- origem 005 (monitoramento multi-agência)
    'monitoramento_sites',
    'monitoramento_itens',
    'monitoramento_alertas',
    'monitoramento_runs',
    'fontes_oficiais',
    'diretor_fontes',
    'mandato_fontes',
    'diretor_candidatos',
    -- origem 006 (associados/documentos — DADO PESSOAL, prioridade LGPD)
    'associados',
    'associado_temas',
    'lista_triplice',
    'documentos_associado',
    'documento_fontes',
    -- origem 008 (já tinham migration standalone, reincluídas por segurança/idempotência)
    'associado_documento_agendamentos',
    'documento_envios',
    -- origem coleta (já cobertas pela 20260716; reincluídas — no-op)
    'antt_reunioes_coletadas',
    'antt_processos_coletados',
    'documentos_coletados'
  ] LOOP
    IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = t) THEN
      EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
      -- derruba a policy aberta (aplicável a todas as roles) sob os dois nomes possíveis
      EXECUTE format('DROP POLICY IF EXISTS "allow_all_service_role" ON public.%I', t);
      EXECUTE format('DROP POLICY IF EXISTS "service_role_all_%s" ON public.%I', t, t);
      -- re-cria restrita a service_role
      EXECUTE format(
        'CREATE POLICY "service_role_all_%s" ON public.%I FOR ALL TO service_role USING (true) WITH CHECK (true)',
        t, t
      );
      -- cinto e suspensório: mesmo sem policy p/ anon, remove o GRANT de tabela
      EXECUTE format('REVOKE ALL ON public.%I FROM anon, authenticated', t);
      RAISE NOTICE '[auditoria4] RLS re-assertada: %', t;
    ELSE
      RAISE NOTICE '[auditoria4] tabela ausente (ignorada): %', t;
    END IF;
  END LOOP;
END $$;

COMMIT;

NOTIFY pgrst, 'reload schema';

-- VERIFICAÇÃO (rodar após aplicar):
--   1. get_advisors categoria "security" → deve zerar rls_policy_always_true /
--      policy_exists_rls_disabled para estas tabelas.
--   2. Smoke com a ANON key (não a service_role):
--      curl "$NEXT_PUBLIC_SUPABASE_URL/rest/v1/votos?select=id&limit=1" \
--        -H "apikey: $ANON" -H "Authorization: Bearer $ANON"
--      → deve retornar [] (RLS nega) — NUNCA linhas reais.
--
-- AÇÃO MANUAL à parte (painel, não-SQL): Authentication → habilitar
-- "Leaked Password Protection" (advisor auth_leaked_password_protection).
