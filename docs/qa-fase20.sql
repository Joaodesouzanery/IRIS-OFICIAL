-- ═══════════════════════════════════════════════════════════════════════════════
-- QA DA FASE 20 — o reparo que repara, o voto no nome certo, a ANTT de volta
-- (somente LEITURA — uma instrução, para colar no SQL Editor)
--
-- ORDEM: deploy verde → "Rodar tudo" (pelo menos 2 runs, para o rodízio girar) → colar isto.
--
-- ① REPARO POR DEGRAU — a prova do commit 2. O `sem_casamento` é o veredito: se ele for alto e
--    `reparadas` baixo, o `item_numero` da safra velha não casa com o do splitter atual, e o
--    reparo voltou a devolver zero com outra cara. Este número vem da RESPOSTA da rota; aqui
--    medimos o efeito no banco.
-- ② VOTOS POR AGÊNCIA — o número que a fase existe para mover. A ANM estava em 21.
-- ③ A ANTT VOLTOU A COLETAR? — a prova do commit 5, item 1 (reserva por laço).
-- ④ O RODÍZIO GIROU? — confirmLote/enqueue/coleta aparecendo nos contadores das runs.
-- ⑤ ROSTER × PRESENÇA — quantos itens a inferência RECUSOU para não gravar voto errado.
-- ⑥ A JANELA DE MANDATOS — o acervo antigo separado do "cadastro incompleto".
-- ═══════════════════════════════════════════════════════════════════════════════

