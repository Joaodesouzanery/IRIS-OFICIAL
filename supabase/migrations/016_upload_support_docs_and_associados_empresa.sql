-- Migration 016: upload support documents and associates inside Empresas

ALTER TABLE deliberacoes
  DROP CONSTRAINT IF EXISTS deliberacoes_tipo_documento_check;

ALTER TABLE deliberacoes
  ADD CONSTRAINT deliberacoes_tipo_documento_check
  CHECK (tipo_documento IN (
    'deliberacao',
    'ata',
    'resolucao',
    'portaria',
    'pauta',
    'voto_individual',
    'documento_apoio'
  ));

ALTER TABLE upload_jobs
  ADD COLUMN IF NOT EXISTS metadata JSONB NOT NULL DEFAULT '{}';

CREATE INDEX IF NOT EXISTS idx_upload_jobs_metadata_gin
  ON upload_jobs USING GIN(metadata);

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('pdfs', 'pdfs', false, 52428800, ARRAY['application/pdf'])
ON CONFLICT (id) DO UPDATE SET
  public = false,
  file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

DROP POLICY IF EXISTS "pdfs_service_role_private_access" ON storage.objects;
CREATE POLICY "pdfs_service_role_private_access"
  ON storage.objects
  FOR ALL
  TO service_role
  USING (bucket_id = 'pdfs')
  WITH CHECK (bucket_id = 'pdfs');
