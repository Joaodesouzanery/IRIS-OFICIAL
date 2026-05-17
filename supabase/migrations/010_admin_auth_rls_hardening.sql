-- Migration 010: admins, RLS hardening e storage privado

CREATE TABLE IF NOT EXISTS admin_users (
  id         UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id    UUID NOT NULL UNIQUE,
  email      TEXT NOT NULL UNIQUE,
  role       TEXT NOT NULL DEFAULT 'admin' CHECK (role IN ('admin','viewer')),
  active     BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE OR REPLACE TRIGGER trg_admin_users_updated_at
  BEFORE UPDATE ON admin_users
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

ALTER TABLE admin_users ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "allow_all_service_role" ON admin_users;
DROP POLICY IF EXISTS "service_role_all_admin_users" ON admin_users;
CREATE POLICY "service_role_all_admin_users"
  ON admin_users
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- Harden policies created earlier whose name implied service_role but applied to all roles.
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'agencias',
    'diretores',
    'mandatos',
    'upload_jobs',
    'deliberacoes',
    'votos',
    'monitoramento_sites',
    'monitoramento_itens',
    'monitoramento_alertas',
    'monitoramento_runs',
    'fontes_oficiais',
    'diretor_fontes',
    'mandato_fontes',
    'diretor_candidatos',
    'associados',
    'associado_temas',
    'lista_triplice',
    'documentos_associado',
    'documento_fontes',
    'associado_documento_agendamentos',
    'documento_envios',
    'antt_reunioes_coletadas',
    'antt_processos_coletados',
    'documentos_coletados'
  ]
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS "allow_all_service_role" ON %I', t);
    EXECUTE format('DROP POLICY IF EXISTS "service_role_all_%s" ON %I', t, t);
    EXECUTE format(
      'CREATE POLICY "service_role_all_%s" ON %I FOR ALL TO service_role USING (true) WITH CHECK (true)',
      t,
      t
    );
  END LOOP;
END $$;

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('pdfs', 'pdfs', false, 52428800, ARRAY['application/pdf'])
ON CONFLICT (id) DO UPDATE SET
  public = false,
  file_size_limit = 52428800,
  allowed_mime_types = ARRAY['application/pdf'];

-- Service role bypasses RLS, but explicit storage policies keep future direct access easier to audit.
DROP POLICY IF EXISTS "service_role_all_pdfs" ON storage.objects;
CREATE POLICY "service_role_all_pdfs"
  ON storage.objects
  FOR ALL
  TO service_role
  USING (bucket_id = 'pdfs')
  WITH CHECK (bucket_id = 'pdfs');
