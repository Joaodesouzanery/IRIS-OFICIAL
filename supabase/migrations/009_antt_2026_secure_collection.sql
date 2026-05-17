-- Migration 009: coleta segura ANTT 2026

ALTER TABLE monitoramento_sites
  DROP CONSTRAINT IF EXISTS monitoramento_sites_estrategia_check;

ALTER TABLE monitoramento_sites
  ADD CONSTRAINT monitoramento_sites_estrategia_check
  CHECK (estrategia IN ('html-static','govbr-news','antt-2026','needs-headless','headless','manual'));

ALTER TABLE monitoramento_itens
  DROP CONSTRAINT IF EXISTS monitoramento_itens_tipo_check;

ALTER TABLE monitoramento_itens
  ADD CONSTRAINT monitoramento_itens_tipo_check
  CHECK (tipo IN (
    'reuniao','pauta','voto','ata','deliberacao','documento',
    'diretoria','mandato','ato_nomeacao',
    'noticia','politica_publica','consulta_publica'
  ));

CREATE TABLE IF NOT EXISTS antt_reunioes_coletadas (
  id             UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  agencia_id     UUID REFERENCES agencias(id) ON DELETE SET NULL,
  ano            INTEGER NOT NULL DEFAULT 2026 CHECK (ano BETWEEN 2000 AND 2099),
  numero         TEXT NOT NULL,
  titulo         TEXT NOT NULL,
  tipo           VARCHAR(30) NOT NULL
                   CHECK (tipo IN ('ordinaria','extraordinaria','eletronica')),
  data_inicio    DATE,
  data_fim       DATE,
  hora_inicio    TIME,
  hora_fim       TIME,
  url_reuniao    TEXT NOT NULL UNIQUE,
  source_url     TEXT NOT NULL,
  source_hash    CHAR(64) NOT NULL,
  status         VARCHAR(30) NOT NULL DEFAULT 'coletada'
                   CHECK (status IN ('coletada','parcial','erro','ignorada')),
  metadata       JSONB NOT NULL DEFAULT '{}',
  coletado_em    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS antt_processos_coletados (
  id             UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  agencia_id     UUID REFERENCES agencias(id) ON DELETE SET NULL,
  reuniao_id     UUID NOT NULL REFERENCES antt_reunioes_coletadas(id) ON DELETE CASCADE,
  item_numero    TEXT,
  processo       TEXT,
  interessado    TEXT,
  relator        TEXT,
  assunto        TEXT,
  decisao        TEXT,
  metadata       JSONB NOT NULL DEFAULT '{}',
  coletado_em    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS documentos_coletados (
  id               UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  agencia_id       UUID REFERENCES agencias(id) ON DELETE SET NULL,
  reuniao_id       UUID REFERENCES antt_reunioes_coletadas(id) ON DELETE CASCADE,
  processo_id      UUID REFERENCES antt_processos_coletados(id) ON DELETE SET NULL,
  tipo             VARCHAR(30) NOT NULL
                     CHECK (tipo IN ('pauta','voto','deliberacao','outro')),
  titulo           TEXT NOT NULL,
  url_original     TEXT NOT NULL,
  storage_bucket   TEXT NOT NULL DEFAULT 'pdfs',
  storage_path     TEXT,
  file_hash        CHAR(64),
  content_type     TEXT,
  tamanho_bytes    INTEGER,
  status           VARCHAR(30) NOT NULL DEFAULT 'coletado'
                     CHECK (status IN ('coletado','validado','em_revisao','importado','ignorado','erro')),
  validation_status VARCHAR(30) NOT NULL DEFAULT 'pendente'
                     CHECK (validation_status IN ('pendente','ok','rejeitado','erro')),
  error_message    TEXT,
  metadata         JSONB NOT NULL DEFAULT '{}',
  coletado_em      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_antt_reunioes_ano_tipo
  ON antt_reunioes_coletadas(ano, tipo, data_inicio DESC);
CREATE INDEX IF NOT EXISTS idx_antt_reunioes_agencia
  ON antt_reunioes_coletadas(agencia_id);
CREATE INDEX IF NOT EXISTS idx_antt_processos_reuniao
  ON antt_processos_coletados(reuniao_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_antt_processos_unique
  ON antt_processos_coletados(reuniao_id, COALESCE(item_numero, ''), COALESCE(processo, ''));
CREATE INDEX IF NOT EXISTS idx_documentos_coletados_status
  ON documentos_coletados(status, validation_status, coletado_em DESC);
CREATE INDEX IF NOT EXISTS idx_documentos_coletados_reuniao
  ON documentos_coletados(reuniao_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_documentos_coletados_url
  ON documentos_coletados(url_original);
CREATE UNIQUE INDEX IF NOT EXISTS idx_documentos_coletados_hash
  ON documentos_coletados(file_hash)
  WHERE file_hash IS NOT NULL;

CREATE OR REPLACE TRIGGER trg_antt_reunioes_updated_at
  BEFORE UPDATE ON antt_reunioes_coletadas
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE OR REPLACE TRIGGER trg_antt_processos_updated_at
  BEFORE UPDATE ON antt_processos_coletados
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE OR REPLACE TRIGGER trg_documentos_coletados_updated_at
  BEFORE UPDATE ON documentos_coletados
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

ALTER TABLE antt_reunioes_coletadas ENABLE ROW LEVEL SECURITY;
ALTER TABLE antt_processos_coletados ENABLE ROW LEVEL SECURITY;
ALTER TABLE documentos_coletados ENABLE ROW LEVEL SECURITY;

CREATE POLICY "allow_all_service_role" ON antt_reunioes_coletadas
  USING (true) WITH CHECK (true);
CREATE POLICY "allow_all_service_role" ON antt_processos_coletados
  USING (true) WITH CHECK (true);
CREATE POLICY "allow_all_service_role" ON documentos_coletados
  USING (true) WITH CHECK (true);

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('pdfs', 'pdfs', false, 52428800, ARRAY['application/pdf'])
ON CONFLICT (id) DO UPDATE SET
  public = false,
  file_size_limit = 52428800,
  allowed_mime_types = ARRAY['application/pdf'];

INSERT INTO agencias (sigla, nome, nome_completo)
VALUES ('ANTT', 'ANTT', 'Agencia Nacional de Transportes Terrestres')
ON CONFLICT (sigla) DO UPDATE SET
  nome = EXCLUDED.nome,
  nome_completo = EXCLUDED.nome_completo;

INSERT INTO monitoramento_sites (agencia_id, nome, url, estrategia, seletor_links)
SELECT id,
       'ANTT - Reunioes da Diretoria 2026',
       'https://portal.antt.gov.br/web/guest/reunioes-da-diretoria',
       'antt-2026',
       'a[href]'
FROM agencias
WHERE sigla = 'ANTT'
  AND NOT EXISTS (
    SELECT 1 FROM monitoramento_sites
    WHERE url = 'https://portal.antt.gov.br/web/guest/reunioes-da-diretoria'
      AND estrategia = 'antt-2026'
  );
