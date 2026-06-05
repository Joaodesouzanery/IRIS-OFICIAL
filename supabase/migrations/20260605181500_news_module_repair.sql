-- Corrige o modulo de Noticias com uma migration estreita.

BEGIN;

ALTER TABLE public.regulatory_newsletter_editions
  ADD COLUMN IF NOT EXISTS documento_tipo TEXT NOT NULL DEFAULT 'newsletter_regulatoria',
  ADD COLUMN IF NOT EXISTS template_version TEXT NOT NULL DEFAULT 'iris_newsletter_layout_v1';

ALTER TABLE public.regulatory_newsletter_editions
  DROP CONSTRAINT IF EXISTS regulatory_newsletter_editions_documento_tipo_check;

ALTER TABLE public.regulatory_newsletter_editions
  ADD CONSTRAINT regulatory_newsletter_editions_documento_tipo_check
  CHECK (documento_tipo IN ('newsletter_regulatoria', 'minuto_regulacao'));

CREATE INDEX IF NOT EXISTS idx_regulatory_newsletter_editions_documento_tipo
  ON public.regulatory_newsletter_editions(documento_tipo, created_at DESC);

CREATE TABLE IF NOT EXISTS public.regulatory_news_collection_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  site_id UUID REFERENCES public.monitoramento_sites(id) ON DELETE SET NULL,
  trigger_type TEXT NOT NULL CHECK (trigger_type IN ('manual', 'scheduled')),
  batch_offset INTEGER NOT NULL DEFAULT 0 CHECK (batch_offset >= 0),
  links_detectados INTEGER NOT NULL DEFAULT 0,
  itens_processados INTEGER NOT NULL DEFAULT 0,
  itens_salvos INTEGER NOT NULL DEFAULT 0,
  itens_pendentes INTEGER NOT NULL DEFAULT 0,
  imagens_encontradas INTEGER NOT NULL DEFAULT 0,
  imagens_ausentes INTEGER NOT NULL DEFAULT 0,
  imagens_com_falha INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL CHECK (status IN ('ok', 'error')),
  error_message TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_regulatory_news_collection_runs_site_created
  ON public.regulatory_news_collection_runs(site_id, created_at DESC);

ALTER TABLE public.regulatory_news_collection_runs ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.regulatory_news_collection_runs FROM anon, authenticated;
DROP POLICY IF EXISTS service_role_all_regulatory_news_collection_runs ON public.regulatory_news_collection_runs;
CREATE POLICY service_role_all_regulatory_news_collection_runs
  ON public.regulatory_news_collection_runs FOR ALL TO service_role
  USING (true) WITH CHECK (true);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.regulatory_news_collection_runs TO service_role;

ALTER TABLE public.monitoramento_sites
  DROP CONSTRAINT IF EXISTS monitoramento_sites_estrategia_check;

ALTER TABLE public.monitoramento_sites
  ADD CONSTRAINT monitoramento_sites_estrategia_check
  CHECK (estrategia IN (
    'html-static',
    'govbr-news',
    'artesp-news',
    'antt-2026',
    'needs-headless',
    'headless',
    'manual'
  ));

