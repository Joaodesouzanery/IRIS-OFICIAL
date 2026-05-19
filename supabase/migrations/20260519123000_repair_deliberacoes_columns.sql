-- Reparo idempotente: colunas usadas pelo upload, revisão e dashboards de deliberações.
-- Pode ser executado diretamente no SQL Editor do Supabase.

ALTER TABLE public.deliberacoes
  ADD COLUMN IF NOT EXISTS assunto TEXT,
  ADD COLUMN IF NOT EXISTS procedencia VARCHAR(200),
  ADD COLUMN IF NOT EXISTS tipo_reuniao VARCHAR(20),
  ADD COLUMN IF NOT EXISTS decisoes_todas TEXT[],
  ADD COLUMN IF NOT EXISTS numero_reuniao VARCHAR(20),
  ADD COLUMN IF NOT EXISTS tipo_documento VARCHAR(30) DEFAULT 'deliberacao',
  ADD COLUMN IF NOT EXISTS relator VARCHAR(200),
  ADD COLUMN IF NOT EXISTS item_numero VARCHAR(20),
  ADD COLUMN IF NOT EXISTS documento_pai_id UUID REFERENCES public.deliberacoes(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS raw_extraction JSONB,
  ADD COLUMN IF NOT EXISTS area_regulatoria TEXT;

ALTER TABLE public.deliberacoes
  DROP CONSTRAINT IF EXISTS deliberacoes_resultado_check;

ALTER TABLE public.deliberacoes
  ADD CONSTRAINT deliberacoes_resultado_check
  CHECK (
    resultado IS NULL OR resultado IN (
      'Deferido',
      'Indeferido',
      'Parcialmente Deferido',
      'Retirado de Pauta',
      'Ratificado',
      'Aprovado',
      'Aprovado com Ressalvas',
      'Aprovado por Unanimidade',
      'Recomendado',
      'Determinado',
      'Autorizado'
    )
  );

ALTER TABLE public.deliberacoes
  DROP CONSTRAINT IF EXISTS deliberacoes_microtema_check;

ALTER TABLE public.deliberacoes
  ADD CONSTRAINT deliberacoes_microtema_check
  CHECK (
    microtema IS NULL OR microtema IN (
      'tarifa',
      'obras',
      'multa',
      'contrato',
      'reequilibrio',
      'fiscalizacao',
      'seguranca',
      'ambiental',
      'desapropriacao',
      'adimplencia',
      'pessoal',
      'usuario',
      'lavra',
      'pesquisa',
      'licenciamento',
      'servidao',
      'cfem',
      'disponibilidade',
      'recursos',
      'outros'
    )
  );

ALTER TABLE public.deliberacoes
  DROP CONSTRAINT IF EXISTS deliberacoes_tipo_documento_check;

ALTER TABLE public.deliberacoes
  ADD CONSTRAINT deliberacoes_tipo_documento_check
  CHECK (
    tipo_documento IS NULL OR tipo_documento IN (
      'deliberacao',
      'ata',
      'resolucao',
      'portaria',
      'pauta',
      'voto_individual',
      'documento_apoio'
    )
  );

ALTER TABLE public.deliberacoes
  DROP CONSTRAINT IF EXISTS deliberacoes_area_regulatoria_check;

ALTER TABLE public.deliberacoes
  ADD CONSTRAINT deliberacoes_area_regulatoria_check
  CHECK (
    area_regulatoria IS NULL OR area_regulatoria IN (
      'rodovia',
      'ferrovia',
      'rodoviario_passageiros',
      'cargas_logistica',
      'infraestrutura_geral',
      'governanca_regulatoria',
      'administrativo',
      'outros'
    )
  );

CREATE INDEX IF NOT EXISTS idx_deliberacoes_pai
  ON public.deliberacoes(documento_pai_id);

CREATE INDEX IF NOT EXISTS idx_deliberacoes_area_regulatoria
  ON public.deliberacoes(area_regulatoria);

CREATE INDEX IF NOT EXISTS idx_deliberacoes_area_data
  ON public.deliberacoes(area_regulatoria, data_reuniao);

NOTIFY pgrst, 'reload schema';
