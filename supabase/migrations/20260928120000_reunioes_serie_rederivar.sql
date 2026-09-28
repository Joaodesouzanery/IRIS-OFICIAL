-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- ⛔ NÃO RODAR. SUBSTITUÍDA POR `20260928140000_reunioes_serie_rederivar_v2.sql`.
--
-- Esta versão FALHA no SQL Editor do Supabase:
--     ERROR: 42P01: relation "_iris_serie_evidencia" does not exist
--
-- Ela monta uma TEMP TABLE numa instrução e a consome nas seguintes. ⚠️ E eu NÃO sei dizer por que
-- falhou: a `20260821130000_limpeza_residual_anm` usa a MESMA forma (`CREATE TEMP TABLE … ON COMMIT
-- DROP` dentro de `BEGIN/COMMIT`, consumida por instruções seguintes) e foi aplicada com sucesso —
-- então a explicação fácil ("o editor não mantém a sessão entre instruções") é refutada pelo próprio
-- repositório. Sem um Postgres aqui para reproduzir, escrever uma causa seria palpite com cara de
-- diagnóstico.
--
-- A v2 não aposta em causa nenhuma: ela REMOVE A DEPENDÊNCIA — cada instrução carrega sua própria
-- evidência num CTE, e não depende de nada que outra tenha deixado para trás.
--
-- ⚠️ ESTA v1 NÃO APLICOU NADA: o erro ocorreu antes de qualquer `UPDATE`, dentro de `BEGIN/COMMIT`.
-- O arquivo fica no repositório porque migration é forward-only — mas não rode.
-- ═══════════════════════════════════════════════════════════════════════════════════════════════

-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- Fase 35 · Bloco D — RE-DERIVAR `reunioes.serie` no passivo que o mojibake gravou como "ordinaria"
--
-- ⚠️ O DEFEITO, e por que o conserto anterior nao o alcancou
--
-- O commit f8c9a6f (Fase 34) consertou um mojibake NO CODIGO-FONTE do parser: a classe da regex
-- `ELETRONICA` estava corrompida, `deriveSerie` nunca casava "eletronic", e TODA Reuniao Deliberativa
-- Eletronica caia no `return "ordinaria"` final. Aquele commit consertou as escritas NOVAS.
--
-- Mas o backfill da migration 20260825120000 rodou `WHERE serie IS NULL` -- e estas linhas NAO eram
-- nulas: tinham 'ordinaria', escrito errado. Elas nunca foram revisitadas.
--
-- ⚠️ O CUSTO MEDIDO, que e o que torna isto prioridade e nao limpeza
--
-- `buracosDaSerie` (src/lib/server/placar.ts) agrupa por (agencia, serie) e so confia na faixa se
-- `max - min <= SALTO_MAXIMO_DA_SERIE` (400). Com a RDE gravada como 'ordinaria', a serie eletronica
-- (270..295) e a de Diretoria (1.027..1.038) caem no MESMO balde: o salto passa de 700 e a deteccao
-- de buracos SE CALA. O placar reportou `numeros_ausentes: 3` enquanto o usuario contou ~12 a mao
-- (1027, 1033, 1037 nas publicas; 270, 275, 284, 285, 288, 290, 292, 293, 294 nas eletronicas).
-- O docblock de `reunioes.ts` avisa a armadilha com estas palavras: "presumir 'ordinaria' juntaria
-- series distintas na mesma chave".
--
-- ⚠️ POR QUE NAO CRIO FUNCAO AUXILIAR
--
-- Licao da Fase 24b/25: a migration v1 chamava `iris_seed_director`, e a migration que CRIA essa
-- funcao a DERRUBA na mesma transacao -- a v2 teve de inlinar tudo. Aqui a logica vai inline, no
-- proprio UPDATE, sem depender de nada que outra migration possa remover.
--
-- ⚠️ POR QUE OS PADROES SAO CURTOS ('%eletr%', nao '%eletronic%')
--
-- Mesma escolha do backfill de 20260825120000, e ela e deliberada: o prefixo curto casa "eletronica"
-- E "eletronica" sem acento, sem depender da extensao `unaccent` (que pode nao estar instalada) nem
-- de um `translate` com a tabela de acentos escrita a mao.
--
-- IDEMPOTENTE: reaplicar nao muda nada, porque o WHERE exige que o valor ATUAL discorde da evidencia.
-- FORWARD-ONLY. Seguro aplicar com o codigo atual no ar (nenhuma coluna nova; `serie` ja existe).
-- ═══════════════════════════════════════════════════════════════════════════════════════════════

BEGIN;