SELECT jsonb_pretty(jsonb_build_object(

  -- ① O passivo que o reparo ataca: item de ata sem `resultado`, com e sem dispositivo.
  --    `tem_dispositivo` é o teto do degrau «ligadura»; `pai_tem_texto` é o teto do «resplit».
  '1_reparo_itens_de_ata', (
    SELECT COALESCE(jsonb_agg(t ORDER BY t.sem_resultado DESC), '[]'::jsonb) FROM (
      SELECT COALESCE(a.sigla,'?') AS sigla,
             COUNT(*) FILTER (WHERE d.resultado IS NULL) AS sem_resultado,
             COUNT(*) FILTER (WHERE d.resultado IS NOT NULL) AS com_resultado,
             COUNT(*) FILTER (WHERE d.resultado IS NULL
                              AND COALESCE(d.resumo_pleito,'') <> '') AS teto_do_degrau_ligadura,
             COUNT(*) FILTER (WHERE d.resultado IS NULL AND EXISTS (
               SELECT 1 FROM documentos_regulatorios dr
                WHERE dr.deliberacao_id = d.documento_pai_id
                  AND COALESCE(dr.texto_extraido,'') <> ''
             )) AS teto_do_degrau_resplit
        FROM deliberacoes d LEFT JOIN agencias a ON a.id = d.agencia_id
       WHERE d.tipo_documento = 'ata'
         AND d.documento_pai_id IS NOT NULL
         AND COALESCE(d.numero_deliberacao,'') NOT LIKE 'PAUTA-%'
       GROUP BY 1
    ) t
  ),

  -- ② O número da fase. `nominais` é o que só a ANTT produz — por isso a coleta dela importa.
  '2_votos_por_agencia', (
    SELECT COALESCE(jsonb_agg(t ORDER BY t.votos DESC), '[]'::jsonb) FROM (
      SELECT COALESCE(a.sigla,'?') AS sigla,
             COUNT(v.id) AS votos,
             COUNT(v.id) FILTER (WHERE v.is_nominal) AS nominais,
             COUNT(DISTINCT v.deliberacao_id) AS deliberacoes_com_voto
        FROM votos v
        JOIN deliberacoes d ON d.id = v.deliberacao_id
        LEFT JOIN agencias a ON a.id = d.agencia_id
       GROUP BY 1
    ) t
  ),

  -- ③ A prova do laço barato: itens NOVOS da ANTT vistos nas últimas 48h. Antes do commit 5 a
  --    coleta devolvia `itens_encontrados: 0` com `status: ok` — zero que parece saúde.
  --    `monitoramento_itens` é onde a coleta grava; `first_seen_at` é quando o item apareceu.
  '3_antt_voltou_a_coletar', (
    SELECT COALESCE(jsonb_agg(t ORDER BY t.sigla), '[]'::jsonb) FROM (
      SELECT COALESCE(a.sigla,'?') AS sigla,
             COUNT(*) FILTER (WHERE mi.first_seen_at > NOW() - INTERVAL '48 hours') AS itens_48h,
             COUNT(*) AS itens_total,
             MAX(mi.first_seen_at) AS mais_recente
        FROM monitoramento_itens mi
        LEFT JOIN agencias a ON a.id = mi.agencia_id
       GROUP BY 1
    ) t
  ),

  -- ④ O rodízio girou? Cada `tentou_<passo>` vem do conjunto de tentados, acumulado na run.
  --    Se `tentou_confirmLote` ou `tentou_enqueue` continuarem raros, o anel não está entrando.
  --    ⚠️ A tabela é `esteira_runs` (não `esteira_execucoes`) e a coluna é `iniciado_em`.
  '4_rodizio_de_privilegio', (
    SELECT COALESCE(jsonb_agg(t ORDER BY t.iniciado_em DESC), '[]'::jsonb) FROM (
      SELECT e.iniciado_em,
             e.rodadas,
             e.status,
             (e.contadores->>'tentou_extracao')    AS tentou_extracao,
             (e.contadores->>'tentou_confirmLote') AS tentou_confirm_lote,
             (e.contadores->>'tentou_enqueue')     AS tentou_enqueue,
             (e.contadores->>'tentou_coleta')      AS tentou_coleta,
             (e.contadores->>'tentou_reResultar')  AS tentou_re_resultar
        FROM esteira_runs e
       ORDER BY e.iniciado_em DESC
       LIMIT 5
    ) t
  ),

  -- ⑤ O guard do commit 1: itens em que o roster NÃO pôde ser conferido. Aqui aproximamos pelo
  --    que o banco sabe — item final, sem voto, cuja ata NOMEIA presentes. O detalhe exato
  --    (`roster_nao_conferivel` + `detalhe_roster`) sai na resposta de `materializar-faltantes`.
  '5_itens_finais_sem_voto', (
    SELECT COALESCE(jsonb_agg(t ORDER BY t.sem_voto DESC), '[]'::jsonb) FROM (
      SELECT COALESCE(a.sigla,'?') AS sigla,
             COUNT(*) AS sem_voto,
             COUNT(*) FILTER (
               WHERE jsonb_typeof(d.raw_extraction->'nomes_presentes') = 'array'
                 AND jsonb_array_length(d.raw_extraction->'nomes_presentes') > 0
             ) AS ata_nomeia_presentes
        FROM deliberacoes d LEFT JOIN agencias a ON a.id = d.agencia_id
       WHERE d.resultado IS NOT NULL
         AND NOT EXISTS (SELECT 1 FROM votos v WHERE v.deliberacao_id = d.id)
         AND (d.tipo_documento <> 'ata' OR d.documento_pai_id IS NOT NULL)
       GROUP BY 1
    ) t
  ),

  -- ⑥ A janela de mandatos: o que é "acervo antigo" e o que é "cadastro incompleto". Sem esta
  --    separação, ingerir o acervo pré-2022 da ANM DERRUBARIA a cobertura de votação.
  --    ⚠️ Sem JOIN entre mandatos e deliberações de propósito: o produto cartesiano
  --    (mandatos × deliberações) explode e a consulta estoura o tempo do editor.
  '6_janela_de_mandatos', (
    SELECT COALESCE(jsonb_agg(t ORDER BY t.sigla), '[]'::jsonb) FROM (
      SELECT a.sigla,
             j.primeiro_mandato_conhecido,
             (SELECT COUNT(*) FROM deliberacoes d
               WHERE d.agencia_id = a.id
                 AND j.primeiro_mandato_conhecido IS NOT NULL
                 AND d.data_reuniao < j.primeiro_mandato_conhecido) AS deliberacoes_fora_da_janela,
             (SELECT COUNT(*) FROM deliberacoes d
               WHERE d.agencia_id = a.id AND d.data_reuniao IS NULL) AS deliberacoes_sem_data
        FROM agencias a
        LEFT JOIN LATERAL (
          -- Mandato FABRICADO ('automatico', derivado do próprio voto inferido) NÃO conta como
          -- conhecimento: aceitá-lo faria a janela se auto-ampliar a partir do que ela mesma gerou.
          SELECT MIN(m.data_inicio) AS primeiro_mandato_conhecido
            FROM mandatos m
            JOIN diretores dir ON dir.id = m.diretor_id
           WHERE dir.agencia_id = a.id
             AND dir.review_status = 'aprovado'
             AND m.fonte_dado <> 'automatico'
        ) j ON TRUE
    ) t
  )

)) AS qa_fase20;
