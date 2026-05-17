-- Migration 014: owner global e edicoes persistentes de newsletter

ALTER TABLE admin_users
  DROP CONSTRAINT IF EXISTS admin_users_role_check;

ALTER TABLE admin_users
  ADD CONSTRAINT admin_users_role_check
  CHECK (role IN ('owner','admin','viewer'));

CREATE TABLE IF NOT EXISTS regulatory_newsletter_editions (
  id                 UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  assunto            TEXT NOT NULL,
  descricao          TEXT,
  destinatarios      TEXT[] NOT NULL DEFAULT '{}',
  temas              TEXT[] NOT NULL DEFAULT '{}',
  noticia_ids        UUID[] NOT NULL DEFAULT '{}',
  status             VARCHAR(30) NOT NULL DEFAULT 'rascunho'
                       CHECK (status IN ('rascunho','revisado','aprovado','enviado','arquivado')),
  html               TEXT NOT NULL,
  metadata           JSONB NOT NULL DEFAULT '{}',
  created_by         UUID,
  created_by_email   TEXT,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_regulatory_newsletter_editions_created_at
  ON regulatory_newsletter_editions(created_at DESC);

CREATE INDEX IF NOT EXISTS idx_regulatory_newsletter_editions_status
  ON regulatory_newsletter_editions(status, created_at DESC);

CREATE OR REPLACE TRIGGER trg_regulatory_newsletter_editions_updated_at
  BEFORE UPDATE ON regulatory_newsletter_editions
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

ALTER TABLE regulatory_newsletter_editions ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON regulatory_newsletter_editions FROM anon, authenticated;

DROP POLICY IF EXISTS "service_role_all_regulatory_newsletter_editions" ON regulatory_newsletter_editions;
CREATE POLICY "service_role_all_regulatory_newsletter_editions"
  ON regulatory_newsletter_editions
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);
