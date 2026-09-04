-- ═══════════════════════════════════════════════════════════════════════════════
-- QA DA FASE 18 — as três medições que decidem a próxima fase (somente LEITURA)
--
-- ORDEM: deploy verde → aplicar 20260905120000_alerta_de_fonte_sem_item.sql → "Rodar tudo"
--        → colar isto e devolver o JSON.
--
-- ① OS 44 VOTOS ILEGÍVEIS, com KB/PÁGINA — a medição que decide OCR × parser:
--    arquivo PESADO com zero texto = escaneado de verdade → OCR é a resposta;
--    arquivo LEVE com zero texto = codificação que o pdf-parse não decodifica → conserto de
--    PARSER, muito mais barato, e o OCR seria a resposta errada.
-- ② OS 267 ITENS DE ATA SEM RESULTADO — separa "retirado de pauta" (normal) de
--    "dispositivo não extraído" (lacuna).
-- ③ `extracao_metodo` na COLUNA CERTA (o "(não registrado)" em 1087/1087 foi defeito da minha
--    consulta anterior: o caminho é campos_detectados→preview→extraction_raw).
-- ④ A IDADE DA FILA — o poço que o commit 1 desta fase pode criar: acelerar a descoberta ~25×
--    sem acelerar o download alarga o vão entre descoberto e baixado.
-- ⑤ O alarme voltou a gravar? (a regressão do item_id NOT NULL)
-- ═══════════════════════════════════════════════════════════════════════════════

