-- ════════════════════════════════════════════════════════════════════════════════════════════════
-- IMQN rev2022 — a Matriz de Maturidade da Qualidade Normativa como TABELA VERSIONADA (Fase 37).
--
-- Fonte: docs/metodologia/Matriz Qualidade Normativa_rev2022.xlsx (programa INFRA Competitividade).
-- GERADO a partir de src/lib/server/imqn/rev2022.json — o MESMO dado que o código usa; a etapa226/227
-- reprova se o SQL e o JSON divergirem. Não edite um sem o outro.
--
-- O que entra:
--   · qualidade_imqn_matrizes             — a versão (rev2022), valores de nível 1 / 0,7 / 0,35 / 0
--   · qualidade_imqn_dimensoes            — 6 dimensões, peso em pontos, BASE LEGAL por dimensão
--   · qualidade_imqn_criterios            — 10 critérios (AIR e ARR com Capacitação/Metodologia/Processo
--                                           30/35/35) e a verificabilidade (publica/parcial/interna)
--   · qualidade_imqn_condicoes            — as 73 condições I–IV, texto da planilha, verificabilidade
--   · qualidade_imqn_condicoes_avaliadas  — a avaliação POR CONDIÇÃO (atendida? evidência? validada?),
--                                           que é o que alimenta a "nota comprovada"
--
-- ⚠️ REVISAR ANTES DE APLICAR (o usuário é o portão da qualidade do dado):
--   1. A base legal está marcada base_legal_conferida = FALSE em todas as dimensões. A da Participação
--      Social foi ALTERADA em relação ao texto herdado do módulo ("Lei 13.848/2019, arts. 19 a 25")
--      para "arts. 9º a 11" (consulta pública no art. 9º, audiência no art. 10). O artigo da ARR
--      (Decreto 10.411/2020, art. 12) é herdado e não foi conferido.
--   2. A verificabilidade de cada condição é CLASSIFICAÇÃO DO IRIS (proposta), não da planilha.
--
-- Idempotente (rode quantas vezes quiser), forward-only, sem função auxiliar, sem tabela temporária,
-- nenhuma instrução depende de objeto criado por outra fora desta transação. O código degrada sem
-- ela: sem a tabela de avaliações por condição, a nota comprovada é 0 — honesto, não quebrado.
-- ════════════════════════════════════════════════════════════════════════════════════════════════

BEGIN;

