-- Cria mandatos faltantes a partir das datas já cadastradas no diretor
-- (data_posse / data_fim_mandato). Sem isso, getActiveDiretoresForVote descarta
-- diretores sem linha em `mandatos` quando outros diretores têm mandato na data.
-- Idempotente: só insere para diretores que ainda não têm nenhum mandato.

BEGIN;

INSERT INTO public.mandatos (diretor_id, data_inicio, data_fim, cargo, fonte_dado)
SELECT d.id, d.data_posse, d.data_fim_mandato, d.cargo, 'automatico'
FROM public.diretores d
WHERE d.data_posse IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM public.mandatos m WHERE m.diretor_id = d.id
  );

NOTIFY pgrst, 'reload schema';

COMMIT;
