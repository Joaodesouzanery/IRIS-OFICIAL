-- ═══════════════════════════════════════════════════════════════════════════════
-- PORTÃO DO BLOCO A — FASE 30  (somente LEITURA · UMA instrução · colar no SQL Editor)
--
-- Ele responde as três perguntas do portão com o que está NO BANCO, não com o que a tela diz.
--
-- ⚠️ POR QUE ELE EXISTE, em vez de repetir o bloco ① do `qa-fase29.sql`:
-- aquele bloco divide por `COALESCE(concluido_em, atualizado_em)`, e `reaparRunsOrfas` grava
-- `concluido_em` TRÊS MINUTOS depois (24 h nas runs do cron). Foi essa fórmula que produziu o
-- fantasma "196 s por rodada" numa run que fazia 42,8. Aqui as DUAS aparecem lado a lado, para o
-- erro ficar visível em vez de ser corrigido em silêncio.
--
-- ① A RUN TERMINOU?         esperado: `concluido` (ou `running`, se ainda está rodando).
--                           `erro` com motivo de reaper = morreu sem fechar a própria linha.
-- ② APARECEU 409 DA CERCA?  esperado: `motivos_de_cerca` VAZIO. Qualquer linha aqui nomeia a
--                           causa — e é exatamente isso que os quatro desfechos existem para dar.
-- ③ A LEASE ESTÁ VIVA?      `rodadas_concluidas` presente e IGUAL a `rodadas` numa run fechada.
--                           `em_voo > 0` numa run fechada = rodada que morreu sem gravar.
-- ④ O REGISTRO GRAVOU?      esperado: zero runs paradas por "o registro não gravou". Se houver,
--                           é o caso NOVO do commit 3d71779 — diagnóstico, não regressão.
-- ⑤ O 110s DEIXOU RASTRO?   os documentos que a função abandonou no meio (timeout/SIGKILL), por
--                           agência e por ciclo de reprocesso. É o outro lado do mesmo relógio.
-- ═══════════════════════════════════════════════════════════════════════════════

