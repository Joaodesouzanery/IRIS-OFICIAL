-- ═══════════════════════════════════════════════════════════════════════════════
-- QA DA FASE 21 — quão perto estamos do objetivo (somente LEITURA — uma instrução)
--
-- ORDEM: deploy verde → "Rodar tudo" → LER O BANNER (é lá que o delta da regra do dispositivo
--        aparece agora) → colar isto.
--
-- ① COBERTURA 2026 POR AGÊNCIA — a pergunta que fecha o ciclo: das deliberações FINAIS de 2026
--    já no banco, quantas têm voto, quantas nominais, quantas faltam. É o "quanto falta para 100%".
-- ② VOTOS POR AGÊNCIA (total, todas as datas) — para comparar com a fase anterior.
-- ③ MIGRATIONS POR EFEITO — aplicação manual NÃO registra em schema_migrations; a única prova é
--    o objeto/dado que cada uma cria. `false` = ainda não aplicada.
-- ④ A COLETA CONTINUA VIVA? — itens novos em 48h por agência (a ANTT tem de aparecer).
-- ═══════════════════════════════════════════════════════════════════════════════

SELECT jsonb_pretty(jsonb_build_object(

  -- ① O predicado FINAL, na mesma forma de `isFinalDecisionRecord`: tipo não-final fora,
  --    `import_counts_as_final:false` fora, ata só como filho com resultado, e os três tipos finais.
  '1_cobertura_2026_por_agencia', (
    SELECT COALESCE(jsonb_agg(t ORDER BY t.sigla), '[]'::jsonb) FROM (
      WITH finais AS (
        SELECT d.id, d.agencia_id
          FROM deliberacoes d
         WHERE d.data_reuniao >= DATE '2026-01-01' AND d.data_reuniao <= DATE '2026-12-31'
           AND COALESCE((d.raw_extraction->>'import_counts_as_final')::boolean, true) IS DISTINCT FROM false
           -- TIPOS_NAO_FINAIS (regulatory-documents.ts:239) — exatamente os três, nem mais um.
           AND d.tipo_documento NOT IN ('pauta','voto_individual','documento_apoio')
           -- Os subtipos que o predicado canônico exclui (regulatory-documents.ts:265).
           AND COALESCE(d.raw_extraction->>'documento_subtipo', d.raw_extraction->>'documento_antt_tipo', '')
               NOT IN ('pauta','voto_individual','reuniao_deliberativa_eletronica','reuniao_diretoria_publica','reuniao_extraordinaria')
           AND (
                 (d.tipo_documento = 'ata' AND d.documento_pai_id IS NOT NULL AND d.resultado IS NOT NULL)
              OR d.tipo_documento IN ('deliberacao','resolucao','portaria')
           )
      )
      SELECT COALESCE(a.sigla,'?') AS sigla,
             COUNT(*) AS finais_2026,
             COUNT(*) FILTER (WHERE EXISTS (SELECT 1 FROM votos v WHERE v.deliberacao_id = f.id)) AS com_voto,
             COUNT(*) FILTER (WHERE EXISTS (SELECT 1 FROM votos v WHERE v.deliberacao_id = f.id AND v.is_nominal)) AS com_voto_nominal,
             COUNT(*) FILTER (WHERE NOT EXISTS (SELECT 1 FROM votos v WHERE v.deliberacao_id = f.id)) AS faltam,
             ROUND(100.0 * COUNT(*) FILTER (WHERE EXISTS (SELECT 1 FROM votos v WHERE v.deliberacao_id = f.id)) / NULLIF(COUNT(*),0), 1) AS pct_com_voto
        FROM finais f LEFT JOIN agencias a ON a.id = f.agencia_id
       GROUP BY 1
    ) t
  ),

  '2_votos_por_agencia_total', (
    SELECT COALESCE(jsonb_agg(t ORDER BY t.votos DESC), '[]'::jsonb) FROM (
      SELECT COALESCE(a.sigla,'?') AS sigla,
             COUNT(v.id) AS votos,
             COUNT(v.id) FILTER (WHERE v.is_nominal) AS nominais,
             COUNT(DISTINCT v.deliberacao_id) AS deliberacoes_com_voto
        FROM votos v JOIN deliberacoes d ON d.id = v.deliberacao_id
        LEFT JOIN agencias a ON a.id = d.agencia_id
       GROUP BY 1
    ) t
  ),

  -- ③ Só as migrations com efeito VERIFICÁVEL. As de dado puro (limpezas, seeds) não deixam
  --    objeto para checar — para essas, PENDENCIAS.md passa a dizer "sem prova por consulta".
  '3_migrations_por_efeito', jsonb_build_object(
    '20260715_indices_auditoria2',   EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'idx_deliberacoes_agencia_numreuniao'),
    '20260818_idx_agencia_data',     EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'idx_deliberacoes_agencia_data'),
    '20260825_reunioes_serie',       EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'reunioes' AND column_name = 'serie'),
    '20260826130000_esteira_runs',   EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'esteira_runs'),
    '20260905_alerta_item_id_nulo',  EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'monitoramento_alertas' AND column_name = 'item_id' AND is_nullable = 'YES'),
    '20260906_filhos_de_pauta_arquivados', (
       SELECT COUNT(*) > 0 FROM deliberacoes
        WHERE numero_deliberacao LIKE 'PAUTA-%'
          AND (raw_extraction->>'import_counts_as_final')::boolean = false
    ),
    '20260904_arquivados_sem_motivo_restantes', (
       SELECT COUNT(*) FROM monitoramento_itens
        WHERE status = 'ignorado' AND COALESCE(metadata->>'enqueue_motivo','') = ''
    )
  ),

  '4_coleta_48h', (
    SELECT COALESCE(jsonb_agg(t ORDER BY t.sigla), '[]'::jsonb) FROM (
      SELECT COALESCE(a.sigla,'?') AS sigla,
             COUNT(*) FILTER (WHERE mi.first_seen_at > NOW() - INTERVAL '48 hours') AS itens_48h,
             MAX(mi.first_seen_at) AS mais_recente
        FROM monitoramento_itens mi LEFT JOIN agencias a ON a.id = mi.agencia_id
       GROUP BY 1
    ) t
  )

)) AS qa_fase21;