INSERT INTO public.agencias (
  sigla, nome, nome_completo, tipo, esfera, ministerio_vinculado,
  url_institucional, status, ativo, dados_importados_em, metadata
)
VALUES
  ('ANA', 'ANA', 'Agencia Nacional de Aguas e Saneamento Basico', 'federal', 'Recursos Hidricos', 'Ministerio da Integracao e do Desenvolvimento Regional', 'https://www.gov.br/ana', 'ativa', TRUE, NOW(), '{"fonte_dado":"fonte_oficial","escopo_inicial":"noticias"}'::jsonb),
  ('ANAC', 'ANAC', 'Agencia Nacional de Aviacao Civil', 'federal', 'Aviacao Civil', 'Ministerio de Portos e Aeroportos', 'https://www.gov.br/anac', 'ativa', TRUE, NOW(), '{"fonte_dado":"fonte_oficial","escopo_inicial":"noticias"}'::jsonb),
  ('ANATEL', 'ANATEL', 'Agencia Nacional de Telecomunicacoes', 'federal', 'Telecomunicacoes', 'Ministerio das Comunicacoes', 'https://www.gov.br/anatel', 'ativa', TRUE, NOW(), '{"fonte_dado":"fonte_oficial","escopo_inicial":"noticias"}'::jsonb),
  ('ANCINE', 'ANCINE', 'Agencia Nacional do Cinema', 'federal', 'Audiovisual', 'Ministerio da Cultura', 'https://www.gov.br/ancine', 'ativa', TRUE, NOW(), '{"fonte_dado":"fonte_oficial","escopo_inicial":"noticias"}'::jsonb),
  ('ANEEL', 'ANEEL', 'Agencia Nacional de Energia Eletrica', 'federal', 'Energia Eletrica', 'Ministerio de Minas e Energia', 'https://www.gov.br/aneel', 'ativa', TRUE, NOW(), '{"fonte_dado":"fonte_oficial","escopo_inicial":"noticias"}'::jsonb),
  ('ANP', 'ANP', 'Agencia Nacional do Petroleo, Gas Natural e Biocombustiveis', 'federal', 'Petroleo, Gas e Biocombustiveis', 'Ministerio de Minas e Energia', 'https://www.gov.br/anp', 'ativa', TRUE, NOW(), '{"fonte_dado":"fonte_oficial","escopo_inicial":"noticias"}'::jsonb),
  ('ANPD', 'ANPD', 'Agencia Nacional de Protecao de Dados', 'federal', 'Protecao de Dados', 'Ministerio da Justica e Seguranca Publica', 'https://www.gov.br/anpd', 'ativa', TRUE, NOW(), '{"fonte_dado":"fonte_oficial","escopo_inicial":"noticias"}'::jsonb),
  ('ANS', 'ANS', 'Agencia Nacional de Saude Suplementar', 'federal', 'Saude Suplementar', 'Ministerio da Saude', 'https://www.gov.br/ans', 'ativa', TRUE, NOW(), '{"fonte_dado":"fonte_oficial","escopo_inicial":"noticias"}'::jsonb),
  ('ANTAQ', 'ANTAQ', 'Agencia Nacional de Transportes Aquaviarios', 'federal', 'Transportes Aquaviarios', 'Ministerio de Portos e Aeroportos', 'https://www.gov.br/antaq', 'ativa', TRUE, NOW(), '{"fonte_dado":"fonte_oficial","escopo_inicial":"noticias"}'::jsonb),
  ('ANVISA', 'ANVISA', 'Agencia Nacional de Vigilancia Sanitaria', 'federal', 'Vigilancia Sanitaria', 'Ministerio da Saude', 'https://www.gov.br/anvisa', 'ativa', TRUE, NOW(), '{"fonte_dado":"fonte_oficial","escopo_inicial":"noticias"}'::jsonb)
ON CONFLICT (sigla) DO UPDATE SET
  nome = EXCLUDED.nome,
  nome_completo = EXCLUDED.nome_completo,
  tipo = EXCLUDED.tipo,
  esfera = EXCLUDED.esfera,
  ministerio_vinculado = EXCLUDED.ministerio_vinculado,
  url_institucional = EXCLUDED.url_institucional,
  status = EXCLUDED.status,
  ativo = EXCLUDED.ativo,
  dados_importados_em = EXCLUDED.dados_importados_em,
  metadata = COALESCE(public.agencias.metadata, '{}'::jsonb) || EXCLUDED.metadata,
  updated_at = NOW();

