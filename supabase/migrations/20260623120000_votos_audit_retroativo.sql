-- Auditoria de votos retroativos (criados ao aprovar um diretor_candidato) e
-- registro de quem revisou. Idempotente.

BEGIN;

ALTER TABLE public.diretor_candidatos
  ADD COLUMN IF NOT EXISTS reviewed_by TEXT;

CREATE TABLE IF NOT EXISTS public.votos_retroativos_audit (
  id                          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  candidato_id                UUID REFERENCES public.diretor_candidatos(id) ON DELETE SET NULL,
  diretor_id                  UUID REFERENCES public.diretores(id) ON DELETE SET NULL,
  agencia_id                  UUID REFERENCES public.agencias(id) ON DELETE SET NULL,
  nome_detectado              TEXT NOT NULL,
  deliberacoes_afetadas       INTEGER NOT NULL DEFAULT 0,
  votos_criados               INTEGER NOT NULL DEFAULT 0,
  votos_ignorados_fora_mandato INTEGER NOT NULL DEFAULT 0,
  detalhe                     JSONB NOT NULL DEFAULT '{}'::jsonb,
  reviewed_by                 TEXT,
  created_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_votos_retro_audit_diretor
  ON public.votos_retroativos_audit(diretor_id, created_at DESC);

ALTER TABLE public.votos_retroativos_audit ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS votos_retroativos_audit_service_role_all ON public.votos_retroativos_audit;
CREATE POLICY votos_retroativos_audit_service_role_all
  ON public.votos_retroativos_audit FOR ALL TO service_role
  USING (true) WITH CHECK (true);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.votos_retroativos_audit TO service_role;

NOTIFY pgrst, 'reload schema';

COMMIT;
