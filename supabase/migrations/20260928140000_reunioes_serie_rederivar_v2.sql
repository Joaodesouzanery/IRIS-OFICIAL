-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- Fase 35 · Bloco D (v2) — RE-DERIVAR `reunioes.serie` no passivo gravado como "ordinaria"
--
-- ⚠️ POR QUE EXISTE UMA v2, E O QUE EU NÃO SEI
--
-- A v1 (`20260928120000`) montava uma TEMP TABLE numa instrução e a consumia nas seguintes. Ao
-- aplicar, o SQL Editor devolveu:
--     ERROR: 42P01: relation "_iris_serie_evidencia" does not exist
--
-- ⚠️ E eu NÃO consigo dizer daqui por que falhou. A migration `20260821130000_limpeza_residual_anm`
-- usa a MESMA forma (`CREATE TEMP TABLE … ON COMMIT DROP` dentro de `BEGIN/COMMIT`, consumida por
-- instruções seguintes) e foi aplicada com sucesso. Ou seja: a explicação fácil — "o editor não
-- mantém a sessão entre instruções" — é REFUTADA pelo próprio repositório. Sem um Postgres aqui para
-- reproduzir, qualquer causa que eu escrevesse seria palpite com cara de diagnóstico.
--
-- Então esta versão NÃO aposta num diagnóstico: ela REMOVE A DEPENDÊNCIA. Cada instrução é
-- autossuficiente — a evidência vira um CTE dentro do próprio `UPDATE`. Assim o resultado não depende
-- de nada que outra instrução tenha deixado para trás, seja qual for a causa.
--
-- É a mesma disciplina que a Fase 24b pagou para aprender com o `iris_seed_director`: a migration que
-- CRIA a função a DERRUBA na mesma transação, e a v2 de lá teve de inlinar tudo. Duas vezes o mesmo
-- formato de erro — depender de objeto criado por outra instrução —, duas vezes a saída foi inline.
--
-- ⚠️ A v1 NÃO APLICOU NADA. O erro ocorreu antes de qualquer `UPDATE`, e dentro de `BEGIN/COMMIT`.
-- Esta v2 é idempotente de qualquer forma: todo `UPDATE` exige que o valor ATUAL discorde da
-- evidência, então aplicar as duas, ou esta duas vezes, dá o mesmo resultado.
--
-- ═══ O DEFEITO QUE ELA CONSERTA (inalterado da v1) ═══
--
-- O commit `f8c9a6f` (Fase 34) consertou um mojibake NO CÓDIGO-FONTE do parser: a classe da regex
-- `ELETRÔNICA` estava corrompida, `deriveSerie` nunca casava "eletronic", e TODA Reunião Deliberativa
-- Eletrônica caía no `return "ordinaria"` final. Aquele commit consertou as escritas NOVAS. O backfill
-- da `20260825120000` rodou `WHERE serie IS NULL` — e estas linhas não eram nulas: tinham
-- `'ordinaria'`, escrito errado. Nunca foram revisitadas.
--
-- CUSTO MEDIDO: `buracosDaSerie` (src/lib/server/placar.ts) agrupa por (agência, série) e só confia na
-- faixa se `max - min <= SALTO_MAXIMO_DA_SERIE` (400). Com a RDE gravada como 'ordinaria', a série
-- eletrônica (270..295) e a de Diretoria (1.027..1.038) caem no MESMO balde: o salto passa de 700 e a
-- detecção de buracos SE CALA. O placar reportou `numeros_ausentes: 3` enquanto o usuário contou ~12 à
-- mão (1027, 1033, 1037 nas públicas; 270, 275, 284, 285, 288, 290, 292, 293, 294 nas eletrônicas).
--
-- FORWARD-ONLY. Seguro aplicar com o código atual no ar (nenhuma coluna nova; `serie` já existe).
-- ═══════════════════════════════════════════════════════════════════════════════════════════════

BEGIN;

