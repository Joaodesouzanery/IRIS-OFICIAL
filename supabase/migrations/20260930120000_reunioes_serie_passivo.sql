-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- Fase 36 · Bloco E — preencher `reunioes.serie` no passivo de ANM e ARTESP
--
-- ⚠️ POR QUE ISTO VEM ANTES DA CORREÇÃO DAS 202 DATAS
--
-- O índice único de `reunioes` é
--     (agencia_id, data_reuniao, COALESCE(numero_reuniao,''), COALESCE(serie,''))
-- e toda correção de data passa por `ensureReuniao`. Com a série divergente entre o que está gravado
-- e o que o código deriva, corrigir a data religa a reunião à linha ERRADA ou cria uma duplicata.
-- Por isso a série é pré-requisito, não acabamento.
--
-- ⚠️ E O QUE ELA MEDE, o commit fa69ec8 já consertou NA ORIGEM
--
-- A causa raiz é `reuniao_ordinaria = firstMatch(text, RE_REUNIAO)` devolver só os DÍGITOS: fora da
-- ANTT o título nunca teve a palavra "Ordinária/Extraordinária", então `deriveSerie` dava NULL e toda
-- reunião nova de ANM/ARTESP nascia sem série. Sem o conserto de runtime, esta migration arrumaria o
-- passivo e a reunião seguinte nasceria NULL de novo. Ela só faz sentido DEPOIS daquele deploy.
--
-- ⚠️ ELA NÃO APAGA NADA
--
-- Onde o destino já está ocupado (a linha NULL viraria irmã de uma que já tem aquela série), a
-- migration NÃO mexe e a linha vai para a CONFERÊNCIA. Fundir reunião é decisão do usuário, e
-- `deliberacoes.reuniao_id` aponta para elas — apagar aqui seria escolher por ele, em silêncio.
--
-- ⚠️ A ANTT FICA DE FORA da faixa, e os três motivos estão medidos nas fixtures:
--   · a série Administrativa ocupa 193–199, INTERCALADA com as RD/RDE de 2026;
--   · número lido errado cai abaixo de 200 ("1.024" já virou "024"; o coletor gravou "1" para
--     "1.036ª" até o commit `ec6970c`);
--   · `tipo_reuniao` colapsa RD e RDE em "Ordinaria".
-- Na ANTT, só o TÍTULO decide. Sem título, a linha vai para a conferência.
--
-- ⚠️ NA ARTESP A FAIXA VENCE `tipo_reuniao`: o tipo dela é a primeira palavra
-- "Ordinária/Extraordinária" do texto e erra — a própria ARTESP retificou a 1177ª ("onde se lê
-- Extraordinária, leia-se Ordinária"). As duas séries dela não se cruzam entre 246 e 1146.
--
-- IDEMPOTENTE (só toca `serie IS NULL`, e o WHERE exige destino livre). FORWARD-ONLY. Sem função
-- auxiliar e sem TEMP TABLE — cada instrução carrega o próprio CTE, a lição da v1 da Fase 35.
-- ═══════════════════════════════════════════════════════════════════════════════════════════════

BEGIN;

-- ── 1. Pelo TÍTULO, em qualquer agência — é o que a fonte escreveu ─────────────────────────────
-- Padrões curtos ('%eletr%') casam com e sem acento sem depender da extensão `unaccent`.
WITH evidencia AS (
  SELECT r.id, r.agencia_id, r.data_reuniao, r.numero_reuniao,
         CASE
           WHEN r.metadata ->> 'titulo' ILIKE '%eletr%'         THEN 'eletronica'
           WHEN r.metadata ->> 'titulo' ILIKE '%administrativ%' THEN 'administrativa'
           WHEN r.metadata ->> 'titulo' ILIKE '%extraordin%'    THEN 'extraordinaria'
           WHEN r.metadata ->> 'titulo' ILIKE '%reuni%'         THEN 'ordinaria'
           ELSE NULL
         END AS alvo
    FROM public.reunioes r
   WHERE r.serie IS NULL
)
UPDATE public.reunioes r
   SET serie = e.alvo, updated_at = NOW()
  FROM evidencia e
 WHERE e.id = r.id
   AND e.alvo IS NOT NULL
   -- Destino livre: se já existe irmã com essa série na mesma chave, a linha fica como está e sai
   -- na CONFERÊNCIA ② para você decidir a fusão.
   AND NOT EXISTS (
     SELECT 1 FROM public.reunioes irma
      WHERE irma.id <> r.id
        AND irma.agencia_id = e.agencia_id
        AND irma.data_reuniao = e.data_reuniao
        AND COALESCE(irma.numero_reuniao, '') = COALESCE(e.numero_reuniao, '')
        AND COALESCE(irma.serie, '') = e.alvo
   );

-- ── 2. ARTESP, pela FAIXA — e marcada como INFERIDA ───────────────────────────────────────────
-- ⚠️ A marca importa: a faixa é um palpite defensável, não leitura. Sem `serie_inferida_por`,
-- ninguém distingue depois o que a fonte disse do que nós deduzimos.
WITH evidencia AS (
  SELECT r.id, r.agencia_id, r.data_reuniao, r.numero_reuniao,
         CASE
           WHEN NULLIF(regexp_replace(COALESCE(r.numero_reuniao, ''), '\D', '', 'g'), '')::int >= 1000
             THEN 'ordinaria'
           ELSE 'extraordinaria'
         END AS alvo
    FROM public.reunioes r
    JOIN public.agencias a ON a.id = r.agencia_id
   WHERE r.serie IS NULL
     AND a.sigla = 'ARTESP'
     AND NULLIF(regexp_replace(COALESCE(r.numero_reuniao, ''), '\D', '', 'g'), '') IS NOT NULL
)
UPDATE public.reunioes r
   SET serie = e.alvo,
       metadata = COALESCE(r.metadata, '{}'::jsonb)
                  || jsonb_build_object('serie_inferida_por', 'faixa', 'serie_inferida_em', 'fase36'),
       updated_at = NOW()
  FROM evidencia e
 WHERE e.id = r.id
   AND NOT EXISTS (
     SELECT 1 FROM public.reunioes irma
      WHERE irma.id <> r.id
        AND irma.agencia_id = e.agencia_id
        AND irma.data_reuniao = e.data_reuniao
        AND COALESCE(irma.numero_reuniao, '') = COALESCE(e.numero_reuniao, '')
        AND COALESCE(irma.serie, '') = e.alvo
   );

-- ── 3. ANM (e o que sobrou da ARTESP), pelo `tipo_reuniao` ────────────────────────────────────
-- Na ANM o tipo vem de `extractAnmMeetingMetadata`, que casa `\brop\b` e a palavra por extenso: é
-- leitura do documento. A ANTT continua de fora — só título decide lá.
WITH evidencia AS (
  SELECT r.id, r.agencia_id, r.data_reuniao, r.numero_reuniao,
         CASE
           WHEN lower(COALESCE(r.tipo_reuniao, '')) LIKE 'extraordin%' THEN 'extraordinaria'
           WHEN lower(COALESCE(r.tipo_reuniao, '')) LIKE 'ordin%'      THEN 'ordinaria'
           ELSE NULL
         END AS alvo
    FROM public.reunioes r
    JOIN public.agencias a ON a.id = r.agencia_id
   WHERE r.serie IS NULL
     AND a.sigla <> 'ANTT'
)
UPDATE public.reunioes r
   SET serie = e.alvo, updated_at = NOW()
  FROM evidencia e
 WHERE e.id = r.id
   AND e.alvo IS NOT NULL
   AND NOT EXISTS (
     SELECT 1 FROM public.reunioes irma
      WHERE irma.id <> r.id
        AND irma.agencia_id = e.agencia_id
        AND irma.data_reuniao = e.data_reuniao
        AND COALESCE(irma.numero_reuniao, '') = COALESCE(e.numero_reuniao, '')
        AND COALESCE(irma.serie, '') = e.alvo
   );

NOTIFY pgrst, 'reload schema';

COMMIT;

-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- CONFERÊNCIA — rodar DEPOIS, fora da transação.
--
-- ① A DISTRIBUIÇÃO, com o `salto` de cada balde. ⚠️ ACEITE: `salto <= 400` em TODOS eles
--    (SALTO_MAXIMO_DA_SERIE). Hoje estouram: ANTT 'ordinaria' 938, ARTESP NULL 1.023, ARTESP
--    'extraordinaria' 960 — enquanto estourarem, a detecção de buracos do placar fica MUDA.
--
-- SELECT a.sigla, COALESCE(r.serie,'(nula)') AS serie, COUNT(*) AS linhas,
--        COUNT(*) FILTER (WHERE r.metadata ->> 'serie_inferida_por' = 'faixa') AS por_faixa,
--        MIN(NULLIF(regexp_replace(COALESCE(r.numero_reuniao,''),'\D','','g'),'')::int) AS menor,
--        MAX(NULLIF(regexp_replace(COALESCE(r.numero_reuniao,''),'\D','','g'),'')::int) AS maior,
--        MAX(NULLIF(regexp_replace(COALESCE(r.numero_reuniao,''),'\D','','g'),'')::int)
--          - MIN(NULLIF(regexp_replace(COALESCE(r.numero_reuniao,''),'\D','','g'),'')::int) AS salto
--   FROM public.reunioes r JOIN public.agencias a ON a.id = r.agencia_id
--  WHERE a.sigla IN ('ANTT','ANM','ARTESP')
--  GROUP BY a.sigla, COALESCE(r.serie,'(nula)') ORDER BY a.sigla, serie;
--
-- ② AS QUE A MIGRATION NÃO TOCOU PORQUE O DESTINO ESTAVA OCUPADO — são duplicatas, e a fusão é
--    DECISÃO SUA. A coluna `deliberacoes` diz o que cada linha carrega: fundir a que tem zero é
--    barato; fundir a que tem deliberações exige religar `reuniao_id` antes.
--
-- SELECT a.sigla, r.data_reuniao, r.numero_reuniao,
--        ARRAY_AGG(COALESCE(r.serie,'(nula)') ORDER BY r.serie NULLS FIRST) AS series,
--        ARRAY_AGG((SELECT COUNT(*) FROM public.deliberacoes d WHERE d.reuniao_id = r.id)
--                  ORDER BY r.serie NULLS FIRST) AS deliberacoes,
--        COUNT(*) AS linhas
--   FROM public.reunioes r JOIN public.agencias a ON a.id = r.agencia_id
--  WHERE a.sigla IN ('ANTT','ANM','ARTESP')
--  GROUP BY a.sigla, r.data_reuniao, r.numero_reuniao
-- HAVING COUNT(*) > 1
--  ORDER BY a.sigla, r.data_reuniao DESC;
--
-- ③ O QUE FICOU SEM SÉRIE, por agência. ⚠️ Na ANTT isto é ESPERADO e correto (sem título, não se
--    presume). Em ANM/ARTESP, cada linha aqui é uma reunião cujo documento não trouxe nem título nem
--    `tipo_reuniao` — e o conserto delas é re-extração, não mais SQL.
--
-- SELECT a.sigla, COUNT(*) AS sem_serie
--   FROM public.reunioes r JOIN public.agencias a ON a.id = r.agencia_id
--  WHERE r.serie IS NULL AND a.sigla IN ('ANTT','ANM','ARTESP')
--  GROUP BY a.sigla ORDER BY a.sigla;
-- ═══════════════════════════════════════════════════════════════════════════════════════════════
