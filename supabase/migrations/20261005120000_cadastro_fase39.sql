-- ════════════════════════════════════════════════════════════════════════════════════════════════
-- Fase 39 — limpezas de cadastro da ANTT (o SQL B de 04/10 confirmou: os mandatos estão CERTOS).
--
--   1. Alex Antonio de Azevedo Cruz e Guilherme Theo Rodrigues da Rocha Sampaio têm, cada um, uma
--      segunda linha de mandato `automatico` (2025-09-16) conflitando com a `verificado`. O motor de
--      voto já ignora `automatico`, mas a linha confunde a leitura humana e contava como "tem
--      mandato" em dois painéis. Sai — com RASTRO em `diretores.metadata`
--      (`mandatos_automaticos_removidos_fase39`), e só se o diretor tiver um mandato verificado.
--   2. Marcelo Cardoso Fonseca: `situacao = 'designado'` (substituto, Portaria DG 190/2026).
--   3. Amaral Filho e Rafael Vitale: `situacao = 'inativo'`, SEM mandato inventado (decisão do
--      usuário). Só se continuarem sem nenhum mandato — se alguém cadastrar datas antes, nada muda.
--
-- Idempotente (rode quantas vezes quiser: a 2ª vez não acha nada), forward-only, sem função
-- auxiliar, sem tabela temporária. Nenhum voto é tocado.
-- ════════════════════════════════════════════════════════════════════════════════════════════════

BEGIN;

-- 1a. O RASTRO primeiro: as linhas que vão sair ficam guardadas no próprio diretor.
UPDATE public.diretores d
SET metadata = COALESCE(d.metadata, '{}'::jsonb)
  || jsonb_build_object('mandatos_automaticos_removidos_fase39', x.linhas)
FROM (
  SELECT m.diretor_id,
         jsonb_agg(jsonb_build_object('data_inicio', m.data_inicio, 'data_fim', m.data_fim,
                                      'fonte_dado', m.fonte_dado, 'removido_em', now()::date)) AS linhas
  FROM public.mandatos m
  JOIN public.diretores di ON di.id = m.diretor_id
  JOIN public.agencias a ON a.id = di.agencia_id
  WHERE a.sigla = 'ANTT'
    AND m.fonte_dado = 'automatico'
    AND di.nome IN ('Alex Antonio de Azevedo Cruz', 'Guilherme Theo Rodrigues da Rocha Sampaio')
    AND EXISTS (SELECT 1 FROM public.mandatos v WHERE v.diretor_id = m.diretor_id AND v.fonte_dado = 'verificado')
  GROUP BY m.diretor_id
) x
WHERE d.id = x.diretor_id;

-- 1b. Depois, a remoção — com as MESMAS condições.
DELETE FROM public.mandatos m
USING public.diretores di, public.agencias a
WHERE di.id = m.diretor_id
  AND a.id = di.agencia_id
  AND a.sigla = 'ANTT'
  AND m.fonte_dado = 'automatico'
  AND di.nome IN ('Alex Antonio de Azevedo Cruz', 'Guilherme Theo Rodrigues da Rocha Sampaio')
  AND EXISTS (SELECT 1 FROM public.mandatos v WHERE v.diretor_id = m.diretor_id AND v.fonte_dado = 'verificado');

-- 2. Marcelo Cardoso Fonseca é DESIGNADO (substituto), não titular.
UPDATE public.diretores d
SET situacao = 'designado'
FROM public.agencias a
WHERE a.id = d.agencia_id AND a.sigla = 'ANTT'
  AND d.nome = 'Marcelo Cardoso Fonseca'
  AND d.situacao IS DISTINCT FROM 'designado';

-- 3. Ex-diretores sem data conhecida: inativos, sem mandato inventado.
UPDATE public.diretores d
SET situacao = 'inativo'
FROM public.agencias a
WHERE a.id = d.agencia_id AND a.sigla = 'ANTT'
  AND d.nome IN ('Amaral Filho', 'Rafael Vitale Rodrigues')
  AND d.situacao IS DISTINCT FROM 'inativo'
  AND NOT EXISTS (SELECT 1 FROM public.mandatos m WHERE m.diretor_id = d.id);

COMMIT;

NOTIFY pgrst, 'reload schema';

-- Conferência (rode depois; esperado: 0 automáticos dos dois, Marcelo designado, os dois inativos):
-- SELECT d.nome, d.situacao, m.data_inicio, m.data_fim, m.fonte_dado,
--        d.metadata->'mandatos_automaticos_removidos_fase39' AS rastro
-- FROM diretores d JOIN agencias a ON a.id = d.agencia_id LEFT JOIN mandatos m ON m.diretor_id = d.id
-- WHERE a.sigla = 'ANTT' AND d.nome IN ('Alex Antonio de Azevedo Cruz','Guilherme Theo Rodrigues da Rocha Sampaio',
--   'Marcelo Cardoso Fonseca','Amaral Filho','Rafael Vitale Rodrigues')
-- ORDER BY d.nome, m.data_inicio;
