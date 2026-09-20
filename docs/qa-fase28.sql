-- ═══════════════════════════════════════════════════════════════════════════════
-- QA DA FASE 28 — o buraco de mil linhas, os rótulos que afirmavam demais, o parser
-- (somente LEITURA — uma instrução)
--
-- ORDEM: deploy verde → "Rodar tudo" 2× → colar.
--
-- ⚠️ BLOCO ① É O MAIS IMPORTANTE DESTA FASE. Ele mede o buraco que existia:
--    `materializar-faltantes` lia as primeiras ~1.000 deliberações por `id` e aplicava o filtro
--    "sem voto" DEPOIS, em JS. Materializar não liberava vaga, então tudo além da milésima nunca
--    recebeu voto, em run nenhuma. `alem_da_milesima` é o tamanho do que estava inalcançável.
--    Esperado: `total_com_resultado` > 1000, e `alem_da_milesima` > 0.
--
-- ② FORA DA JANELA, DECOMPOSTO — o banner dizia "72 anteriores ao 1º mandato", afirmação
--    impossível para 2026 (posterior a TODOS os primeiros mandatos). Esperado: quase tudo em
--    `sem_data_de_reuniao`, quase nada em `anterior_ao_1o_mandato`. Se vier o contrário, minha
--    hipótese estava errada e o rótulo antigo é que estava certo — diga, que eu reverto.
--
-- ③ FORA DE ESCOPO — deliberação de agência não-colegiada contada como "sem evidência de voto".
--    Esperado: o número aqui bate com a QUEDA de `sem_evidencia` no banner.
--
-- ④ ANM POR SÉRIE — a cobertura passou a distinguir ROP de REP no lado do SITE. Para fechar o
--    laço falta o lado do BANCO, e `tipo_reuniao` pode estar nulo. Esperado: `sem_serie` pequeno.
--    Se for grande, a comparação por série fica para a Fase 29 e o motivo está medido aqui.
--
-- ⑤ REUNIÃO COM DOCUMENTO E SEM DECISÃO — a coluna "Temos (c/ deliberação)" conta qualquer
--    tipo_documento, pauta inclusive. Este é o número que ela escondia: temos a pauta, a ata
--    nunca chegou ou nunca foi extraída.
--
-- ⑥ COBERTURA 2026 e ⑦ PRESOS — as duas séries de sempre, para comparar com a Fase 27.
--    ⑦ é a confirmação do Bloco A: nenhum `error_message` pode conter `parser_sem_isolamento`.
--    Se contiver, o worker NÃO subiu na Vercel e o commit 1 não pegou — avise antes de tudo.
--
-- ⑧ TAMANHO DE `monitoramento_itens` — decide se `cobertura-documentos` (6 leituras truncadas)
--    cabe na Fase 29 com `lerTudo` ou se precisa de `count: exact`. Esperado: medir, não supor.
-- ═══════════════════════════════════════════════════════════════════════════════

