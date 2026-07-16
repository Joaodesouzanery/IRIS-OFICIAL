-- Auditoria 3ª rodada (jul/2026) — resolve os database linters do Supabase.
-- Idempotente / forward-only. Aplicar no SQL Editor. NENHUMA ação muda o caminho
-- service_role do servidor — só FECHA acesso anon, adiciona índices/PK e limpa tabela
-- morta VAZIA. Rodar `get_advisors` depois para confirmar.

BEGIN;

-- ─────────────────────────────────────────────────────────────────────────────
-- 🔴 SEC-A [rls_policy_always_true] — as 3 tabelas de coleta estão LIBERADAS PARA ANON.
-- A policy `allow_all_service_role` foi criada com USING(true)/WITH CHECK(true) SEM
-- `TO service_role` → aplica a TODAS as roles (anon/authenticated leem e escrevem via
-- /rest/v1). Re-assere o padrão service_role + REVOKE. (Guardado por existência da tabela.)
-- ─────────────────────────────────────────────────────────────────────────────
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['antt_reunioes_coletadas','antt_processos_coletados','documentos_coletados'] LOOP
    IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname='public' AND tablename=t) THEN
      EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
      EXECUTE format('DROP POLICY IF EXISTS "allow_all_service_role" ON public.%I', t);
      EXECUTE format('DROP POLICY IF EXISTS "service_role_all_%s" ON public.%I', t, t);
      EXECUTE format('CREATE POLICY "service_role_all_%s" ON public.%I FOR ALL TO service_role USING (true) WITH CHECK (true)', t, t);
      EXECUTE format('REVOKE ALL ON public.%I FROM anon, authenticated', t);
    END IF;
  END LOOP;
END $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 🔴 SEC-B [anon/authenticated_security_definer_function_executable] — 4 funções
-- SECURITY DEFINER chamáveis por anon via /rest/v1/rpc (as trg_* são de trigger e NÃO
-- deviam ser RPC). Não estão no repo (criadas à mão) → REVOKE guardado por pg_proc,
-- cobre todas as sobrecargas.
-- ─────────────────────────────────────────────────────────────────────────────
DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT p.proname, pg_get_function_identity_arguments(p.oid) AS args
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname IN (
        'sync_deliberacao_partes_counts_for_delib',
        'sync_deliberacao_partes_counts_for_partes',
        'trg_sync_partes_counts_from_deliberacao',
        'trg_sync_partes_counts_from_vinculo'
      )
  LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION public.%I(%s) FROM PUBLIC, anon, authenticated', r.proname, r.args);
  END LOOP;
END $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- CORR-A [no_primary_key] — qualidade_regulatoria_avaliacoes_arquivo nasceu de
-- CREATE TABLE (LIKE) (20260702120000), que NÃO copia PK. `id` é UUID herdado único.
-- ─────────────────────────────────────────────────────────────────────────────
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname='public' AND tablename='qualidade_regulatoria_avaliacoes_arquivo')
     AND NOT EXISTS (
       SELECT 1 FROM pg_constraint c JOIN pg_class r ON r.oid=c.conrelid JOIN pg_namespace n ON n.oid=r.relnamespace
       WHERE n.nspname='public' AND r.relname='qualidade_regulatoria_avaliacoes_arquivo' AND c.contype='p'
     ) THEN
    ALTER TABLE public.qualidade_regulatoria_avaliacoes_arquivo
      ADD CONSTRAINT qualidade_regulatoria_avaliacoes_arquivo_pkey PRIMARY KEY (id);
  END IF;
END $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- PERF [unindexed_foreign_keys] — SÓ as FKs de tabelas VIVAS com join/filtro reais
-- (todas NÃO-únicas → seguras). As demais FKs do lint já têm índice de cobertura, são
-- de tabela morta, ou apontam p/ tabela minúscula (irrelevante).
-- ─────────────────────────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_documentos_coletados_agencia ON public.documentos_coletados(agencia_id);
CREATE INDEX IF NOT EXISTS idx_documentos_coletados_processo ON public.documentos_coletados(processo_id);
CREATE INDEX IF NOT EXISTS idx_antt_processos_agencia ON public.antt_processos_coletados(agencia_id);
CREATE INDEX IF NOT EXISTS idx_qualidade_evidencias_avaliacao ON public.qualidade_regulatoria_evidencias(avaliacao_id);

-- ─────────────────────────────────────────────────────────────────────────────
-- LIMPEZA [unused_index] — schema LEGADO EN morto (`votes`/`directors`/
-- `deliberacoes_extraidas`): 0 refs no código (que usa votos/diretores/deliberacoes) e
-- 0 nas migrations (resquício da porta do backend Python). DROP só se ESTIVER VAZIA —
-- dado real é preservado e a decisão fica com o Senior. Resolve muitos unused_index.
-- ─────────────────────────────────────────────────────────────────────────────
DO $$
DECLARE t text; vazio boolean;
BEGIN
  FOREACH t IN ARRAY ARRAY['votes','directors','deliberacoes_extraidas'] LOOP
    IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname='public' AND tablename=t) THEN
      EXECUTE format('SELECT NOT EXISTS (SELECT 1 FROM public.%I LIMIT 1)', t) INTO vazio;
      IF vazio THEN
        EXECUTE format('DROP TABLE public.%I CASCADE', t);
        RAISE NOTICE '[auditoria3] tabela morta VAZIA dropada: %', t;
      ELSE
        RAISE NOTICE '[auditoria3] tabela % TEM DADOS — mantida; Senior revisar', t;
      END IF;
    END IF;
  END LOOP;
END $$;

-- Para o SENIOR (NÃO automatizado — podem ter dados de scripts manuais fora do repo):
-- avaliar DROP das órfãs sem refs no código: reunioes_regulatorias, diretor_status_eventos,
-- voto_evidencias, financeiro_*, observatorio_*, deliberacoes_backfill_snapshots,
-- votacao_casos, processo_monitoramento_eventos — e o índice redundante
-- idx_deliberacoes_agencia (virou prefixo dos compostos de 20260715120000).

COMMIT;

NOTIFY pgrst, 'reload schema';

-- AÇÃO MANUAL (painel, não-SQL): Authentication → habilitar "Leaked Password Protection".
