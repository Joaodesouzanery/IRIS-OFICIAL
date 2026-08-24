-- ─────────────────────────────────────────────────────────────────────────────
-- Etapa 59 — PROVENIÊNCIA do voto e JUÍZO da deliberação.
--
-- POR QUE: hoje o único qualificador de um voto é o booleano `is_nominal`. Ele não distingue
-- inferido-por-unanimidade de inferido-por-decisão e, pior, a CORREÇÃO HUMANA do revisor era
-- gravada como "inferida" — o dado de maior qualidade do sistema virava indistinguível de um chute
-- do algoritmo. Sem essa separação, "convergência ≈ 100%" é tautologia: voto inferido é, por
-- construção, não-divergente.
--
-- SEGURANÇA DE DEPLOY: todas as colunas são NULLABLE e sem DEFAULT. O código já roda em produção
-- SEM elas (`src/lib/server/votos-write.ts` remove do payload a coluna que o banco ainda não tem e
-- retenta), então aplicar esta migration DEPOIS do deploy é seguro — e, aplicada, a instância passa
-- a gravar `proveniencia` em até 60 s, sem redeploy.
--
-- Idempotente. Aplicar no SQL Editor do Supabase.
-- ─────────────────────────────────────────────────────────────────────────────

BEGIN;

-- ─── 1. votos: qualificadores do voto ────────────────────────────────────────
ALTER TABLE public.votos ADD COLUMN IF NOT EXISTS proveniencia    TEXT;
ALTER TABLE public.votos ADD COLUMN IF NOT EXISTS motivo_nao_voto TEXT;
ALTER TABLE public.votos ADD COLUMN IF NOT EXISTS fonte_presenca  TEXT;
ALTER TABLE public.votos ADD COLUMN IF NOT EXISTS papel           TEXT;
ALTER TABLE public.votos ADD COLUMN IF NOT EXISTS confianca_match NUMERIC(4,3);
-- NULLABLE de propósito: NULL = LEGADO (não sabemos), nunca FALSE. Gravar `false` no acervo
-- existente afirmaria que nenhum voto antigo foi proferido em autos — uma afirmação que não temos
-- como sustentar, e que a etapa61 leria como fato ao montar a série temporal do diretor.
ALTER TABLE public.votos ADD COLUMN IF NOT EXISTS voto_em_autos   BOOLEAN;

COMMENT ON COLUMN public.votos.proveniencia IS
  'De onde veio o voto: revisao_humana (pessoa corrigiu na tela) | nominal (lido do documento) | inferido_unanimidade | inferido_decisao. NULL = legado.';
COMMENT ON COLUMN public.votos.motivo_nao_voto IS
  'Por que não votou, quando tipo_voto = Ausente. Separa ausência FÍSICA de impedimento/suspeição — o impedido sai do denominador DELE, não do colegiado.';
COMMENT ON COLUMN public.votos.voto_em_autos IS
  'TRUE = voto proferido em sessão ANTERIOR e apenas registrado nesta ata. NULL = legado (desconhecido), nunca FALSE.';

-- CHECKs por NOME PRÓPRIO e recriados a cada aplicação (a skill iris-migrations é explícita:
-- nunca confiar em nome de constraint herdado). `IS NULL OR` em todos: coluna nullable com CHECK
-- estrito recusaria toda linha legada.
ALTER TABLE public.votos DROP CONSTRAINT IF EXISTS votos_proveniencia_check;
ALTER TABLE public.votos ADD CONSTRAINT votos_proveniencia_check
  CHECK (proveniencia IS NULL OR proveniencia IN
    ('revisao_humana', 'nominal', 'inferido_unanimidade', 'inferido_decisao'));

ALTER TABLE public.votos DROP CONSTRAINT IF EXISTS votos_motivo_nao_voto_check;
ALTER TABLE public.votos ADD CONSTRAINT votos_motivo_nao_voto_check
  CHECK (motivo_nao_voto IS NULL OR motivo_nao_voto IN
    ('ausencia', 'impedimento', 'suspeicao', 'vista', 'sobrestamento', 'vacancia'));

ALTER TABLE public.votos DROP CONSTRAINT IF EXISTS votos_fonte_presenca_check;
ALTER TABLE public.votos ADD CONSTRAINT votos_fonte_presenca_check
  CHECK (fonte_presenca IS NULL OR fonte_presenca IN ('documento', 'mandato'));