SELECT jsonb_pretty(jsonb_build_object(

  '1_buraco_do_materializador', (
    SELECT jsonb_build_object(
      'total_com_resultado', COUNT(*),
      'alem_da_milesima', GREATEST(COUNT(*) - 1000, 0),
      'sem_voto_total', COUNT(*) FILTER (WHERE NOT EXISTS (SELECT 1 FROM votos v WHERE v.deliberacao_id = d.id)),
      'sem_voto_alem_da_milesima', (
        SELECT COUNT(*) FROM (
          SELECT id, row_number() OVER (ORDER BY id) AS pos FROM deliberacoes WHERE resultado IS NOT NULL
        ) q WHERE q.pos > 1000 AND NOT EXISTS (SELECT 1 FROM votos v WHERE v.deliberacao_id = q.id)
      )
    ) FROM deliberacoes d WHERE d.resultado IS NOT NULL
  ),

  '2_fora_da_janela_decomposto', (
    SELECT COALESCE(jsonb_agg(t ORDER BY t.sigla), '[]'::jsonb) FROM (
      SELECT COALESCE(a.sigla, '?') AS sigla,
             COUNT(*) FILTER (WHERE d.data_reuniao IS NULL) AS sem_data_de_reuniao,
             COUNT(*) FILTER (WHERE d.data_reuniao IS NOT NULL AND d.data_reuniao < m.primeiro) AS anterior_ao_1o_mandato,
             to_char(m.primeiro, 'YYYY-MM-DD') AS primeiro_mandato_conhecido
        FROM deliberacoes d
        LEFT JOIN agencias a ON a.id = d.agencia_id
        LEFT JOIN LATERAL (
          SELECT MIN(mn.data_inicio) AS primeiro
            FROM mandatos mn JOIN diretores di ON di.id = mn.diretor_id
           WHERE di.agencia_id = d.agencia_id AND di.review_status = 'aprovado'
             AND mn.fonte_dado <> 'automatico'
        ) m ON TRUE
       WHERE d.resultado IS NOT NULL
         AND NOT EXISTS (SELECT 1 FROM votos v WHERE v.deliberacao_id = d.id)
         AND m.primeiro IS NOT NULL
       GROUP BY 1, 4
    ) t
  ),

  '3_fora_de_escopo', (
    SELECT jsonb_build_object(
      'sem_agencia', COUNT(*) FILTER (WHERE d.agencia_id IS NULL),
      'agencia_nao_colegiada', COUNT(*) FILTER (WHERE d.agencia_id IS NOT NULL AND COALESCE(a.sigla,'?') NOT IN ('ANTT','ANM','ARTESP')),
      'por_sigla', COALESCE(jsonb_object_agg(COALESCE(a.sigla,'SEM_AGENCIA'), c) FILTER (WHERE COALESCE(a.sigla,'?') NOT IN ('ANTT','ANM','ARTESP')), '{}'::jsonb)
    ) FROM (
      SELECT d.agencia_id, COUNT(*) AS c FROM deliberacoes d
       WHERE d.resultado IS NOT NULL AND NOT EXISTS (SELECT 1 FROM votos v WHERE v.deliberacao_id = d.id)
       GROUP BY 1
    ) d LEFT JOIN agencias a ON a.id = d.agencia_id
  ),

  '4_anm_por_serie', (
    SELECT jsonb_build_object(
      'ordinarias', COUNT(DISTINCT d.numero_reuniao) FILTER (WHERE d.tipo_reuniao = 'Ordinaria'),
      'extraordinarias', COUNT(DISTINCT d.numero_reuniao) FILTER (WHERE d.tipo_reuniao = 'Extraordinaria'),
      'sem_serie', COUNT(DISTINCT d.numero_reuniao) FILTER (WHERE d.tipo_reuniao IS NULL),
      'deliberacoes_sem_serie', COUNT(*) FILTER (WHERE d.tipo_reuniao IS NULL)
    ) FROM deliberacoes d JOIN agencias a ON a.id = d.agencia_id
     WHERE a.sigla = 'ANM' AND d.data_reuniao >= '2026-01-01' AND d.data_reuniao <= '2026-12-31'
  ),

  '5_reuniao_com_documento_sem_decisao', (
    SELECT COALESCE(jsonb_agg(t ORDER BY t.sigla), '[]'::jsonb) FROM (
      SELECT sigla,
             COUNT(*) AS reunioes_com_documento,
             COUNT(*) FILTER (WHERE com_decisao = 0) AS sem_decisao_extraida
        FROM (
          SELECT COALESCE(a.sigla,'?') AS sigla, d.numero_reuniao,
                 COUNT(*) FILTER (WHERE d.resultado IS NOT NULL AND d.tipo_documento NOT IN ('pauta','documento','reuniao')) AS com_decisao
            FROM deliberacoes d LEFT JOIN agencias a ON a.id = d.agencia_id
           WHERE d.numero_reuniao IS NOT NULL
             AND d.data_reuniao >= '2026-01-01' AND d.data_reuniao <= '2026-12-31'
           GROUP BY 1, 2
        ) q GROUP BY 1
    ) t
  ),

  '6_cobertura_2026', (
    SELECT COALESCE(jsonb_agg(t ORDER BY t.sigla), '[]'::jsonb) FROM (
      SELECT COALESCE(a.sigla,'?') AS sigla,
             COUNT(DISTINCT d.numero_reuniao) AS reunioes,
             COUNT(*) AS deliberacoes,
             (SELECT COUNT(*) FROM votos v JOIN deliberacoes d2 ON d2.id = v.deliberacao_id
               WHERE d2.agencia_id = d.agencia_id AND d2.data_reuniao >= '2026-01-01' AND d2.data_reuniao <= '2026-12-31') AS votos
        FROM deliberacoes d LEFT JOIN agencias a ON a.id = d.agencia_id
       WHERE d.data_reuniao >= '2026-01-01' AND d.data_reuniao <= '2026-12-31'
       GROUP BY d.agencia_id, a.sigla
    ) t
  ),

  '7_presos_e_o_worker', (
    SELECT jsonb_build_object(
      'por_status', COALESCE((
        SELECT jsonb_agg(t ORDER BY t.status, t.sigla) FROM (
          SELECT COALESCE(a.sigla,'?') AS sigla, dr.status, dr.tipo_documento, COUNT(*) AS documentos,
                 COUNT(*) FILTER (WHERE dr.campos_detectados ? 'reprocesso_encerrado') AS encerrados,
                 COUNT(*) FILTER (WHERE dr.campos_detectados->>'arquivado_motivo' = 'parser_travou') AS arquivados_parser,
                 left(COALESCE(max(dr.error_message), ''), 120) AS exemplo_erro
            FROM documentos_regulatorios dr LEFT JOIN agencias a ON a.id = dr.agencia_id
           WHERE dr.status IN ('processing','failed','queued')
              OR dr.campos_detectados->>'arquivado_motivo' = 'parser_travou'
           GROUP BY 1,2,3
        ) t), '[]'::jsonb),
      -- ⚠️ A CONFIRMAÇÃO DO BLOCO A. Qualquer número > 0 aqui significa que o worker NÃO subiu na
      -- Lambda e o teto do parser continua decorativo. Nesse caso NADA do resto importa primeiro.
      'parser_sem_isolamento', (SELECT COUNT(*) FROM documentos_regulatorios WHERE error_message ILIKE '%parser_sem_isolamento%'),
      'timeout_do_parser', (SELECT COUNT(*) FROM documentos_regulatorios WHERE error_message ILIKE '%Timeout ao processar PDF%'),
      'motivo_preservado', (SELECT COUNT(*) FROM documentos_regulatorios WHERE error_message ILIKE 'Falha ao extrair texto do PDF:%')
    )
  ),

  '8_tamanho_para_a_fase_29', (
    SELECT jsonb_build_object(
      'monitoramento_itens', (SELECT COUNT(*) FROM monitoramento_itens),
      'documentos_coletados', (SELECT COUNT(*) FROM documentos_coletados),
      'documentos_regulatorios', (SELECT COUNT(*) FROM documentos_regulatorios),
      'deliberacoes', (SELECT COUNT(*) FROM deliberacoes),
      'votos', (SELECT COUNT(*) FROM votos)
    )
  )

));
