-- ═══════════════════════════════════════════════════════════════════════════════
-- QA DA FASE 29 — a esteira que termina, a fila que drena, e o voto auditável
-- (somente LEITURA — uma instrução)
--
-- ORDEM: deploy verde → "Rodar tudo" → colar. Depois, abra a aba "Auditoria de votos".
--
-- ⚠️ O QUE MUDOU, e por isso o que este QA mede é DIFERENTE do da Fase 28.
-- A Fase 28 provou que o parser NÃO era a causa do "90s sem resposta" (`timeout_do_parser: 0`,
-- `motivo_preservado: 0`). A causa medida eram três coisas que ninguém cronometrava:
--   1. os reapers rodando DUAS vezes por rodada (a segunda saía da fatia da extração);
--   2. o reaper de fila fazendo UMA consulta por documento, com freio só nos 2s finais;
--   3. o download do Storage SEM timeout e FORA da corrida contra o relógio.
-- Os três estão consertados. Estes blocos medem se o efeito apareceu.
--
-- ① A RUN TERMINA — esperado: a última execução com `status='concluido'` (não 'erro'), e
--    `segundos_por_rodada` ≤ ~80. Se vier 'erro' com "90s", nada mais importa primeiro.
--    ⚠️ O cliente agora espera 110s na esteira, então "passou de 90s" não deve mais aparecer.
-- ② A FILA DRENA — esperado: a linha `queued` da ARTESP some ou cai perto de zero (eram 25).
--    É o número que mostra o laço quebrado: os 25 encareciam o reaper, e o reaper impedia a
--    extração de alcançá-los.
-- ③ VAZÃO — esperado: ≥ 8 jobs por rodada (era 0,2 — a extração iniciou 2 jobs em 10 rodadas).
-- ④ OS NOVOS MOTIVOS DE FALHA são PRESERVADOS, não silêncio. `download_estourou` > 0 não é
--    problema: é o teto funcionando e dizendo o nome. O que seria problema é voltar a aparecer
--    "Processamento interrompido (timeout/SIGKILL)" em massa, que é o reaper achando documento
--    que a função abandonou.
-- ⑤ A CERCA — `rodadas` de cada run tem de ser monotônico e sem saltos de 2 em 2. Salto de 2
--    significaria que `registrarRodada` voltou a incrementar junto com o claim.
-- ⑥ O RELATÓRIO deixou de subcontar: `votos_no_banco` contra o teto antigo de 1.000/agência.
-- ⑦ A AUDITORIA POR VOTO — o material da aba nova: quantos votos, quantos com PDF alcançável, e
--    o número que responde "os diretores deveriam ter a mesma quantidade?": deliberações em que
--    parte do colegiado tem voto e parte não.
-- ═══════════════════════════════════════════════════════════════════════════════