ALTER TABLE public.votos DROP CONSTRAINT IF EXISTS votos_confianca_match_check;
ALTER TABLE public.votos ADD CONSTRAINT votos_confianca_match_check
  CHECK (confianca_match IS NULL OR (confianca_match >= 0 AND confianca_match <= 1));

-- NENHUM check cross-column (ex.: "proveniencia='nominal' ⇒ is_nominal=TRUE"). Enquanto o
-- write-path não propagar erro em 100% dos caminhos, um cross-check transformaria uma
-- inconsistência de dado numa FALHA DE GRAVAÇÃO — e votos parariam de entrar por causa de um
-- rótulo. Consistência aqui é trabalho da suíte de checagem (etapa63), não do banco.

-- ─── 2. deliberacoes: juízo de mérito × admissibilidade ──────────────────────
ALTER TABLE public.deliberacoes ADD COLUMN IF NOT EXISTS juizo TEXT;

COMMENT ON COLUMN public.deliberacoes.juizo IS
  'merito (padrão) | admissibilidade (NÃO CONHECER). Admissibilidade sai dos DOIS lados da taxa de deferimento: não é jurisprudência, é prazo processual.';

ALTER TABLE public.deliberacoes DROP CONSTRAINT IF EXISTS deliberacoes_juizo_check;
ALTER TABLE public.deliberacoes ADD CONSTRAINT deliberacoes_juizo_check
  CHECK (juizo IS NULL OR juizo IN ('merito', 'admissibilidade'));

-- ─── 3. Backfill — SÓ o determinístico ───────────────────────────────────────
-- `is_nominal = TRUE` ⇒ o voto foi LIDO do documento: 'nominal' é fato, não inferência.
UPDATE public.votos
   SET proveniencia = 'nominal'
 WHERE proveniencia IS NULL AND is_nominal = TRUE;

-- `is_nominal = FALSE` fica NULL de propósito. O acervo não registra se a inferência veio de
-- unanimidade textual ou da direção da decisão; escolher um dos dois seria FABRICAR proveniência —
-- exatamente o tipo de invenção que esta etapa existe para acabar.

-- `juizo` a partir do que a EXTRAÇÃO já gravou no JSON (etapa54). Aqui o backfill é legítimo
-- porque o valor foi LIDO DO DOCUMENTO, não inferido. Sem ele, todo documento ingerido entre o
-- deploy da Fase 1 e esta migration cairia silenciosamente no balde 'decidido' da etapa60.
UPDATE public.deliberacoes
   SET juizo = raw_extraction->>'juizo'
 WHERE juizo IS NULL
   AND raw_extraction->>'juizo' IN ('merito', 'admissibilidade');

-- ─── 4. Índices ──────────────────────────────────────────────────────────────
-- Parcial na fatia NOMINAL: é ela que as métricas de comportamento passam a usar por padrão
-- (etapa61), e ela é minoria do acervo — um índice parcial custa pouco e serve exatamente a
-- consulta que vai crescer.
CREATE INDEX IF NOT EXISTS idx_votos_proveniencia_nominal
  ON public.votos (diretor_id, deliberacao_id)
  WHERE proveniencia IN ('nominal', 'revisao_humana');

-- Fatia de NÃO-VOTO: alimenta o denominador POR DIRETOR (impedido/vista saem do denominador dele).
CREATE INDEX IF NOT EXISTS idx_votos_motivo_nao_voto
  ON public.votos (diretor_id)
  WHERE motivo_nao_voto IS NOT NULL;

-- Admissibilidade é filtro de denominador em várias rotas; parcial porque é minoria.
CREATE INDEX IF NOT EXISTS idx_deliberacoes_juizo_admissibilidade
  ON public.deliberacoes (agencia_id, data_reuniao)
  WHERE juizo = 'admissibilidade';

COMMIT;

NOTIFY pgrst, 'reload schema';

-- ─────────────────────────────────────────────────────────────────────────────
-- CONFERÊNCIA (rodar depois; não faz parte da migration):
--
--   SELECT proveniencia, COUNT(*) FROM public.votos GROUP BY 1 ORDER BY 2 DESC;
--     -- esperado: 'nominal' = nº de votos com is_nominal, NULL = o resto. Nenhum outro valor
--     -- ainda, porque 'revisao_humana' e os 'inferido_*' só aparecem em gravações NOVAS.
--
--   SELECT juizo, COUNT(*) FROM public.deliberacoes GROUP BY 1 ORDER BY 2 DESC;
--     -- 'admissibilidade' só aparece em documentos ingeridos depois da Fase 1.
-- ─────────────────────────────────────────────────────────────────────────────
