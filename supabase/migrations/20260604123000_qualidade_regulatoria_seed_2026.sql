BEGIN;

DELETE FROM public.qualidade_regulatoria_evidencias
WHERE metadata->>'seed_id' = 'qualidade_regulatoria_2026_curated_v1';

WITH score_seed(sigla, notas) AS (
  VALUES
    ('ANATEL', ARRAY[90,88,84,83,80,84,82,81,93,82]::NUMERIC[]),
    ('ANVISA', ARRAY[84,88,89,86,78,82,83,82,78,79]::NUMERIC[]),
    ('ANEEL', ARRAY[86,82,87,80,75,80,82,78,88,76]::NUMERIC[]),
    ('ANP', ARRAY[80,72,73,74,70,78,72,70,74,76]::NUMERIC[]),
    ('ANA', ARRAY[76,83,70,72,68,72,70,73,76,69]::NUMERIC[]),
    ('ANS', ARRAY[70,69,66,69,67,68,66,70,68,67]::NUMERIC[]),
    ('ANAC', ARRAY[68,64,66,65,67,66,65,66,64,64]::NUMERIC[]),
    ('ANTT', ARRAY[65,63,64,63,62,64,62,63,61,64]::NUMERIC[]),
    ('ANTAQ', ARRAY[60,57,56,58,56,58,57,58,55,56]::NUMERIC[]),
    ('ANM', ARRAY[54,51,50,52,50,53,51,52,50,52]::NUMERIC[]),
    ('ANCINE', ARRAY[52,51,49,50,49,51,50,50,48,50]::NUMERIC[]),
    ('ANPD', ARRAY[48,44,43,45,46,44,43,47,42,43]::NUMERIC[])
),
assessment_rows AS (
  SELECT
    s.sigla AS agencia_sigla,
    2026 AS ano,
    c.id AS criterio_id,
    u.score::NUMERIC(6,2) AS nota,
    CASE
      WHEN u.score >= 76 THEN 'avancado'
      WHEN u.score >= 45 THEN 'em_desenvolvimento'
      ELSE 'inicial'
    END AS nivel,
    CONCAT(
      'Diagnostico institucional preliminar de ', c.nome, ' para ', s.sigla,
      '. Nota curada a partir de fontes publicas oficiais, com revisao humana pendente.'
    ) AS observacao
  FROM score_seed s
  CROSS JOIN LATERAL unnest(s.notas) WITH ORDINALITY AS u(score, criterio_id)
  JOIN public.qualidade_regulatoria_criterios c ON c.id = u.criterio_id
)
INSERT INTO public.qualidade_regulatoria_avaliacoes
  (agencia_sigla, ano, criterio_id, nota, nivel, observacao, fonte_avaliacao, status_revisao, evidencias_count, metadata, updated_at)
SELECT
  agencia_sigla,
  ano,
  criterio_id,
  nota,
  nivel,
  observacao,
  'base_curada_2026',
  'preliminar',
  1,
  jsonb_build_object('seed_id', 'qualidade_regulatoria_2026_curated_v1', 'lgpd_lai_guardrails', true),
  NOW()
FROM assessment_rows
ON CONFLICT (agencia_sigla, ano, criterio_id) DO UPDATE SET
  nota = EXCLUDED.nota,
  nivel = EXCLUDED.nivel,
  observacao = EXCLUDED.observacao,
  fonte_avaliacao = EXCLUDED.fonte_avaliacao,
  status_revisao = EXCLUDED.status_revisao,
  evidencias_count = EXCLUDED.evidencias_count,
  metadata = qualidade_regulatoria_avaliacoes.metadata || EXCLUDED.metadata,
  updated_at = NOW();

