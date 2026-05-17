-- Migration 005: monitoramento multiagencia e microtemas ANM

ALTER TABLE deliberacoes
  DROP CONSTRAINT IF EXISTS deliberacoes_microtema_check;

ALTER TABLE deliberacoes
  ADD COLUMN IF NOT EXISTS raw_extraction JSONB;

ALTER TABLE deliberacoes
  ADD CONSTRAINT deliberacoes_microtema_check
  CHECK (microtema IN (
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
  ));

CREATE TABLE IF NOT EXISTS monitoramento_sites (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  agencia_id      UUID REFERENCES agencias(id) ON DELETE SET NULL,
  nome            TEXT NOT NULL,
  url             TEXT NOT NULL,
  estrategia      VARCHAR(30) NOT NULL DEFAULT 'html-static'
                    CHECK (estrategia IN ('html-static','needs-headless','headless','manual')),
  seletor_links   TEXT NOT NULL DEFAULT 'a[href]',
  ativo           BOOLEAN NOT NULL DEFAULT TRUE,
  ultimo_check    TIMESTAMPTZ,
  ultimo_hash     CHAR(64),
  ultimo_status   VARCHAR(30) NOT NULL DEFAULT 'never'
                    CHECK (ultimo_status IN ('never','ok','error','needs_headless')),
  ultimo_erro     TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS monitoramento_itens (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  site_id         UUID NOT NULL REFERENCES monitoramento_sites(id) ON DELETE CASCADE,
  agencia_id      UUID REFERENCES agencias(id) ON DELETE SET NULL,
  tipo            VARCHAR(30) NOT NULL DEFAULT 'documento'
                    CHECK (tipo IN ('reuniao','pauta','ata','deliberacao','documento','diretoria','mandato','ato_nomeacao')),
  titulo          TEXT NOT NULL,
  url_item        TEXT NOT NULL,
  reuniao         TEXT,
  data_reuniao    DATE,
  hash_item       CHAR(64) NOT NULL,
  status          VARCHAR(30) NOT NULL DEFAULT 'novo'
                    CHECK (status IN ('novo','em_revisao','importado','ignorado')),
  metadata        JSONB NOT NULL DEFAULT '{}',
  first_seen_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_seen_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (site_id, hash_item)
);

ALTER TABLE diretores
  ADD COLUMN IF NOT EXISTS source_url TEXT,
  ADD COLUMN IF NOT EXISTS source_type VARCHAR(40),
  ADD COLUMN IF NOT EXISTS source_hash CHAR(64),
  ADD COLUMN IF NOT EXISTS source_confidence NUMERIC(4,3),
  ADD COLUMN IF NOT EXISTS review_status VARCHAR(30) NOT NULL DEFAULT 'aprovado',
  ADD COLUMN IF NOT EXISTS lgpd_basis TEXT NOT NULL DEFAULT 'public_official_function',
  ADD COLUMN IF NOT EXISTS last_verified_at TIMESTAMPTZ;

ALTER TABLE mandatos
  ADD COLUMN IF NOT EXISTS source_url TEXT,
  ADD COLUMN IF NOT EXISTS source_type VARCHAR(40),
  ADD COLUMN IF NOT EXISTS source_hash CHAR(64),
  ADD COLUMN IF NOT EXISTS source_confidence NUMERIC(4,3),
  ADD COLUMN IF NOT EXISTS review_status VARCHAR(30) NOT NULL DEFAULT 'aprovado',
  ADD COLUMN IF NOT EXISTS lgpd_basis TEXT NOT NULL DEFAULT 'public_official_function',
  ADD COLUMN IF NOT EXISTS last_verified_at TIMESTAMPTZ;

ALTER TABLE diretores
  DROP CONSTRAINT IF EXISTS diretores_review_status_check;
ALTER TABLE diretores
  ADD CONSTRAINT diretores_review_status_check
  CHECK (review_status IN ('pendente','aprovado','rejeitado','conflito'));

ALTER TABLE mandatos
  DROP CONSTRAINT IF EXISTS mandatos_review_status_check;
ALTER TABLE mandatos
  ADD CONSTRAINT mandatos_review_status_check
  CHECK (review_status IN ('pendente','aprovado','rejeitado','conflito'));

CREATE TABLE IF NOT EXISTS fontes_oficiais (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  agencia_id      UUID REFERENCES agencias(id) ON DELETE SET NULL,
  tipo            VARCHAR(40) NOT NULL
                    CHECK (tipo IN ('diario_oficial','pagina_agencia','portal_transparencia','deliberacao','ata','outro')),
  titulo          TEXT NOT NULL,
  url             TEXT NOT NULL,
  hash_conteudo   CHAR(64),
  coletado_em     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  confianca       NUMERIC(4,3) NOT NULL DEFAULT 0.700 CHECK (confianca BETWEEN 0 AND 1),
  metadata        JSONB NOT NULL DEFAULT '{}'
);

CREATE TABLE IF NOT EXISTS diretor_fontes (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  diretor_id      UUID NOT NULL REFERENCES diretores(id) ON DELETE CASCADE,
  fonte_id        UUID NOT NULL REFERENCES fontes_oficiais(id) ON DELETE CASCADE,
  papel           VARCHAR(40) NOT NULL DEFAULT 'evidencia'
                    CHECK (papel IN ('nomeacao','exoneracao','composicao','participacao','evidencia')),
  confianca       NUMERIC(4,3) NOT NULL DEFAULT 0.700 CHECK (confianca BETWEEN 0 AND 1),
  review_status   VARCHAR(30) NOT NULL DEFAULT 'pendente'
                    CHECK (review_status IN ('pendente','aprovado','rejeitado','conflito')),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (diretor_id, fonte_id, papel)
);

CREATE TABLE IF NOT EXISTS mandato_fontes (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  mandato_id      UUID NOT NULL REFERENCES mandatos(id) ON DELETE CASCADE,
  fonte_id        UUID NOT NULL REFERENCES fontes_oficiais(id) ON DELETE CASCADE,
  papel           VARCHAR(40) NOT NULL DEFAULT 'evidencia'
                    CHECK (papel IN ('inicio','fim','composicao','evidencia')),
  confianca       NUMERIC(4,3) NOT NULL DEFAULT 0.700 CHECK (confianca BETWEEN 0 AND 1),
  review_status   VARCHAR(30) NOT NULL DEFAULT 'pendente'
                    CHECK (review_status IN ('pendente','aprovado','rejeitado','conflito')),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (mandato_id, fonte_id, papel)
);

CREATE TABLE IF NOT EXISTS diretor_candidatos (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  agencia_id      UUID REFERENCES agencias(id) ON DELETE SET NULL,
  nome_detectado  TEXT NOT NULL,
  cargo_detectado TEXT,
  diretor_id      UUID REFERENCES diretores(id) ON DELETE SET NULL,
  source_type     VARCHAR(40) NOT NULL DEFAULT 'deliberacao',
  source_url      TEXT,
  source_hash     CHAR(64),
  evidence        JSONB NOT NULL DEFAULT '{}',
  confidence      NUMERIC(4,3) NOT NULL DEFAULT 0.500 CHECK (confidence BETWEEN 0 AND 1),
  review_status   VARCHAR(30) NOT NULL DEFAULT 'pendente'
                    CHECK (review_status IN ('pendente','aprovado','rejeitado','conflito')),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  reviewed_at     TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS monitoramento_alertas (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  item_id         UUID NOT NULL REFERENCES monitoramento_itens(id) ON DELETE CASCADE,
  site_id         UUID NOT NULL REFERENCES monitoramento_sites(id) ON DELETE CASCADE,
  agencia_id      UUID REFERENCES agencias(id) ON DELETE SET NULL,
  tipo            VARCHAR(30) NOT NULL DEFAULT 'novo_item',
  titulo          TEXT NOT NULL,
  url_item        TEXT NOT NULL,
  lido            BOOLEAN NOT NULL DEFAULT FALSE,
  resolvido       BOOLEAN NOT NULL DEFAULT FALSE,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (item_id, tipo)
);

CREATE TABLE IF NOT EXISTS monitoramento_runs (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  site_id         UUID REFERENCES monitoramento_sites(id) ON DELETE SET NULL,
  started_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  finished_at     TIMESTAMPTZ,
  status          VARCHAR(30) NOT NULL DEFAULT 'running'
                    CHECK (status IN ('running','ok','error','needs_headless')),
  itens_encontrados INTEGER NOT NULL DEFAULT 0,
  novos_itens     INTEGER NOT NULL DEFAULT 0,
  error_message   TEXT
);

CREATE INDEX IF NOT EXISTS idx_monitoramento_sites_ativo
  ON monitoramento_sites(ativo);
CREATE INDEX IF NOT EXISTS idx_monitoramento_itens_site
  ON monitoramento_itens(site_id);
CREATE INDEX IF NOT EXISTS idx_monitoramento_itens_status
  ON monitoramento_itens(status);
CREATE INDEX IF NOT EXISTS idx_monitoramento_itens_data
  ON monitoramento_itens(data_reuniao);
CREATE INDEX IF NOT EXISTS idx_monitoramento_alertas_lido
  ON monitoramento_alertas(lido, resolvido);
CREATE INDEX IF NOT EXISTS idx_monitoramento_runs_site
  ON monitoramento_runs(site_id, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_fontes_oficiais_agencia
  ON fontes_oficiais(agencia_id, tipo);
CREATE UNIQUE INDEX IF NOT EXISTS idx_fontes_oficiais_url_hash
  ON fontes_oficiais(url, hash_conteudo);
CREATE INDEX IF NOT EXISTS idx_diretor_candidatos_status
  ON diretor_candidatos(review_status, agencia_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_diretor_candidatos_unique_source
  ON diretor_candidatos(agencia_id, nome_detectado, source_hash);
CREATE INDEX IF NOT EXISTS idx_diretores_review
  ON diretores(review_status, needs_review);
CREATE INDEX IF NOT EXISTS idx_mandatos_review
  ON mandatos(review_status);

CREATE OR REPLACE TRIGGER trg_monitoramento_sites_updated_at
  BEFORE UPDATE ON monitoramento_sites
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

ALTER TABLE monitoramento_sites   ENABLE ROW LEVEL SECURITY;
ALTER TABLE monitoramento_itens   ENABLE ROW LEVEL SECURITY;
ALTER TABLE monitoramento_alertas ENABLE ROW LEVEL SECURITY;
ALTER TABLE monitoramento_runs    ENABLE ROW LEVEL SECURITY;
ALTER TABLE fontes_oficiais       ENABLE ROW LEVEL SECURITY;
ALTER TABLE diretor_fontes        ENABLE ROW LEVEL SECURITY;
ALTER TABLE mandato_fontes        ENABLE ROW LEVEL SECURITY;
ALTER TABLE diretor_candidatos    ENABLE ROW LEVEL SECURITY;

CREATE POLICY "allow_all_service_role" ON monitoramento_sites   USING (true) WITH CHECK (true);
CREATE POLICY "allow_all_service_role" ON monitoramento_itens   USING (true) WITH CHECK (true);
CREATE POLICY "allow_all_service_role" ON monitoramento_alertas USING (true) WITH CHECK (true);
CREATE POLICY "allow_all_service_role" ON monitoramento_runs    USING (true) WITH CHECK (true);
CREATE POLICY "allow_all_service_role" ON fontes_oficiais       USING (true) WITH CHECK (true);
CREATE POLICY "allow_all_service_role" ON diretor_fontes        USING (true) WITH CHECK (true);
CREATE POLICY "allow_all_service_role" ON mandato_fontes        USING (true) WITH CHECK (true);
CREATE POLICY "allow_all_service_role" ON diretor_candidatos    USING (true) WITH CHECK (true);

INSERT INTO monitoramento_sites (agencia_id, nome, url, estrategia, seletor_links)
SELECT id, 'ARTESP - Reuniões da Diretoria',
       'https://www.artesp.sp.gov.br/artesp/transparencia/reunioes-diretoria',
       'html-static', 'a[href]'
FROM agencias
WHERE sigla = 'ARTESP'
  AND NOT EXISTS (
    SELECT 1 FROM monitoramento_sites
    WHERE url = 'https://www.artesp.sp.gov.br/artesp/transparencia/reunioes-diretoria'
  );
