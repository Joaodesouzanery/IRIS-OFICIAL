-- ═══════════════════════════════════════════════════════════════════════════
-- Etapa 19 — Rede de segurança de mandatos a partir de VOTOS.
--
-- Problema: diretores criados pela esteira de candidatos (aprovarCandidato) sem
-- `data_posse` ficam SEM mandato → a inferência de voto por mandato
-- (getActiveDiretoresForVote) fica DESLIGADA para eles (nota "N diretores sem
-- mandato" no painel Completude 2026). As redes anteriores
-- (20260624120000_mandatos_higiene, 20260705122000_mandatos_seed_2026) só cobrem
-- diretores com `data_posse IS NOT NULL`.
--
-- Efeito: para todo diretor que JÁ TEM voto materializado mas NÃO tem mandato,
-- cria um mandato ABERTO a partir da data da 1ª deliberação que ele votou. É a
-- versão em lote do fallback que o candidato-approval.ts passou a fazer no fluxo.
-- Idempotente (só cria onde falta) e forward-only.
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

INSERT INTO public.mandatos (diretor_id, data_inicio, data_fim, cargo, fonte_dado, review_status, lgpd_basis)
SELECT
  d.id,
  MIN(del.data_reuniao)::date AS data_inicio,
  NULL::date AS data_fim,
  d.cargo,
  'automatico',
  'aprovado',
  'public_official_function'
FROM public.diretores d
JOIN public.votos v ON v.diretor_id = d.id
JOIN public.deliberacoes del ON del.id = v.deliberacao_id
WHERE del.data_reuniao IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM public.mandatos m WHERE m.diretor_id = d.id)
GROUP BY d.id, d.cargo;

NOTIFY pgrst, 'reload schema';

COMMIT;