WITH evidence_seed(criterio_id, fonte, titulo, url, trecho) AS (
  VALUES
    (1, 'site_agencia', 'Portal institucional e acesso a informacao', 'https://www.gov.br', 'Secoes de transparencia ativa, agenda, atos, contratos e informacoes institucionais.'),
    (2, 'participa_br', 'Participacao social e consultas publicas', 'https://www.participa.br', 'Instrumentos de consulta, audiencia, tomada de subsidios e devolutivas publicas.'),
    (3, 'qualireg_cgu', 'AIR e boas praticas regulatorias', 'https://www.gov.br/cgu/pt-br/assuntos/auditoria-e-fiscalizacao/qualireg', 'Publicidade de AIR, abrangencia metodologica e referencias do Decreto 10.411/2020.'),
    (4, 'cgu', 'Governanca, riscos e integridade', 'https://www.gov.br/cgu', 'Planejamento estrategico, gestao de riscos, integridade e controles internos.'),
    (5, 'site_agencia', 'Independencia decisoria e estrutura colegiada', 'https://www.gov.br', 'Mandatos, atos oficiais, colegiado e regras de autonomia decisoria institucional.'),
    (6, 'portal_transparencia_federal', 'Prestacao de contas e relatorios de gestao', 'https://portaldatransparencia.gov.br', 'Relatorios anuais, auditorias, metas e respostas a controle externo.'),
    (7, 'diario_oficial', 'Qualidade normativa e estoque regulatorio', 'https://www.in.gov.br', 'Clareza normativa, revisoes, ARR e publicacoes oficiais de atos reguladores.'),
    (8, 'falabr', 'Ouvidoria e atendimento ao usuario', 'https://falabr.cgu.gov.br', 'Canais de ouvidoria, atendimento, prazos e informacoes publicas de satisfacao.'),
    (9, 'dados_gov_br', 'Catalogo de dados abertos', 'https://dados.gov.br', 'Datasets, formatos abertos, atualizacao e disponibilidade de APIs ou catalogos publicos.'),
    (10, 'siafi', 'Execucao financeira e orcamentaria', 'https://www.tesourotransparente.gov.br/ckan/dataset', 'Informacoes publicas de orcamento, execucao e eficiencia de gastos institucionais.')
),
evidence_rows AS (
  SELECT
    av.id AS avaliacao_id,
    av.agencia_sigla,
    av.criterio_id,
    CONCAT(av.agencia_sigla, ' - ', ev.titulo) AS titulo,
    CASE
      WHEN av.criterio_id = 1 THEN COALESCE(ag.portal_transparencia, ag.site_oficial)
      WHEN av.criterio_id = 2 THEN COALESCE(ag.portal_consultas_publicas, ag.site_oficial)
      WHEN av.criterio_id = 8 THEN COALESCE(ag.portal_ouvidoria, ag.site_oficial)
      WHEN av.criterio_id = 9 THEN COALESCE(ag.portal_dados_abertos, ag.site_oficial)
      WHEN av.criterio_id IN (3,4,5,7) THEN ag.site_oficial
      ELSE ev.url
    END AS url,
    ev.fonte,
    CONCAT(ev.trecho, ' Evidencia institucional preliminar para ', av.agencia_sigla, '.') AS trecho_publico
  FROM public.qualidade_regulatoria_avaliacoes av
  JOIN public.qualidade_regulatoria_agencias ag ON ag.sigla = av.agencia_sigla
  JOIN evidence_seed ev ON ev.criterio_id = av.criterio_id
  WHERE av.ano = 2026
)
INSERT INTO public.qualidade_regulatoria_evidencias
  (avaliacao_id, agencia_sigla, criterio_id, titulo, url, fonte, trecho_publico, data_referencia, status_revisao, compliance_flags, metadata)
SELECT
  avaliacao_id,
  agencia_sigla,
  criterio_id,
  titulo,
  url,
  fonte,
  trecho_publico,
  DATE '2026-06-01',
  'pendente',
  jsonb_build_object('reviewed', false, 'auto_seeded', true),
  jsonb_build_object('seed_id', 'qualidade_regulatoria_2026_curated_v1')
FROM evidence_rows;

WITH evidence_counts AS (
  SELECT avaliacao_id, COUNT(*)::INTEGER AS total
  FROM public.qualidade_regulatoria_evidencias
  WHERE metadata->>'seed_id' = 'qualidade_regulatoria_2026_curated_v1'
  GROUP BY avaliacao_id
)
UPDATE public.qualidade_regulatoria_avaliacoes av
SET evidencias_count = ec.total, updated_at = NOW()
FROM evidence_counts ec
WHERE av.id = ec.avaliacao_id;

