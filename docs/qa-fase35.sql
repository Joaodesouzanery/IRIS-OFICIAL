-- ════════════════════════════════════════════════════════════════════════════════════════════════
-- IRIS · QA da Fase 35 — a regua por DELIBERACAO, e as tres perguntas que a Fase 34 deixou abertas
--
-- SOMENTE LEITURA. Uma instrucao, resultado em JSON numa celula. Cole inteiro no SQL Editor.
--
-- ⚠️ POR QUE ESTE ARQUIVO EXISTE, e nao bastou o SQL da fase anterior
--
-- O SQL que eu mandei na Fase 34 tinha DOIS defeitos, e os dois o usuario pegou lendo o resultado:
--
--  (a) o universo saia de `JOIN public.votos`, entao reuniao SEM voto desaparecia da medicao.
--      Foi por isso que a 1.029 da ANTT "sumiu" da lista das nove: nao sumiu do placar (a rota le
--      `deliberacoes`), sumiu do MEU SQL.
--
--  (b) o filtro era `tipo_documento = 'ata' AND documento_pai_id IS NOT NULL` -- uma WHITELIST.
--      O predicado real (`isFinalDecisionRecord`) e uma BLACKLIST e aceita `deliberacao` sem pai.
--      A ARTESP publica deliberacao individual, cada linha e sua propria mae: o meu filtro apagou a
--      agencia inteira. Foi por isso que o bloco 1 somou 37 reunioes enquanto o placar somou 80.
--
-- Aqui o predicado e TRANSCRITO do codigo, nao reinventado -- ver `isFinalDecisionRecord` em
-- src/lib/server/regulatory-documents.ts:269. Se ele mudar la, este arquivo mente.
--
-- ⚠️ ARMADILHAS DE SCHEMA conferidas antes de escrever:
--   · `raw_extraction` e a coluna viva; `raw_extracted` (da 001) e legado e ninguem le.
--   · `mandatos` NAO tem `agencia_id` -- a agencia vem por JOIN em `diretores`.
--   · `numero_reuniao` e TEXTO em duas larguras (varchar(10) em deliberacoes, varchar(20) em
--     reunioes) e conviv em dois formatos ("1.024" e "1024").
--   · `reunioes` nao tem coluna `titulo`; ele vive em `metadata->>'titulo'`.
-- ════════════════════════════════════════════════════════════════════════════════════════════════
WITH ag AS (SELECT id, sigla FROM public.agencias WHERE sigla IN ('ANTT','ANM','ARTESP')),

-- O colegiado esperado, com os MESMOS filtros do motor de voto (`getActiveDiretoresForVote`).
-- Sem estes dois (fonte_dado <> 'automatico' E review_status = 'aprovado') o placar discorda do motor,
-- que e o pior desfecho possivel numa ferramenta feita para dar confianca.
mand AS (
  SELECT m.diretor_id, d.agencia_id, d.nome, m.data_inicio, m.data_fim
    FROM public.mandatos m
    JOIN public.diretores d ON d.id = m.diretor_id
   WHERE m.fonte_dado <> 'automatico' AND d.review_status = 'aprovado'
),

-- ⚠️ O PREDICADO, transcrito de isFinalDecisionRecord:
--    1. import_counts_as_final = false                  -> nao e final
--    2. tipo em (pauta, voto_individual, documento_apoio) -> nao e final
--    3. subtipo em (pauta, voto_individual)              -> nao e final (derruba mae E filho)
--    4. tipo = 'ata'  -> final SE tem pai E tem resultado (a mae da sessao e envelope)
--    5. tipo em (deliberacao, resolucao, portaria) -> final
finais AS (
  SELECT d.id, d.agencia_id, a.sigla, d.data_reuniao, d.numero_reuniao, d.tipo_documento
    FROM public.deliberacoes d
    JOIN ag a ON a.id = d.agencia_id
   WHERE COALESCE((d.raw_extraction->>'import_counts_as_final')::boolean, TRUE) IS TRUE
     AND COALESCE(d.tipo_documento,'') NOT IN ('pauta','voto_individual','documento_apoio')
     AND COALESCE(
           d.raw_extraction->>'documento_subtipo',
           d.raw_extraction->>'documento_antt_tipo',
           '') NOT IN ('pauta','voto_individual')
     AND (
       (d.tipo_documento = 'ata' AND d.documento_pai_id IS NOT NULL AND d.resultado IS NOT NULL)
       OR d.tipo_documento IN ('deliberacao','resolucao','portaria')
     )
),

-- Finais de 2026 COM numero de reuniao. Documento avulso nao tem colegiado a conferir.
finais_2026 AS (
  SELECT * FROM finais
   WHERE data_reuniao BETWEEN DATE '2026-01-01' AND DATE '2026-12-31'
     AND numero_reuniao IS NOT NULL
),

