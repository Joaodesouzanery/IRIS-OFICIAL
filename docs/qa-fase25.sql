-- ═══════════════════════════════════════════════════════════════════════════════
-- QA DA FASE 25 — "não está muito grande?" — a prova de que não há duplicação
-- (somente LEITURA — uma instrução)
--
-- ① DELIBERAÇÕES DUPLICADAS por (agência, número) — a prova de que o confirm REUSA a existente
--    (esperado ≈ 0; item de ata usa item_numero, fica fora).
-- ② VOTOS DUPLICADOS por (deliberação, diretor) — esperado 0, pela UNIQUE do schema.
-- ③ TOTAIS REAIS direto no SQL — para bater com a tela de Completude depois do commit 1 (a tela
--    lia 1.000 linhas). `orfaos` deve ser 0 (FK CASCADE); se não for, a FK não está em produção.
-- ④ DIREÇÃO DO VOTO INFERIDO em Indeferido — a medição da pergunta do Caio Mário: quantos votos
--    inferidos são "Favoravel" em deliberação Indeferida (unânime × não unânime) e quanto o
--    "% Favorável" cairia se o inferido seguisse o desfecho. Nada muda até você decidir.
-- ═══════════════════════════════════════════════════════════════════════════════

SELECT jsonb_pretty(jsonb_build_object(

  '1_deliberacoes_duplicadas_por_numero', (
    SELECT COALESCE(jsonb_agg(t ORDER BY t.copias DESC), '[]'::jsonb) FROM (
      SELECT a.sigla, d.numero_deliberacao, COUNT(*) AS copias
        FROM deliberacoes d JOIN agencias a ON a.id = d.agencia_id
       WHERE d.tipo_documento = 'deliberacao' AND d.numero_deliberacao IS NOT NULL
       GROUP BY 1, 2 HAVING COUNT(*) > 1
       LIMIT 20
    ) t
  ),

  '2_votos_duplicados_por_par', (
    SELECT COUNT(*) FROM (
      SELECT deliberacao_id, diretor_id FROM votos GROUP BY 1, 2 HAVING COUNT(*) > 1
    ) t
  ),

  '3_totais_reais', jsonb_build_object(
    'deliberacoes', (SELECT COUNT(*) FROM deliberacoes),
    'votos', (SELECT COUNT(*) FROM votos),
    'orfaos', (SELECT COUNT(*) FROM votos v LEFT JOIN deliberacoes d ON d.id = v.deliberacao_id WHERE d.id IS NULL),
    'fk_votos_deliberacao', (
      SELECT COALESCE(jsonb_agg(jsonb_build_object('constraint', con.conname, 'on_delete', con.confdeltype)), '[]'::jsonb)
        FROM pg_constraint con JOIN pg_class rel ON rel.oid = con.conrelid
       WHERE rel.relname = 'votos' AND con.contype = 'f'
    ),
    'unique_votos', (
      SELECT COALESCE(jsonb_agg(con.conname), '[]'::jsonb)
        FROM pg_constraint con JOIN pg_class rel ON rel.oid = con.conrelid
       WHERE rel.relname = 'votos' AND con.contype = 'u'
    ),
    'por_agencia_2026', (
      SELECT COALESCE(jsonb_agg(t ORDER BY t.sigla), '[]'::jsonb) FROM (
        SELECT a.sigla,
               COUNT(DISTINCT d.id) AS deliberacoes_2026,
               COUNT(v.id) AS votos_2026,
               COUNT(DISTINCT d.data_reuniao) AS reunioes_2026
          FROM deliberacoes d JOIN agencias a ON a.id = d.agencia_id
          LEFT JOIN votos v ON v.deliberacao_id = d.id
         WHERE d.data_reuniao >= DATE '2026-01-01'
         GROUP BY 1
      ) t
    )
  ),

  '4_direcao_do_voto_inferido_em_indeferido', (
    SELECT COALESCE(jsonb_agg(t ORDER BY t.sigla), '[]'::jsonb) FROM (
      SELECT a.sigla,
             COUNT(v.id) FILTER (WHERE NOT v.is_nominal) AS inferidos_total,
             COUNT(v.id) FILTER (WHERE NOT v.is_nominal AND v.tipo_voto = 'Favoravel' AND d.resultado = 'Indeferido') AS inferidos_favoravel_em_indeferido,
             COUNT(v.id) FILTER (WHERE NOT v.is_nominal AND v.tipo_voto = 'Favoravel' AND d.resultado = 'Indeferido'
                                   AND COALESCE((d.raw_extraction->>'unanimidade_detectada')::boolean, false)) AS dos_quais_unanimes,
             COUNT(v.id) FILTER (WHERE NOT v.is_nominal AND v.tipo_voto = 'Favoravel' AND d.resultado = 'Indeferido' AND v.is_divergente) AS dos_quais_marcados_divergentes,
             -- "% Favorável" hoje (só efetivos) × se o inferido seguisse o desfecho
             ROUND(100.0 * COUNT(v.id) FILTER (WHERE v.tipo_voto = 'Favoravel')
                   / NULLIF(COUNT(v.id) FILTER (WHERE v.tipo_voto IN ('Favoravel','Desfavoravel')), 0), 1) AS pct_favoravel_hoje,
             ROUND(100.0 * (COUNT(v.id) FILTER (WHERE v.tipo_voto = 'Favoravel')
                            - COUNT(v.id) FILTER (WHERE NOT v.is_nominal AND v.tipo_voto = 'Favoravel' AND d.resultado = 'Indeferido'))
                   / NULLIF(COUNT(v.id) FILTER (WHERE v.tipo_voto IN ('Favoravel','Desfavoravel')), 0), 1) AS pct_favoravel_se_seguir_desfecho
        FROM votos v JOIN deliberacoes d ON d.id = v.deliberacao_id JOIN agencias a ON a.id = d.agencia_id
       GROUP BY 1
    ) t
  )

)) AS qa_fase25;