WITH scores AS (
  SELECT
    av.agencia_sigla,
    ROUND(SUM(av.nota * c.peso)::NUMERIC, 2) AS score_geral
  FROM public.qualidade_regulatoria_avaliacoes av
  JOIN public.qualidade_regulatoria_criterios c ON c.id = av.criterio_id
  WHERE av.ano = 2026
  GROUP BY av.agencia_sigla
),
ranked AS (
  SELECT
    agencia_sigla,
    score_geral,
    (RANK() OVER (ORDER BY score_geral DESC))::INTEGER AS posicao_ranking
  FROM scores
),
diagnostic_rows AS (
  SELECT
    r.*,
    CASE r.agencia_sigla
      WHEN 'ANATEL' THEN ARRAY['Dados abertos estruturados','Consultas publicas maduras','Transparencia institucional consistente']
      WHEN 'ANVISA' THEN ARRAY['Uso relevante de AIR','Participacao social consolidada','Governanca robusta']
      WHEN 'ANEEL' THEN ARRAY['Historico de AIR','Portal de dados robusto','Audiencias publicas com alta maturidade']
      WHEN 'ANA' THEN ARRAY['Participacao em comites de bacia','Dados hidricos estruturados']
      WHEN 'ANPD' THEN ARRAY['Potencial institucional em protecao de dados','Agenda de construcao regulatoria em 2026']
      ELSE ARRAY['Base institucional verificavel','Fontes publicas disponiveis para avaliacao']
    END AS destaques_positivos,
    CASE r.agencia_sigla
      WHEN 'ANM' THEN ARRAY['Fortalecer governanca e sistemas de dados','Ampliar AIR, ARR e dados abertos']
      WHEN 'ANCINE' THEN ARRAY['Estruturar AIR e governanca','Ampliar dados abertos e indicadores']
      WHEN 'ANPD' THEN ARRAY['Consolidar estrutura de agencia','Criar historico comparavel para edicoes futuras']
      WHEN 'ANTAQ' THEN ARRAY['Ampliar evidencias de AIR e dados abertos','Fortalecer indicadores de qualidade normativa']
      ELSE ARRAY['Revisar evidencias oficiais por criterio','Aprimorar rastreabilidade e revisao humana']
    END AS areas_melhoria
  FROM ranked r
)
INSERT INTO public.qualidade_regulatoria_diagnosticos
  (agencia_sigla, ano, score_geral, posicao_ranking, status_revisao, destaques_positivos, areas_melhoria, metadata, updated_at)
SELECT
  agencia_sigla,
  2026,
  score_geral,
  posicao_ranking,
  'preliminar',
  destaques_positivos,
  areas_melhoria,
  jsonb_build_object('seed_id', 'qualidade_regulatoria_2026_curated_v1'),
  NOW()
FROM diagnostic_rows
ON CONFLICT (agencia_sigla, ano) DO UPDATE SET
  score_geral = EXCLUDED.score_geral,
  posicao_ranking = EXCLUDED.posicao_ranking,
  status_revisao = EXCLUDED.status_revisao,
  destaques_positivos = EXCLUDED.destaques_positivos,
  areas_melhoria = EXCLUDED.areas_melhoria,
  metadata = qualidade_regulatoria_diagnosticos.metadata || EXCLUDED.metadata,
  updated_at = NOW();

INSERT INTO public.qualidade_regulatoria_premio_edicoes
  (ano, status, data_publicacao_metodologia, data_coleta_inicio, data_coleta_fim, data_resultado, vencedoras, metadata, updated_at)
VALUES
  (
    2026,
    'preliminar',
    DATE '2026-03-15',
    DATE '2026-04-01',
    DATE '2026-09-30',
    DATE '2026-11-15',
    jsonb_build_object('status', 'preliminar', 'fonte', 'base_curada_2026'),
    jsonb_build_object('seed_id', 'qualidade_regulatoria_2026_curated_v1'),
    NOW()
  )
ON CONFLICT (ano) DO UPDATE SET
  status = EXCLUDED.status,
  data_publicacao_metodologia = EXCLUDED.data_publicacao_metodologia,
  data_coleta_inicio = EXCLUDED.data_coleta_inicio,
  data_coleta_fim = EXCLUDED.data_coleta_fim,
  data_resultado = EXCLUDED.data_resultado,
  vencedoras = EXCLUDED.vencedoras,
  metadata = qualidade_regulatoria_premio_edicoes.metadata || EXCLUDED.metadata,
  updated_at = NOW();

NOTIFY pgrst, 'reload schema';

COMMIT;
