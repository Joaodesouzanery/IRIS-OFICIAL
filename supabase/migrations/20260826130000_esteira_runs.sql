-- Fase 7 · Commit 9 — `esteira_runs`: a esteira ganha memória da própria execução.
--
-- ═══ O que faltava ═══
--
-- `/api/v1/pipeline/run` era 100% STATELESS: não gravava uma linha sobre si mesmo. Todo o estado
-- do "Rodar tudo" (rodada atual, contadores acumulados, motivo da parada) vivia num `useMutation`
-- do navegador. Fechar a aba não perdia o TRABALHO — cada rodada já commita no banco — mas perdia
-- o laço e qualquer noção de progresso, e era isso que o usuário via como "perde tudo".
--
-- Também não havia LOCK: duas abas abertas (ou o cron somado a uma aba) rodavam a esteira sobre
-- as mesmas linhas ao mesmo tempo, disputando os mesmos documentos.
--
-- Esta tabela espelha `monitoramento_runs`, o padrão já usado no projeto para execução por site —
-- inclusive o reaper de linha `running` órfã, que aqui é indispensável: o SIGKILL de 60s do Hobby
-- mata a função sem rodar `finally`, então uma execução PODE morrer sem fechar a própria linha.
--
-- Idempotente e forward-only. O código degrada sem ela: sem a tabela, a esteira volta a se
-- comportar exatamente como hoje (roda, não lembra) — deploy antes da migration é seguro.

BEGIN;

CREATE TABLE IF NOT EXISTS esteira_runs (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  status          VARCHAR(20) NOT NULL DEFAULT 'running'
                    CHECK (status IN ('running', 'concluido', 'abortado', 'erro')),
  -- Quem pediu: a tela ('ui') ou o agendador ('cron'). Sem isto não dá para ler o histórico.
  origem          VARCHAR(20) NOT NULL DEFAULT 'ui',
  rodadas         INTEGER NOT NULL DEFAULT 0,
  -- Contadores acumulados da execução inteira (materializados, extraídos, aprovados…).
  contadores      JSONB NOT NULL DEFAULT '{}'::jsonb,
  -- Alimento do DISJUNTOR: passos que terminaram bem × passos que falharam, na execução inteira.
  passos_ok       INTEGER NOT NULL DEFAULT 0,
  passos_erro     INTEGER NOT NULL DEFAULT 0,
  motivo_parada   TEXT,
  iniciado_em     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  atualizado_em   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  concluido_em    TIMESTAMPTZ
);

-- Busca da execução ATIVA (o caminho quente: toda rodada e todo poll da tela passam por aqui).
CREATE INDEX IF NOT EXISTS idx_esteira_runs_ativa
  ON esteira_runs (atualizado_em DESC)
  WHERE status = 'running';

-- Histórico recente, para a tela mostrar o desfecho da última execução.
CREATE INDEX IF NOT EXISTS idx_esteira_runs_recentes
  ON esteira_runs (iniciado_em DESC);

ALTER TABLE esteira_runs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS esteira_runs_service_role_all ON esteira_runs;
CREATE POLICY esteira_runs_service_role_all ON esteira_runs
  FOR ALL TO service_role USING (true) WITH CHECK (true);

COMMIT;

NOTIFY pgrst, 'reload schema';
