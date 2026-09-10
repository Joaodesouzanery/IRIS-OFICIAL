-- ═══════════════════════════════════════════════════════════════════════════════
-- QA DA FASE 26 — o inferido segue o desfecho; os presos na extração; duplicata por ANO
-- (somente LEITURA — uma instrução)
--
-- ORDEM: deploy verde → "Rodar tudo" 2× → colar.
--
-- ① DUPLICADAS por (agência, número, ANO) — a ARTESP renumera por ano; o QA da Fase 25 agrupou
--    sem ano e mostrou "duplicatas" que são atos de anos diferentes. Esperado ≈ 0.
-- ② % FAVORÁVEL por agência DEPOIS da regra do inferido — esperado ≈ ARTESP 73 · ANM 79 · ANTT 99.
-- ③ ANM 2026 — reuniões/deliberações/votos depois da fila justa (esperado: subir de 3 reuniões).
-- ④ OS PRESOS NA EXTRAÇÃO — filename, tamanho, páginas, erro, ciclos. É o que diz se são
--    escaneados (OCR), grandes ou corrompidos. As atas reais da ANM levam < 100 ms: não são elas.
-- ═══════════════════════════════════════════════════════════════════════════════

SELECT jsonb_pretty(jsonb_build_object(

  '1_duplicadas_por_numero_e_ano', (
    SELECT COALESCE(jsonb_agg(t ORDER BY t.copias DESC), '[]'::jsonb) FROM (
      SELECT a.sigla, d.numero_deliberacao, EXTRACT(YEAR FROM d.data_reuniao)::int AS ano,
             COUNT(*) AS copias,
             jsonb_agg(jsonb_build_object('id', d.id, 'data', d.data_reuniao, 'tipo', d.tipo_documento)) AS linhas
        FROM deliberacoes d JOIN agencias a ON a.id = d.agencia_id
       WHERE d.tipo_documento IN ('deliberacao', 'voto_individual') AND d.numero_deliberacao IS NOT NULL
       GROUP BY 1, 2, 3 HAVING COUNT(*) > 1
       LIMIT 20
    ) t
  ),

  '2_pct_favoravel_por_agencia', (
    SELECT COALESCE(jsonb_agg(t ORDER BY t.sigla), '[]'::jsonb) FROM (
      SELECT a.sigla,
             COUNT(v.id) FILTER (WHERE v.tipo_voto = 'Favoravel') AS favoraveis,
             COUNT(v.id) FILTER (WHERE v.tipo_voto = 'Desfavoravel') AS desfavoraveis,
             COUNT(v.id) FILTER (WHERE NOT v.is_nominal AND v.tipo_voto = 'Favoravel' AND d.resultado = 'Indeferido') AS inferidos_favoravel_em_indeferido_restantes,
             ROUND(100.0 * COUNT(v.id) FILTER (WHERE v.tipo_voto = 'Favoravel')
                   / NULLIF(COUNT(v.id) FILTER (WHERE v.tipo_voto IN ('Favoravel','Desfavoravel')), 0), 1) AS pct_favoravel
        FROM votos v JOIN deliberacoes d ON d.id = v.deliberacao_id JOIN agencias a ON a.id = d.agencia_id
       GROUP BY 1
    ) t
  ),

  '3_anm_2026', (
    SELECT jsonb_build_object(
      'reunioes', COUNT(DISTINCT d.data_reuniao),
      'deliberacoes', COUNT(DISTINCT d.id),
      'votos', COUNT(v.id),
      'itens_monitoramento_novo', (SELECT COUNT(*) FROM monitoramento_itens mi JOIN agencias a2 ON a2.id = mi.agencia_id
                                    WHERE a2.sigla = 'ANM' AND mi.status = 'novo' AND mi.tipo IN ('ata','deliberacao','voto'))
    )
      FROM deliberacoes d JOIN agencias a ON a.id = d.agencia_id LEFT JOIN votos v ON v.deliberacao_id = d.id
     WHERE a.sigla = 'ANM' AND d.data_reuniao >= DATE '2026-01-01'
  ),

  '4_presos_na_extracao', (
    SELECT COALESCE(jsonb_agg(t ORDER BY t.sigla, t.status), '[]'::jsonb) FROM (
      SELECT COALESCE(a.sigla,'?') AS sigla, dr.filename, dr.status,
             ROUND(COALESCE(dr.size_bytes,0) / 1024.0) AS kb, dr.page_count, dr.chars_per_page,
             left(COALESCE(dr.error_message,''), 120) AS erro,
             COALESCE((dr.campos_detectados->>'reprocessos_falha')::int, 0) AS ciclos,
             dr.updated_at
        FROM documentos_regulatorios dr LEFT JOIN agencias a ON a.id = dr.agencia_id
       WHERE dr.status IN ('processing', 'failed', 'queued')
       ORDER BY dr.updated_at DESC
       LIMIT 30
    ) t
  )

)) AS qa_fase26;
