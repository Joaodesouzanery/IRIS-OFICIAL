-- Marca a origem das evidências de qualidade (manual, coleta web ou derivada de
-- dados internos do IRIS) e garante idempotência da coleta derivada. Idempotente.

BEGIN;

ALTER TABLE public.qualidade_regulatoria_evidencias
  ADD COLUMN IF NOT EXISTS origem TEXT NOT NULL DEFAULT 'manual';

ALTER TABLE public.qualidade_regulatoria_evidencias
  DROP CONSTRAINT IF EXISTS qualidade_regulatoria_evidencias_origem_check;
ALTER TABLE public.qualidade_regulatoria_evidencias
  ADD CONSTRAINT qualidade_regulatoria_evidencias_origem_check
  CHECK (origem IN ('manual', 'coleta_web', 'derivada_dados'));

-- Backfill: evidências já inseridas pelo coletor web tinham auto_collected=true.
UPDATE public.qualidade_regulatoria_evidencias
  SET origem = 'coleta_web'
  WHERE origem = 'manual'
    AND COALESCE((compliance_flags->>'auto_collected')::boolean, false) = true;

-- Idempotência da coleta derivada por (agência, critério, métrica). Parcial: nunca
-- colide com evidências manuais ou de coleta web.
CREATE UNIQUE INDEX IF NOT EXISTS uq_qre_evidencia_derivada
  ON public.qualidade_regulatoria_evidencias(agencia_sigla, criterio_id, (metadata->>'metric_key'))
  WHERE origem = 'derivada_dados';

NOTIFY pgrst, 'reload schema';

COMMIT;
