-- 011_area_regulatoria_upload_attachments.sql
-- Campo de área regulatória e suporte explícito a anexos privados no fluxo manual.

ALTER TABLE deliberacoes
  ADD COLUMN IF NOT EXISTS area_regulatoria TEXT;

ALTER TABLE deliberacoes
  DROP CONSTRAINT IF EXISTS deliberacoes_area_regulatoria_check;

ALTER TABLE deliberacoes
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

CREATE INDEX IF NOT EXISTS idx_deliberacoes_area_regulatoria
  ON deliberacoes(area_regulatoria);

CREATE INDEX IF NOT EXISTS idx_deliberacoes_area_data
  ON deliberacoes(area_regulatoria, data_reuniao);

-- O fluxo manual salva PDFs originais no bucket privado "pdfs" quando a revisão é confirmada.
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('pdfs', 'pdfs', false, 52428800, ARRAY['application/pdf'])
ON CONFLICT (id) DO UPDATE
SET public = false,
    file_size_limit = 52428800,
    allowed_mime_types = ARRAY['application/pdf'];

ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "pdfs_service_role_private_access" ON storage.objects;
CREATE POLICY "pdfs_service_role_private_access"
  ON storage.objects
  TO service_role
  USING (bucket_id = 'pdfs')
  WITH CHECK (bucket_id = 'pdfs');