-- ── 1. Corrigir quem está como 'ordinaria' e cuja EVIDÊNCIA discorda ──────────────────────────
--
-- Três fontes de evidência, em ordem de confiança:
--   (a) `antt_reunioes_coletadas.tipo` — vem da LISTAGEM do portal, e o CHECK da migration 009 já
--       restringe aos três valores. É a fonte mais forte que existe.
--   (b) `reunioes.metadata->>'titulo'` — o que `ensureReuniao` grava.
--   (c) o título da deliberação ligada (`deliberacoes.reuniao_ordinaria`) — segunda via, para a linha
--       cujo `metadata` nasceu sem título. Sem ela o backfill não alcança o passivo antigo.
--
-- ⚠️ ALVO ESTREITO de propósito: `serie = 'ordinaria'`. Era esse o valor que o mojibake produzia (o
-- `return` final de `deriveSerie`), e é o único em que "discordar da evidência" significa "foi gravado
-- errado". Mexer em linha com outra série seria trocar um palpite por outro.
--
-- ⚠️ E os padrões são CURTOS ('%eletr%', não '%eletronic%'): o prefixo curto casa "eletrônica" COM e
-- SEM acento, sem depender da extensão `unaccent` (que pode não estar instalada) nem de um `translate`
-- com a tabela de acentos escrita à mão. É a mesma escolha do backfill de `20260825120000`.
WITH titulo_da_delib AS (
  SELECT r.id AS reuniao_id,
         -- ⚠️ MAX() é determinismo, não descuido: se as deliberações da mesma reunião discordarem, a
         -- escolha fica FIXA. Reaplicar tem de dar o mesmo resultado, senão a migration não é idempotente.
         MAX(d.reuniao_ordinaria) AS titulo
    FROM public.reunioes r
    JOIN public.deliberacoes d
      ON d.agencia_id = r.agencia_id
     AND d.data_reuniao = r.data_reuniao
     AND COALESCE(d.numero_reuniao, '') = COALESCE(r.numero_reuniao, '')
   WHERE d.reuniao_ordinaria IS NOT NULL
   GROUP BY r.id
),
evidencia AS (
  SELECT r.id,
         r.agencia_id,
         r.data_reuniao,
         r.numero_reuniao,
         r.serie AS serie_atual,
         CASE
           WHEN arc.tipo IS NOT NULL THEN arc.tipo
           WHEN COALESCE(r.metadata ->> 'titulo', td.titulo) ILIKE '%eletr%'         THEN 'eletronica'
           WHEN COALESCE(r.metadata ->> 'titulo', td.titulo) ILIKE '%extraordin%'    THEN 'extraordinaria'
           WHEN COALESCE(r.metadata ->> 'titulo', td.titulo) ILIKE '%administrativ%' THEN 'administrativa'
           ELSE NULL
         END AS serie_da_evidencia
    FROM public.reunioes r
    LEFT JOIN public.antt_reunioes_coletadas arc
           ON r.metadata ->> 'antt_reuniao_coletada_id' = arc.id::text
    LEFT JOIN titulo_da_delib td ON td.reuniao_id = r.id
)
UPDATE public.reunioes r
   SET serie = e.serie_da_evidencia,
       updated_at = NOW()
  FROM evidencia e
 WHERE e.id = r.id
   AND e.serie_atual = 'ordinaria'
   AND e.serie_da_evidencia IS NOT NULL
   AND e.serie_da_evidencia <> 'ordinaria'
   -- ⚠️ GUARDA DE COLISÃO. O índice único é
   -- (agencia_id, data_reuniao, COALESCE(numero_reuniao,''), COALESCE(serie,'')). Se existir uma linha
   -- IRMÃ que já tenha o valor de destino, o UPDATE violaria o índice e a migration INTEIRA falharia
   -- por causa de uma duplicata antiga. O `NOT EXISTS` pula essas linhas; a CONFERÊNCIA no fim as
   -- lista, para serem resolvidas como duplicata — que é o que são.
   AND NOT EXISTS (
     SELECT 1 FROM public.reunioes irma
      WHERE irma.id <> r.id
        AND irma.agencia_id = r.agencia_id
        AND irma.data_reuniao = r.data_reuniao
        AND COALESCE(irma.numero_reuniao, '') = COALESCE(r.numero_reuniao, '')
        AND COALESCE(irma.serie, '') = e.serie_da_evidencia
   );

