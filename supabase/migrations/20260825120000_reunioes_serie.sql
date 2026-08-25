-- ═══════════════════════════════════════════════════════════════════════════
-- Etapa 66 — a SÉRIE da reunião entra na identidade
--
-- PROBLEMA MEDIDO: os contadores de reunião são INDEPENDENTES por série, e a chave natural de
-- `reunioes` não tem série:
--     UNIQUE (agencia_id, data_reuniao, COALESCE(numero_reuniao, ''))
-- Prova no corpus de certificação: a 1.024ª Reunião de Diretoria (RD) e a 264ª Reunião
-- Deliberativa Eletrônica (RDE) da ANTT compartilham a data 2026-01-19. Uma RD nº 264 e uma RDE
-- nº 264 na MESMA data colidiriam numa linha só — e a monotonicidade da série (a 83ª não pode
-- preceder a 81ª) é impossível de checar sem separar as séries.
--
-- SEGUNDO DEFEITO, no backfill da 20260705121000: o `CASE` mapeia
--     WHEN 'ordinaria' ... WHEN 'extraordinaria' ... ELSE NULL
-- e `antt_reunioes_coletadas.tipo` aceita TRÊS valores. Toda RDE chegou em `reunioes` com
-- `tipo_reuniao IS NULL`, e o `ON CONFLICT ... COALESCE(reunioes.tipo_reuniao, EXCLUDED...)`
-- preservou o NULL. É o único ponto do sistema onde a distinção RDE é descartada POR CÓDIGO.
--
-- DEPLOY ANTES DA MIGRATION É SEGURO: `ensureReuniao` sonda a coluna e a omite do payload
-- enquanto ela não existir (mesma disciplina de `votos-write.ts`).
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

-- ── 1. A coluna ────────────────────────────────────────────────────────────
ALTER TABLE public.reunioes
  ADD COLUMN IF NOT EXISTS serie VARCHAR(30);

COMMENT ON COLUMN public.reunioes.serie IS
  'Série da reunião: ordinaria | extraordinaria | eletronica | administrativa. Os contadores são '
  'INDEPENDENTES por série — a 1.024ª RD e a 264ª RDE da ANTT coexistem na mesma data. Difere de '
  '`tipo_reuniao`, que só admite duas cardinalidades e por isso colapsa RD e RDE em "Ordinaria".';

-- ── 2. Backfill da série, das fontes que JÁ carregam a distinção ───────────
-- (a) `antt_reunioes_coletadas.tipo` tem os três valores (CHECK da migration 009).
UPDATE public.reunioes r
   SET serie = arc.tipo
  FROM public.antt_reunioes_coletadas arc
 WHERE r.serie IS NULL
   AND arc.tipo IS NOT NULL
   AND r.metadata ->> 'antt_reuniao_coletada_id' = arc.id::text;

-- (b) o TÍTULO, que o backfill anterior já gravou em `metadata`.
UPDATE public.reunioes
   SET serie = CASE
     WHEN metadata ->> 'titulo' ILIKE '%eletr%'        THEN 'eletronica'
     WHEN metadata ->> 'titulo' ILIKE '%extraordin%'   THEN 'extraordinaria'
     WHEN metadata ->> 'titulo' ILIKE '%administrativ%' THEN 'administrativa'
     WHEN metadata ->> 'titulo' ILIKE '%reuni%'        THEN 'ordinaria'
     ELSE NULL
   END
 WHERE serie IS NULL
   AND metadata ->> 'titulo' IS NOT NULL;

-- (c) último recurso: o próprio `tipo_reuniao`, que distingue ao menos a extraordinária.
UPDATE public.reunioes
   SET serie = CASE
     WHEN tipo_reuniao = 'Extraordinaria' THEN 'extraordinaria'
     WHEN tipo_reuniao = 'Ordinaria'      THEN 'ordinaria'
     ELSE NULL
   END
 WHERE serie IS NULL
   AND tipo_reuniao IS NOT NULL;

-- ── 3. Reparar o `tipo_reuniao` que o CASE do backfill anterior zerou ──────
-- Toda RDE virou NULL ali. Agora que a série existe, o tipo pode ser derivado dela sem perder a
-- distinção (a série continua sendo a fonte fina; `tipo_reuniao` fica para os consumidores antigos).
UPDATE public.reunioes
   SET tipo_reuniao = CASE serie
     WHEN 'extraordinaria' THEN 'Extraordinaria'
     ELSE 'Ordinaria'
   END
 WHERE tipo_reuniao IS NULL
   AND serie IS NOT NULL;

-- ── 4. A chave natural passa a incluir a série ────────────────────────────
-- ⚠️ A nova chave é MAIS PERMISSIVA que a antiga (acrescenta uma coluna), então não há risco de
-- violação ao criá-la: tudo que era único continua único. A ordem — criar a nova ANTES de derrubar
-- a antiga — mantém a proteção contra corrida em qualquer instante.
CREATE UNIQUE INDEX IF NOT EXISTS idx_reunioes_chave_natural_serie
  ON public.reunioes (agencia_id, data_reuniao, COALESCE(numero_reuniao, ''), COALESCE(serie, ''));

DROP INDEX IF EXISTS public.idx_reunioes_chave_natural;

-- ── 5. Índice para a consulta de monotonicidade ───────────────────────────
-- `checarSerieMonotonica` busca as vizinhas da MESMA agência e série, ordenadas por data.
CREATE INDEX IF NOT EXISTS idx_reunioes_serie_data
  ON public.reunioes (agencia_id, serie, data_reuniao DESC);

NOTIFY pgrst, 'reload schema';

COMMIT;

-- ═══════════════════════════════════════════════════════════════════════════
-- CONFERÊNCIA (rodar DEPOIS, fora da transação):
--
--   SELECT a.sigla, r.serie, count(*), min(r.data_reuniao), max(r.data_reuniao)
--     FROM public.reunioes r LEFT JOIN public.agencias a ON a.id = r.agencia_id
--    GROUP BY 1,2 ORDER BY 1,2;
--
-- Esperado: a ANTT aparece com `ordinaria` E `eletronica` separadas. Se `eletronica` vier zerada,
-- o backfill não achou a origem — conferir `reunioes.metadata` e `antt_reunioes_coletadas`.
--
--   -- Colisões que a chave antiga teria juntado numa linha só:
--   SELECT agencia_id, data_reuniao, numero_reuniao, count(DISTINCT serie)
--     FROM public.reunioes GROUP BY 1,2,3 HAVING count(DISTINCT serie) > 1;
-- ═══════════════════════════════════════════════════════════════════════════
