-- Índice composto para o par mais filtrado da plataforma: toda listagem/dashboard corta
-- por agencia_id e ordena/filtra por data_reuniao. Existiam índices SEPARADOS (agencia,
-- data) mas não o composto — o Postgres escolhia um e varria o resto.
-- Idempotente; aplicar no SQL Editor do Supabase.

BEGIN;

CREATE INDEX IF NOT EXISTS idx_deliberacoes_agencia_data
  ON public.deliberacoes (agencia_id, data_reuniao DESC);

-- Já que estamos aqui: o funil da esteira consulta documentos_regulatorios por status
-- toda rodada (review_pending/queued/failed) — barato de indexar, uso constante.
CREATE INDEX IF NOT EXISTS idx_documentos_regulatorios_status
  ON public.documentos_regulatorios (status);

COMMIT;

NOTIFY pgrst, 'reload schema';
