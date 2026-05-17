-- Migration 006: associados, documentos e politica publica gov.br

ALTER TABLE monitoramento_sites
  DROP CONSTRAINT IF EXISTS monitoramento_sites_estrategia_check;

ALTER TABLE monitoramento_sites
  ADD CONSTRAINT monitoramento_sites_estrategia_check
  CHECK (estrategia IN ('html-static','govbr-news','needs-headless','headless','manual'));

ALTER TABLE monitoramento_itens
  DROP CONSTRAINT IF EXISTS monitoramento_itens_tipo_check;

ALTER TABLE monitoramento_itens
  ADD CONSTRAINT monitoramento_itens_tipo_check
  CHECK (tipo IN (
    'reuniao','pauta','ata','deliberacao','documento',
    'diretoria','mandato','ato_nomeacao',
    'noticia','politica_publica','consulta_publica'
  ));

CREATE TABLE IF NOT EXISTS associados (
  id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  nome              TEXT NOT NULL UNIQUE,
  setor             TEXT NOT NULL,
  descricao         TEXT,
  agencia_siglas    TEXT[] NOT NULL DEFAULT '{}',
  ministerios       TEXT[] NOT NULL DEFAULT '{}',
  ministerio_urls   TEXT[] NOT NULL DEFAULT '{}',
  microtemas        TEXT[] NOT NULL DEFAULT '{}',
  palavras_chave    TEXT[] NOT NULL DEFAULT '{}',
  vp_nome           TEXT,
  vp_cargo          TEXT,
  vp_minibio        TEXT,
  vp_foto_url       TEXT,
  ativo             BOOLEAN NOT NULL DEFAULT TRUE,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS associado_temas (
  id             UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  associado_id   UUID NOT NULL REFERENCES associados(id) ON DELETE CASCADE,
  tema           TEXT NOT NULL,
  microtema      TEXT,
  peso           NUMERIC(4,3) NOT NULL DEFAULT 1 CHECK (peso BETWEEN 0 AND 1),
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS lista_triplice (
  id             UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  agencia_id     UUID REFERENCES agencias(id) ON DELETE SET NULL,
  cargo          TEXT NOT NULL,
  etapa          TEXT NOT NULL DEFAULT 'mapeamento'
                   CHECK (etapa IN ('mapeamento','indicacao','sabatinado','aprovado','nomeado','arquivado')),
  nome_candidato TEXT NOT NULL,
  fonte_url      TEXT,
  fonte_tipo     VARCHAR(40),
  fonte_hash     CHAR(64),
  confidence     NUMERIC(4,3) NOT NULL DEFAULT 0.600 CHECK (confidence BETWEEN 0 AND 1),
  review_status  VARCHAR(30) NOT NULL DEFAULT 'pendente'
                   CHECK (review_status IN ('pendente','aprovado','rejeitado','conflito')),
  data_evento    DATE,
  metadata       JSONB NOT NULL DEFAULT '{}',
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS documentos_associado (
  id             UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  associado_id   UUID NOT NULL REFERENCES associados(id) ON DELETE CASCADE,
  tipo           VARCHAR(30) NOT NULL CHECK (tipo IN ('relatorio_trimestral','boletim_mensal')),
  periodo_inicio DATE NOT NULL,
  periodo_fim    DATE NOT NULL,
  titulo         TEXT NOT NULL,
  html           TEXT NOT NULL,
  fontes         JSONB NOT NULL DEFAULT '[]',
  status_revisao VARCHAR(30) NOT NULL DEFAULT 'rascunho'
                   CHECK (status_revisao IN ('rascunho','revisado','aprovado','arquivado')),
  versao         INTEGER NOT NULL DEFAULT 1,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS documento_fontes (
  id             UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  documento_id   UUID NOT NULL REFERENCES documentos_associado(id) ON DELETE CASCADE,
  fonte_tipo     VARCHAR(40) NOT NULL,
  titulo         TEXT NOT NULL,
  url            TEXT,
  metadata       JSONB NOT NULL DEFAULT '{}',
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_associados_ativo ON associados(ativo);
CREATE INDEX IF NOT EXISTS idx_associados_agencias ON associados USING GIN(agencia_siglas);
CREATE INDEX IF NOT EXISTS idx_associados_palavras ON associados USING GIN(palavras_chave);
CREATE UNIQUE INDEX IF NOT EXISTS idx_associado_temas_unique
  ON associado_temas(associado_id, tema, COALESCE(microtema, ''));
CREATE INDEX IF NOT EXISTS idx_lista_triplice_agencia ON lista_triplice(agencia_id, review_status);
CREATE INDEX IF NOT EXISTS idx_documentos_associado ON documentos_associado(associado_id, tipo, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_documento_fontes_documento ON documento_fontes(documento_id);

CREATE OR REPLACE TRIGGER trg_associados_updated_at
  BEFORE UPDATE ON associados
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

ALTER TABLE associados ENABLE ROW LEVEL SECURITY;
ALTER TABLE associado_temas ENABLE ROW LEVEL SECURITY;
ALTER TABLE lista_triplice ENABLE ROW LEVEL SECURITY;
ALTER TABLE documentos_associado ENABLE ROW LEVEL SECURITY;
ALTER TABLE documento_fontes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "allow_all_service_role" ON associados USING (true) WITH CHECK (true);
CREATE POLICY "allow_all_service_role" ON associado_temas USING (true) WITH CHECK (true);
CREATE POLICY "allow_all_service_role" ON lista_triplice USING (true) WITH CHECK (true);
CREATE POLICY "allow_all_service_role" ON documentos_associado USING (true) WITH CHECK (true);
CREATE POLICY "allow_all_service_role" ON documento_fontes USING (true) WITH CHECK (true);

INSERT INTO agencias (sigla, nome, nome_completo)
VALUES
  ('ANTT', 'ANTT', 'Agencia Nacional de Transportes Terrestres')
ON CONFLICT (sigla) DO UPDATE SET nome = EXCLUDED.nome, nome_completo = EXCLUDED.nome_completo;

INSERT INTO associados (
  nome, setor, descricao, agencia_siglas, ministerios, ministerio_urls, microtemas, palavras_chave, vp_nome, vp_cargo, vp_minibio
) VALUES
  (
    'Metro de Sao Paulo',
    'Metroviario',
    'Mapeamento regulatorio para temas metroviarios em ARTESP/ANTT.',
    ARRAY['ARTESP','ANTT'],
    ARRAY['Ministerio dos Transportes'],
    ARRAY['https://www.gov.br/transportes/pt-br/assuntos/noticias'],
    ARRAY['tarifa','contrato','obras','fiscalizacao','usuario','seguranca'],
    ARRAY['metro','metroviario','ferrovia','trilhos','transporte publico','concessao','mobilidade'],
    'VP a definir',
    'Vice-presidencia',
    'Mini bio pendente de curadoria. Preencher com fonte oficial antes de distribuir o relatorio.'
  ),
  (
    'Simineral',
    'Mineracao',
    'Mapeamento regulatorio para mineracao, ANM e politica publica mineral.',
    ARRAY['ANM'],
    ARRAY['Ministerio de Minas e Energia'],
    ARRAY['https://www.gov.br/mme/pt-br/assuntos/noticias'],
    ARRAY['lavra','pesquisa','licenciamento','servidao','cfem','disponibilidade','recursos'],
    ARRAY['mineracao','mineral','minerais criticos','lavra','pesquisa mineral','para','simineral'],
    'VP a definir',
    'Vice-presidencia',
    'Mini bio pendente de curadoria. Preencher com fonte oficial antes de distribuir o relatorio.'
  )
ON CONFLICT (nome) DO UPDATE SET
  setor = EXCLUDED.setor,
  descricao = EXCLUDED.descricao,
  agencia_siglas = EXCLUDED.agencia_siglas,
  ministerios = EXCLUDED.ministerios,
  ministerio_urls = EXCLUDED.ministerio_urls,
  microtemas = EXCLUDED.microtemas,
  palavras_chave = EXCLUDED.palavras_chave;

INSERT INTO monitoramento_sites (agencia_id, nome, url, estrategia, seletor_links)
SELECT NULL, 'Ministerio dos Transportes - Noticias',
       'https://www.gov.br/transportes/pt-br/assuntos/noticias',
       'govbr-news', 'a[href]'
WHERE NOT EXISTS (
  SELECT 1 FROM monitoramento_sites
  WHERE url = 'https://www.gov.br/transportes/pt-br/assuntos/noticias'
);

INSERT INTO monitoramento_sites (agencia_id, nome, url, estrategia, seletor_links)
SELECT NULL, 'Ministerio de Minas e Energia - Noticias',
       'https://www.gov.br/mme/pt-br/assuntos/noticias',
       'govbr-news', 'a[href]'
WHERE NOT EXISTS (
  SELECT 1 FROM monitoramento_sites
  WHERE url = 'https://www.gov.br/mme/pt-br/assuntos/noticias'
);