SELECT jsonb_pretty(jsonb_build_object(

  '1_a_run_termina', (
    SELECT COALESCE(jsonb_agg(t ORDER BY t.iniciado_em DESC), '[]'::jsonb) FROM (
      SELECT r.id, r.origem, r.status, r.rodadas, r.passos_ok, r.passos_erro,
             r.iniciado_em,
             left(COALESCE(r.motivo_parada, ''), 120) AS motivo_parada,
             CASE WHEN r.rodadas > 0 THEN
               round(EXTRACT(EPOCH FROM (COALESCE(r.concluido_em, r.atualizado_em) - r.iniciado_em))::numeric / r.rodadas, 1)
             END AS segundos_por_rodada
        FROM esteira_runs r
       ORDER BY r.iniciado_em DESC
       LIMIT 5
    ) t
  ),

  '2_a_fila_drena', (
    SELECT COALESCE(jsonb_agg(t ORDER BY t.status, t.sigla), '[]'::jsonb) FROM (
      SELECT COALESCE(a.sigla, '?') AS sigla, dr.status, COUNT(*) AS documentos
        FROM documentos_regulatorios dr
        LEFT JOIN agencias a ON a.id = dr.agencia_id
       WHERE dr.status IN ('queued', 'processing', 'failed')
       GROUP BY 1, 2
    ) t
  ),

  '3_vazao', (
    SELECT jsonb_build_object(
      'ultima_run_rodadas', r.rodadas,
      'processados_na_run', COALESCE((r.contadores->>'processados')::numeric, 0),
      'jobs_por_rodada', CASE WHEN r.rodadas > 0
        THEN round(COALESCE((r.contadores->>'processados')::numeric, 0) / r.rodadas, 2) END,
      'materializados_na_run', COALESCE((r.contadores->>'materializados')::numeric, 0)
    ) FROM esteira_runs r ORDER BY r.iniciado_em DESC LIMIT 1
  ),

  '4_motivos_preservados', (
    SELECT jsonb_build_object(
      -- O teto FUNCIONANDO e dizendo o nome. > 0 aqui é saúde, não defeito.
      'download_estourou', COUNT(*) FILTER (WHERE error_message ILIKE '%Download do PDF excedeu%'),
      'round_trip_do_supabase', COUNT(*) FILTER (WHERE error_message ILIKE '%Round-trip do Supabase excedeu%'),
      'timeout_do_parser', COUNT(*) FILTER (WHERE error_message ILIKE '%Timeout ao processar PDF%'),
      'parser_sem_isolamento', COUNT(*) FILTER (WHERE error_message ILIKE '%parser_sem_isolamento%'),
      'fatia_acabou', COUNT(*) FILTER (WHERE error_message ILIKE '%Excedeu a fatia de extração%'),
      -- ⚠️ ESTE é o que tem de CAIR: é o reaper achando documento que a função abandonou.
      'abandonado_pela_funcao', COUNT(*) FILTER (WHERE error_message ILIKE '%timeout/SIGKILL%'),
      'sem_via_de_reprocesso', COUNT(*) FILTER (WHERE error_message ILIKE '%sem upload_job utilizável%')
    ) FROM documentos_regulatorios
  ),

  '5_a_cerca_da_run', (
    SELECT COALESCE(jsonb_agg(t ORDER BY t.iniciado_em DESC), '[]'::jsonb) FROM (
      SELECT r.id, r.rodadas, r.iniciado_em, r.status,
             -- A soma dos passos deve acompanhar as rodadas. Se `rodadas` for ~2x o esperado,
             -- `registrarRodada` voltou a incrementar junto com o claim.
             r.passos_ok + r.passos_erro AS passos_totais
        FROM esteira_runs r ORDER BY r.iniciado_em DESC LIMIT 5
    ) t
  ),

  '6_o_relatorio_ve_tudo', (
    SELECT jsonb_build_object(
      'votos_no_banco', (SELECT COUNT(*) FROM votos),
      'teto_antigo_por_agencia', 1000,
      'votos_por_agencia', COALESCE((
        SELECT jsonb_object_agg(sigla, n) FROM (
          SELECT COALESCE(a.sigla, '?') AS sigla, COUNT(*) AS n
            FROM votos v
            JOIN diretores di ON di.id = v.diretor_id
            LEFT JOIN agencias a ON a.id = di.agencia_id
           GROUP BY 1
        ) q), '{}'::jsonb)
    )
  ),

  '7_auditoria_por_voto', (
    SELECT jsonb_build_object(
      'votos_total', (SELECT COUNT(*) FROM votos),
      'lidos', (SELECT COUNT(*) FROM votos WHERE proveniencia IN ('nominal','revisao_humana') OR (proveniencia IS NULL AND is_nominal)),
      'inferidos', (SELECT COUNT(*) FROM votos WHERE proveniencia IN ('inferido_unanimidade','inferido_decisao') OR (proveniencia IS NULL AND NOT is_nominal)),
      'com_motivo_nao_voto', (SELECT COUNT(*) FROM votos WHERE motivo_nao_voto IS NOT NULL),
      'em_autos', (SELECT COUNT(*) FROM votos WHERE voto_em_autos IS TRUE),
      -- A deliberação cujo PDF a aba consegue abrir: o documento ligado a ela OU ao pai.
      'deliberacoes_com_pdf_alcancavel', (
        SELECT COUNT(DISTINCT d.id) FROM deliberacoes d
         WHERE EXISTS (SELECT 1 FROM documentos_regulatorios dr
                        WHERE dr.deliberacao_id = COALESCE(d.documento_pai_id, d.id)
                          AND dr.storage_path IS NOT NULL)
      ),
      -- ⚠️ O NÚMERO QUE RESPONDE "os diretores não deveriam ter a mesma quantidade de votos?"
      -- Não deveriam (mandato, ausência, relatoria). O sintoma REAL é este: na MESMA deliberação,
      -- parte do colegiado tem voto e parte não. Mesmo roster do motor que cria os votos.
      'deliberacoes_com_colegiado_incompleto', (
        SELECT COUNT(*) FROM (
          SELECT d.id,
                 (SELECT COUNT(DISTINCT v.diretor_id) FROM votos v WHERE v.deliberacao_id = d.id) AS votaram,
                 (SELECT COUNT(DISTINCT mn.diretor_id)
                    FROM mandatos mn JOIN diretores di ON di.id = mn.diretor_id
                   WHERE di.agencia_id = d.agencia_id
                     AND di.review_status = 'aprovado'
                     AND mn.fonte_dado <> 'automatico'
                     AND mn.data_inicio <= d.data_reuniao
                     AND (mn.data_fim IS NULL OR mn.data_fim >= d.data_reuniao)) AS esperados
            FROM deliberacoes d
           WHERE d.data_reuniao >= '2026-01-01' AND d.data_reuniao <= '2026-12-31'
             AND EXISTS (SELECT 1 FROM votos v WHERE v.deliberacao_id = d.id)
        ) q WHERE q.esperados > 0 AND q.votaram < q.esperados
      ),
      -- Erro de atribuição: voto cuja agência do diretor difere da agência da deliberação.
      'votos_com_agencia_divergente', (
        SELECT COUNT(*) FROM votos v
          JOIN diretores di ON di.id = v.diretor_id
          JOIN deliberacoes d ON d.id = v.deliberacao_id
         WHERE di.agencia_id IS DISTINCT FROM d.agencia_id
      )
    )
  )

));
