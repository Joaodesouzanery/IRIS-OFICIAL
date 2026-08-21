-- Limpeza RESIDUAL da ANM — v2 (ago/2026).
--
-- A 20260821130000 usava TEMP TABLE + função pg_temp, que NÃO sobrevivem no SQL Editor do
-- Supabase (pooler em modo transação → "relation anm_gabarito does not exist"). Esta versão é
-- autocontida: a allow-list vai INLINE (VALUES já normalizados em minúsculas/sem acento) em
-- cada comando. Mesma lógica; idempotente; aplicar no SQL Editor (a 130000 não aplicou nada).
--
-- Gabarito (colegiado ANM público + ex-diretores reais do seed 20260705122000). Os votos dos
-- rejeitados SÃO APAGADOS — eram fabricados por retroativo/inferência, nunca lidos de voto real.

BEGIN;

-- 1 · Rejeita todo aprovado ANM FORA do gabarito e sem selo verificado/seed.
UPDATE public.diretores d
SET review_status = 'rejeitado', needs_review = TRUE, updated_at = NOW()
FROM public.agencias ag
WHERE ag.id = d.agencia_id
  AND ag.sigla = 'ANM'
  AND d.review_status = 'aprovado'
  AND COALESCE(d.fonte_dado, 'manual') <> 'verificado'
  AND COALESCE(d.metadata ->> 'seed', '') = ''
  AND lower(translate(d.nome,
        'ÁÀÂÃÄÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÇáàâãäéèêëíìîïóòôõöúùûüç',
        'AAAAAEEEEIIIIOOOOOUUUUCaaaaaeeeeiiiiooooouuuuc')) NOT IN (
    'mauro henrique moreira sousa',
    'caio mario trivellato seabra filho',
    'jose fernando gomes junior',
    'jose fernando de mendonca gomes junior',
    'luiz paniago neves',
    'fabio fernando borges',
    'roger romao cabral',
    'tasso mendonca junior'
  );

-- 2 · Apaga os VOTOS fabricados dos rejeitados ANM.
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

-- 4 · Cartões pendentes cujo nome (normalizado) é de rejeitado da mesma agência.
UPDATE public.diretor_candidatos c
SET review_status = 'rejeitado', reviewed_at = NOW()
WHERE c.review_status = 'pendente'
  AND EXISTS (
    SELECT 1 FROM public.diretores d
    WHERE d.agencia_id = c.agencia_id
      AND d.review_status = 'rejeitado'
      AND lower(translate(d.nome,
            'ÁÀÂÃÄÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÇáàâãäéèêëíìîïóòôõöúùûüç',
            'AAAAAEEEEIIIIOOOOOUUUUCaaaaaeeeeiiiiooooouuuuc'))
        = lower(translate(c.nome_detectado,
            'ÁÀÂÃÄÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÇáàâãäéèêëíìîïóòôõöúùûüç',
            'AAAAAEEEEIIIIOOOOOUUUUCaaaaaeeeeiiiiooooouuuuc'))
  );

COMMIT;

NOTIFY pgrst, 'reload schema';

-- ── Conferência (rodar depois) ──────────────────────────────────────────────────────────
-- SELECT d.nome, d.review_status FROM diretores d JOIN agencias a ON a.id=d.agencia_id
--   WHERE a.sigla='ANM' ORDER BY d.review_status, d.nome;
-- Esperado: aprovados = só os nomes do gabarito (5-8).