SELECT jsonb_pretty(jsonb_build_object(

  '1_votos_ilegiveis_ocr_ou_parser', (
    SELECT jsonb_build_object(
      'resumo', (
        SELECT COALESCE(jsonb_agg(t ORDER BY t.total DESC), '[]'::jsonb) FROM (
          SELECT COALESCE(a.sigla,'?') AS sigla,
                 dr.tipo_documento,
                 dr.status,
                 dr.campos_detectados->>'arquivado_motivo' AS motivo,
                 COUNT(*) AS total,
                 ROUND(AVG(dr.size_bytes)::numeric / 1024, 1) AS kb_medio,
                 ROUND(AVG(NULLIF(dr.page_count, 0))::numeric, 1) AS paginas_medias,
                 ROUND(AVG(dr.size_bytes::numeric / NULLIF(dr.page_count,0)) / 1024, 1) AS kb_por_pagina
            FROM documentos_regulatorios dr LEFT JOIN agencias a ON a.id = dr.agencia_id
           WHERE COALESCE(dr.chars_per_page, 0) < 80
           GROUP BY 1,2,3,4
        ) t
      ),
      -- O veredito por documento: PESADO sem texto = escaneado; LEVE sem texto = parser.
      'amostra', (
        SELECT COALESCE(jsonb_agg(jsonb_build_object(
                 'filename', LEFT(dr.filename, 70),
                 'kb_por_pagina', ROUND(dr.size_bytes::numeric / NULLIF(dr.page_count,0) / 1024, 1),
                 'paginas', dr.page_count,
                 'chars_por_pagina', dr.chars_per_page,
                 'motivo', dr.campos_detectados->>'arquivado_motivo',
                 'inicio_do_texto', LEFT(COALESCE(dr.texto_extraido, ''), 60),
                 'veredito', CASE
                   WHEN dr.size_bytes::numeric / NULLIF(dr.page_count,0) / 1024 >= 100 THEN 'provavel ESCANEADO (OCR)'
                   WHEN dr.size_bytes::numeric / NULLIF(dr.page_count,0) / 1024 < 30 THEN 'provavel PARSER (codificacao)'
                   ELSE 'inconclusivo' END)), '[]'::jsonb)
          FROM (SELECT * FROM documentos_regulatorios
                 WHERE COALESCE(chars_per_page, 0) < 80 ORDER BY size_bytes DESC NULLS LAST LIMIT 15) dr
      )
    )
  ),

  '2_ata_sem_resultado', (
    SELECT jsonb_build_object(
      'por_agencia', (
        SELECT COALESCE(jsonb_agg(t ORDER BY t.total DESC), '[]'::jsonb) FROM (
          SELECT COALESCE(a.sigla,'?') AS sigla, COUNT(*) AS total,
                 -- "Retirado/vista/sobrestado" é desfecho NORMAL registrado noutro campo.
                 -- ⚠️ CORRIGIDO na Fase 19. Este bloco lia `raw_extraction->>'decisao'` e
                 -- `fundamento_decisao` — DOIS caminhos que, para filho de ata, nunca são
                 -- escritos: `decisao` é omissão DECLARADA do raw (ata-item-materializacao.ts:51,
                 -- "vira a coluna resumo_pleito") e `fundamento_decisao` só é gravado no ramo
                 -- demo. Por isso davam 0 em 100% dos casos — e 100% é a assinatura de consulta
                 -- errada, não de dado uniforme. O dispositivo mora em `resumo_pleito`.
                 COUNT(*) FILTER (WHERE COALESCE(d.resumo_pleito,'') <> '') AS tem_dispositivo,
                 COUNT(*) FILTER (WHERE COALESCE(d.resumo_pleito,'') = '') AS sem_dispositivo
            FROM deliberacoes d LEFT JOIN agencias a ON a.id = d.agencia_id
           WHERE d.tipo_documento = 'ata' AND d.documento_pai_id IS NOT NULL AND d.resultado IS NULL
           GROUP BY 1
        ) t
      ),
      'tem_voto', (
        SELECT COUNT(*) FROM deliberacoes d
         WHERE d.tipo_documento = 'ata' AND d.documento_pai_id IS NOT NULL AND d.resultado IS NULL
           AND EXISTS (SELECT 1 FROM votos v WHERE v.deliberacao_id = d.id)
      ),
      'amostra', (
        SELECT COALESCE(jsonb_agg(jsonb_build_object(
                 'numero', d.numero_deliberacao, 'assunto', LEFT(COALESCE(d.assunto,''), 70),
                 'dispositivo', LEFT(COALESCE(d.resumo_pleito,''), 70))), '[]'::jsonb)
          FROM (SELECT * FROM deliberacoes
                 WHERE tipo_documento = 'ata' AND documento_pai_id IS NOT NULL AND resultado IS NULL
                 LIMIT 10) d
      )
    )
  ),

  '3_extracao_metodo', (
    -- ⚠️ O caminho CERTO: campos_detectados → preview → extraction_raw → extracao_metodo.
    -- A consulta da Fase 17 leu `campos_detectados->>'extracao_metodo'` e por isso devolveu
    -- "(nao registrado)" em 1087/1087 — defeito da consulta, não do código.
    SELECT COALESCE(jsonb_agg(t), '[]'::jsonb) FROM (
      SELECT COALESCE(dr.campos_detectados->'preview'->'extraction_raw'->>'extracao_metodo',
                      '(nao registrado)') AS metodo,
             COUNT(*) AS total
        FROM documentos_regulatorios dr GROUP BY 1
    ) t
  ),

  '4_idade_da_fila', (
    -- O poço que o commit 1 pode criar: descoberta acelerada ~25× com download no mesmo ritmo.
    SELECT COALESCE(jsonb_agg(t ORDER BY t.dias_do_mais_antigo DESC NULLS LAST), '[]'::jsonb) FROM (
      SELECT COALESCE(a.sigla,'?') AS sigla, mi.tipo, COUNT(*) AS total_novos,
             MAX(EXTRACT(DAY FROM (NOW() - mi.first_seen_at)))::int AS dias_do_mais_antigo,
             COUNT(*) FILTER (WHERE mi.first_seen_at < NOW() - INTERVAL '7 days')  AS parados_ha_7d,
             COUNT(*) FILTER (WHERE mi.first_seen_at < NOW() - INTERVAL '30 days') AS parados_ha_30d
        FROM monitoramento_itens mi
        JOIN monitoramento_sites ms ON ms.id = mi.site_id
        LEFT JOIN agencias a ON a.id = ms.agencia_id
       WHERE mi.status = 'novo' AND ms.tipo_fonte <> 'noticias'
       GROUP BY 1,2
    ) t
  ),

  '5_alarme_voltou_a_gravar', (
    SELECT jsonb_build_object(
      'por_tipo', (
        SELECT COALESCE(jsonb_agg(t ORDER BY t.total DESC), '[]'::jsonb) FROM (
          SELECT al.tipo, COUNT(*) AS total, MAX(al.created_at)::date AS mais_recente
            FROM monitoramento_alertas al GROUP BY 1
        ) t
      ),
      'de_fonte_sem_item', (
        SELECT COUNT(*) FROM monitoramento_alertas WHERE item_id IS NULL
      )
    )
  ),

  '6_cobertura_por_fonte', (
    SELECT COALESCE(jsonb_agg(t ORDER BY t.sigla, t.nome), '[]'::jsonb) FROM (
      SELECT COALESCE(a.sigla,'?') AS sigla, ms.nome, ms.ultimo_check::date AS ultimo_check,
             (SELECT mr.itens_encontrados FROM monitoramento_runs mr
               WHERE mr.site_id = ms.id AND mr.finished_at IS NOT NULL
               ORDER BY mr.started_at DESC LIMIT 1)                          AS itens_ultima,
             (SELECT mr.novos_itens FROM monitoramento_runs mr
               WHERE mr.site_id = ms.id AND mr.finished_at IS NOT NULL
               ORDER BY mr.started_at DESC LIMIT 1)                          AS novos_ultima,
             (SELECT MAX(mi.first_seen_at)::date FROM monitoramento_itens mi
               WHERE mi.site_id = ms.id)                                     AS ultimo_item_novo
        FROM monitoramento_sites ms LEFT JOIN agencias a ON a.id = ms.agencia_id
       WHERE ms.tipo_fonte <> 'noticias' AND ms.ativo
    ) t
  )

));
