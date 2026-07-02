-- Etapa 6 — Substitui os 10 critérios de Qualidade Regulatória pelas 6 dimensões da
-- Matriz de Avaliação da Maturidade da Qualidade Normativa (IMQN, programa INFRA
-- Competitividade) e alarga o CHECK de `nivel` para os 4 níveis IMQN.
-- Idempotente (safe re-run). Aplicar no SQL Editor do Supabase.

BEGIN;

-- 1) Arquiva as avaliações dos 10 critérios antigos e limpa a tabela para a nova matriz.
--    Roda a parte destrutiva SÓ na primeira aplicação (enquanto ainda há critérios id>6).
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.qualidade_regulatoria_criterios WHERE id > 6) THEN
    CREATE TABLE IF NOT EXISTS public.qualidade_regulatoria_avaliacoes_arquivo
      (LIKE public.qualidade_regulatoria_avaliacoes);
    INSERT INTO public.qualidade_regulatoria_avaliacoes_arquivo
      SELECT * FROM public.qualidade_regulatoria_avaliacoes;
    DELETE FROM public.qualidade_regulatoria_avaliacoes;
    -- Evidências derivadas/auto atreladas aos ids antigos serão regeneradas pela coleta.
    DELETE FROM public.qualidade_regulatoria_evidencias WHERE origem = 'derivada_dados';
  END IF;
END $$;

-- 2) Alarga o CHECK de `nivel` para os 4 níveis da Matriz IMQN.
ALTER TABLE public.qualidade_regulatoria_avaliacoes
  DROP CONSTRAINT IF EXISTS qualidade_regulatoria_avaliacoes_nivel_check;
ALTER TABLE public.qualidade_regulatoria_avaliacoes
  ADD CONSTRAINT qualidade_regulatoria_avaliacoes_nivel_check
  CHECK (nivel IN ('inexistente', 'inicial', 'gerenciado', 'melhoria_continua'));

-- 3) Remove os critérios antigos (7..10; o CASCADE limpa dependências) e grava as 6 dimensões.
DELETE FROM public.qualidade_regulatoria_criterios WHERE id > 6;

INSERT INTO public.qualidade_regulatoria_criterios
  (id, nome, descricao, peso, nivel_prioridade, fontes_coleta, metodo_coleta, obrigatorio_por_lei, base_legal, ordem, ativo)
VALUES
  (1, 'Análise de Impacto Regulatório (AIR)', 'Capacitação, metodologia e processo de AIR: existência, qualidade e publicidade das análises de impacto (problema, alternativas, impactos e participação social).', 0.25, 'alta', ARRAY['site_agencia','qualireg_cgu','diario_oficial'], 'misto', TRUE, 'Decreto 10.411/2020; Lei 13.874/2019, art. 5; Lei 13.848/2019, art. 6', 1, TRUE),
  (2, 'Participação Social', 'Instrumentos, metodologia e efetividade de consultas públicas, audiências e tomadas de subsídios, incluindo devolutiva às contribuições.', 0.15, 'alta', ARRAY['participa_br','site_agencia','relatorios_anuais'], 'scraping', TRUE, 'Lei 13.848/2019, arts. 19 a 25; Decreto 10.411/2020', 2, TRUE),
  (3, 'Gestão de Estoque Regulatório', 'Levantamento, análise, indexação e consolidação do acervo normativo, integrados ao planejamento e à transparência.', 0.20, 'alta', ARRAY['site_agencia','diario_oficial','acervo_normativo'], 'misto', TRUE, 'Decreto 10.139/2019, art. 19; Lei 13.874/2019', 3, TRUE),
  (4, 'Agenda Regulatória', 'Elaboração, priorização, participação social e cumprimento da agenda regulatória, integrada ao planejamento estratégico.', 0.15, 'alta', ARRAY['site_agencia','participa_br','relatorios_anuais'], 'misto', TRUE, 'Lei 13.848/2019, art. 21', 4, TRUE),
  (5, 'Gestão do Processo Normativo', 'Formalização, padronização e monitoramento por indicadores do fluxo de elaboração de atos normativos.', 0.10, 'media', ARRAY['site_agencia','diario_oficial'], 'misto', TRUE, 'Lei 13.848/2019; Decreto 10.411/2020', 5, TRUE),
  (6, 'Análise de Resultado Regulatório (ARR)', 'Capacitação, metodologia e processo de ARR: avaliação dos resultados das normas em vigor, com agenda de ARR e participação social.', 0.15, 'alta', ARRAY['site_agencia','qualireg_cgu','relatorios_arr'], 'misto', TRUE, 'Decreto 10.411/2020, art. 12', 6, TRUE)
ON CONFLICT (id) DO UPDATE SET
  nome = EXCLUDED.nome,
  descricao = EXCLUDED.descricao,
  peso = EXCLUDED.peso,
  nivel_prioridade = EXCLUDED.nivel_prioridade,
  fontes_coleta = EXCLUDED.fontes_coleta,
  metodo_coleta = EXCLUDED.metodo_coleta,
  obrigatorio_por_lei = EXCLUDED.obrigatorio_por_lei,
  base_legal = EXCLUDED.base_legal,
  ordem = EXCLUDED.ordem,
  ativo = TRUE;

-- 4) Atualiza as categorias de prêmio para as 6 dimensões.
DELETE FROM public.qualidade_regulatoria_premio_categorias WHERE id IN ('transparencia', 'inovacao', 'governanca');

INSERT INTO public.qualidade_regulatoria_premio_categorias
  (id, nome, descricao, criterios_avaliados, tipo, ativo)
VALUES
  ('geral', 'Melhor Índice de Maturidade (IMQN)', 'Maior score geral ponderado nas 6 dimensões da Matriz de Qualidade Normativa.', ARRAY[1,2,3,4,5,6], 'geral', TRUE),
  ('air', 'Destaque em Análise de Impacto Regulatório', 'Maturidade em AIR (capacitação, metodologia e processo).', ARRAY[1], 'tematico', TRUE),
  ('participacao', 'Destaque em Participação Social', 'Instrumentos, metodologia e efetividade da participação social.', ARRAY[2], 'tematico', TRUE),
  ('estoque', 'Destaque em Gestão do Estoque Regulatório', 'Levantamento, consolidação e gestão do acervo normativo.', ARRAY[3], 'tematico', TRUE),
  ('agenda_arr', 'Destaque em Agenda Regulatória e ARR', 'Agenda regulatória e análise de resultado regulatório.', ARRAY[4,6], 'tematico', TRUE),
  ('evolucao', 'Prêmio Evolução Regulatória', 'Maior evolução percentual frente à edição anterior.', ARRAY[1,2,3,4,5,6], 'evolucao', TRUE)
ON CONFLICT (id) DO UPDATE SET
  nome = EXCLUDED.nome,
  descricao = EXCLUDED.descricao,
  criterios_avaliados = EXCLUDED.criterios_avaliados,
  tipo = EXCLUDED.tipo,
  ativo = TRUE;

COMMIT;
