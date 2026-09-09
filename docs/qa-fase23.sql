-- ═══════════════════════════════════════════════════════════════════════════════
-- QA DA FASE 23 — as 20 atas sem itens, as duplicatas liberadas, a represa aberta
-- (somente LEITURA — uma instrução)
--
-- ORDEM: deploy verde → "Rodar tudo" (2 runs: a 2ª arquiva os irmãos das duplicatas) → colar.
--
-- ① AS ATAS SEM ITENS — 18 ARTESP + 2 ANTT paradas em "Revisar" porque o splitter devolveu ZERO
--    itens. `page_count`/`chars_per_page`/os 200 primeiros chars dizem se é ata de verdade
--    (splitter a consertar) ou capa/anexo (arquivar). VOCÊ decide, linha a linha.
-- ② EXCEÇÕES POR MOTIVO, depois — o C06 deve ter sumido; "possível duplicata" deve ter caído.
-- ③ VOTOS DA ARTESP antes/depois da represa — esperado: subiu (as 85 confirmadas).
-- ═══════════════════════════════════════════════════════════════════════════════

SELECT jsonb_pretty(jsonb_build_object(

  '1_atas_sem_itens', (
    SELECT COALESCE(jsonb_agg(t ORDER BY t.sigla, t.filename), '[]'::jsonb) FROM (
      SELECT COALESCE(a.sigla,'?') AS sigla,
             dr.filename,
             dr.page_count,
             dr.chars_per_page,
             dr.extraction_confidence,
             COALESCE(dr.campos_detectados->>'auto_skip', '') AS motivo,
             left(regexp_replace(COALESCE(dr.texto_extraido, ''), '\s+', ' ', 'g'), 200) AS inicio_do_texto
        FROM documentos_regulatorios dr
        LEFT JOIN agencias a ON a.id = dr.agencia_id
       WHERE dr.status = 'review_pending'
         AND dr.tipo_documento = 'ata'
         AND (dr.campos_detectados->>'auto_skip' ILIKE '%sem itens%' OR dr.campos_detectados->>'auto_skip' = 'não conta como final')
    ) t
  ),

  '2_motivo_das_excecoes', (
    SELECT COALESCE(jsonb_agg(t ORDER BY t.documentos DESC), '[]'::jsonb) FROM (
      SELECT COALESCE(a.sigla,'?') AS sigla, COALESCE(dr.tipo_documento,'?') AS tipo,
             COALESCE(dr.campos_detectados->>'auto_skip', '(sem motivo gravado)') AS motivo,
             COUNT(*) AS documentos
        FROM documentos_regulatorios dr LEFT JOIN agencias a ON a.id = dr.agencia_id
       WHERE dr.status = 'review_pending'
       GROUP BY 1, 2, 3
    ) t
  ),

  '3_votos_por_agencia', (
    SELECT COALESCE(jsonb_agg(t ORDER BY t.votos DESC), '[]'::jsonb) FROM (
      SELECT COALESCE(a.sigla,'?') AS sigla, COUNT(v.id) AS votos,
             COUNT(v.id) FILTER (WHERE v.is_nominal) AS nominais,
             COUNT(DISTINCT v.deliberacao_id) AS deliberacoes_com_voto
        FROM votos v JOIN deliberacoes d ON d.id = v.deliberacao_id
        LEFT JOIN agencias a ON a.id = d.agencia_id
       GROUP BY 1
    ) t
  ),

  '4_duplicatas_arquivadas_pelo_auto_confirm', (
    SELECT jsonb_build_object(
      'exatas', COUNT(*) FILTER (WHERE campos_detectados->>'arquivado_motivo' = 'duplicata_exata'),
      'semanticas', COUNT(*) FILTER (WHERE campos_detectados->>'arquivado_motivo' = 'duplicata_semantica'),
      'ainda_marcadas_na_fila', (SELECT COUNT(*) FROM documentos_regulatorios WHERE status = 'review_pending' AND is_duplicate)
    ) FROM documentos_regulatorios WHERE status = 'ignored'
  )

)) AS qa_fase23;
