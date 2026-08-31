-- ═══════════════════════════════════════════════════════════════════════════════
-- QA DA FASE 15 — a prova dos cinco consertos (somente LEITURA)
--
-- COMO USAR: aplique ANTES as migrations 20260831120000 e 20260831130000, clique "Rodar tudo"
-- até drenar, e então cole TUDO no SQL Editor (projeto IRIS) e Run. UMA consulta; me mande o JSON.
--
-- Responde, na ordem dos consertos:
--  ① a 87ª ROP nominalmente: onde ela está presa (tipo/status/motivo/tentativas/doc/job);
--  ② itens ANM por status × tipo × motivo (o mapa do funil que o carimbo reabriu);
--  ③ o seletor dos 6 sites ANM — a órfã agora coberta?
--  ④ deliberações por agência × ano — 1996 → 0? os 74 `ano null` → quantos?
--  ⑤ ANM 2026 existe como deliberação?
--  ⑥ os 51 arquivados como pagina_institucional;
--  ⑦ o resíduo marcado para revisão de data (irrecuperáveis, com motivo);
--  ⑧ a última esteira_run — `redatadas` apareceu no contador?
-- ═══════════════════════════════════════════════════════════════════════════════

SELECT jsonb_pretty(jsonb_build_object(

  '1_ata_87_rop', (
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
             'site', t.nome, 'tipo', t.tipo, 'status', t.status, 'tentativas', t.tentativas,
             'proxima_tentativa_em', t.proxima_tentativa_em, 'motivo', t.motivo,
             'tem_documento', t.documento_id IS NOT NULL, 'tem_job', t.upload_job_id IS NOT NULL,
             'first_seen', t.first_seen_at::date, 'url', t.url_item)), '[]'::jsonb)
      FROM (
      SELECT ms.nome, mi.tipo, mi.status, mi.tentativas, mi.proxima_tentativa_em,
             mi.metadata->>'enqueue_motivo' AS motivo, mi.documento_id, mi.upload_job_id,
             mi.first_seen_at, mi.url_item
        FROM monitoramento_itens mi JOIN monitoramento_sites ms ON ms.id = mi.site_id
       WHERE mi.url_item ILIKE '%ata-87%' OR mi.titulo ILIKE '%87ª%' OR mi.titulo ILIKE '%87a %'
       LIMIT 10
    ) t
  ),

  '2_itens_anm_funil', (
    SELECT COALESCE(jsonb_agg(t ORDER BY t.total DESC), '[]'::jsonb) FROM (
      SELECT mi.status, mi.tipo, COALESCE(mi.metadata->>'enqueue_motivo','(sem motivo)') AS motivo,
             COUNT(*) AS total,
             COUNT(*) FILTER (WHERE mi.proxima_tentativa_em IS NOT NULL) AS com_carimbo_retry
        FROM monitoramento_itens mi
        JOIN monitoramento_sites ms ON ms.id = mi.site_id
        JOIN agencias a ON a.id = ms.agencia_id
       WHERE a.sigla = 'ANM' AND ms.tipo_fonte <> 'noticias'
       GROUP BY 1,2,3
    ) t
  ),

  '3_seletor_sites_anm', (
    SELECT COALESCE(jsonb_agg(jsonb_build_object('nome', ms.nome, 'url', ms.url,
             'seletor', ms.seletor_links, 'ultimo_check', ms.ultimo_check)), '[]'::jsonb)
      FROM monitoramento_sites ms JOIN agencias a ON a.id = ms.agencia_id
     WHERE a.sigla = 'ANM'
  ),

  '4_deliberacoes_por_agencia_ano', (
    SELECT COALESCE(jsonb_agg(t ORDER BY t.sigla, t.ano), '[]'::jsonb) FROM (
      SELECT COALESCE(a.sigla,'(sem agência)') AS sigla,
             EXTRACT(YEAR FROM d.data_reuniao)::int AS ano,
             COUNT(*) AS deliberacoes
        FROM deliberacoes d LEFT JOIN agencias a ON a.id = d.agencia_id
       GROUP BY 1,2
    ) t
  ),
  '4b_total_geral', (SELECT COUNT(*) FROM deliberacoes),

  '5_anm_2026', (
    SELECT jsonb_build_object(
      'deliberacoes_2026', (
        SELECT COUNT(*) FROM deliberacoes d JOIN agencias a ON a.id = d.agencia_id
         WHERE a.sigla = 'ANM' AND d.data_reuniao >= DATE '2026-01-01'
      ),
      -- documentos_regulatorios NÃO tem data_reuniao (conferido no schema) — a janela é por
      -- created_at: o que o retry do carimbo produziu de novo desde a Fase 15.
      'docs_anm_por_status', (
        SELECT COALESCE(jsonb_agg(t), '[]'::jsonb) FROM (
          SELECT dr.status, dr.tipo_documento, COUNT(*) AS total,
                 COUNT(*) FILTER (WHERE dr.created_at >= TIMESTAMPTZ '2026-08-31') AS criados_apos_31_08
            FROM documentos_regulatorios dr JOIN agencias a ON a.id = dr.agencia_id
           WHERE a.sigla = 'ANM' GROUP BY 1,2
        ) t
      )
    )
  ),

  '6_arquivados_pagina_institucional', (
    SELECT COUNT(*) FROM monitoramento_itens mi
     WHERE mi.metadata->>'enqueue_motivo' = 'pagina_institucional'
  ),

  '7_datas_para_revisao', (
    SELECT COALESCE(jsonb_agg(t ORDER BY t.total DESC), '[]'::jsonb) FROM (
      SELECT COALESCE(a.sigla,'(sem agência)') AS sigla,
             COUNT(*) AS total,
             COUNT(*) FILTER (WHERE d.data_reuniao IS NULL) AS ainda_sem_data,
             COUNT(*) FILTER (WHERE d.raw_extraction ? 'data_ausente_motivo') AS sem_fonte_derivavel,
             COUNT(*) FILTER (WHERE d.raw_extraction ? 'data_invalidada_valor') AS invalidadas
        FROM deliberacoes d LEFT JOIN agencias a ON a.id = d.agencia_id
       WHERE (d.raw_extraction->>'precisa_revisao_data') = 'true'
       GROUP BY 1
    ) t
  ),

  '8_ultima_esteira_run', (
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
             'iniciado_em', t.iniciado_em, 'status', t.status, 'rodadas', t.rodadas,
             'motivo_parada', t.motivo_parada,
             'redatadas', t.contadores->'redatadas',
             'datas_para_revisao', t.contadores->'datas_para_revisao',
             'materializados', t.contadores->'materializados',
             'votos', t.contadores->'votos')), '[]'::jsonb)
      FROM (SELECT * FROM esteira_runs ORDER BY iniciado_em DESC LIMIT 2) t
  )

));
