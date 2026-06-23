-- Telemetria de hardening da coleta: duração, retries, throttle, HTTP 429 e
-- falhas de headless. Estende as tabelas de execução já existentes
-- (monitoramento_runs, regulatory_news_collection_runs) em vez de criar novas,
-- e expõe uma view unificada para observabilidade. Idempotente.

BEGIN;

-- ─── monitoramento_runs (monitoramento/check + antt/2026/collect) ───────────────
ALTER TABLE public.monitoramento_runs
  ADD COLUMN IF NOT EXISTS trigger_type TEXT NOT NULL DEFAULT 'scheduled',
  ADD COLUMN IF NOT EXISTS duration_ms INTEGER,
  ADD COLUMN IF NOT EXISTS fetch_retries INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS http_429_count INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS throttle_wait_ms INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS headless_dependency_missing INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS headless_launch_failed INTEGER NOT NULL DEFAULT 0;

ALTER TABLE public.monitoramento_runs
  DROP CONSTRAINT IF EXISTS monitoramento_runs_trigger_type_check;
ALTER TABLE public.monitoramento_runs
  ADD CONSTRAINT monitoramento_runs_trigger_type_check
  CHECK (trigger_type IN ('manual', 'scheduled', 'test', 'backfill'));

CREATE INDEX IF NOT EXISTS idx_monitoramento_runs_started
  ON public.monitoramento_runs(started_at DESC);

-- ─── regulatory_news_collection_runs (noticias/coletar) ─────────────────────────
ALTER TABLE public.regulatory_news_collection_runs
  ADD COLUMN IF NOT EXISTS duration_ms INTEGER,
  ADD COLUMN IF NOT EXISTS fetch_retries INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS http_429_count INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS throttle_wait_ms INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS headless_dependency_missing INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS headless_launch_failed INTEGER NOT NULL DEFAULT 0;

-- ─── view unificada de execuções de coleta (observabilidade, read-only) ─────────
CREATE OR REPLACE VIEW public.coleta_execucoes AS
  SELECT
    'monitoramento'::text          AS dominio,
    r.id, r.site_id, r.trigger_type, r.status,
    r.started_at, r.finished_at, r.duration_ms,
    r.itens_encontrados            AS itens,
    r.novos_itens                  AS novos,
    r.fetch_retries, r.http_429_count, r.throttle_wait_ms,
    r.headless_dependency_missing, r.headless_launch_failed,
    r.error_message
  FROM public.monitoramento_runs r
  UNION ALL
  SELECT
    'noticias'::text               AS dominio,
    n.id, n.site_id, n.trigger_type, n.status,
    n.created_at                   AS started_at,
    NULL::timestamptz              AS finished_at,
    n.duration_ms,
    n.itens_processados            AS itens,
    n.itens_salvos                 AS novos,
    n.fetch_retries, n.http_429_count, n.throttle_wait_ms,
    n.headless_dependency_missing, n.headless_launch_failed,
    n.error_message
  FROM public.regulatory_news_collection_runs n;

NOTIFY pgrst, 'reload schema';

COMMIT;
