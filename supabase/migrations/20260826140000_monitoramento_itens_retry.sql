-- Fase 8 — retry com backoff para itens que morreram por falha de REDE.
--
-- ═══ O furo ═══
-- `enqueue-pdfs` marca o item como 'ignorado' após 3 falhas de download, e o re-crawl NÃO o
-- ressuscita: na colisão de hash_item (23505), `monitoring-runner` só atualiza `last_seen_at`.
-- Se o portal da agência ficar fora do ar durante as tentativas, aquela ata está perdida para
-- sempre — mesmo com o portal de volta no dia seguinte.
--
-- ═══ Por que COLUNAS, e não `metadata` ═══
-- Duas armadilhas mapeadas na análise de risco:
--   1. `last_seen_at` NÃO serve de relógio: ele é bumpado a cada re-crawl que vê o link (e o crawl
--      diário vê), então "agora - last_seen_at > X" nunca vence justamente no caso que importa.
--   2. `metadata` é SOBRESCRITO inteiro por `tryAutoEnqueueMonitoredDocument`
--      (monitoring-runner.ts) — um contador guardado ali se perde sem aviso.
-- Além disso, um predicado JSONB (`metadata->>proxima_tentativa_em <= agora`) avalia NULL para
-- toda linha que não tem a chave, e NULL não satisfaz `<=`: o passivo JÁ arquivado — o problema
-- que este conserto existe para resolver — ficaria permanentemente fora do retry.
--
-- ═══ O que NÃO muda ═══
-- O item continua com status 'ignorado'. Revivê-lo para 'novo' corromperia três contadores que
-- hoje significam "descoberto e NUNCA tentado" (completude-2026, saude-dados, cobertura-documentos)
-- — eles passariam a somar item que já foi tentado e falhou. Quem decide a elegibilidade é a
-- consulta de retry, não o status.
--
-- Idempotente e forward-only. O código degrada sem ela: sem as colunas, o retry simplesmente não
-- acontece e a esteira se comporta como hoje.

BEGIN;

ALTER TABLE monitoramento_itens
  ADD COLUMN IF NOT EXISTS tentativas INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS proxima_tentativa_em TIMESTAMPTZ;

-- Índice do caminho quente: a consulta de retry filtra por status + prazo vencido.
CREATE INDEX IF NOT EXISTS idx_monitoramento_itens_retry
  ON monitoramento_itens (proxima_tentativa_em)
  WHERE status = 'ignorado';

-- Backfill do PASSIVO: os itens que já estão arquivados por falha de rede não têm carimbo e, sem
-- isto, nunca entrariam no retry — o conserto nasceria sem efeito sobre o problema que motivou.
-- `tentativas` volta a 1 (e não ao total gasto) de propósito: o contador antigo foi queimado em
-- SEGUNDOS dentro de uma única rodada (o item ficava em 'novo' entre as falhas e era re-selecionado
-- pela chamada seguinte do mesmo laço), então ele nunca representou "3 dias de tentativa".
UPDATE monitoramento_itens
   SET proxima_tentativa_em = NOW(),
       tentativas = 1
 WHERE status = 'ignorado'
   AND proxima_tentativa_em IS NULL
   AND metadata->>'enqueue_motivo' = 'download_falhou';

COMMIT;

NOTIFY pgrst, 'reload schema';
