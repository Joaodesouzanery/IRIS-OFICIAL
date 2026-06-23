-- Normalização de empresas (interessado das deliberações): entidade canônica com
-- variantes, e FK opcional deliberacoes.empresa_id. Idempotente.

BEGIN;

CREATE TABLE IF NOT EXISTS public.empresas (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agencia_id       UUID REFERENCES public.agencias(id) ON DELETE SET NULL,
  nome_normalizado TEXT NOT NULL,
  nome_exibicao    TEXT NOT NULL,
  nome_variantes   TEXT[] NOT NULL DEFAULT '{}',
  setor            TEXT,
  fonte_dado       TEXT NOT NULL DEFAULT 'automatico'
                     CHECK (fonte_dado IN ('automatico', 'manual', 'verificado')),
  needs_review     BOOLEAN NOT NULL DEFAULT FALSE,
  metadata         JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Mesma razão social pode existir em agências distintas.
CREATE UNIQUE INDEX IF NOT EXISTS uq_empresas_agencia_nome_norm
  ON public.empresas(agencia_id, nome_normalizado);
CREATE INDEX IF NOT EXISTS idx_empresas_agencia ON public.empresas(agencia_id);
CREATE INDEX IF NOT EXISTS idx_empresas_nome_norm ON public.empresas(nome_normalizado);

ALTER TABLE public.deliberacoes
  ADD COLUMN IF NOT EXISTS empresa_id UUID REFERENCES public.empresas(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_deliberacoes_empresa ON public.deliberacoes(empresa_id);

-- update_updated_at() já existe (migration 001).
CREATE OR REPLACE TRIGGER trg_empresas_updated_at
  BEFORE UPDATE ON public.empresas
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

ALTER TABLE public.empresas ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS empresas_service_role_all ON public.empresas;
CREATE POLICY empresas_service_role_all ON public.empresas
  FOR ALL TO service_role USING (true) WITH CHECK (true);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.empresas TO service_role;

NOTIFY pgrst, 'reload schema';

COMMIT;
