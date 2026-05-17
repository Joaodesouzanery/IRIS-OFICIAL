-- Migration 012: noticias regulatorias e newsletter semanal

CREATE TABLE IF NOT EXISTS regulatory_news (
  id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  agencia_id        UUID REFERENCES agencias(id) ON DELETE SET NULL,
  agencia_sigla     TEXT,
  titulo            TEXT NOT NULL,
  url               TEXT NOT NULL UNIQUE,
  fonte             TEXT NOT NULL,
  imagem_url        TEXT,
  resumo            TEXT,
  conteudo          TEXT,
  publicado_em      TIMESTAMPTZ,
  status_curadoria  VARCHAR(30) NOT NULL DEFAULT 'novo'
                      CHECK (status_curadoria IN ('novo','selecionado','ignorado','arquivado')),
  hash_item         CHAR(64) NOT NULL UNIQUE,
  metadata          JSONB NOT NULL DEFAULT '{}',
  first_seen_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_seen_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_regulatory_news_agencia_data
  ON regulatory_news(agencia_sigla, publicado_em DESC NULLS LAST);

CREATE INDEX IF NOT EXISTS idx_regulatory_news_agencia_id
  ON regulatory_news(agencia_id);

CREATE INDEX IF NOT EXISTS idx_regulatory_news_status
  ON regulatory_news(status_curadoria, first_seen_at DESC);

CREATE TABLE IF NOT EXISTS regulatory_newsletter_schedules (
  id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  nome                TEXT NOT NULL DEFAULT 'Newsletter Regulatório',
  dia_semana          SMALLINT NOT NULL DEFAULT 5 CHECK (dia_semana BETWEEN 0 AND 6),
  hora_envio          TIME NOT NULL DEFAULT '09:00',
  destinatarios       TEXT[] NOT NULL DEFAULT '{}',
  ativo               BOOLEAN NOT NULL DEFAULT TRUE,
  proximo_envio       TIMESTAMPTZ,
  ultimo_aviso_em     TIMESTAMPTZ,
  observacoes         TEXT,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE OR REPLACE TRIGGER trg_regulatory_news_updated_at
  BEFORE UPDATE ON regulatory_news
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE OR REPLACE TRIGGER trg_regulatory_newsletter_schedules_updated_at
  BEFORE UPDATE ON regulatory_newsletter_schedules
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

ALTER TABLE regulatory_news ENABLE ROW LEVEL SECURITY;
ALTER TABLE regulatory_newsletter_schedules ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON regulatory_news FROM anon, authenticated;
REVOKE ALL ON regulatory_newsletter_schedules FROM anon, authenticated;

DROP POLICY IF EXISTS "service_role_all_regulatory_news" ON regulatory_news;
CREATE POLICY "service_role_all_regulatory_news"
  ON regulatory_news
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

DROP POLICY IF EXISTS "service_role_all_regulatory_newsletter_schedules" ON regulatory_newsletter_schedules;
CREATE POLICY "service_role_all_regulatory_newsletter_schedules"
  ON regulatory_newsletter_schedules
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

INSERT INTO regulatory_newsletter_schedules (nome, dia_semana, hora_envio, destinatarios, ativo)
SELECT 'Newsletter Regulatório', 5, '09:00', '{}', true
WHERE NOT EXISTS (
  SELECT 1 FROM regulatory_newsletter_schedules
  WHERE nome = 'Newsletter Regulatório'
);

INSERT INTO monitoramento_sites (agencia_id, nome, url, estrategia, seletor_links)
SELECT id, 'ARTESP - Notícias',
       'https://www.artesp.sp.gov.br/artesp/noticias',
       'html-static', 'a[href]'
FROM agencias
WHERE sigla = 'ARTESP'
  AND NOT EXISTS (
    SELECT 1 FROM monitoramento_sites
    WHERE url = 'https://www.artesp.sp.gov.br/artesp/noticias'
  );

INSERT INTO monitoramento_sites (agencia_id, nome, url, estrategia, seletor_links)
SELECT id, 'ANTT - Últimas Notícias',
       'https://www.gov.br/antt/pt-br/assuntos/ultimas-noticias',
       'govbr-news', 'a[href]'
FROM agencias
WHERE sigla = 'ANTT'
  AND NOT EXISTS (
    SELECT 1 FROM monitoramento_sites
    WHERE url = 'https://www.gov.br/antt/pt-br/assuntos/ultimas-noticias'
  );

INSERT INTO monitoramento_sites (agencia_id, nome, url, estrategia, seletor_links)
SELECT id, 'ANM - Notícias',
       'https://www.gov.br/anm/pt-br/assuntos/noticias',
       'govbr-news', 'a[href]'
FROM agencias
WHERE sigla = 'ANM'
  AND NOT EXISTS (
    SELECT 1 FROM monitoramento_sites
    WHERE url = 'https://www.gov.br/anm/pt-br/assuntos/noticias'
  );
