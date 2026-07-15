-- Auditoria 2ª rodada (jul/2026) — corrige RLS ausente + adiciona índices de performance.
-- Idempotente (safe re-run). Aplicar no SQL Editor do Supabase.
-- Deploy-antes-seguro: o código já funciona sem estes índices; a RLS só FECHA um acesso
-- indevido (não muda o caminho do servidor, que usa service_role).

BEGIN;

-- ─────────────────────────────────────────────────────────────────────────────
-- SEC-1 [ALTO] — RLS ausente em `qualidade_regulatoria_avaliacoes_arquivo`.
-- A tabela nasceu de `CREATE TABLE (LIKE ...)` na 20260702120000 — `LIKE` NÃO copia RLS,
-- então ficou legível pela chave anon (pública) via /rest/v1. Habilita RLS + policy
-- service_role (espelha o padrão do repo) + revoga anon/authenticated. Só age se existir.
-- ─────────────────────────────────────────────────────────────────────────────
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_tables
    WHERE schemaname = 'public' AND tablename = 'qualidade_regulatoria_avaliacoes_arquivo'
  ) THEN
    ALTER TABLE public.qualidade_regulatoria_avaliacoes_arquivo ENABLE ROW LEVEL SECURITY;
    DROP POLICY IF EXISTS "service_role_all_qualidade_regulatoria_avaliacoes_arquivo"
      ON public.qualidade_regulatoria_avaliacoes_arquivo;
    CREATE POLICY "service_role_all_qualidade_regulatoria_avaliacoes_arquivo"
      ON public.qualidade_regulatoria_avaliacoes_arquivo
      FOR ALL TO service_role USING (true) WITH CHECK (true);
    REVOKE ALL ON public.qualidade_regulatoria_avaliacoes_arquivo FROM anon, authenticated;
  END IF;
END $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- PERF — índices para os filtros/ordenações quentes (todos NÃO-únicos → sempre seguros).
-- pg_trgm já habilitado (usado em 001/006/016).
-- ─────────────────────────────────────────────────────────────────────────────

-- Busca ILIKE %termo% da lista de notícias (hoje seq-scan): índice trigram em titulo/resumo.
CREATE INDEX IF NOT EXISTS idx_regulatory_news_titulo_trgm
  ON public.regulatory_news USING gin (titulo gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_regulatory_news_resumo_trgm
  ON public.regulatory_news USING gin (resumo gin_trgm_ops);

-- Ordenação padrão da lista SEM filtro de agência (o índice existente lidera por agencia_sigla).
CREATE INDEX IF NOT EXISTS idx_regulatory_news_publicado_first_seen
  ON public.regulatory_news (publicado_em DESC NULLS LAST, first_seen_at DESC);

-- Dedup de deliberação por reunião/processo (deliberacao-dedup.ts): numero_reuniao e processo hoje sem índice.
CREATE INDEX IF NOT EXISTS idx_deliberacoes_agencia_numreuniao
  ON public.deliberacoes (agencia_id, numero_reuniao);
CREATE INDEX IF NOT EXISTS idx_deliberacoes_agencia_processo_data
  ON public.deliberacoes (agencia_id, processo, data_reuniao);

-- enqueue-pdfs filtra status='novo' + tipo IN (...); auto-confirm ordena por confiança.
CREATE INDEX IF NOT EXISTS idx_monitoramento_itens_status_tipo
  ON public.monitoramento_itens (status, tipo);
CREATE INDEX IF NOT EXISTS idx_documentos_regulatorios_status_conf
  ON public.documentos_regulatorios (status, extraction_confidence DESC);

-- recompute/confirm filtram candidatos por agência + review_status + nome.
CREATE INDEX IF NOT EXISTS idx_diretor_candidatos_agencia_review_nome
  ON public.diretor_candidatos (agencia_id, review_status, nome_detectado);

COMMIT;

NOTIFY pgrst, 'reload schema';
