-- ════════════════════════════════════════════════════════════════════════════════════════════════
-- IRIS · QA da Fase 36 — as 202 datas, os filhos que nunca seguiam a mae, e a ANAC que nao grava
--
-- SOMENTE LEITURA. Uma instrucao, resultado em JSON numa celula. Cole inteiro no SQL Editor.
--
-- ⚠️ AS DUAS ARMADILHAS QUE A FASE 35 PAGOU, e que este arquivo evita de proposito:
--   (a) o universo NAO sai de `JOIN public.votos` — reuniao SEM voto tem de continuar no
--       denominador, senao ela "some" da medicao (foi a 1.029 da ANTT desaparecendo do MEU SQL).
--   (b) o predicado de "final" e uma BLACKLIST transcrita de `isFinalDecisionRecord`
--       (src/lib/server/regulatory-documents.ts), nao uma whitelist `ata AND pai IS NOT NULL` —
--       a ARTESP publica deliberacao individual e a whitelist apagava a agencia inteira.
--
-- ⚠️ ARMADILHAS DE SCHEMA conferidas antes de escrever:
--   · `raw_extraction` e a coluna viva; `raw_extracted` (da 001) e legado.
--   · `mandatos` NAO tem `agencia_id` — a agencia vem por JOIN em `diretores`.
--   · `numero_reuniao` e TEXTO em duas larguras e conviv em dois formatos ("1.024" e "1024").
--   · `reunioes` nao tem coluna `titulo`; ele vive em `metadata->>'titulo'`.
--   · `votos.proveniencia` pode nao existir se a migration nao foi aplicada — por isso a
--     nominalidade e lida por `COALESCE(proveniencia, CASE is_nominal ...)` e o bloco ⑧ CONFERE se
--     a coluna existe antes de opinar.
--
-- O QUE CADA BLOCO RESPONDE (e cada um existe porque uma decisao depende dele):
--   ① as 202 datas: quantas deliberacoes tem data que o proprio pai contradiz.
--   ② os filhos desalinhados: item de ata com data diferente da mae. Entrada do B.1.
--   ③ o revoto: votos de quem NAO tinha mandato na data da deliberacao. Entrada do B.4.
--   ④ o colegiado parcial: deliberacao com voto de PARTE do roster. Entrada do Bloco A.
--   ⑤ a certificacao: as 5 atas do gabarito, com itens e votos por diretor, para a subtracao.
--   ⑥ a serie: quantas reunioes nasceram com serie NULL depois do Bloco E.
--   ⑦ a orfa: reunioes com data impossivel e ZERO deliberacao.
--   ⑧ a ANAC: quantas noticias por agencia, e desde quando — a pergunta que eu NAO pude responder
--     sem o banco ("o coletor acha 71 links e grava zero: onde esta o corte?").
-- ════════════════════════════════════════════════════════════════════════════════════════════════
WITH ag AS (SELECT id, sigla FROM public.agencias WHERE sigla IN ('ANTT','ANM','ARTESP')),

-- O colegiado esperado, com os MESMOS filtros do motor de voto (`getActiveDiretoresForVote`):
-- mandato FABRICADO (fonte_dado='automatico') nao conta como conhecimento, e diretor nao aprovado
-- nao entra. Sem os dois, este QA discorda do motor — o pior desfecho numa ferramenta de confianca.
mand AS (
  SELECT m.diretor_id, d.agencia_id, d.nome, m.data_inicio, m.data_fim,
         NULLIF(d.metadata ->> 'afastado_desde', '')::date AS afastado_desde,
         NULLIF(d.metadata ->> 'afastado_ate',   '')::date AS afastado_ate
    FROM public.mandatos m
    JOIN public.diretores d ON d.id = m.diretor_id
   WHERE m.fonte_dado <> 'automatico' AND d.review_status = 'aprovado'
),