-- ── 1. A evidencia de serie, de tres fontes, em ordem de confianca ─────────────────────────────
--   (a) `antt_reunioes_coletadas.tipo` — vem da LISTAGEM do portal, e o CHECK da migration 009 ja
--       restringe aos tres valores. E a fonte mais forte que existe.
--   (b) `reunioes.metadata->>'titulo'` — o que `ensureReuniao` grava.
--   (c) o titulo da deliberacao ligada (`deliberacoes.reuniao_ordinaria`) — segunda via, para a
--       linha cujo `metadata` nasceu sem titulo. Sem ela o backfill nao alcanca o passivo antigo.
CREATE TEMP TABLE _iris_serie_evidencia ON COMMIT DROP AS
WITH titulo_da_delib AS (
  SELECT r.id AS reuniao_id,
         -- ⚠️ MAX() e nao um titulo qualquer: se as deliberacoes da mesma reuniao discordarem, a
         -- escolha fica DETERMINISTICA. Reaplicar tem de dar o mesmo resultado.
         MAX(d.reuniao_ordinaria) AS titulo
    FROM public.reunioes r
    JOIN public.deliberacoes d
      ON d.agencia_id = r.agencia_id
     AND d.data_reuniao = r.data_reuniao
     AND COALESCE(d.numero_reuniao, '') = COALESCE(r.numero_reuniao, '')
   WHERE d.reuniao_ordinaria IS NOT NULL
   GROUP BY r.id
)
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
       END AS serie_da_evidencia,
       COALESCE(r.metadata ->> 'titulo', td.titulo) AS titulo_usado
  FROM public.reunioes r
  LEFT JOIN public.antt_reunioes_coletadas arc
         ON r.metadata ->> 'antt_reuniao_coletada_id' = arc.id::text
  LEFT JOIN titulo_da_delib td ON td.reuniao_id = r.id;

-- ── 2. O UPDATE, so onde a evidencia DISCORDA do gravado ───────────────────────────────────────
-- ⚠️ ALVO ESTREITO de proposito: `serie_atual = 'ordinaria'`. Era esse o valor que o mojibake
-- produzia (o `return` final de `deriveSerie`), e e o unico em que "discordar da evidencia" significa
-- "foi gravado errado". Mexer em linha com outra serie seria trocar um palpite por outro.
--
-- ⚠️ E A GUARDA DE COLISAO. O indice unico e
-- (agencia_id, data_reuniao, COALESCE(numero_reuniao,''), COALESCE(serie,'')). Se existir uma linha
-- IRMA que ja tenha o valor de destino, o UPDATE violaria o indice e a migration inteira falharia --
-- por causa de uma duplicata antiga. O `NOT EXISTS` pula essas linhas; o bloco de CONFERENCIA no fim
-- as lista, para serem resolvidas como duplicata (que e o que sao).
UPDATE public.reunioes r
   SET serie = e.serie_da_evidencia,
       updated_at = NOW()
  FROM _iris_serie_evidencia e
 WHERE e.id = r.id
   AND e.serie_atual = 'ordinaria'
   AND e.serie_da_evidencia IS NOT NULL
   AND e.serie_da_evidencia <> 'ordinaria'
   AND NOT EXISTS (
     SELECT 1 FROM public.reunioes irma
      WHERE irma.id <> r.id
        AND irma.agencia_id = r.agencia_id
        AND irma.data_reuniao = r.data_reuniao
        AND COALESCE(irma.numero_reuniao, '') = COALESCE(r.numero_reuniao, '')
        AND COALESCE(irma.serie, '') = e.serie_da_evidencia
   );

-- ── 3. E a linha que ainda esta NULA, agora que ha uma segunda via de titulo ────────────────────
-- O backfill de 20260825120000 so tinha `metadata->>'titulo'`; esta passada alcanca quem nasceu sem
-- ele e tem titulo na deliberacao ligada.
UPDATE public.reunioes r
   SET serie = COALESCE(e.serie_da_evidencia, 'ordinaria'),
       updated_at = NOW()
  FROM _iris_serie_evidencia e
 WHERE e.id = r.id
   AND r.serie IS NULL
   AND e.titulo_usado IS NOT NULL
   AND e.titulo_usado ILIKE '%reuni%'
   AND NOT EXISTS (
     SELECT 1 FROM public.reunioes irma
      WHERE irma.id <> r.id
        AND irma.agencia_id = r.agencia_id
        AND irma.data_reuniao = r.data_reuniao
        AND COALESCE(irma.numero_reuniao, '') = COALESCE(r.numero_reuniao, '')
        AND COALESCE(irma.serie, '') = COALESCE(e.serie_da_evidencia, 'ordinaria')
   );

NOTIFY pgrst, 'reload schema';

COMMIT;

-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- CONFERENCIA — rodar DEPOIS, fora da transacao. Cole tudo de uma vez.
--
-- ① A distribuicao por serie. Se a ANTT passar a ter linhas em 'eletronica', o backfill pegou.
--    Se continuar so com 'ordinaria', a evidencia nao existe no banco e o conserto e OUTRO
--    (re-coleta do titulo), nao mais tempo de esteira.
--
-- SELECT a.sigla, COALESCE(r.serie,'(nula)') AS serie, COUNT(*) AS linhas,
--        MIN(NULLIF(regexp_replace(COALESCE(r.numero_reuniao,''),'\D','','g'),'')::int) AS menor,
--        MAX(NULLIF(regexp_replace(COALESCE(r.numero_reuniao,''),'\D','','g'),'')::int) AS maior
--   FROM public.reunioes r JOIN public.agencias a ON a.id = r.agencia_id
--  WHERE a.sigla IN ('ANTT','ANM','ARTESP')
--  GROUP BY a.sigla, COALESCE(r.serie,'(nula)') ORDER BY a.sigla, serie;
--
-- ⚠️ ACEITE: para a ANTT, o `maior - menor` de CADA serie tem de caber em 400
--    (SALTO_MAXIMO_DA_SERIE). Enquanto nao couber, a deteccao de buracos continua calada e o
--    `numeros_ausentes` do placar continua menor que a contagem a mao.
--
-- ② AS LINHAS QUE A GUARDA DE COLISAO PULOU — sao duplicatas, e precisam de decisao sua.
--    Se vier vazio, nenhuma foi pulada.
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
