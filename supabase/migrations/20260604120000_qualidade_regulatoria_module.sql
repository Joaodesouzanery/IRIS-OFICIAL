CREATE TABLE IF NOT EXISTS public.qualidade_regulatoria_agencias (
  sigla TEXT PRIMARY KEY,
  nome_completo TEXT NOT NULL,
  setor_regulado TEXT NOT NULL,
  ano_criacao INTEGER NOT NULL,
  lei_criacao TEXT NOT NULL,
  site_oficial TEXT NOT NULL,
  portal_transparencia TEXT,
  portal_dados_abertos TEXT,
  portal_consultas_publicas TEXT,
  portal_ouvidoria TEXT,
  email_contato TEXT,
  ativo BOOLEAN NOT NULL DEFAULT TRUE,
  metadata JSONB NOT NULL DEFAULT '{}'::JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.qualidade_regulatoria_criterios (
  id INTEGER PRIMARY KEY,
  nome TEXT NOT NULL,
  descricao TEXT NOT NULL,
  peso NUMERIC(6,4) NOT NULL CHECK (peso >= 0 AND peso <= 1),
  nivel_prioridade TEXT NOT NULL CHECK (nivel_prioridade IN ('alta', 'media', 'baixa')),
  fontes_coleta TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  metodo_coleta TEXT NOT NULL CHECK (metodo_coleta IN ('api', 'scraping', 'manual', 'misto')),
  url_documentacao TEXT,
  obrigatorio_por_lei BOOLEAN NOT NULL DEFAULT FALSE,
  base_legal TEXT,
  ativo BOOLEAN NOT NULL DEFAULT TRUE,
  ordem INTEGER NOT NULL DEFAULT 0,
  metadata JSONB NOT NULL DEFAULT '{}'::JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.qualidade_regulatoria_fontes (
  id TEXT PRIMARY KEY,
  nome TEXT NOT NULL,
  url TEXT NOT NULL,
  api_url TEXT,
  requer_chave BOOLEAN NOT NULL DEFAULT FALSE,
  metodo_coleta TEXT NOT NULL DEFAULT 'misto',
  criterios_relacionados INTEGER[] NOT NULL DEFAULT ARRAY[]::INTEGER[],
  formato TEXT,
  atualizacao TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.qualidade_regulatoria_avaliacoes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agencia_sigla TEXT NOT NULL REFERENCES public.qualidade_regulatoria_agencias(sigla) ON DELETE CASCADE,
  ano INTEGER NOT NULL DEFAULT EXTRACT(YEAR FROM NOW())::INTEGER,
  criterio_id INTEGER NOT NULL REFERENCES public.qualidade_regulatoria_criterios(id) ON DELETE CASCADE,
  nota NUMERIC(6,2) NOT NULL DEFAULT 0 CHECK (nota >= 0 AND nota <= 100),
  nivel TEXT NOT NULL CHECK (nivel IN ('avancado', 'em_desenvolvimento', 'inicial')),
  observacao TEXT,
  fonte_avaliacao TEXT NOT NULL DEFAULT 'manual',
  status_revisao TEXT NOT NULL DEFAULT 'pendente' CHECK (status_revisao IN ('preliminar', 'pendente', 'em_revisao', 'validado', 'rejeitado')),
  evidencias_count INTEGER NOT NULL DEFAULT 0,
  revisado_por UUID,
  revisado_em TIMESTAMPTZ,
  metadata JSONB NOT NULL DEFAULT '{}'::JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (agencia_sigla, ano, criterio_id)
);

CREATE TABLE IF NOT EXISTS public.qualidade_regulatoria_evidencias (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  avaliacao_id UUID REFERENCES public.qualidade_regulatoria_avaliacoes(id) ON DELETE SET NULL,
  agencia_sigla TEXT NOT NULL REFERENCES public.qualidade_regulatoria_agencias(sigla) ON DELETE CASCADE,
  criterio_id INTEGER NOT NULL REFERENCES public.qualidade_regulatoria_criterios(id) ON DELETE CASCADE,
  titulo TEXT NOT NULL,
  url TEXT,
  fonte TEXT,
  trecho_publico TEXT,
  data_referencia DATE,
  status_revisao TEXT NOT NULL DEFAULT 'pendente' CHECK (status_revisao IN ('pendente', 'validada', 'rejeitada')),
  compliance_flags JSONB NOT NULL DEFAULT '{}'::JSONB,
  metadata JSONB NOT NULL DEFAULT '{}'::JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.qualidade_regulatoria_coletas (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agencia_sigla TEXT REFERENCES public.qualidade_regulatoria_agencias(sigla) ON DELETE SET NULL,
  criterio_id INTEGER REFERENCES public.qualidade_regulatoria_criterios(id) ON DELETE SET NULL,
  fonte_id TEXT REFERENCES public.qualidade_regulatoria_fontes(id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'pendente' CHECK (status IN ('pendente', 'sucesso', 'falha', 'restrito', 'parcial')),
  data_coleta TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  dados_brutos JSONB NOT NULL DEFAULT '{}'::JSONB,
  evidencias_detectadas JSONB NOT NULL DEFAULT '[]'::JSONB,
  warnings TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  compliance_status TEXT NOT NULL DEFAULT 'pendente_revisao',
  metadata JSONB NOT NULL DEFAULT '{}'::JSONB
);

CREATE TABLE IF NOT EXISTS public.qualidade_regulatoria_diagnosticos (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agencia_sigla TEXT NOT NULL REFERENCES public.qualidade_regulatoria_agencias(sigla) ON DELETE CASCADE,
  ano INTEGER NOT NULL,
  score_geral NUMERIC(6,2) NOT NULL DEFAULT 0,
  posicao_ranking INTEGER,
  status_revisao TEXT NOT NULL DEFAULT 'preliminar',
  destaques_positivos TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  areas_melhoria TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  metadata JSONB NOT NULL DEFAULT '{}'::JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (agencia_sigla, ano)
);

CREATE TABLE IF NOT EXISTS public.qualidade_regulatoria_premio_categorias (
  id TEXT PRIMARY KEY,
  nome TEXT NOT NULL,
  descricao TEXT NOT NULL,
  criterios_avaliados INTEGER[] NOT NULL DEFAULT ARRAY[]::INTEGER[],
  tipo TEXT NOT NULL CHECK (tipo IN ('geral', 'tematico', 'evolucao')),
  ativo BOOLEAN NOT NULL DEFAULT TRUE,
  metadata JSONB NOT NULL DEFAULT '{}'::JSONB
);

CREATE TABLE IF NOT EXISTS public.qualidade_regulatoria_premio_edicoes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ano INTEGER NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'rascunho',
  data_publicacao_metodologia DATE,
  data_coleta_inicio DATE,
  data_coleta_fim DATE,
  data_resultado DATE,
  vencedoras JSONB NOT NULL DEFAULT '{}'::JSONB,
  metadata JSONB NOT NULL DEFAULT '{}'::JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_qualidade_avaliacoes_agencia_ano
  ON public.qualidade_regulatoria_avaliacoes(agencia_sigla, ano);
CREATE INDEX IF NOT EXISTS idx_qualidade_evidencias_agencia_criterio
  ON public.qualidade_regulatoria_evidencias(agencia_sigla, criterio_id);
CREATE INDEX IF NOT EXISTS idx_qualidade_coletas_status
  ON public.qualidade_regulatoria_coletas(status, data_coleta DESC);

INSERT INTO public.qualidade_regulatoria_agencias
  (sigla, nome_completo, setor_regulado, ano_criacao, lei_criacao, site_oficial, portal_transparencia, portal_dados_abertos, portal_consultas_publicas, portal_ouvidoria)
VALUES
  ('ANA', 'Agência Nacional de Águas e Saneamento Básico', 'Recursos hídricos e saneamento', 2000, 'Lei 9.984/2000', 'https://www.gov.br/ana', 'https://www.gov.br/ana/acesso-a-informacao', 'https://dados.gov.br/organization?q=ana', 'https://www.gov.br/ana/participacao-social', 'https://www.gov.br/ana/canais_atendimento/ouvidoria'),
  ('ANAC', 'Agência Nacional de Aviação Civil', 'Aviação civil', 2005, 'Lei 11.182/2005', 'https://www.gov.br/anac', 'https://www.gov.br/anac/acesso-a-informacao', 'https://dados.gov.br/organization?q=anac', 'https://www.gov.br/anac/participacao-social', 'https://www.gov.br/anac/canais_atendimento/ouvidoria'),
  ('ANCINE', 'Agência Nacional do Cinema', 'Setor cinematográfico e audiovisual', 2001, 'MP 2.228-1/2001', 'https://www.ancine.gov.br', 'https://www.ancine.gov.br/acesso-a-informacao', 'https://dados.gov.br/organization?q=ancine', 'https://www.ancine.gov.br/participacao-social', 'https://www.ancine.gov.br/ouvidoria'),
  ('ANEEL', 'Agência Nacional de Energia Elétrica', 'Energia elétrica', 1996, 'Lei 9.427/1996', 'https://www.gov.br/aneel', 'https://www.gov.br/aneel/acesso-a-informacao', 'https://dadosabertos.aneel.gov.br', 'https://www.gov.br/aneel/participacao-social', 'https://www.gov.br/aneel/canais_atendimento/ouvidoria'),
  ('ANM', 'Agência Nacional de Mineração', 'Mineração', 2017, 'Lei 13.575/2017', 'https://www.gov.br/anm', 'https://www.gov.br/anm/acesso-a-informacao', 'https://dados.gov.br/organization?q=anm', 'https://www.gov.br/anm/participacao-social', 'https://www.gov.br/anm/canais_atendimento/ouvidoria'),
  ('ANP', 'Agência Nacional do Petróleo, Gás Natural e Biocombustíveis', 'Petróleo, gás natural e biocombustíveis', 1997, 'Lei 9.478/1997', 'https://www.gov.br/anp', 'https://www.gov.br/anp/acesso-a-informacao', 'https://dados.gov.br/organization?q=anp', 'https://www.gov.br/anp/participacao-social', 'https://www.gov.br/anp/canais_atendimento/ouvidoria'),
  ('ANS', 'Agência Nacional de Saúde Suplementar', 'Planos e seguros de saúde', 2000, 'Lei 9.961/2000', 'https://www.gov.br/ans', 'https://www.gov.br/ans/acesso-a-informacao', 'https://dadosabertos.ans.gov.br', 'https://www.gov.br/ans/participacao-social', 'https://www.gov.br/ans/canais_atendimento/ouvidoria'),
  ('ANATEL', 'Agência Nacional de Telecomunicações', 'Telecomunicações', 1997, 'Lei 9.472/1997', 'https://www.gov.br/anatel', 'https://www.gov.br/anatel/acesso-a-informacao', 'https://dados.gov.br/organization/agencia-nacional-de-telecomunicacoes-anatel', 'https://sistemas.anatel.gov.br/acp/consultas/listar', 'https://www.gov.br/anatel/canais_atendimento/ouvidoria'),
  ('ANTAQ', 'Agência Nacional de Transportes Aquaviários', 'Transportes aquaviários e portos', 2001, 'Lei 10.233/2001', 'https://www.gov.br/antaq', 'https://www.gov.br/antaq/acesso-a-informacao', 'https://dados.gov.br/organization?q=antaq', 'https://www.gov.br/antaq/participacao-social', 'https://www.gov.br/antaq/canais_atendimento/ouvidoria'),
  ('ANTT', 'Agência Nacional de Transportes Terrestres', 'Transportes terrestres', 2001, 'Lei 10.233/2001', 'https://www.gov.br/antt', 'https://www.gov.br/antt/acesso-a-informacao', 'https://dados.gov.br/organization?q=antt', 'https://www.gov.br/antt/participacao-social', 'https://www.gov.br/antt/canais_atendimento/ouvidoria'),
  ('ANVISA', 'Agência Nacional de Vigilância Sanitária', 'Vigilância sanitária', 1999, 'Lei 9.782/1999', 'https://www.gov.br/anvisa', 'https://www.gov.br/anvisa/acesso-a-informacao', 'https://dados.gov.br/organization?q=anvisa', 'https://consultas.anvisa.gov.br', 'https://www.gov.br/anvisa/canais_atendimento/ouvidoria'),
  ('ANPD', 'Agência Nacional de Proteção de Dados', 'Proteção de dados pessoais', 2026, 'Lei 15.352/2026', 'https://www.gov.br/anpd', 'https://www.gov.br/anpd/acesso-a-informacao', 'https://dados.gov.br/organization?q=anpd', 'https://www.gov.br/anpd/participacao-social', 'https://www.gov.br/anpd/canais_atendimento/ouvidoria')
ON CONFLICT (sigla) DO UPDATE SET
  nome_completo = EXCLUDED.nome_completo,
  setor_regulado = EXCLUDED.setor_regulado,
  ano_criacao = EXCLUDED.ano_criacao,
  lei_criacao = EXCLUDED.lei_criacao,
  site_oficial = EXCLUDED.site_oficial,
  portal_transparencia = EXCLUDED.portal_transparencia,
  portal_dados_abertos = EXCLUDED.portal_dados_abertos,
  portal_consultas_publicas = EXCLUDED.portal_consultas_publicas,
  portal_ouvidoria = EXCLUDED.portal_ouvidoria,
  updated_at = NOW();

INSERT INTO public.qualidade_regulatoria_criterios
  (id, nome, descricao, peso, nivel_prioridade, fontes_coleta, metodo_coleta, obrigatorio_por_lei, base_legal, ordem)
VALUES
  (1, 'Transparência Ativa', 'Publicação proativa de informações institucionais, normativas, atas, AIRs, contratos, orçamento e dados abertos.', 0.15, 'alta', ARRAY['portal_transparencia_federal','site_agencia','dados_gov_br'], 'misto', TRUE, 'Lei 12.527/2011; Lei 13.848/2019, art. 18', 1),
  (2, 'Participação Social', 'Volume, qualidade e devolutiva de consultas públicas, audiências públicas e instrumentos de participação.', 0.15, 'alta', ARRAY['participa_br','site_agencia','relatorios_anuais'], 'scraping', TRUE, 'Lei 13.848/2019, arts. 19 a 25', 2),
  (3, 'Análise de Impacto Regulatório', 'Existência, qualidade e publicidade das AIRs, incluindo problema, alternativas, impactos e análise custo-benefício.', 0.15, 'alta', ARRAY['site_agencia','qualireg_cgu','diario_oficial'], 'misto', TRUE, 'Decreto 10.411/2020; Lei 13.874/2019', 3),
  (4, 'Governança Regulatória', 'Planejamento estratégico, gestão de riscos, integridade, código de conduta e controles internos.', 0.12, 'alta', ARRAY['tcu','cgu','site_agencia'], 'misto', TRUE, 'Lei 13.848/2019; IN CGU 01/2016', 4),
  (5, 'Independência Decisória', 'Autonomia técnica, mandatos fixos, quarentena regulatória e estabilidade decisória institucional.', 0.08, 'media', ARRAY['atos_nomeacao','acordaos_tcu','site_agencia'], 'manual', TRUE, 'Lei 13.848/2019, arts. 5 a 12', 5),
  (6, 'Prestação de Contas', 'Relatório anual de atividades, controle externo, metas e auditorias.', 0.12, 'alta', ARRAY['tcu','cgu','portal_transparencia_federal'], 'misto', TRUE, 'Lei 13.848/2019, art. 15', 6),
  (7, 'Qualidade Normativa', 'Clareza, consistência, proporcionalidade, revisão periódica, ARR e gestão do estoque regulatório.', 0.08, 'media', ARRAY['site_agencia','acervo_normativo','relatorios_arr'], 'misto', TRUE, 'Decreto 10.411/2020', 7),
  (8, 'Ouvidoria e Atendimento', 'Estrutura de ouvidoria, tempo médio de resposta, taxa de resolução e satisfação dos usuários.', 0.06, 'media', ARRAY['falabr','relatorios_ouvidoria','cgu'], 'misto', TRUE, 'Lei 13.460/2017; Lei 13.848/2019, art. 24', 8),
  (9, 'Dados Abertos', 'Datasets em formatos abertos, atualização regular, API pública e catálogo em dados.gov.br.', 0.05, 'media', ARRAY['dados_gov_br','api_agencia','inda'], 'api', TRUE, 'Decreto 8.777/2016', 9),
  (10, 'Gestão Financeira e Orçamentária', 'Execução orçamentária, eficiência de gastos, arrecadação regulatória e relatórios financeiros públicos.', 0.04, 'baixa', ARRAY['siafi','portal_transparencia_federal','relatorios_anuais'], 'api', TRUE, 'Lei 4.320/1964; Lei Complementar 101/2000', 10)
ON CONFLICT (id) DO UPDATE SET
  nome = EXCLUDED.nome,
  descricao = EXCLUDED.descricao,
  peso = EXCLUDED.peso,
  nivel_prioridade = EXCLUDED.nivel_prioridade,
  fontes_coleta = EXCLUDED.fontes_coleta,
  metodo_coleta = EXCLUDED.metodo_coleta,
  obrigatorio_por_lei = EXCLUDED.obrigatorio_por_lei,
  base_legal = EXCLUDED.base_legal,
  ativo = TRUE;

INSERT INTO public.qualidade_regulatoria_fontes
  (id, nome, url, api_url, requer_chave, metodo_coleta, criterios_relacionados, formato, atualizacao)
VALUES
  ('portal_transparencia_federal', 'Portal da Transparência Federal', 'https://portaldatransparencia.gov.br', 'https://api.portaldatransparencia.gov.br/api-de-dados', TRUE, 'api', ARRAY[1,6,10], 'JSON', 'diária'),
  ('dados_gov_br', 'Portal Dados Abertos Brasil', 'https://dados.gov.br', 'https://dados.gov.br/api/3/action', FALSE, 'api', ARRAY[1,9], 'JSON', 'variável'),
  ('participa_br', 'Participa.br', 'https://www.participa.br', NULL, FALSE, 'scraping', ARRAY[2], 'HTML', 'contínua'),
  ('falabr', 'Fala.BR', 'https://falabr.cgu.gov.br', NULL, FALSE, 'misto', ARRAY[1,8], 'CSV/HTML', 'mensal'),
  ('qualireg_cgu', 'QualiREG - CGU', 'https://www.gov.br/cgu/pt-br/assuntos/auditoria-e-fiscalizacao/qualireg', NULL, FALSE, 'scraping', ARRAY[3,4], 'PDF/HTML', 'anual'),
  ('diario_oficial', 'Diário Oficial da União', 'https://www.in.gov.br', 'https://www.in.gov.br/consulta/-/buscar/dou', FALSE, 'misto', ARRAY[3,7], 'HTML/RSS', 'diária'),
  ('tcu', 'Tribunal de Contas da União', 'https://portal.tcu.gov.br', 'https://contas.tcu.gov.br/pesquisaJurisprudencia/', FALSE, 'scraping', ARRAY[4,5,6], 'HTML/PDF', 'contínua'),
  ('cgu', 'Controladoria-Geral da União', 'https://www.gov.br/cgu', NULL, FALSE, 'scraping', ARRAY[1,4,6,8], 'HTML/PDF', 'contínua'),
  ('siafi', 'Tesouro/SIAFI público', 'https://www.tesourotransparente.gov.br/ckan/dataset', NULL, FALSE, 'api', ARRAY[10], 'CSV/JSON', 'diária'),
  ('site_agencia', 'Portal oficial da agência', 'https://www.gov.br', NULL, FALSE, 'misto', ARRAY[1,2,3,4,6,7,8], 'HTML/PDF', 'contínua')
ON CONFLICT (id) DO UPDATE SET
  nome = EXCLUDED.nome,
  url = EXCLUDED.url,
  api_url = EXCLUDED.api_url,
  requer_chave = EXCLUDED.requer_chave,
  metodo_coleta = EXCLUDED.metodo_coleta,
  criterios_relacionados = EXCLUDED.criterios_relacionados,
  formato = EXCLUDED.formato,
  atualizacao = EXCLUDED.atualizacao;

INSERT INTO public.qualidade_regulatoria_premio_categorias
  (id, nome, descricao, criterios_avaliados, tipo)
VALUES
  ('geral', 'Melhor Agência Global', 'Maior score geral ponderado.', ARRAY[1,2,3,4,5,6,7,8,9,10], 'geral'),
  ('transparencia', 'Destaque em Transparência e Dados Abertos', 'Transparência Ativa e Dados Abertos.', ARRAY[1,9], 'tematico'),
  ('participacao', 'Destaque em Participação Social', 'Qualidade, volume e devolutiva de participação social.', ARRAY[2], 'tematico'),
  ('inovacao', 'Destaque em Inovação Regulatória', 'AIR, ARR e qualidade normativa.', ARRAY[3,7], 'tematico'),
  ('governanca', 'Destaque em Governança e Integridade', 'Governança, independência decisória e prestação de contas.', ARRAY[4,5,6], 'tematico'),
  ('evolucao', 'Prêmio Evolução Regulatória', 'Maior evolução percentual frente à edição anterior.', ARRAY[1,2,3,4,5,6,7,8,9,10], 'evolucao')
ON CONFLICT (id) DO UPDATE SET
  nome = EXCLUDED.nome,
  descricao = EXCLUDED.descricao,
  criterios_avaliados = EXCLUDED.criterios_avaliados,
  tipo = EXCLUDED.tipo,
  ativo = TRUE;

ALTER TABLE public.qualidade_regulatoria_agencias ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.qualidade_regulatoria_criterios ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.qualidade_regulatoria_fontes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.qualidade_regulatoria_avaliacoes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.qualidade_regulatoria_evidencias ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.qualidade_regulatoria_coletas ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.qualidade_regulatoria_diagnosticos ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.qualidade_regulatoria_premio_categorias ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.qualidade_regulatoria_premio_edicoes ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE
  table_name TEXT;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'qualidade_regulatoria_agencias',
    'qualidade_regulatoria_criterios',
    'qualidade_regulatoria_fontes',
    'qualidade_regulatoria_avaliacoes',
    'qualidade_regulatoria_evidencias',
    'qualidade_regulatoria_coletas',
    'qualidade_regulatoria_diagnosticos',
    'qualidade_regulatoria_premio_categorias',
    'qualidade_regulatoria_premio_edicoes'
  ] LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I_service_role_all ON public.%I', table_name, table_name);
    EXECUTE format('CREATE POLICY %I_service_role_all ON public.%I FOR ALL TO service_role USING (true) WITH CHECK (true)', table_name, table_name);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON public.%I TO service_role', table_name);
  END LOOP;
END $$;

NOTIFY pgrst, 'reload schema';
