-- Limpeza RESIDUAL da ANM (ago/2026) — segunda passada.
--
-- A 20260821120000 preservava quem tinha voto — mas a esteira FABRICAVA voto para os
-- falsos (retroativos nominais por nome + inferência com cadastro sem filtro), então ~12
-- "diretores" (signatários/servidores citados em atas) sobreviveram com votos inventados.
-- O código desta versão fecha as portas (filtro review_status em toda carga de cadastro;
-- mandato automático explícito e fora do roster; nome rejeitado não renasce).
--
-- Esta migration usa ALLOW-LIST explícita: o colegiado da ANM é público e pequeno.
-- ⚠️ ANTES DE APLICAR: rode o SQL de diagnóstico (entregue no chat) e confira se algum
-- nome fora da lista abaixo é um diretor REAL (ex-diretor antigo) — se for, adicione-o
-- à lista. Os votos dos rejeitados SÃO APAGADOS (eram fabricados).
-- Idempotente; aplicar no SQL Editor.

BEGIN;

-- 0 · Allow-list (seed oficial + ex-diretores reais documentados no seed 20260705122000).
--     Match por lower + sem acento (translate) — não depende da extensão unaccent.
CREATE TEMP TABLE anm_gabarito(nome text) ON COMMIT DROP;
INSERT INTO anm_gabarito VALUES
  ('Mauro Henrique Moreira Sousa'),
  ('Caio Mario Trivellato Seabra Filho'),
  ('Jose Fernando Gomes Junior'),
  ('Jose Fernando de Mendonca Gomes Junior'),
  ('Luiz Paniago Neves'),
  ('Fabio Fernando Borges'),
  ('Roger Romao Cabral'),
  ('Tasso Mendonca Junior');

CREATE OR REPLACE FUNCTION pg_temp.norm_nome(t text) RETURNS text AS $$
  SELECT lower(translate(t,
    'ÁÀÂÃÄÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÇáàâãäéèêëíìîïóòôõöúùûüç',
    'AAAAAEEEEIIIIOOOOOUUUUCaaaaaeeeeiiiiooooouuuuc'));
$$ LANGUAGE sql IMMUTABLE;

-- 1 · Rejeita todo aprovado ANM FORA do gabarito e sem selo verificado.
UPDATE public.diretores d
SET review_status = 'rejeitado', needs_review = TRUE, updated_at = NOW()
FROM public.agencias ag
WHERE ag.id = d.agencia_id
  AND ag.sigla = 'ANM'
  AND d.review_status = 'aprovado'
  AND COALESCE(d.fonte_dado, 'manual') <> 'verificado'
  AND COALESCE(d.metadata ->> 'seed', '') = ''
  AND NOT EXISTS (
    SELECT 1 FROM anm_gabarito g
    WHERE pg_temp.norm_nome(g.nome) = pg_temp.norm_nome(d.nome)
  );

-- 2 · Apaga os VOTOS fabricados dos rejeitados ANM (a esteira os inventou por retroativo/
--     inferência — nenhum vem de leitura de voto real de diretor).
DELETE FROM public.votos v
USING public.diretores d, public.agencias ag
WHERE v.diretor_id = d.id
  AND d.agencia_id = ag.id
  AND ag.sigla = 'ANM'
  AND d.review_status = 'rejeitado';

-- 3 · Apaga os mandatos NÃO-verificados dos rejeitados ANM.
DELETE FROM public.mandatos m
USING public.diretores d, public.agencias ag
WHERE m.diretor_id = d.id
  AND d.agencia_id = ag.id
  AND ag.sigla = 'ANM'
  AND d.review_status = 'rejeitado'
  AND COALESCE(m.fonte_dado, 'manual') <> 'verificado'
  AND m.ato_nomeacao IS NULL;

-- 4 · Cartões pendentes cujo nome é de rejeitado.
UPDATE public.diretor_candidatos c
SET review_status = 'rejeitado', reviewed_at = NOW()
WHERE c.review_status = 'pendente'
  AND EXISTS (
    SELECT 1 FROM public.diretores d
    WHERE d.agencia_id = c.agencia_id
      AND d.review_status = 'rejeitado'
      AND pg_temp.norm_nome(d.nome) = pg_temp.norm_nome(c.nome_detectado)
  );

COMMIT;

NOTIFY pgrst, 'reload schema';

-- ── Conferência (rodar depois) ──────────────────────────────────────────────────────────
-- SELECT d.nome, d.review_status FROM diretores d JOIN agencias a ON a.id=d.agencia_id
--   WHERE a.sigla='ANM' ORDER BY d.review_status, d.nome;
-- Esperado: aprovados = só os nomes do gabarito (5-8).
