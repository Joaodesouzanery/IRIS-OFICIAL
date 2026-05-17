-- Documentos brutos regulatórios: fila assíncrona e revisão antes de consolidar.

CREATE TABLE IF NOT EXISTS documentos_regulatorios (
  id                       UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  upload_job_id            UUID UNIQUE REFERENCES upload_jobs(id) ON DELETE SET NULL,
  agencia_id               UUID REFERENCES agencias(id) ON DELETE SET NULL,
  agencia_sigla_detected   VARCHAR(30),
  filename                 VARCHAR(500) NOT NULL,
  source_archive           VARCHAR(500),
  storage_bucket           TEXT NOT NULL DEFAULT 'pdfs',
  storage_path             TEXT NOT NULL,
  file_hash                CHAR(64) NOT NULL,
  mime_type                TEXT NOT NULL DEFAULT 'application/pdf',
  size_bytes               BIGINT,
  status                   VARCHAR(30) NOT NULL DEFAULT 'queued'
                             CHECK (status IN (
                               'queued',
                               'processing',
                               'review_pending',
                               'confirmed',
                               'ignored',
                               'failed'
                             )),
  tipo_documento           VARCHAR(30),
  documento_subtipo        TEXT,
  semantic_duplicate_key   TEXT,
  is_duplicate             BOOLEAN NOT NULL DEFAULT FALSE,
  duplicate_documento_id   UUID REFERENCES documentos_regulatorios(id) ON DELETE SET NULL,
  duplicate_deliberacao_id UUID REFERENCES deliberacoes(id) ON DELETE SET NULL,
  extraction_confidence    NUMERIC(4,3),
  page_count               INTEGER,
  chars_per_page           INTEGER,
  texto_extraido           TEXT,
  campos_detectados        JSONB NOT NULL DEFAULT '{}'::jsonb,
  ata_items                JSONB,
  warnings                 TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  error_message            TEXT,
  metadata                 JSONB NOT NULL DEFAULT '{}'::jsonb,
  processed_at             TIMESTAMPTZ,
  reviewed_at              TIMESTAMPTZ,
  created_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (file_hash)
);

ALTER TABLE upload_jobs
  ADD COLUMN IF NOT EXISTS documento_id UUID REFERENCES documentos_regulatorios(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_documentos_reg_status
  ON documentos_regulatorios(status, created_at);
CREATE INDEX IF NOT EXISTS idx_documentos_reg_agencia
  ON documentos_regulatorios(agencia_id);
CREATE INDEX IF NOT EXISTS idx_documentos_reg_file_hash
  ON documentos_regulatorios(file_hash);
CREATE INDEX IF NOT EXISTS idx_documentos_reg_semantic_key
  ON documentos_regulatorios(semantic_duplicate_key)
  WHERE semantic_duplicate_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_upload_jobs_documento_id
  ON upload_jobs(documento_id);

ALTER TABLE documentos_regulatorios ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "service_role_all_documentos_regulatorios" ON documentos_regulatorios;
CREATE POLICY "service_role_all_documentos_regulatorios"
  ON documentos_regulatorios
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('pdfs', 'pdfs', false, 52428800, ARRAY['application/pdf'])
ON CONFLICT (id) DO UPDATE SET
  public = false,
  file_size_limit = 52428800,
  allowed_mime_types = ARRAY['application/pdf'];
