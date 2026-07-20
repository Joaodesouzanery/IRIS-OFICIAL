-- Alarga o CHECK de regulatory_news_collection_runs.status para aceitar 'empty'.
--
-- BUG (QA jul/2026): a tabela foi criada com CHECK (status IN ('ok','error'))
-- (20260605181500_news_module_repair.sql), mas o coletor grava status por FONTE que
-- pode ser 'empty' (fonte respondeu, 0 item novo — news-collector.ts) e recordCollectionRuns
-- insere esse status CRU. O insert é EM LOTE, então qualquer rodada com >=1 fonte 'empty'
-- viola o CHECK e o insert inteiro falha; o erro é só console.warn (coletar/route.ts) →
-- o histórico de execuções fica ~vazio → o health nunca enxerga 'error' real (active_error
-- nunca dispara) → o aviso "sem notícia nova" não distingue fonte quieta de coletor quebrado.
--
-- Idempotente e forward-only. Deploy-antes seguro: o código já grava 'empty' e já engole o
-- erro do insert; esta migration só PASSA a gravar o histórico corretamente. Não confia no
-- nome da constraint (varre pg_constraint — regra do projeto p/ constraints de produção que
-- podem ter nome diferente do repo). Guardada por existência da tabela.

BEGIN;

DO $$
DECLARE v_con TEXT;
BEGIN
  IF to_regclass('public.regulatory_news_collection_runs') IS NULL THEN
    RETURN;
  END IF;

  -- Derruba TODO CHECK que envolva a coluna status (nome pode divergir do repo).
  FOR v_con IN
    SELECT con.conname
    FROM pg_constraint con
    JOIN pg_class rel ON rel.oid = con.conrelid
    JOIN pg_namespace nsp ON nsp.oid = rel.relnamespace
    WHERE nsp.nspname = 'public'
      AND rel.relname = 'regulatory_news_collection_runs'
      AND con.contype = 'c'
      AND EXISTS (
        SELECT 1 FROM unnest(con.conkey) k
        JOIN pg_attribute a ON a.attrelid = rel.oid AND a.attnum = k
        WHERE a.attname = 'status'
      )
  LOOP
    EXECUTE format('ALTER TABLE public.regulatory_news_collection_runs DROP CONSTRAINT %I', v_con);
  END LOOP;

  -- Recria com o conjunto alargado. Nome fixo; como o loop acima já removeu qualquer
  -- CHECK de status (inclusive este, numa 2ª execução), o ADD nunca colide → idempotente.
  EXECUTE $ddl$
    ALTER TABLE public.regulatory_news_collection_runs
      ADD CONSTRAINT regulatory_news_collection_runs_status_check
      CHECK (status IN ('ok', 'empty', 'error'))
  $ddl$;
END $$;

NOTIFY pgrst, 'reload schema';

COMMIT;