-- ⚠️ O PREDICADO, transcrito de isFinalDecisionRecord (blacklist, nao whitelist).
finais AS (
  SELECT d.id, d.agencia_id, a.sigla, d.data_reuniao, d.numero_reuniao, d.tipo_documento,
         d.documento_pai_id, d.reuniao_id, d.resultado
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

-- Nominalidade pela FONTE UNICA (`isVotoNominal`): proveniencia manda, is_nominal e o fallback.
-- ⚠️ Ler `is_nominal` cru trataria voto `revisao_humana` como inferido — e o revoto o APAGARIA.
votos_lidos AS (
  SELECT v.deliberacao_id, v.diretor_id, v.tipo_voto, v.motivo_nao_voto,
         CASE
           WHEN to_jsonb(v) ? 'proveniencia' AND to_jsonb(v)->>'proveniencia' IN ('nominal','revisao_humana') THEN TRUE
           WHEN to_jsonb(v) ? 'proveniencia' AND to_jsonb(v)->>'proveniencia' IS NOT NULL THEN FALSE
           ELSE COALESCE(v.is_nominal, FALSE)
         END AS nominal
    FROM public.votos v
)

SELECT jsonb_pretty(jsonb_build_object(

  -- ① AS 202 DATAS. Item de ata cuja data DIVERGE da mae. Nao e "data implausivel": e contradicao
  --    interna, e por isso nao depende de nenhuma regra de plausibilidade por agencia.
  '1_filho_com_data_diferente_da_mae', (
    SELECT COALESCE(jsonb_agg(to_jsonb(t) ORDER BY t.sigla, t.numero_reuniao), '[]'::jsonb)
      FROM (SELECT a.sigla, mae.numero_reuniao,
                   mae.data_reuniao AS data_da_mae,
                   COUNT(*) AS filhos_divergentes,
                   COUNT(DISTINCT f.data_reuniao) AS datas_distintas_nos_filhos,
                   MIN(f.data_reuniao) AS menor_data_filho,
                   MAX(f.data_reuniao) AS maior_data_filho,
                   COUNT(*) FILTER (WHERE f.reuniao_id IS DISTINCT FROM mae.reuniao_id) AS reuniao_id_tambem_diverge
              FROM public.deliberacoes f
              JOIN public.deliberacoes mae ON mae.id = f.documento_pai_id
              JOIN ag a ON a.id = f.agencia_id
             WHERE f.documento_pai_id IS NOT NULL
               AND f.data_reuniao IS DISTINCT FROM mae.data_reuniao
             GROUP BY a.sigla, mae.numero_reuniao, mae.data_reuniao) t),

  -- ② O TOTAL dos filhos desalinhados, por agencia. E o numero que o B.1 tem de levar a zero.
  '2_desalinhados_por_agencia', (
    SELECT COALESCE(jsonb_object_agg(t.sigla, to_jsonb(t) - 'sigla'), '{}'::jsonb)
      FROM (SELECT a.sigla,
                   COUNT(*) FILTER (WHERE f.data_reuniao IS DISTINCT FROM mae.data_reuniao) AS data_diverge,
                   COUNT(*) FILTER (WHERE f.reuniao_id IS DISTINCT FROM mae.reuniao_id) AS reuniao_diverge,
                   COUNT(*) AS filhos_no_total
              FROM public.deliberacoes f
              JOIN public.deliberacoes mae ON mae.id = f.documento_pai_id
              JOIN ag a ON a.id = f.agencia_id
             GROUP BY a.sigla) t),

  -- ③ O REVOTO. Voto de quem NAO tinha mandato na data da deliberacao.
  --    ⚠️ `nominal_fora_do_roster` e o numero que INVERTE a leitura: se o documento NOMEIA alguem
  --    votando e o cadastro diz que ela nao tinha mandato, o suspeito e o CADASTRO. Esse voto NUNCA
  --    e apagado — ele e a evidencia que corrige o mandato.
  '3_voto_fora_do_roster', (
    SELECT COALESCE(jsonb_object_agg(t.sigla, to_jsonb(t) - 'sigla'), '{}'::jsonb)
      FROM (SELECT f.sigla,
                   COUNT(*) FILTER (WHERE NOT v.nominal) AS inferido_fora_do_roster,
                   COUNT(*) FILTER (WHERE v.nominal)     AS nominal_fora_do_roster,
                   COUNT(DISTINCT f.id) AS deliberacoes_afetadas
              FROM finais f
              JOIN votos_lidos v ON v.deliberacao_id = f.id
             WHERE f.data_reuniao IS NOT NULL
               AND NOT EXISTS (
                     SELECT 1 FROM mand m
                      WHERE m.diretor_id = v.diretor_id
                        AND m.agencia_id = f.agencia_id
                        AND m.data_inicio <= f.data_reuniao
                        AND (m.data_fim IS NULL OR m.data_fim >= f.data_reuniao))
             GROUP BY f.sigla) t),

  -- ④ O COLEGIADO PARCIAL. Deliberacao com voto de PARTE do roster — a populacao do Bloco A.
  --    ⚠️ Este numero e TETO: aqui o roster e de MANDATO, e o motor usa os PRESENTES do documento,
  --    que e um subconjunto. O numero do motor sai em materializar-faltantes com
  --    {completar_parcial: true, dry_run: true}.
  '4_colegiado_parcial_teto', (
    SELECT COALESCE(jsonb_object_agg(t.sigla, to_jsonb(t) - 'sigla'), '{}'::jsonb)
      FROM (SELECT x.sigla,
                   COUNT(*) AS deliberacoes_parciais,
                   SUM(x.esperados - x.com_voto) AS pares_faltando
              FROM (SELECT f.sigla, f.id,
                           COUNT(DISTINCT m.diretor_id) AS esperados,
                           COUNT(DISTINCT v.diretor_id) AS com_voto
                      FROM finais f
                      JOIN mand m
                        ON m.agencia_id = f.agencia_id
                       AND m.data_inicio <= f.data_reuniao
                       AND (m.data_fim IS NULL OR m.data_fim >= f.data_reuniao)
                       AND NOT (m.afastado_desde IS NOT NULL
                                AND f.data_reuniao >= m.afastado_desde
                                AND (m.afastado_ate IS NULL OR f.data_reuniao <= m.afastado_ate))
                      LEFT JOIN votos_lidos v ON v.deliberacao_id = f.id AND v.diretor_id = m.diretor_id
                     WHERE f.data_reuniao IS NOT NULL
                     GROUP BY f.sigla, f.id) x
             WHERE x.com_voto > 0 AND x.com_voto < x.esperados
             GROUP BY x.sigla) t),

  -- ⑤ A CERTIFICACAO. As 5 atas do gabarito manual, para a subtracao banco x gabarito.
  --    ⚠️ Casado por (agencia, NUMERO) e NUNCA por data: a data e o que esta sendo consertado, e
  --    casar por ela faria o gabarito deixar de reconhecer justamente as reunioes erradas.
  --    Gabarito (conferido a mao nos PDFs): ANM 79a=2025-11-26 (49+13), 81a=2026-01-28 (64+4),
  --    83a=2026-03-25 (49+6); ANTT 1.024a=2026-01-19 (6+1), 264a RDE=2026-01-19 (2+1).
  '5_certificacao_no_banco', (
    SELECT COALESCE(jsonb_agg(to_jsonb(t) ORDER BY t.sigla, t.num), '[]'::jsonb)
      FROM (SELECT a.sigla,
                   REPLACE(COALESCE(d.numero_reuniao,''),'.','') AS num,
                   COUNT(DISTINCT d.id) AS linhas_no_banco,
                   COUNT(DISTINCT d.data_reuniao) AS datas_distintas,
                   MIN(d.data_reuniao) AS menor_data,
                   MAX(d.data_reuniao) AS maior_data,
                   COUNT(DISTINCT v.diretor_id) AS diretores_com_voto,
                   COUNT(v.*) AS votos_no_total,
                   COUNT(v.*) FILTER (WHERE v.nominal) AS votos_nominais
              FROM public.deliberacoes d
              JOIN ag a ON a.id = d.agencia_id
              LEFT JOIN votos_lidos v ON v.deliberacao_id = d.id
             WHERE (a.sigla = 'ANM'  AND REPLACE(COALESCE(d.numero_reuniao,''),'.','') IN ('79','81','83'))
                OR (a.sigla = 'ANTT' AND REPLACE(COALESCE(d.numero_reuniao,''),'.','') IN ('1024','264'))
             GROUP BY a.sigla, REPLACE(COALESCE(d.numero_reuniao,''),'.','')) t),

  -- ⑤b Os votos POR DIRETOR nas 5 atas — e o que se subtrai do gabarito diretor a diretor.
  '5b_votos_por_diretor_nas_atas_do_gabarito', (
    SELECT COALESCE(jsonb_agg(to_jsonb(t) ORDER BY t.sigla, t.num, t.nome), '[]'::jsonb)
      FROM (SELECT a.sigla, REPLACE(COALESCE(d.numero_reuniao,''),'.','') AS num,
                   dir.nome, COUNT(*) AS votos,
                   COUNT(*) FILTER (WHERE v.nominal) AS nominais,
                   COUNT(*) FILTER (WHERE v.tipo_voto = 'Ausente') AS ausentes
              FROM public.deliberacoes d
              JOIN ag a ON a.id = d.agencia_id
              JOIN votos_lidos v ON v.deliberacao_id = d.id
              JOIN public.diretores dir ON dir.id = v.diretor_id
             WHERE (a.sigla = 'ANM'  AND REPLACE(COALESCE(d.numero_reuniao,''),'.','') IN ('79','81','83'))
                OR (a.sigla = 'ANTT' AND REPLACE(COALESCE(d.numero_reuniao,''),'.','') IN ('1024','264'))
             GROUP BY a.sigla, REPLACE(COALESCE(d.numero_reuniao,''),'.',''), dir.nome) t),

  -- ⑥ A SERIE. Depois do Bloco E, reuniao NOVA de ANM/ARTESP nao deve mais nascer com serie NULL.
  --    `inferida_por_faixa` conta as que a migration marcou — elas sao inferencia, nao leitura.
  '6_serie_das_reunioes', (
    SELECT COALESCE(jsonb_agg(to_jsonb(t) ORDER BY t.sigla, t.serie), '[]'::jsonb)
      FROM (SELECT a.sigla, COALESCE(r.serie,'(nula)') AS serie, COUNT(*) AS linhas,
                   COUNT(*) FILTER (WHERE r.metadata->>'serie_inferida_por' = 'faixa') AS inferida_por_faixa,
                   MIN(r.criado_em)::date AS mais_antiga,
                   MAX(r.criado_em)::date AS mais_recente
              FROM public.reunioes r JOIN ag a ON a.id = r.agencia_id
             GROUP BY a.sigla, COALESCE(r.serie,'(nula)')) t),

  -- ⑦ A ORFA. Reuniao com ZERO deliberacao. ⚠️ O codigo so remove as de data IMPOSSIVEL; esta lista
  --    e mais larga de proposito, para o usuario ver se ha orfa PLAUSIVEL (como a de 2024-06-25) que
  --    exigiria decisao humana.
  '7_reunioes_orfas', (
    SELECT COALESCE(jsonb_agg(to_jsonb(t) ORDER BY t.sigla, t.data_reuniao), '[]'::jsonb)
      FROM (SELECT a.sigla, r.data_reuniao, r.numero_reuniao, COALESCE(r.serie,'(nula)') AS serie,
                   r.metadata->>'titulo' AS titulo
              FROM public.reunioes r
              JOIN ag a ON a.id = r.agencia_id
             WHERE NOT EXISTS (SELECT 1 FROM public.deliberacoes d WHERE d.reuniao_id = r.id)) t),

  -- ⑧ A ANAC — a pergunta que eu NAO pude responder sem o banco.
  --    MEDIDO ao vivo em 30/09: a listagem da ANAC responde 200, tem 71 links validos e a mais nova
  --    e de HOJE. Se `total = 0` aqui, o corte esta entre ACHAR o link e SALVAR o detalhe, e as duas
  --    causas plausiveis sao (a) orcamento de tempo e (b) a janela de 2000 linhas do /health.
  --    ⚠️ Se `total > 0` aqui, entao o defeito e do /health (a janela), nao da coleta.
  '8_noticias_por_agencia', (
    SELECT COALESCE(jsonb_agg(to_jsonb(t) ORDER BY t.sigla), '[]'::jsonb)
      FROM (SELECT a2.sigla, COUNT(n.*) AS total,
                   MAX(n.publicado_em)::date AS mais_nova,
                   MIN(n.publicado_em)::date AS mais_antiga,
                   COUNT(*) FILTER (WHERE n.publicado_em IS NULL) AS sem_data,
                   MAX(n.last_seen_at)::date AS visto_por_ultimo
              FROM public.agencias a2
              LEFT JOIN public.regulatory_news n ON n.agencia_id = a2.id
             WHERE a2.sigla IN ('ANAC','ANS','ANA','ANCINE','ANPD','ANATEL','ANEEL','ANP','ANTAQ','ANVISA','ANTT','ANM','ARTESP')
             GROUP BY a2.sigla) t),

  -- ⑧b Os RUNS do coletor. ⚠️ Se esta lista vier VAZIA, a migration 20260720120000 (que aceita
  --    status 'empty') provavelmente nao foi aplicada: o insert em LOTE violava o CHECK e falhava
  --    INTEIRO, com o erro so no console. Sem historico, `latest_links_found` e sempre NULL — e
  --    `NULL !== 0` faz TODA fonte parada cair em "quieta". Explicaria a tela inteira de uma vez.
  '8b_runs_do_coletor', (
    SELECT COALESCE(jsonb_agg(to_jsonb(t) ORDER BY t.sigla), '[]'::jsonb)
      FROM (SELECT a3.sigla, COUNT(*) AS runs,
                   MAX(r2.created_at)::date AS ultimo_run,
                   MAX(r2.links_detectados) AS max_links_detectados,
                   MAX(r2.itens_processados) AS max_itens_processados,
                   MAX(r2.itens_salvos) AS max_itens_salvos,
                   COUNT(*) FILTER (WHERE r2.status = 'empty') AS runs_vazios,
                   COUNT(*) FILTER (WHERE r2.status = 'error') AS runs_com_erro
              FROM public.regulatory_news_collection_runs r2
              JOIN public.monitoramento_sites ms ON ms.id = r2.site_id
              JOIN public.agencias a3 ON a3.id = ms.agencia_id
             WHERE r2.created_at >= NOW() - INTERVAL '30 days'
             GROUP BY a3.sigla) t)
)) AS qa_fase36;
