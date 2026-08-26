-- ═══════════════════════════════════════════════════════════════════════════════
-- DIAGNÓSTICO DE PRODUÇÃO — somente LEITURA
--
-- COMO USAR: cole TUDO no SQL Editor do Supabase (projeto IRIS REGULAÇÃO) e clique em Run.
-- É UMA consulta só: o resultado sai numa célula única em JSON — clique nela, copie e me mande.
--
-- ⚠️ Por que uma consulta só: o SQL Editor do Supabase exibe apenas o resultado da ÚLTIMA
-- instrução. A primeira versão deste arquivo tinha seis SELECTs separados e o usuário só via o
-- sexto — as cinco respostas que importavam ficavam invisíveis.
--
-- Nada aqui escreve. E este arquivo existe porque todo o diagnóstico das Fases 7 e 8 foi feito
-- lendo CÓDIGO: nenhuma linha do banco de produção foi consultada.
-- ═══════════════════════════════════════════════════════════════════════════════

SELECT jsonb_pretty(jsonb_build_object(

  -- ① A PERGUNTA QUE REENQUADRA TUDO: quanto existe, por agência e por ano.
  '1_volume_por_agencia_ano', (
    SELECT COALESCE(jsonb_agg(t ORDER BY t.sigla, t.ano), '[]'::jsonb) FROM (
      SELECT COALESCE(a.sigla, '(sem agência)')            AS sigla,
             EXTRACT(YEAR FROM d.data_reuniao)::int        AS ano,
             COUNT(DISTINCT d.id)                          AS deliberacoes,
             COUNT(DISTINCT d.numero_reuniao)              AS reunioes,
             COUNT(v.id)                                   AS votos,
             COUNT(v.id) FILTER (WHERE v.is_nominal)       AS votos_nominais
        FROM deliberacoes d
        LEFT JOIN agencias a ON a.id = d.agencia_id
        LEFT JOIN votos     v ON v.deliberacao_id = d.id
       GROUP BY 1, 2
    ) t
  ),

  -- ② DE ONDE VEIO: esteira × upload manual. Se a ANM aparecer só em "manual", o painel de
  --    diretores dela descreve os PDFs de certificação, não o corpus.
  '2_origem_das_deliberacoes', (
    SELECT COALESCE(jsonb_agg(t ORDER BY t.sigla, t.deliberacoes DESC), '[]'::jsonb) FROM (
      SELECT COALESCE(a.sigla, '(sem agência)') AS sigla,
             CASE
               WHEN d.raw_extraction->>'auto_confirmado'  IS NOT NULL THEN 'esteira (auto-confirm)'
               WHEN d.raw_extraction->>'aprovado_em_lote' IS NOT NULL THEN 'esteira (confirm-lote)'
               ELSE 'upload manual / origem antiga'
             END                                AS origem,
             COUNT(*)                           AS deliberacoes,
             COUNT(DISTINCT d.numero_reuniao)   AS reunioes_distintas
        FROM deliberacoes d
        LEFT JOIN agencias a ON a.id = d.agencia_id
       GROUP BY 1, 2
    ) t
  ),

  -- ③ O NÚMERO REAL POR TRÁS DOS "676".
  '3_itens_monitorados', (
    SELECT COALESCE(jsonb_agg(t ORDER BY t.total DESC), '[]'::jsonb) FROM (
      SELECT COALESCE(a.sigla, '(sem agência)') AS sigla,
             mi.tipo,
             mi.status,
             mi.metadata->>'enqueue_motivo'     AS motivo,
             COUNT(*)                           AS total
        FROM monitoramento_itens mi
        LEFT JOIN agencias a ON a.id = mi.agencia_id
       GROUP BY 1, 2, 3, 4
    ) t
  ),

  -- ④ ONDE OS PDFs EXTRAÍDOS MORRERAM ("174 extraídos · 0 materializados").
  '4_documentos_por_estado', (
    SELECT COALESCE(jsonb_agg(t ORDER BY t.total DESC), '[]'::jsonb) FROM (
      SELECT COALESCE(a.sigla, '(sem agência)')        AS sigla,
             dr.status,
             dr.tipo_documento,
             dr.campos_detectados->>'arquivado_motivo' AS arquivado_motivo,
             COUNT(*)                                  AS total
        FROM documentos_regulatorios dr
        LEFT JOIN agencias a ON a.id = dr.agencia_id
       GROUP BY 1, 2, 3, 4
    ) t
  ),

  -- ⑤ COBERTURA DE 2026: qual a primeira e a última reunião que temos, por agência.
  '5_cobertura_2026', (
    SELECT COALESCE(jsonb_agg(t ORDER BY t.sigla), '[]'::jsonb) FROM (
      SELECT COALESCE(a.sigla, '(sem agência)')        AS sigla,
             COUNT(DISTINCT d.numero_reuniao)          AS reunioes_2026,
             COUNT(*)                                  AS deliberacoes_2026,
             MIN(d.data_reuniao)                       AS primeira_data,
             MAX(d.data_reuniao)                       AS ultima_data
        FROM deliberacoes d
        LEFT JOIN agencias a ON a.id = d.agencia_id
       WHERE d.data_reuniao >= DATE '2026-01-01'
       GROUP BY 1
    ) t
  ),

  -- ⑥ AS MIGRATIONS ESTÃO APLICADAS? (1 = sim, 0 = falta aplicar)
  '6_migrations_aplicadas', (
    SELECT jsonb_object_agg(objeto, presente) FROM (
      SELECT 'esteira_runs (Fase 7)' AS objeto,
             (SELECT COUNT(*) FROM information_schema.tables
               WHERE table_schema='public' AND table_name='esteira_runs') AS presente
      UNION ALL
      SELECT 'monitoramento_itens.proxima_tentativa_em (Fase 8)',
             (SELECT COUNT(*) FROM information_schema.columns
               WHERE table_schema='public' AND table_name='monitoramento_itens'
                 AND column_name='proxima_tentativa_em')
      UNION ALL
      SELECT 'monitoramento_itens.tentativas (Fase 8)',
             (SELECT COUNT(*) FROM information_schema.columns
               WHERE table_schema='public' AND table_name='monitoramento_itens'
                 AND column_name='tentativas')
      UNION ALL
      SELECT 'votos.confianca_match (Fase 6)',
             (SELECT COUNT(*) FROM information_schema.columns
               WHERE table_schema='public' AND table_name='votos'
                 AND column_name='confianca_match')
    ) m
  )

)) AS diagnostico;