CREATE TABLE IF NOT EXISTS public.qualidade_imqn_matrizes (
  versao                          TEXT PRIMARY KEY,
  titulo                          TEXT NOT NULL,
  fonte                           TEXT NOT NULL,
  valores_nivel                   JSONB NOT NULL,
  classificacao_verificabilidade  TEXT,
  criado_em                       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.qualidade_imqn_dimensoes (
  versao                TEXT NOT NULL REFERENCES public.qualidade_imqn_matrizes(versao) ON DELETE CASCADE,
  id                    SMALLINT NOT NULL,
  codigo                TEXT NOT NULL,
  nome                  TEXT NOT NULL,
  peso                  NUMERIC(6,2) NOT NULL,
  base_legal            TEXT NOT NULL,
  base_legal_conferida  BOOLEAN NOT NULL DEFAULT FALSE,
  nota_base_legal       TEXT,
  PRIMARY KEY (versao, id)
);

CREATE TABLE IF NOT EXISTS public.qualidade_imqn_criterios (
  versao            TEXT NOT NULL,
  codigo            TEXT NOT NULL,
  dimensao_id       SMALLINT NOT NULL,
  nome              TEXT NOT NULL,
  peso_na_dimensao  NUMERIC(6,4) NOT NULL,
  coluna_planilha   TEXT,
  verificabilidade  TEXT NOT NULL CHECK (verificabilidade IN ('publica','parcial','interna')),
  resumo_niveis     JSONB NOT NULL,
  PRIMARY KEY (versao, codigo),
  FOREIGN KEY (versao, dimensao_id) REFERENCES public.qualidade_imqn_dimensoes(versao, id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS public.qualidade_imqn_condicoes (
  versao            TEXT NOT NULL,
  id                TEXT NOT NULL,
  criterio_codigo   TEXT NOT NULL,
  nivel             TEXT NOT NULL CHECK (nivel IN ('inicial','gerenciado','melhoria_continua')),
  ordem             TEXT NOT NULL,
  texto             TEXT NOT NULL,
  verificabilidade  TEXT NOT NULL CHECK (verificabilidade IN ('publica','interna')),
  motivo            TEXT,
  PRIMARY KEY (versao, id),
  FOREIGN KEY (versao, criterio_codigo) REFERENCES public.qualidade_imqn_criterios(versao, codigo) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS public.qualidade_imqn_condicoes_avaliadas (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agencia_sigla   TEXT NOT NULL,
  ano             INTEGER NOT NULL,
  versao          TEXT NOT NULL,
  condicao_id     TEXT NOT NULL,
  atendida        BOOLEAN NOT NULL,
  evidencia_url   TEXT,
  observacao      TEXT,
  status_revisao  TEXT NOT NULL DEFAULT 'pendente'
                  CHECK (status_revisao IN ('preliminar','pendente','em_revisao','validado','rejeitado')),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (agencia_sigla, ano, versao, condicao_id),
  FOREIGN KEY (versao, condicao_id) REFERENCES public.qualidade_imqn_condicoes(versao, id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS qualidade_imqn_cond_aval_ano_idx
  ON public.qualidade_imqn_condicoes_avaliadas (ano, agencia_sigla);

INSERT INTO public.qualidade_imqn_matrizes (versao, titulo, fonte, valores_nivel, classificacao_verificabilidade)
VALUES ('rev2022', 'Matriz de Avaliação da Maturidade da Qualidade Normativa (IMQN)', 'Programa INFRA Competitividade — docs/metodologia/Matriz Qualidade Normativa_rev2022.xlsx', '{"melhoria_continua": 1.0, "gerenciado": 0.7, "inicial": 0.35, "inexistente": 0.0}'::jsonb, 'IRIS, 2026-10-04 — proposta para revisão do usuário: ''publica'' = comprovável por documento/dado que o órgão publica; ''interna'' = só com dado interno.')
ON CONFLICT (versao) DO UPDATE SET titulo = EXCLUDED.titulo, fonte = EXCLUDED.fonte,
  valores_nivel = EXCLUDED.valores_nivel, classificacao_verificabilidade = EXCLUDED.classificacao_verificabilidade;

INSERT INTO public.qualidade_imqn_dimensoes (versao, id, codigo, nome, peso, base_legal, base_legal_conferida, nota_base_legal)
VALUES
  ('rev2022', 1, 'AIR', 'Análise de Impacto Regulatório (AIR)', 25.0, 'Decreto 10.411/2020; Lei 13.874/2019, art. 5º; Lei 13.848/2019, art. 6º', FALSE, NULL),
  ('rev2022', 2, 'PS', 'Participação Social', 15.0, 'Lei 13.848/2019, arts. 9º a 11; Lei 13.874/2019; Decreto 10.411/2020', FALSE, 'ALTERADO em relação ao texto herdado do módulo (''Lei 13.848/2019, arts. 19 a 25''): a consulta pública está no art. 9º e a audiência pública no art. 10 da Lei 13.848/2019. Conferir antes de publicar.'),
  ('rev2022', 3, 'ESTOQUE', 'Gestão de Estoque Regulatório', 20.0, 'Decreto 10.139/2019, art. 19; Lei 13.874/2019', FALSE, NULL),
  ('rev2022', 4, 'AGENDA', 'Agenda Regulatória', 15.0, 'Lei 13.848/2019, art. 21', FALSE, NULL),
  ('rev2022', 5, 'PROCESSO', 'Gestão do Processo Normativo', 10.0, 'Lei 13.848/2019; Decreto 10.411/2020', FALSE, NULL),
  ('rev2022', 6, 'ARR', 'Análise de Resultado Regulatório (ARR)', 15.0, 'Decreto 10.411/2020, art. 12', FALSE, 'Artigo herdado do módulo; conferir o dispositivo exato do Decreto 10.411/2020 que trata da ARR.')
ON CONFLICT (versao, id) DO UPDATE SET codigo = EXCLUDED.codigo, nome = EXCLUDED.nome, peso = EXCLUDED.peso,
  -- ⚠️ base legal CONFERIDA pelo usuário não é sobrescrita por uma reaplicação desta migration.
  base_legal = CASE WHEN qualidade_imqn_dimensoes.base_legal_conferida THEN qualidade_imqn_dimensoes.base_legal ELSE EXCLUDED.base_legal END,
  nota_base_legal = CASE WHEN qualidade_imqn_dimensoes.base_legal_conferida THEN qualidade_imqn_dimensoes.nota_base_legal ELSE EXCLUDED.nota_base_legal END;

INSERT INTO public.qualidade_imqn_criterios (versao, codigo, dimensao_id, nome, peso_na_dimensao, coluna_planilha, verificabilidade, resumo_niveis)
VALUES
  ('rev2022', 'AIR_CAP', 1, 'Capacitação', 0.3, 'C', 'interna', '{"melhoria_continua": "Plano de capacitação em AIR estabelecido e em prática", "gerenciado": "Servidores capacitados em nível introdutório, intermediário e avançado", "inicial": "Pequena quantidade de servidores com capacitação introdutória", "inexistente": "Não há servidores capacitados em AIR no órgão"}'::jsonb),
  ('rev2022', 'AIR_MET', 1, 'Metodologia', 0.35, 'D', 'publica', '{"melhoria_continua": "Critérios objetivos estabelecidos para classificação quanto ao nível de impacto e complexidade das AIRs", "gerenciado": "Há manual instituindo a aplicabilidade institucional da AIR.", "inicial": "AIR institucionalizada conforme Decreto 10.411/2020", "inexistente": "Não há metodologia de AIR estabelecida"}'::jsonb),
  ('rev2022', 'AIR_PROC', 1, 'Processo', 0.35, 'E', 'parcial', '{"melhoria_continua": "AIRs de alto impacto/alta complexidade são submetidas à participação social prévia e posterior", "gerenciado": "AIR é realizada sistematicamente, com participação social posterior", "inicial": "AIR é sempre realizada e a dispensa justificada", "inexistente": "AIR realizada eventualmente"}'::jsonb),
  ('rev2022', 'PS', 2, 'Participação Social', 1.0, 'F', 'parcial', '{"melhoria_continua": "Boas práticas consolidadas no órgão de modo que a efetividade do evento de Participação Social é mensurada.", "gerenciado": "A instituição possui manual de procedimentos e divulga de forma adequada as informações", "inicial": "A instituição atende ao disposto na legislação", "inexistente": "A instituição não atende ao disposto na legislação"}'::jsonb),
  ('rev2022', 'ESTOQUE', 3, 'Gestão de Estoque Regulatório', 1.0, 'G', 'parcial', '{"melhoria_continua": "Processos de gestão de estoque integrados ao planejamento normativo e aos processos de transparência", "gerenciado": "Análise qualitativa dos atos normativos publicados pelo órgão", "inicial": "Levantamento quantitativo dos atos normativos publicados pelo órgão", "inexistente": "Não há levantamento de atos normativos publicados pelo órgão"}'::jsonb),
  ('rev2022', 'AGENDA', 4, 'Agenda Regulatória', 1.0, 'H', 'parcial', '{"melhoria_continua": "Processos da Agenda Regulatória integrados ao planejamento e à gestão do órgão", "gerenciado": "Elaboração, atualização e acompanhamento da Agenda Regulatória institucionalizados", "inicial": "Existe Agenda Regulatória no órgão", "inexistente": "Não há agenda regulatória"}'::jsonb),
  ('rev2022', 'PROCESSO', 5, 'Gestão do Processo Normativo', 1.0, 'I', 'parcial', '{"melhoria_continua": "Indicadores de processo normativo monitorados, e resultados utilizados para a melhoria contínua do processo, integrando o processo normativo à gestão estratégica da instituição", "gerenciado": "As intervenções de participação social estão claramente inseridas no processo", "inicial": "Há documento que institucionaliza o processo normativo", "inexistente": "Não é padronizado"}'::jsonb),
  ('rev2022', 'ARR_CAP', 6, 'Capacitação', 0.3, 'J', 'interna', '{"melhoria_continua": "Plano de capacitação em ARR estabelecido e em prática, com 75% dos servidores capacitados", "gerenciado": "50% dos servidores capacitados", "inicial": "25% dos servidores capacitados", "inexistente": "Não há servidores capacitados em ARR no órgão"}'::jsonb),
  ('rev2022', 'ARR_MET', 6, 'Metodologia', 0.35, 'K', 'publica', '{"melhoria_continua": "Agenda de ARR construída com participação social e integrada com a Agenda Regulatória", "gerenciado": "ARR institucionalizada no órgão", "inicial": "Agenda de ARR é publicada", "inexistente": "Não há metodologia de ARR estabelecida"}'::jsonb),
  ('rev2022', 'ARR_PROC', 6, 'Processo', 0.35, 'L', 'parcial', '{"melhoria_continua": "A execução da Agenda de ARR é monitorada e há processo contínuo de avaliação e melhoria do processo de elaboração de ARR", "gerenciado": "ARRs de alto impacto/alta complexidade foram submetidas a participação social.", "inicial": "ARRs são publicadas e acessíveis ao público", "inexistente": "ARR é realizada esporadicamente"}'::jsonb)
ON CONFLICT (versao, codigo) DO UPDATE SET dimensao_id = EXCLUDED.dimensao_id, nome = EXCLUDED.nome,
  peso_na_dimensao = EXCLUDED.peso_na_dimensao, coluna_planilha = EXCLUDED.coluna_planilha,
  verificabilidade = EXCLUDED.verificabilidade, resumo_niveis = EXCLUDED.resumo_niveis;

INSERT INTO public.qualidade_imqn_condicoes (versao, id, criterio_codigo, nivel, ordem, texto, verificabilidade, motivo)
VALUES
  ('rev2022', 'AIR_CAP.INI.I', 'AIR_CAP', 'inicial', 'I', 'I - Capacitações em AIR não estão institucionalizadas;', 'interna', 'percentual e nível de capacitação dos servidores é dado de gestão de pessoas, não publicado'),
  ('rev2022', 'AIR_CAP.INI.II', 'AIR_CAP', 'inicial', 'II', 'II - de 50% a 74% dos servidores envolvidos em elaboração de regulação capacitados em nível básico, ou seja, capazes de reconhecer o objetivo de uma AIR, bem como nomear as etapas de uma AIR e possibilidades de dispensa e não aplicabilidade, nos termos no Decreto nº 10.411, de 30 de junho de2020;', 'interna', 'percentual e nível de capacitação dos servidores é dado de gestão de pessoas, não publicado'),
  ('rev2022', 'AIR_CAP.INI.III', 'AIR_CAP', 'inicial', 'III', 'III – de 25% a 49% dos servidores envolvidos em elaboração de regulação capacitados em nível intermediário, ou seja, capazes de desenvolver as etapas de mapeamento do problema (incluindo atores, objetivos e base legal), levantamento de alternativas, análises qualitativas dos impactos das alternativas e elaboração do plano de implementação da alternativa sugerida.', 'interna', 'percentual e nível de capacitação dos servidores é dado de gestão de pessoas, não publicado'),
  ('rev2022', 'AIR_CAP.GER.I', 'AIR_CAP', 'gerenciado', 'I', 'I – Capacitações em AIR estão institucionalizadas, sem um plano formalizado;', 'interna', 'percentual e nível de capacitação dos servidores é dado de gestão de pessoas, não publicado'),
  ('rev2022', 'AIR_CAP.GER.II', 'AIR_CAP', 'gerenciado', 'II', 'II – no mínimo 75% dos servidores envolvidos em elaboração de regulação capacitados em nível básico, ou seja, capazes de reconhecer o objetivo de uma AIR, bem como nomear as etapas de uma AIR e possibilidades de dispensa e não aplicabilidade, nos termos no Decreto nº 10.411, de 2020;', 'interna', 'percentual e nível de capacitação dos servidores é dado de gestão de pessoas, não publicado'),
  ('rev2022', 'AIR_CAP.GER.III', 'AIR_CAP', 'gerenciado', 'III', 'III – de 50% a 74% dos servidores envolvidos em elaboração de regulação capacitados em nível intermediário, ou seja, capazes de desenvolver as etapas de mapeamento do problema (incluindo atores, objetivos e base legal), levantamento de alternativas, análises qualitativas dos impactos das alternativas e elaboração do plano de implementação da alternativa sugerida;', 'interna', 'percentual e nível de capacitação dos servidores é dado de gestão de pessoas, não publicado'),
  ('rev2022', 'AIR_CAP.GER.IV', 'AIR_CAP', 'gerenciado', 'IV', 'IV – de 25% da 49% dos servidores envolvidos em elaboração de regulação capacitados em nível avançado, ou seja, capazes de desenvolver as etapas de mapeamento do problema (incluindo atores, objetivos e base legal), levantamento de alternativas, análises qualitativas e quantitativas dos impactos das alternativas e elaboração do plano de implementação da alternativa sugerida (incluindo avaliação de riscos).', 'interna', 'percentual e nível de capacitação dos servidores é dado de gestão de pessoas, não publicado'),
  ('rev2022', 'AIR_CAP.MC.I', 'AIR_CAP', 'melhoria_continua', 'I', 'I – Plano de capacitação formalizado e em execução, incluindo permanente reciclagem em técnicas de AIR;', 'interna', 'percentual e nível de capacitação dos servidores é dado de gestão de pessoas, não publicado'),
  ('rev2022', 'AIR_CAP.MC.II', 'AIR_CAP', 'melhoria_continua', 'II', 'II – no mínimo 75% dos servidores envolvidos em elaboração de regulação capacitados em nível intermediário, ou seja, capazes de desenvolver as etapas de mapeamento do problema (incluindo atores, objetivos e base legal), levantamento de alternativas, análises qualitativas dos impactos das alternativas e elaboração do plano de implementação da alternativa sugerida;', 'interna', 'percentual e nível de capacitação dos servidores é dado de gestão de pessoas, não publicado'),
  ('rev2022', 'AIR_CAP.MC.III', 'AIR_CAP', 'melhoria_continua', 'III', 'III – no mínimo 50% dos servidores envolvidos em elaboração de regulação capacitados em nível avançado, ou seja, capazes de desenvolver as etapas de mapeamento do problema (incluindo atores, objetivos e base legal), levantamento de alternativas, análises qualitativas e quantitativas dos impactos das alternativas e elaboração do plano de implementação da alternativa sugerida (incluindo avaliação de riscos).', 'interna', 'percentual e nível de capacitação dos servidores é dado de gestão de pessoas, não publicado'),
  ('rev2022', 'AIR_MET.INI.I', 'AIR_MET', 'inicial', 'I', 'I - houve a publicação de normativo interno dispondo sobre a aplicação da AIR na instituição, conforme Decreto nº 10.411, de 2020.', 'publica', NULL),
  ('rev2022', 'AIR_MET.GER.I', 'AIR_MET', 'gerenciado', 'I', 'I – Existência de manual ou ato normativo interno instituindo a aplicabilidade institucional da AIR;', 'publica', NULL),
  ('rev2022', 'AIR_MET.GER.II', 'AIR_MET', 'gerenciado', 'II', 'II – Existência de manual ou ato normativo dispondo sobre a participação social posterior relativa à AIR.', 'publica', NULL),
  ('rev2022', 'AIR_MET.MC.I', 'AIR_MET', 'melhoria_continua', 'I', 'I – Critérios objetivos estabelecidos para classificação quanto ao nível de impacto e complexidade da AIR;', 'publica', NULL),
  ('rev2022', 'AIR_MET.MC.II', 'AIR_MET', 'melhoria_continua', 'II', 'II – Metodologia contempla participação social prévia e posterior à elaboração da AIR, conforme complexidade do ato.', 'publica', NULL),
  ('rev2022', 'AIR_PROC.INI.I', 'AIR_PROC', 'inicial', 'I', 'I – AIR é sempre realizada e a dispensa justificada, conforme critérios objetivos estabelecidos, conforme Decreto nº 10.411, de 2020;', 'publica', NULL),
  ('rev2022', 'AIR_PROC.INI.II', 'AIR_PROC', 'inicial', 'II', 'II – Todas as AIRs são publicadas e acessíveis ao público na internet;', 'publica', NULL),
  ('rev2022', 'AIR_PROC.INI.III', 'AIR_PROC', 'inicial', 'III', 'III – Participação Social é realizada, conforme Decreto nº 10.411, de 2020.', 'publica', NULL),
  ('rev2022', 'AIR_PROC.GER.I', 'AIR_PROC', 'gerenciado', 'I', 'I – Todas as AIRs são sempre realizadas conforme manual ou ato normativo interno e publicadas e acessíveis ao público na internet;', 'publica', NULL),
  ('rev2022', 'AIR_PROC.GER.II', 'AIR_PROC', 'gerenciado', 'II', 'II – O processo de elaboração de AIR está mapeado na instituição;', 'interna', 'mapeamento do processo de elaboração de AIR é documento interno'),
  ('rev2022', 'AIR_PROC.GER.III', 'AIR_PROC', 'gerenciado', 'III', 'III – As AIRs são objeto de participação social posterior, conforme decisão técnica.', 'publica', NULL),
  ('rev2022', 'AIR_PROC.MC.I', 'AIR_PROC', 'melhoria_continua', 'I', 'I – Há processo contínuo de avaliação e melhoria do processo de elaboração de AIR;', 'interna', 'avaliação e melhoria contínua do processo é atividade interna'),
  ('rev2022', 'AIR_PROC.MC.II', 'AIR_PROC', 'melhoria_continua', 'II', 'II – Existência de instrumento de avaliação de qualidade das AIRs realizadas;', 'interna', 'instrumento de avaliação de qualidade das AIRs não é publicado de forma padronizada'),
  ('rev2022', 'AIR_PROC.MC.III', 'AIR_PROC', 'melhoria_continua', 'III', 'III – As AIRs de alto impacto/alta complexidade são submetidas à participação social prévia e posterior.', 'publica', NULL),
  ('rev2022', 'PS.INI.I', 'PS', 'inicial', 'I', 'I - existe dispositivo interno orientando a participação social conforme disposto na legislação específica vigente, tais como as Leis nº 13.848, de 25 de junho de 2019 e nº 13.874, de 20 de setembro de 2019 e o Decreto nº 10.411, de 2020.', 'publica', NULL),
  ('rev2022', 'PS.GER.I', 'PS', 'gerenciado', 'I', 'I – Existência de manual ou ato normativo interno instituindo metodologia e procedimento de participação social;', 'publica', NULL),
  ('rev2022', 'PS.GER.II', 'PS', 'gerenciado', 'II', 'II – Os relatórios da Ouvidoria e os relatórios do portal consumidor.gov são utilizados para subsidiar as decisões regulatórias;', 'interna', 'o USO de relatórios de ouvidoria/consumidor.gov para decidir não aparece em documento público'),
  ('rev2022', 'PS.GER.III', 'PS', 'gerenciado', 'III', 'III – Todas as informações relativas aos processos em andamento são divulgadas no portal do órgão e/ou plataforma Participa Mais Brasil;', 'publica', NULL),
  ('rev2022', 'PS.GER.IV', 'PS', 'gerenciado', 'IV', 'IV – A efetividade do evento de participação social é avaliada de forma intuitiva.', 'interna', 'avaliação ''intuitiva'' da efetividade é, por definição, não documentada'),
  ('rev2022', 'PS.MC.I', 'PS', 'melhoria_continua', 'I', 'I – A instituição realiza eventos de participação social para a construção do conhecimento sobre dada matéria e para o desenvolvimento de propostas;', 'publica', NULL),
  ('rev2022', 'PS.MC.II', 'PS', 'melhoria_continua', 'II', 'II – Relatórios da Ouvidoria, relatórios do portal consumidor.gov, pesquisas de satisfação e dados de atendimento são utilizados para subsidiar as decisões regulatórias;', 'interna', 'o USO de relatórios de ouvidoria/consumidor.gov para decidir não aparece em documento público'),
  ('rev2022', 'PS.MC.III', 'PS', 'melhoria_continua', 'III', 'III – Todos os instrumentos, processos e relatórios contendo as contribuições analisadas são divulgados no portal do órgão e/ou plataforma Participa Mais Brasil;', 'publica', NULL),
  ('rev2022', 'PS.MC.IV', 'PS', 'melhoria_continua', 'IV', 'IV – A efetividade do evento de participação social é mensurada, conforme metodologia instituída.', 'interna', 'mensuração da efetividade da participação social é interna'),
  ('rev2022', 'ESTOQUE.INI.I', 'ESTOQUE', 'inicial', 'I', 'I – Normas publicadas e disponíveis de maneira sistematizada para consulta pública na internet;', 'publica', NULL),
  ('rev2022', 'ESTOQUE.INI.II', 'ESTOQUE', 'inicial', 'II', 'II – Foi realizado levantamento quantitativo de todas as normas do órgão.', 'publica', NULL),
  ('rev2022', 'ESTOQUE.GER.I', 'ESTOQUE', 'gerenciado', 'I', 'I – Normas publicadas e disponíveis de maneira sistematizada para consulta pública no portal gov.br;', 'publica', NULL),
  ('rev2022', 'ESTOQUE.GER.II', 'ESTOQUE', 'gerenciado', 'II', 'II – Foi realizado levantamento quantitativo de todas as normas do órgão, bem como análise qualitativa, indexação e classificação por tema;', 'publica', NULL),
  ('rev2022', 'ESTOQUE.GER.III', 'ESTOQUE', 'gerenciado', 'III', 'III – Para toda a nova norma de alto impacto/alta complexidade foi estimado o fardo regulatório; e', 'publica', NULL),
  ('rev2022', 'ESTOQUE.GER.IV', 'ESTOQUE', 'gerenciado', 'IV', 'IV – Existe manutenção da consolidação normativa, conforme art. 19 do Decreto nº 10.139, de 28 de novembro de 2019.', 'publica', NULL),
  ('rev2022', 'ESTOQUE.MC.I', 'ESTOQUE', 'melhoria_continua', 'I', 'I – As alterações do estoque regulatório da instituição são priorizadas por meio de uma agenda regulatória;', 'publica', NULL),
  ('rev2022', 'ESTOQUE.MC.II', 'ESTOQUE', 'melhoria_continua', 'II', 'II – Todas as novas normas passam pela análise de consolidação e compatibilização de normas vigentes.', 'interna', 'a análise de consolidação/compatibilização de CADA nova norma é etapa interna do processo'),
  ('rev2022', 'AGENDA.INI.I', 'AGENDA', 'inicial', 'I', 'I – Os temas da agenda regulatória são elencados e priorizados pelos gestores da agência;', 'publica', NULL),
  ('rev2022', 'AGENDA.INI.II', 'AGENDA', 'inicial', 'II', 'II – É avaliada a aderência da proposta de Agenda às políticas públicas.', 'publica', NULL),
  ('rev2022', 'AGENDA.GER.I', 'AGENDA', 'gerenciado', 'I', 'I – A elaboração da agenda regulatória tem ampla participação social, a qual é analisada, porém não respondida e divulgada;', 'publica', NULL),
  ('rev2022', 'AGENDA.GER.II', 'AGENDA', 'gerenciado', 'II', 'II – O Ministério Setorial é oficiado, por meio do Ministro e da Secretaria Finalística, quando da abertura do processo de participação social. O Ministério deve oficiar as agências reguladoras vinculadas, visando a integração das agendas;', 'interna', 'ofício ao Ministério setorial é correspondência interna'),
  ('rev2022', 'AGENDA.GER.III', 'AGENDA', 'gerenciado', 'III', 'III – Cumprimento de 50% a 79% da Agenda Regulatória;', 'publica', NULL),
  ('rev2022', 'AGENDA.GER.IV', 'AGENDA', 'gerenciado', 'IV', 'IV – A execução da Agenda Regulatória é periodicamente monitorada.', 'interna', 'monitoramento SEM divulgação (a divulgação é a condição do nível acima)'),
  ('rev2022', 'AGENDA.MC.I', 'AGENDA', 'melhoria_continua', 'I', 'I – A elaboração da agenda regulatória tem ampla participação social, a qual é analisada, respondida e divulgada;', 'publica', NULL),
  ('rev2022', 'AGENDA.MC.II', 'AGENDA', 'melhoria_continua', 'II', 'II – Os projetos da Agenda Regulatória estão aderentes ao planejamento estratégico vigente e estão correlacionados ao Plano de Gestão Anual;', 'publica', NULL),
  ('rev2022', 'AGENDA.MC.III', 'AGENDA', 'melhoria_continua', 'III', 'III - Cumprimento de, no mínimo, 80% da Agenda Regulatória;', 'publica', NULL),
  ('rev2022', 'AGENDA.MC.IV', 'AGENDA', 'melhoria_continua', 'IV', 'IV – A execução da Agenda Regulatória é periodicamente monitorada e divulgada.', 'publica', NULL),
  ('rev2022', 'PROCESSO.INI.I', 'PROCESSO', 'inicial', 'I', 'I – O fluxo do processo normativo é formalizado de forma bem definida e clara;', 'publica', NULL),
  ('rev2022', 'PROCESSO.INI.II', 'PROCESSO', 'inicial', 'II', 'II – As instâncias de aprovação estabelecidas são claras e formalizadas.', 'publica', NULL),
  ('rev2022', 'PROCESSO.GER.I', 'PROCESSO', 'gerenciado', 'I', 'I - as intervenções de participação social estão claramente inseridas no processo.', 'publica', NULL),
  ('rev2022', 'PROCESSO.MC.I', 'PROCESSO', 'melhoria_continua', 'I', 'I – Indicadores de processo normativo estabelecidos e monitorados;', 'interna', 'indicadores do processo normativo são de gestão interna'),
  ('rev2022', 'PROCESSO.MC.II', 'PROCESSO', 'melhoria_continua', 'II', 'II – Há processo contínuo de avaliação e melhoria do processo normativo, utilizando o resultado dos indicadores.', 'interna', 'melhoria contínua com base em indicadores é atividade interna'),
  ('rev2022', 'ARR_CAP.INI.I', 'ARR_CAP', 'inicial', 'I', 'I – Capacitações não estão institucionalizadas;', 'interna', 'percentual de servidores capacitados em ARR é dado de gestão de pessoas, não publicado'),
  ('rev2022', 'ARR_CAP.INI.II', 'ARR_CAP', 'inicial', 'II', 'II – de 25% a 49% dos servidores envolvidos em elaboração de regulação capacitados em ARR.', 'interna', 'percentual de servidores capacitados em ARR é dado de gestão de pessoas, não publicado'),
  ('rev2022', 'ARR_CAP.GER.I', 'ARR_CAP', 'gerenciado', 'I', 'I – Capacitações institucionalizadas, sem um plano formalizado;', 'interna', 'percentual de servidores capacitados em ARR é dado de gestão de pessoas, não publicado'),
  ('rev2022', 'ARR_CAP.GER.II', 'ARR_CAP', 'gerenciado', 'II', 'II – de 50% a 74% dos servidores envolvidos em elaboração de regulação capacitados em ARR;', 'interna', 'percentual de servidores capacitados em ARR é dado de gestão de pessoas, não publicado'),
  ('rev2022', 'ARR_CAP.MC.I', 'ARR_CAP', 'melhoria_continua', 'I', 'I – Plano de capacitação formalizado e em execução, incluindo permanente reciclagem em ARR;', 'interna', 'percentual de servidores capacitados em ARR é dado de gestão de pessoas, não publicado'),
  ('rev2022', 'ARR_CAP.MC.II', 'ARR_CAP', 'melhoria_continua', 'II', 'II – No mínimo, 75% dos servidores envolvidos em elaboração de regulação capacitados em ARR.', 'interna', 'percentual de servidores capacitados em ARR é dado de gestão de pessoas, não publicado'),
  ('rev2022', 'ARR_MET.INI.I', 'ARR_MET', 'inicial', 'I', 'I - existe Agenda de ARR, conforme determinado no Decreto nº 10.411, de 2020.', 'publica', NULL),
  ('rev2022', 'ARR_MET.GER.I', 'ARR_MET', 'gerenciado', 'I', 'I – Existência de manual ou ato normativo instituindo a aplicabilidade de ARR no órgão;', 'publica', NULL),
  ('rev2022', 'ARR_MET.GER.II', 'ARR_MET', 'gerenciado', 'II', 'II – Metodologia de elaboração da Agenda de ARR contempla participação social.', 'publica', NULL),
  ('rev2022', 'ARR_MET.MC.I', 'ARR_MET', 'melhoria_continua', 'I', 'I – Metodologia de elaboração de ARR contempla a participação social, conforme complexidade do ato;', 'publica', NULL),
  ('rev2022', 'ARR_MET.MC.II', 'ARR_MET', 'melhoria_continua', 'II', 'II – Existência de Agenda de ARR integrada com a Agenda Regulatória.', 'publica', NULL),
  ('rev2022', 'ARR_PROC.INI.I', 'ARR_PROC', 'inicial', 'I', 'I – Todas as ARRs são publicadas e acessíveis ao público na internet;', 'publica', NULL),
  ('rev2022', 'ARR_PROC.INI.II', 'ARR_PROC', 'inicial', 'II', 'II – A agenda de ARR está publicada no site do órgão.', 'publica', NULL),
  ('rev2022', 'ARR_PROC.GER.I', 'ARR_PROC', 'gerenciado', 'I', 'I – ARR é realizada conforme manual ou ato normativo;', 'interna', 'a conformidade da ARR ao manual não é verificável só pelo documento publicado'),
  ('rev2022', 'ARR_PROC.GER.II', 'ARR_PROC', 'gerenciado', 'II', 'II – ARRs de alto impacto/alta complexidade foram submetidas à participação social.', 'publica', NULL),
  ('rev2022', 'ARR_PROC.MC.I', 'ARR_PROC', 'melhoria_continua', 'I', 'I – Há processo contínuo de avaliação e melhoria do processo de elaboração de ARR;', 'interna', 'avaliação e melhoria contínua do processo de ARR é atividade interna'),
  ('rev2022', 'ARR_PROC.MC.II', 'ARR_PROC', 'melhoria_continua', 'II', 'II – A execução da Agenda de ARR é periodicamente monitorada e divulgada.', 'publica', NULL)
ON CONFLICT (versao, id) DO UPDATE SET criterio_codigo = EXCLUDED.criterio_codigo, nivel = EXCLUDED.nivel,
  ordem = EXCLUDED.ordem, texto = EXCLUDED.texto, verificabilidade = EXCLUDED.verificabilidade, motivo = EXCLUDED.motivo;

-- RLS no padrão do projeto: o servidor opera via service_role; a chave anon não lê nada.
ALTER TABLE public.qualidade_imqn_matrizes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.qualidade_imqn_dimensoes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.qualidade_imqn_criterios ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.qualidade_imqn_condicoes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.qualidade_imqn_condicoes_avaliadas ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS qualidade_imqn_matrizes_service_role_all ON public.qualidade_imqn_matrizes;
CREATE POLICY qualidade_imqn_matrizes_service_role_all ON public.qualidade_imqn_matrizes FOR ALL TO service_role USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS qualidade_imqn_dimensoes_service_role_all ON public.qualidade_imqn_dimensoes;
CREATE POLICY qualidade_imqn_dimensoes_service_role_all ON public.qualidade_imqn_dimensoes FOR ALL TO service_role USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS qualidade_imqn_criterios_service_role_all ON public.qualidade_imqn_criterios;
CREATE POLICY qualidade_imqn_criterios_service_role_all ON public.qualidade_imqn_criterios FOR ALL TO service_role USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS qualidade_imqn_condicoes_service_role_all ON public.qualidade_imqn_condicoes;
CREATE POLICY qualidade_imqn_condicoes_service_role_all ON public.qualidade_imqn_condicoes FOR ALL TO service_role USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS qualidade_imqn_condicoes_avaliadas_service_role_all ON public.qualidade_imqn_condicoes_avaliadas;
CREATE POLICY qualidade_imqn_condicoes_avaliadas_service_role_all ON public.qualidade_imqn_condicoes_avaliadas FOR ALL TO service_role USING (true) WITH CHECK (true);

NOTIFY pgrst, 'reload schema';

COMMIT;