-- ── 2. E a linha que ainda está NULA, agora que há uma segunda via de título ───────────────────
-- O backfill de `20260825120000` só tinha `metadata->>'titulo'`; esta passada alcança quem nasceu sem
-- ele e tem título na deliberação ligada. O CTE é REPETIDO de propósito — ver o cabeçalho.
WITH titulo_da_delib AS (
  SELECT r.id AS reuniao_id, MAX(d.reuniao_ordinaria) AS titulo
    FROM public.reunioes r
    JOIN public.deliberacoes d
      ON d.agencia_id = r.agencia_id
     AND d.data_reuniao = r.data_reuniao
     AND COALESCE(d.numero_reuniao, '') = COALESCE(r.numero_reuniao, '')
   WHERE d.reuniao_ordinaria IS NOT NULL
   GROUP BY r.id
),
evidencia AS (
  SELECT r.id,
         r.agencia_id,
         r.data_reuniao,
         r.numero_reuniao,
         COALESCE(r.metadata ->> 'titulo', td.titulo) AS titulo_usado,
         CASE
           WHEN arc.tipo IS NOT NULL THEN arc.tipo
           WHEN COALESCE(r.metadata ->> 'titulo', td.titulo) ILIKE '%eletr%'         THEN 'eletronica'
           WHEN COALESCE(r.metadata ->> 'titulo', td.titulo) ILIKE '%extraordin%'    THEN 'extraordinaria'
           WHEN COALESCE(r.metadata ->> 'titulo', td.titulo) ILIKE '%administrativ%' THEN 'administrativa'
           ELSE 'ordinaria'
         END AS serie_da_evidencia
    FROM public.reunioes r
    LEFT JOIN public.antt_reunioes_coletadas arc
           ON r.metadata ->> 'antt_reuniao_coletada_id' = arc.id::text
    LEFT JOIN titulo_da_delib td ON td.reuniao_id = r.id
)
UPDATE public.reunioes r
   SET serie = e.serie_da_evidencia,
       updated_at = NOW()
  FROM evidencia e
 WHERE e.id = r.id
   AND r.serie IS NULL
   AND e.titulo_usado IS NOT NULL
   -- ⚠️ Exige "reuni" no título: sem marcador reconhecível, `deriveSerie` devolve NULL de propósito —
   -- "presumir 'ordinaria' juntaria séries distintas na mesma chave", diz o docblock de `reunioes.ts`.
   -- Gravar 'ordinaria' aqui recriaria exatamente o defeito que esta migration existe para desfazer.
   AND e.titulo_usado ILIKE '%reuni%'
   AND NOT EXISTS (
     SELECT 1 FROM public.reunioes irma
      WHERE irma.id <> r.id
        AND irma.agencia_id = r.agencia_id
        AND irma.data_reuniao = r.data_reuniao
        AND COALESCE(irma.numero_reuniao, '') = COALESCE(r.numero_reuniao, '')
        AND COALESCE(irma.serie, '') = e.serie_da_evidencia
   );

NOTIFY pgrst, 'reload schema';

COMMIT;

-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- CONFERÊNCIA — rodar DEPOIS, fora da transação. Cole as duas de uma vez.
--
-- ① A distribuição por série. Se a ANTT passar a ter linhas em 'eletronica', o backfill pegou.
--    Se continuar só com 'ordinaria', a EVIDÊNCIA não existe no banco (nenhuma das três fontes tem o
--    título), e aí o conserto é outro — re-coletar o título —, não mais tempo de esteira.
--
-- SELECT a.sigla, COALESCE(r.serie,'(nula)') AS serie, COUNT(*) AS linhas,
--        MIN(NULLIF(regexp_replace(COALESCE(r.numero_reuniao,''),'\D','','g'),'')::int) AS menor,
--        MAX(NULLIF(regexp_replace(COALESCE(r.numero_reuniao,''),'\D','','g'),'')::int) AS maior,
--        MAX(NULLIF(regexp_replace(COALESCE(r.numero_reuniao,''),'\D','','g'),'')::int)
--          - MIN(NULLIF(regexp_replace(COALESCE(r.numero_reuniao,''),'\D','','g'),'')::int) AS salto
--   FROM public.reunioes r JOIN public.agencias a ON a.id = r.agencia_id
--  WHERE a.sigla IN ('ANTT','ANM','ARTESP')
--  GROUP BY a.sigla, COALESCE(r.serie,'(nula)') ORDER BY a.sigla, serie;
--
-- ⚠️ ACEITE: para a ANTT, o `salto` de CADA série tem de caber em 400 (SALTO_MAXIMO_DA_SERIE).
--    Enquanto não couber, a detecção de buracos continua calada e o `numeros_ausentes` do placar
--    continua menor que a contagem à mão.
--
-- ② AS LINHAS QUE A GUARDA DE COLISÃO PULOU — são duplicatas e precisam de decisão sua.
--    Vazio = nenhuma foi pulada.
--
-- SELECT a.sigla, r.data_reuniao, r.numero_reuniao,
--        ARRAY_AGG(COALESCE(r.serie,'(nula)') ORDER BY r.serie) AS series_na_mesma_chave,
--        COUNT(*) AS linhas
--   FROM public.reunioes r JOIN public.agencias a ON a.id = r.agencia_id
--  WHERE a.sigla IN ('ANTT','ANM','ARTESP')
--  GROUP BY a.sigla, r.data_reuniao, r.numero_reuniao
-- HAVING COUNT(*) > 1
--  ORDER BY a.sigla, r.data_reuniao DESC;
-- ═══════════════════════════════════════════════════════════════════════════════════════════════
