-- Adiciona a data de publicação (DOU/DOE) das deliberações, distinta da data da
-- reunião/deliberação (data_reuniao). Permite separar "quando foi deliberado" de
-- "quando foi publicado". Idempotente.

ALTER TABLE public.deliberacoes
  ADD COLUMN IF NOT EXISTS data_publicacao DATE;

CREATE INDEX IF NOT EXISTS idx_deliberacoes_data_publicacao
  ON public.deliberacoes(data_publicacao);

-- Espelha idx_deliberacoes_area_data: agrupamento/ordenação por agência + publicação.
CREATE INDEX IF NOT EXISTS idx_deliberacoes_agencia_publicacao
  ON public.deliberacoes(agencia_id, data_publicacao);

NOTIFY pgrst, 'reload schema';
