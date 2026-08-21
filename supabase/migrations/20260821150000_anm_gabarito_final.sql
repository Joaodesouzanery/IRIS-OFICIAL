-- ANM — ajuste FINAL do gabarito (ago/2026), após a limpeza v2 (20260821140000).
--
-- Conferência do usuário mostrou: (a) Roger Romão Cabral e Tasso Mendonça Junior (reais, do
-- gabarito) ficaram REJEITADOS — foram rejeitados por limpeza anterior e a v2 só rejeita, nunca
-- re-aprova; (b) os rejeitados-prosa PRECISAM SUMIR: o nome real "Luiz Paniago Neves" casa
-- score 1.0 com o lixo "Luiz Paniago Neves Para A Relatoria…" e a antirrecontaminação do código
-- bloquearia a recriação do diretor real para sempre. Deletar é seguro: os votos e mandatos dos
-- rejeitados já foram apagados pela v2, e todas as FKs sobre diretores são CASCADE/SET NULL.
-- O código atual (gate estrito de nome) impede que a prosa renasça.
-- Idempotente; autocontida (sem temp objects); aplicar no SQL Editor.

BEGIN;

-- 1 · RE-APROVA os diretores ANM do gabarito que estavam rejeitados (Roger, Tasso e qualquer
--     outro nome real da lista).
UPDATE public.diretores d
SET review_status = 'aprovado', needs_review = FALSE, updated_at = NOW()
FROM public.agencias ag
WHERE ag.id = d.agencia_id
  AND ag.sigla = 'ANM'
  AND d.review_status = 'rejeitado'
  AND lower(translate(d.nome,
        'ÁÀÂÃÄÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÇáàâãäéèêëíìîïóòôõöúùûüç',
        'AAAAAEEEEIIIIOOOOOUUUUCaaaaaeeeeiiiiooooouuuuc')) IN (
    'mauro henrique moreira sousa',
    'caio mario trivellato seabra filho',
    'jose fernando gomes junior',
    'jose fernando de mendonca gomes junior',
    'luiz paniago neves',
    'fabio fernando borges',
    'roger romao cabral',
    'tasso mendonca junior'
  );

-- 2 · DELETA os diretores ANM que restarem rejeitados (é tudo prosa da extração antiga; sem
--     votos/mandatos desde a v2). FKs: votos/mandatos CASCADE, diretor_candidatos SET NULL.
DELETE FROM public.diretores d
USING public.agencias ag
WHERE ag.id = d.agencia_id
  AND ag.sigla = 'ANM'
  AND d.review_status = 'rejeitado';

COMMIT;

NOTIFY pgrst, 'reload schema';

-- ── Conferência (rodar depois) ──────────────────────────────────────────────────────────
-- SELECT d.nome, d.review_status FROM diretores d JOIN agencias a ON a.id=d.agencia_id
--   WHERE a.sigla='ANM' ORDER BY d.review_status, d.nome;
-- Esperado: 5 aprovados (Mauro, Caio Mário, Fábio, Roger, Tasso) e ZERO rejeitados.
-- José Fernando e Luiz Paniago voltam limpos (com votos) após "Rodar tudo" 2×.