SELECT jsonb_pretty(jsonb_build_object(

  '1_a_run_terminou', (
    SELECT COALESCE(jsonb_agg(t ORDER BY t.iniciado_em DESC), '[]'::jsonb) FROM (
      SELECT r.id, r.origem, r.status, r.rodadas,
             r.passos_ok, r.passos_erro, r.iniciado_em,
             left(COALESCE(r.motivo_parada, ''), 180) AS motivo_parada,
             -- A fórmula HONESTA: `atualizado_em` é escrito pela própria rodada.
             CASE WHEN r.rodadas > 0 THEN
               round(EXTRACT(EPOCH FROM (r.atualizado_em - r.iniciado_em))::numeric / r.rodadas, 1)
             END AS seg_por_rodada,
             -- A fórmula da Fase 29, para o fantasma ficar à vista quando as duas divergirem.
             CASE WHEN r.rodadas > 0 THEN
               round(EXTRACT(EPOCH FROM (COALESCE(r.concluido_em, r.atualizado_em) - r.iniciado_em))::numeric / r.rodadas, 1)
             END AS seg_por_rodada_formula_f29
        FROM esteira_runs r
       ORDER BY r.iniciado_em DESC
       LIMIT 6
    ) t
  ),

  -- ② Se vier vazio, a porta segurou. Se vier alguma linha, ela DIZ qual dos quatro casos foi.
  '2_motivos_de_cerca', (
    SELECT COALESCE(jsonb_agg(t ORDER BY t.iniciado_em DESC), '[]'::jsonb) FROM (
      SELECT r.id, r.status, r.iniciado_em, left(r.motivo_parada, 200) AS motivo_parada
        FROM esteira_runs r
       WHERE r.motivo_parada IS NOT NULL
         AND (r.motivo_parada ILIKE '%invoca%'        -- "Outra invocação desta execução…"
           OR r.motivo_parada ILIKE '%outra aba%'     -- run_alheia
           OR r.motivo_parada ILIKE '%rodada atual%'  -- token_ausente / token_vencido
           OR r.motivo_parada ILIKE '%foi encerrada%')-- run_encerrada
         AND r.iniciado_em > now() - interval '3 days'
       ORDER BY r.iniciado_em DESC
       LIMIT 10
    ) t
  ),

  -- ③ A lease. Numa run FECHADA, `em_voo` tem de ser 0: rodadas reivindicadas == concluídas.
  '3_a_lease', (
    SELECT COALESCE(jsonb_agg(t ORDER BY t.iniciado_em DESC), '[]'::jsonb) FROM (
      SELECT r.id, r.status, r.rodadas,
             (r.contadores ->> 'rodadas_concluidas') AS rodadas_concluidas,
             CASE WHEN r.contadores ? 'rodadas_concluidas'
                  THEN r.rodadas - (r.contadores ->> 'rodadas_concluidas')::int
             END AS em_voo,
             (r.contadores ? 'rodadas_concluidas') AS tem_a_chave,
             r.iniciado_em
        FROM esteira_runs r
       WHERE r.iniciado_em > now() - interval '3 days'
       ORDER BY r.iniciado_em DESC
       LIMIT 6
    ) t
  ),

  -- ④ O caso NOVO. Esperado: lista vazia.
  '4_registro_que_nao_gravou', (
    SELECT COALESCE(jsonb_agg(t ORDER BY t.iniciado_em DESC), '[]'::jsonb) FROM (
      SELECT r.id, r.status, r.rodadas, r.iniciado_em, left(r.motivo_parada, 200) AS motivo_parada
        FROM esteira_runs r
       WHERE r.motivo_parada ILIKE '%registro%'
         AND r.iniciado_em > now() - interval '3 days'
       ORDER BY r.iniciado_em DESC
       LIMIT 10
    ) t
  ),

  -- ⑤ O rastro do relógio: o que a função abandonou no meio.
  '5_abandonado_pela_funcao', (
    SELECT COALESCE(jsonb_agg(t ORDER BY t.documentos DESC), '[]'::jsonb) FROM (
      SELECT COALESCE(a.sigla, '?') AS sigla,
             dr.status,
             CASE
               WHEN dr.error_message ILIKE '%SIGKILL%' OR dr.error_message ILIKE '%interrompid%'
                 THEN 'abandonado_pela_funcao'
               WHEN dr.error_message ILIKE '%download%' THEN 'falha_de_download'
               WHEN dr.error_message IS NULL THEN 'sem_motivo'
               ELSE 'outro'
             END AS familia,
             COALESCE((dr.campos_detectados ->> 'reprocessos_falha')::int, 0) AS ciclos,
             COUNT(*) AS documentos,
             max(dr.updated_at) AS mais_recente
        FROM documentos_regulatorios dr
        LEFT JOIN agencias a ON a.id = dr.agencia_id
       WHERE dr.status IN ('failed', 'processing', 'queued')
       GROUP BY 1, 2, 3, 4
    ) t
  ),

  -- ⑤b O elo documento↔job nos estados inválidos: o defeito que custou 62 documentos na Fase 10.
  '5b_elo_documento_job', (
    SELECT jsonb_build_object(
      'queued_com_job_done', (
        SELECT COUNT(*) FROM documentos_regulatorios dr
         JOIN upload_jobs j ON j.id = dr.upload_job_id
        WHERE dr.status = 'queued' AND j.status = 'done'),
      'failed_com_job_pending', (
        SELECT COUNT(*) FROM documentos_regulatorios dr
         JOIN upload_jobs j ON j.id = dr.upload_job_id
        WHERE dr.status = 'failed' AND j.status = 'pending'),
      'job_pending_sem_documento', (
        SELECT COUNT(*) FROM upload_jobs j
        WHERE j.status = 'pending' AND j.documento_id IS NULL),
      'fila_pendente_agora', (SELECT COUNT(*) FROM upload_jobs WHERE status = 'pending')
    )
  )

)) AS qa_portao_fase30;
