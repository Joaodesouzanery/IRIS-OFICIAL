-- Monitoramento focado em documentos regulatórios e fila de upload.

ALTER TABLE monitoramento_sites
  ADD COLUMN IF NOT EXISTS tipo_fonte VARCHAR(40) NOT NULL DEFAULT 'documentos_regulatorios',
  ADD COLUMN IF NOT EXISTS auto_enfileirar_pdf BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS metadata JSONB NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE monitoramento_sites
  DROP CONSTRAINT IF EXISTS monitoramento_sites_tipo_fonte_check;
ALTER TABLE monitoramento_sites
  ADD CONSTRAINT monitoramento_sites_tipo_fonte_check
  CHECK (tipo_fonte IN ('documentos_regulatorios','noticias','institucional'));

ALTER TABLE monitoramento_itens
  ADD COLUMN IF NOT EXISTS upload_job_id UUID REFERENCES upload_jobs(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS documento_id UUID REFERENCES documentos_regulatorios(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS enfileirado_em TIMESTAMPTZ;

ALTER TABLE monitoramento_runs
  ADD COLUMN IF NOT EXISTS documentos_enfileirados INTEGER NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_monitoramento_sites_tipo_ativo
  ON monitoramento_sites(tipo_fonte, ativo);
CREATE INDEX IF NOT EXISTS idx_monitoramento_itens_documento
  ON monitoramento_itens(documento_id)
  WHERE documento_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_monitoramento_itens_upload_job
  ON monitoramento_itens(upload_job_id)
  WHERE upload_job_id IS NOT NULL;

-- As fontes jornalísticas continuam existindo no módulo Notícias. No
-- Monitoramento elas ficam inativas para não misturar alertas de notícia com
-- pautas, atas, votos e deliberações.
UPDATE monitoramento_sites
SET tipo_fonte = 'noticias',
    auto_enfileirar_pdf = FALSE,
    ativo = FALSE,
    metadata = COALESCE(metadata, '{}'::jsonb) || jsonb_build_object('migrated_to_news_module', true)
WHERE estrategia = 'govbr-news'
   OR url IN (
    'https://www.artesp.sp.gov.br/artesp/noticias',
    'https://www.gov.br/antt/pt-br/assuntos/ultimas-noticias',
    'https://www.gov.br/anm/pt-br/assuntos/noticias'
   );

UPDATE monitoramento_sites
SET tipo_fonte = 'documentos_regulatorios',
    auto_enfileirar_pdf = TRUE
WHERE tipo_fonte IS NULL
   OR tipo_fonte <> 'noticias';

INSERT INTO monitoramento_sites (agencia_id, nome, url, estrategia, seletor_links, tipo_fonte, auto_enfileirar_pdf, metadata)
SELECT id,
       'ANM - Pautas da Diretoria Colegiada',
       'https://www.gov.br/anm/pt-br/composicao/diretoria-colegiada/pautas',
       'html-static',
       'a[href]',
       'documentos_regulatorios',
       TRUE,
       jsonb_build_object('tipos_esperados', ARRAY['pauta'], 'fonte_oficial', true)
FROM agencias
WHERE sigla = 'ANM'
  AND NOT EXISTS (
    SELECT 1 FROM monitoramento_sites
    WHERE url = 'https://www.gov.br/anm/pt-br/composicao/diretoria-colegiada/pautas'
  );

INSERT INTO monitoramento_sites (agencia_id, nome, url, estrategia, seletor_links, tipo_fonte, auto_enfileirar_pdf, metadata)
SELECT id,
       'ANM - Atas da Diretoria Colegiada',
       'https://www.gov.br/anm/pt-br/composicao/diretoria-colegiada/atas',
       'html-static',
       'a[href]',
       'documentos_regulatorios',
       TRUE,
       jsonb_build_object('tipos_esperados', ARRAY['ata'], 'fonte_oficial', true)
FROM agencias
WHERE sigla = 'ANM'
  AND NOT EXISTS (
    SELECT 1 FROM monitoramento_sites
    WHERE url = 'https://www.gov.br/anm/pt-br/composicao/diretoria-colegiada/atas'
  );

INSERT INTO monitoramento_sites (agencia_id, nome, url, estrategia, seletor_links, tipo_fonte, auto_enfileirar_pdf, metadata)
SELECT id,
       'ANM - Pautas das ROP',
       'https://www.gov.br/anm/pt-br/composicao/diretoria-colegiada/reunioes-da-diretoria-colegiada/pautas-da-rop',
       'html-static',
       'a[href]',
       'documentos_regulatorios',
       TRUE,
       jsonb_build_object('tipos_esperados', ARRAY['pauta'], 'fonte_oficial', true)
FROM agencias
WHERE sigla = 'ANM'
  AND NOT EXISTS (
    SELECT 1 FROM monitoramento_sites
    WHERE url = 'https://www.gov.br/anm/pt-br/composicao/diretoria-colegiada/reunioes-da-diretoria-colegiada/pautas-da-rop'
  );

INSERT INTO monitoramento_sites (agencia_id, nome, url, estrategia, seletor_links, tipo_fonte, auto_enfileirar_pdf, metadata)
SELECT id,
       'ANM - Atas das ROP',
       'https://www.gov.br/anm/pt-br/composicao/diretoria-colegiada/reunioes-da-diretoria-colegiada/atas-da-rop',
       'html-static',
       'a[href]',
       'documentos_regulatorios',
       TRUE,
       jsonb_build_object('tipos_esperados', ARRAY['ata'], 'fonte_oficial', true)
FROM agencias
WHERE sigla = 'ANM'
  AND NOT EXISTS (
    SELECT 1 FROM monitoramento_sites
    WHERE url = 'https://www.gov.br/anm/pt-br/composicao/diretoria-colegiada/reunioes-da-diretoria-colegiada/atas-da-rop'
  );

INSERT INTO monitoramento_sites (agencia_id, nome, url, estrategia, seletor_links, tipo_fonte, auto_enfileirar_pdf, metadata)
SELECT id,
       'ARTESP - Reuniões da Diretoria',
       'https://www.artesp.sp.gov.br/artesp/transparencia/reunioes-diretoria',
       'html-static',
       'a[href]',
       'documentos_regulatorios',
       TRUE,
       jsonb_build_object('tipos_esperados', ARRAY['deliberacao','ata','pauta'], 'fonte_oficial', true)
FROM agencias
WHERE sigla = 'ARTESP'
  AND NOT EXISTS (
    SELECT 1 FROM monitoramento_sites
    WHERE url = 'https://www.artesp.sp.gov.br/artesp/transparencia/reunioes-diretoria'
  );

UPDATE monitoramento_sites
SET tipo_fonte = 'documentos_regulatorios',
    auto_enfileirar_pdf = TRUE,
    metadata = COALESCE(metadata, '{}'::jsonb) || jsonb_build_object('tipos_esperados', ARRAY['pauta','ata','voto','deliberacao'])
WHERE estrategia = 'antt-2026';