WITH news_sources(sigla, nome, url, estrategia, news_tier, news_profile) AS (
  VALUES
    ('ARTESP', 'ARTESP - Noticias', 'https://www.artesp.sp.gov.br/artesp/noticias', 'artesp-news', 'core', 'artesp'),
    ('ANTT', 'ANTT - Ultimas Noticias', 'https://www.gov.br/antt/pt-br/assuntos/ultimas-noticias', 'govbr-news', 'core', 'govbr-core'),
    ('ANM', 'ANM - Noticias', 'https://www.gov.br/anm/pt-br/assuntos/noticias', 'govbr-news', 'core', 'govbr-core'),
    ('ANA', 'ANA - Noticias', 'https://www.gov.br/ana/pt-br/assuntos/noticias-e-eventos/noticias', 'govbr-news', 'expanded', 'govbr-expanded'),
    ('ANAC', 'ANAC - Noticias', 'https://www.gov.br/anac/pt-br/noticias', 'govbr-news', 'expanded', 'govbr-expanded'),
    ('ANATEL', 'ANATEL - Noticias', 'https://www.gov.br/anatel/pt-br/assuntos/noticias', 'govbr-news', 'expanded', 'govbr-expanded'),
    ('ANCINE', 'ANCINE - Noticias', 'https://www.gov.br/ancine/pt-br/assuntos/noticias', 'govbr-news', 'expanded', 'govbr-expanded'),
    ('ANEEL', 'ANEEL - Noticias', 'https://www.gov.br/aneel/pt-br/assuntos/noticias', 'govbr-news', 'expanded', 'govbr-expanded'),
    ('ANP', 'ANP - Noticias e comunicados', 'https://www.gov.br/anp/pt-br/canais_atendimento/imprensa/noticias-comunicados', 'govbr-news', 'expanded', 'govbr-expanded'),
    ('ANPD', 'ANPD - Noticias', 'https://www.gov.br/anpd/pt-br/assuntos/noticias', 'govbr-news', 'expanded', 'govbr-expanded'),
    ('ANS', 'ANS - Noticias', 'https://www.gov.br/ans/pt-br/assuntos/noticias', 'govbr-news', 'expanded', 'govbr-expanded'),
    ('ANTAQ', 'ANTAQ - Noticias', 'https://www.gov.br/antaq/pt-br/noticias', 'govbr-news', 'expanded', 'govbr-expanded'),
    ('ANVISA', 'ANVISA - Noticias', 'https://www.gov.br/anvisa/pt-br/assuntos/noticias-anvisa', 'govbr-news', 'expanded', 'govbr-expanded')
),
upsert_sources AS (
  INSERT INTO public.monitoramento_sites (
    agencia_id, nome, url, estrategia, seletor_links, tipo_fonte,
    auto_enfileirar_pdf, ativo, metadata
  )
  SELECT
    a.id,
    s.nome,
    s.url,
    s.estrategia,
    'a[href]',
    'noticias',
    FALSE,
    TRUE,
    jsonb_build_object(
      'fonte_oficial', true,
      'collector', 'noticias',
      'news_module_configured', true,
      'news_tier', s.news_tier,
      'news_profile', s.news_profile
    )
  FROM news_sources s
  JOIN public.agencias a ON a.sigla = s.sigla
  WHERE NOT EXISTS (
    SELECT 1 FROM public.monitoramento_sites existing WHERE existing.url = s.url
  )
  RETURNING id
)
UPDATE public.monitoramento_sites site
SET agencia_id = a.id,
    nome = s.nome,
    estrategia = s.estrategia,
    tipo_fonte = 'noticias',
    auto_enfileirar_pdf = FALSE,
    ativo = TRUE,
    metadata = COALESCE(site.metadata, '{}'::jsonb) ||
      jsonb_build_object(
        'fonte_oficial', true,
        'collector', 'noticias',
        'news_module_configured', true,
        'news_tier', s.news_tier,
        'news_profile', s.news_profile
      )
FROM news_sources s
JOIN public.agencias a ON a.sigla = s.sigla
WHERE site.url = s.url;

NOTIFY pgrst, 'reload schema';

COMMIT;
