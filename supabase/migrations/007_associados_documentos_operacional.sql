-- Migration 007: camada operacional para documentos periodicos de associados

ALTER TABLE documentos_associado
  ADD COLUMN IF NOT EXISTS metricas JSONB NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS qualidade JSONB NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS gerado_por VARCHAR(40) NOT NULL DEFAULT 'manual',
  ADD COLUMN IF NOT EXISTS agendamento_id UUID,
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

CREATE TABLE IF NOT EXISTS associado_documento_agendamentos (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  associado_id    UUID NOT NULL REFERENCES associados(id) ON DELETE CASCADE,
  tipo            VARCHAR(30) NOT NULL CHECK (tipo IN ('relatorio_trimestral','boletim_mensal')),
  frequencia      VARCHAR(30) NOT NULL CHECK (frequencia IN ('mensal','trimestral')),
  dia_mes         INTEGER NOT NULL DEFAULT 5 CHECK (dia_mes BETWEEN 1 AND 28),
  destinatarios   TEXT[] NOT NULL DEFAULT '{}',
  ativo           BOOLEAN NOT NULL DEFAULT TRUE,
  proximo_envio   TIMESTAMPTZ NOT NULL,
  ultimo_envio    TIMESTAMPTZ,
  secoes          TEXT[] NOT NULL DEFAULT '{}',
  observacoes     TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS documento_envios (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  documento_id    UUID NOT NULL REFERENCES documentos_associado(id) ON DELETE CASCADE,
  agendamento_id  UUID REFERENCES associado_documento_agendamentos(id) ON DELETE SET NULL,
  destinatarios   TEXT[] NOT NULL DEFAULT '{}',
  status          VARCHAR(30) NOT NULL DEFAULT 'pendente'
                    CHECK (status IN ('pendente','enviado','erro','cancelado')),
  provider        VARCHAR(60),
  provider_id     TEXT,
  error_message   TEXT,
  sent_at         TIMESTAMPTZ,
  metadata        JSONB NOT NULL DEFAULT '{}',
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'documentos_associado_agendamento_id_fkey'
  ) THEN
    ALTER TABLE documentos_associado
      ADD CONSTRAINT documentos_associado_agendamento_id_fkey
      FOREIGN KEY (agendamento_id)
      REFERENCES associado_documento_agendamentos(id)
      ON DELETE SET NULL;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_documentos_associado_status
  ON documentos_associado(status_revisao, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_documentos_associado_agendamento
  ON documentos_associado(agendamento_id);
CREATE INDEX IF NOT EXISTS idx_associado_documento_agendamentos_due
  ON associado_documento_agendamentos(ativo, proximo_envio);
CREATE INDEX IF NOT EXISTS idx_associado_documento_agendamentos_assoc
  ON associado_documento_agendamentos(associado_id, tipo);
CREATE INDEX IF NOT EXISTS idx_documento_envios_documento
  ON documento_envios(documento_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_documento_envios_status
  ON documento_envios(status, created_at DESC);

CREATE OR REPLACE TRIGGER trg_documentos_associado_updated_at
  BEFORE UPDATE ON documentos_associado
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE OR REPLACE TRIGGER trg_associado_documento_agendamentos_updated_at
  BEFORE UPDATE ON associado_documento_agendamentos
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

ALTER TABLE associado_documento_agendamentos ENABLE ROW LEVEL SECURITY;
ALTER TABLE documento_envios ENABLE ROW LEVEL SECURITY;

CREATE POLICY "allow_all_service_role" ON associado_documento_agendamentos
  USING (true) WITH CHECK (true);
CREATE POLICY "allow_all_service_role" ON documento_envios
  USING (true) WITH CHECK (true);
