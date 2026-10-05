-- ════════════════════════════════════════════════════════════════════════════════════════════════
-- QA da Fase 39 — datas, depois votos. SOMENTE LEITURA. Rode no SQL Editor DEPOIS de:
--   Rodar Tudo (grava a referência) → Datas a corrigir: Medir/Aplicar → Revoto: Simular/Aplicar.
-- Cada bloco devolve uma linha JSON com o nome do bloco.
-- ════════════════════════════════════════════════════════════════════════════════════════════════

-- ① O SQL A de novo: votos NOMINAIS da ANTT fora do mandato, por ano da data gravada.
--    Esperado depois das correções: as reuniões 282, 286, 1.035 e 289 SOMEM (data certa = 2026,
--    roster de 2026); o que sobrar sem número é voto individual que a âncora não alcançou.
WITH ag AS (SELECT id FROM agencias WHERE sigla = 'ANTT'),
mand AS (
  SELECT m.diretor_id, m.data_inicio, m.data_fim FROM mandatos m
  JOIN diretores d ON d.id = m.diretor_id
  WHERE d.agencia_id = (SELECT id FROM ag) AND m.fonte_dado <> 'automatico' AND d.review_status = 'aprovado'),
fora AS (
  SELECT de.id, de.numero_reuniao, de.data_reuniao
  FROM deliberacoes de
  JOIN votos v ON v.deliberacao_id = de.id
  WHERE de.agencia_id = (SELECT id FROM ag)
    AND (CASE WHEN to_jsonb(v) ? 'proveniencia' AND to_jsonb(v)->>'proveniencia' IS NOT NULL
              THEN to_jsonb(v)->>'proveniencia' IN ('nominal','revisao_humana')
              ELSE COALESCE(v.is_nominal, false) END)
    AND de.data_reuniao IS NOT NULL
    AND NOT EXISTS (SELECT 1 FROM mand m WHERE m.diretor_id = v.diretor_id
                    AND m.data_inicio <= de.data_reuniao
                    AND (m.data_fim IS NULL OR m.data_fim >= de.data_reuniao)))
SELECT jsonb_build_object(
  'bloco', '1_antt_nominal_fora_do_mandato',
  'com_numero', (SELECT COUNT(DISTINCT id) FROM fora WHERE numero_reuniao IS NOT NULL),
  'sem_numero', (SELECT COUNT(DISTINCT id) FROM fora WHERE numero_reuniao IS NULL),
  'reunioes', (SELECT jsonb_agg(DISTINCT numero_reuniao) FROM fora WHERE numero_reuniao IS NOT NULL),
  'votos', (SELECT COUNT(*) FROM fora)
) AS resultado;

-- ② O que o painel "Datas a corrigir" gravou, por janela e agência — com o rastro.
SELECT jsonb_build_object(
  'bloco', '2_datas_corrigidas',
  'por_janela', COALESCE((
    SELECT jsonb_object_agg(k, n) FROM (
      SELECT (a.sigla || ' · ' || (de.raw_extraction->>'data_corrigida_por')) AS k, COUNT(*) AS n
      FROM deliberacoes de JOIN agencias a ON a.id = de.agencia_id
      WHERE de.raw_extraction ? 'data_corrigida_por'
      GROUP BY 1) t), '{}'::jsonb),
  'amostra', COALESCE((
    SELECT jsonb_agg(x) FROM (
      SELECT a.sigla, de.numero_reuniao, de.raw_extraction->>'data_anterior' AS de, de.data_reuniao AS para,
             de.raw_extraction->>'data_corrigida_fonte' AS fonte
      FROM deliberacoes de JOIN agencias a ON a.id = de.agencia_id
      WHERE de.raw_extraction ? 'data_corrigida_por'
      ORDER BY de.raw_extraction->>'data_corrigida_em' DESC LIMIT 15) x), '[]'::jsonb)
) AS resultado;

-- ③ Números com MAIS DE UMA data no ano (ARTESP 1177/1178/1182/1192/1200/239 no QA de 04/10).
--    Esperado: zero depois da janela "referência".
SELECT jsonb_build_object(
  'bloco', '3_numero_com_duas_datas',
  'casos', COALESCE((
    SELECT jsonb_agg(x) FROM (
      SELECT a.sigla, r.numero_reuniao, COALESCE(r.serie, '?') AS serie,
             jsonb_agg(DISTINCT r.data_reuniao ORDER BY r.data_reuniao) AS datas
      FROM reunioes r JOIN agencias a ON a.id = r.agencia_id
      WHERE r.data_reuniao >= '2026-01-01' AND r.data_reuniao <= '2026-12-31' AND r.numero_reuniao IS NOT NULL
      GROUP BY a.sigla, r.numero_reuniao, COALESCE(r.serie, '?')
      HAVING COUNT(DISTINCT r.data_reuniao) > 1) x), '[]'::jsonb)
) AS resultado;

-- ④ As mães da ANM do gabarito: data gravada × data certificada.
SELECT jsonb_build_object(
  'bloco', '4_anm_maes_do_gabarito',
  'maes', COALESCE((
    SELECT jsonb_agg(x ORDER BY x.numero_reuniao) FROM (
      SELECT DISTINCT de.numero_reuniao, de.data_reuniao,
             CASE de.numero_reuniao WHEN '79' THEN '2025-11-26' WHEN '81' THEN '2026-01-28'
                                    WHEN '82' THEN '2026-02-23' WHEN '83' THEN '2026-03-25' END AS certificada
      FROM deliberacoes de JOIN agencias a ON a.id = de.agencia_id
      WHERE a.sigla = 'ANM' AND de.numero_reuniao IN ('79','81','82','83')
        AND EXISTS (SELECT 1 FROM deliberacoes f WHERE f.documento_pai_id = de.id)) x), '[]'::jsonb)
) AS resultado;

-- ⑤ A referência do site gravada (portão 1 do livro-razão).
SELECT jsonb_build_object(
  'bloco', '5_referencia',
  'reunioes_por_agencia', COALESCE((
    SELECT jsonb_object_agg(a.sigla, n) FROM (
      SELECT agencia_id, COUNT(*) AS n FROM reunioes_referencia GROUP BY agencia_id) t
    JOIN agencias a ON a.id = t.agencia_id), '{}'::jsonb),
  'fontes', COALESCE((
    SELECT jsonb_agg(jsonb_build_object('fonte', fonte, 'ultima_boa_em', ultima_boa_em,
                                        'ultima_tentativa_em', ultima_tentativa_em, 'ultimo_erro', ultimo_erro))
    FROM referencia_fontes), '[]'::jsonb)
) AS resultado;

-- ⑥ O revoto aplicado (auditoria) — quantos votos inferidos saíram, por quê.
SELECT jsonb_build_object(
  'bloco', '6_revoto_auditado',
  'registros', (SELECT COUNT(*) FROM votos_retroativos_audit WHERE detalhe->>'tipo' = 'revoto_por_data_corrigida'),
  'votos_removidos', (SELECT COALESCE(SUM((detalhe->>'votos_a_remover')::int), 0)
                      FROM votos_retroativos_audit WHERE detalhe->>'tipo' = 'revoto_por_data_corrigida')
) AS resultado;