-- ⚠️ PARES: cada deliberacao final x cada diretor esperado na data. LEFT JOIN em votos, para
-- deliberacao SEM voto nenhum CONTINUAR no denominador -- foi o defeito (a) do SQL anterior.
pares AS (
  SELECT f.sigla, f.numero_reuniao, f.data_reuniao, f.id AS deliberacao_id,
         m.diretor_id, m.nome,
         EXISTS (SELECT 1 FROM public.votos v
                  WHERE v.deliberacao_id = f.id AND v.diretor_id = m.diretor_id) AS respondido
    FROM finais_2026 f
    JOIN mand m
      ON m.agencia_id = f.agencia_id
     AND m.data_inicio <= f.data_reuniao
     AND (m.data_fim IS NULL OR m.data_fim >= f.data_reuniao)
),

-- Cobertura por (reuniao, diretor): em quantos itens ele respondeu, de quantos.
cob AS (
  SELECT sigla, numero_reuniao, data_reuniao, diretor_id, nome,
         COUNT(*) AS itens,
         COUNT(*) FILTER (WHERE respondido) AS respondidos
    FROM pares
   GROUP BY sigla, numero_reuniao, data_reuniao, diretor_id, nome
)

SELECT jsonb_pretty(jsonb_build_object(

  -- ① A COBERTURA REAL por agencia, e a distancia para o TETO.
  --    `teto` = reunioes em que todo diretor esperado tem >=1 voto (a regua antiga, "84%").
  --    `estrito` = reunioes em que todo diretor respondeu em TODOS os itens.
  --    A diferenca entre os dois e o tamanho do que o teto escondia.
  '1_cobertura', (
    SELECT jsonb_object_agg(sigla, jsonb_build_object(
             'reunioes', reunioes, 'itens', itens,
             'pares_esperados', pares_esp, 'pares_respondidos', pares_resp,
             'cobertura_pct', CASE WHEN pares_esp > 0
                                   THEN ROUND(100.0 * pares_resp / pares_esp) ELSE 0 END,
             'reunioes_teto', teto, 'reunioes_estrito', estrito))
      FROM (
        SELECT sigla,
               COUNT(DISTINCT (numero_reuniao, data_reuniao))               AS reunioes,
               SUM(itens) / NULLIF(COUNT(DISTINCT diretor_id),0)            AS itens,
               SUM(itens)                                                   AS pares_esp,
               SUM(respondidos)                                             AS pares_resp,
               COUNT(DISTINCT (numero_reuniao, data_reuniao)) FILTER (WHERE respondidos > 0)
                 - COUNT(DISTINCT (numero_reuniao, data_reuniao)) FILTER (WHERE respondidos = 0) AS teto,
               COUNT(DISTINCT (numero_reuniao, data_reuniao))
                 - COUNT(DISTINCT (numero_reuniao, data_reuniao)) FILTER (WHERE respondidos < itens) AS estrito
          FROM cob GROUP BY sigla) t),

  -- ② OS DIRETORES COM VOTO EM PARTE DOS ITENS — o caso que o teto NAO VE.
  --    E a frase que o usuario pediu: "Jose Fernando sem voto em 38 de 39 itens da 84a".
  '2_voto_parcial', (
    SELECT COALESCE(jsonb_agg(to_jsonb(t) ORDER BY t.sem_voto_em DESC), '[]'::jsonb)
      FROM (SELECT sigla, numero_reuniao, data_reuniao, nome,
                   respondidos, itens, (itens - respondidos) AS sem_voto_em
              FROM cob WHERE respondidos > 0 AND respondidos < itens
             ORDER BY (itens - respondidos) DESC LIMIT 40) t),

  -- ③ QUEM NAO RESPONDEU NADA — o que o teto tambem via, para separar dos parciais.
  '3_sem_nenhum_voto', (
    SELECT COALESCE(jsonb_agg(to_jsonb(t) ORDER BY t.data_reuniao DESC), '[]'::jsonb)
      FROM (SELECT sigla, numero_reuniao, data_reuniao, nome, itens
              FROM cob WHERE respondidos = 0
             ORDER BY data_reuniao DESC LIMIT 40) t),

  -- ④ ⚠️ A 1.029 DA ANTT. Ela estava na lista das nove e nao apareceu entre as oito que fecharam.
  --    A hipotese: existe com ZERO voto, e por isso saiu do meu SQL antigo (que fazia JOIN votos).
  --    Aqui ela aparece mesmo com zero, e `votos` diz qual dos dois casos e.
  '4_a_1029_da_antt', (
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
             'numero', d.numero_reuniao, 'data', d.data_reuniao,
             'tipo', d.tipo_documento, 'tem_pai', (d.documento_pai_id IS NOT NULL),
             'resultado', d.resultado, 'e_final', (d.id IN (SELECT id FROM finais)),
             'votos', (SELECT COUNT(*) FROM public.votos v WHERE v.deliberacao_id = d.id))
           ORDER BY d.data_reuniao), '[]'::jsonb)
      FROM public.deliberacoes d JOIN ag a ON a.id = d.agencia_id
     WHERE a.sigla = 'ANTT' AND REPLACE(COALESCE(d.numero_reuniao,''),'.','') = '1029'),

  -- ⑤ ⚠️ DE QUAL AGENCIA ERAM OS 51 VOTOS APAGADOS pelo reparo de artefato.
  --    Se forem da ARTESP, o reparo removeu voto que NADA refez (a ARTESP nao tem colegiado a
  --    inferir do mesmo jeito) -- e isso seria regressao minha, nao conserto.
  '5_agencia_dos_apagados', (
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
             'quando', aud.created_at, 'deliberacoes', aud.deliberacoes_afetadas,
             'votos_removidos', aud.detalhe->>'votos_a_remover',
             'por_agencia', (
               SELECT jsonb_object_agg(sigla, n) FROM (
                 SELECT a2.sigla, COUNT(*) AS n
                   FROM jsonb_array_elements(aud.detalhe->'linhas') AS linha
                   JOIN public.deliberacoes d2 ON d2.id = (linha->>'deliberacao_id')::uuid
                   JOIN ag a2 ON a2.id = d2.agencia_id
                  GROUP BY a2.sigla) s),
             'refeitas', (
               SELECT COUNT(*) FROM jsonb_array_elements(aud.detalhe->'linhas') AS linha
                WHERE EXISTS (SELECT 1 FROM public.votos v
                               WHERE v.deliberacao_id = (linha->>'deliberacao_id')::uuid))
           ) ORDER BY aud.created_at DESC), '[]'::jsonb)
      FROM public.votos_retroativos_audit aud
     WHERE aud.detalhe->>'tipo' = 'voto_artefato_removido'),

  -- ⑥ ⚠️ A SERIE NO BANCO. A deteccao de buracos agrupa por (agencia, serie) e so confia na faixa
  --    se `max - min <= 400`. Se a RDE estiver gravada como 'ordinaria', ela cai no mesmo balde da
  --    Reuniao de Diretoria e o salto 270->1038 passa de 400: a deteccao se CALA. Era o motivo de
  --    `numeros_ausentes: 3` contra os ~12 que o usuario contou.
  '6_serie_por_agencia', (
    SELECT COALESCE(jsonb_agg(to_jsonb(t) ORDER BY t.sigla, t.serie), '[]'::jsonb)
      FROM (SELECT a.sigla, COALESCE(r.serie,'(nula)') AS serie, COUNT(*) AS linhas,
                   MIN(NULLIF(regexp_replace(COALESCE(r.numero_reuniao,''),'\D','','g'),'')::int) AS menor,
                   MAX(NULLIF(regexp_replace(COALESCE(r.numero_reuniao,''),'\D','','g'),'')::int) AS maior,
                   MAX(NULLIF(regexp_replace(COALESCE(r.numero_reuniao,''),'\D','','g'),'')::int)
                     - MIN(NULLIF(regexp_replace(COALESCE(r.numero_reuniao,''),'\D','','g'),'')::int) AS salto,
                   COUNT(*) FILTER (WHERE r.metadata->>'titulo' ILIKE '%letr%nic%') AS titulo_diz_eletronica
              FROM public.reunioes r JOIN ag a ON a.id = r.agencia_id
             GROUP BY a.sigla, COALESCE(r.serie,'(nula)')) t),

  -- ⑦ As datas que a Fase 34 prometeu e o usuario conferiu: 81a, 82a, 83a da ANM ainda erradas;
  --    1.035 e 289 da ANTT com linha em 2026 E linha antiga sobrando (duplicata, nao data errada).
  '7_datas_pendentes', (
    SELECT COALESCE(jsonb_agg(to_jsonb(t) ORDER BY t.sigla, t.numero_reuniao, t.data_reuniao), '[]'::jsonb)
      FROM (SELECT a.sigla, d.numero_reuniao, d.data_reuniao, COUNT(*) AS linhas,
                   BOOL_OR(d.raw_extraction ? 'data_invalidada_motivo') AS ja_anulada,
                   BOOL_OR(d.raw_extraction ? 'data_ausente_motivo') AS nunca_teve
              FROM public.deliberacoes d JOIN ag a ON a.id = d.agencia_id
             WHERE (a.sigla = 'ANM'    AND REPLACE(COALESCE(d.numero_reuniao,''),'.','') IN ('80','81','82','83','84','85','86','87'))
                OR (a.sigla = 'ANTT'   AND REPLACE(COALESCE(d.numero_reuniao,''),'.','') IN ('282','286','289','1035'))
                OR (a.sigla = 'ARTESP' AND REPLACE(COALESCE(d.numero_reuniao,''),'.','') IN ('1177','1186'))
             GROUP BY a.sigla, d.numero_reuniao, d.data_reuniao) t)
)) AS qa_fase35;
