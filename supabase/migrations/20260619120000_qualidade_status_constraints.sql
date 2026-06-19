-- Estende os CHECKs de status da Qualidade Regulatória para suportar:
--  - auto-validação de evidências de alta confiança (status_revisao = 'em_revisao')
--  - classificação de falhas de coleta (status = 'falha_rede' | 'falha_conteudo')
-- Mantém os valores antigos para compatibilidade com linhas já existentes.

-- Evidências: permitir 'em_revisao' (e alinhar com o conjunto de avaliações).
ALTER TABLE public.qualidade_regulatoria_evidencias
  DROP CONSTRAINT IF EXISTS qualidade_regulatoria_evidencias_status_revisao_check;

ALTER TABLE public.qualidade_regulatoria_evidencias
  ADD CONSTRAINT qualidade_regulatoria_evidencias_status_revisao_check
  CHECK (status_revisao IN ('pendente', 'em_revisao', 'validada', 'rejeitada', 'validado', 'rejeitado', 'preliminar'));

-- Coletas: permitir classificação de falha de rede x falha de conteúdo.
ALTER TABLE public.qualidade_regulatoria_coletas
  DROP CONSTRAINT IF EXISTS qualidade_regulatoria_coletas_status_check;

ALTER TABLE public.qualidade_regulatoria_coletas
  ADD CONSTRAINT qualidade_regulatoria_coletas_status_check
  CHECK (status IN ('pendente', 'sucesso', 'falha', 'restrito', 'parcial', 'falha_rede', 'falha_conteudo'));
