-- ═══════════════════════════════════════════════════════════════════════════════
-- AUDITORIA DE VOTOS E COBERTURA (Fase 12) — somente LEITURA
--
-- COMO USAR: cole TUDO no SQL Editor do Supabase (projeto IRIS REGULAÇÃO) e clique em Run.
-- É UMA consulta só: o resultado sai numa célula única em JSON — clique nela, copie e me mande.
--
-- ⚠️ Por que uma consulta só: o SQL Editor exibe apenas o resultado da ÚLTIMA instrução
-- (a lição do diagnostico-producao.sql).
--
-- O QUE ELA RESPONDE:
--   ① a comparação HONESTA de votos por diretor — por agência, com a janela do mandato e as
--     "oportunidades" (deliberações finais dentro da janela). É o que decide se a desigualdade
--     da tela é bug ou é mandato;
--   ② deliberação por deliberação de 2026: votos gravados × roster de diretores na data — e as
--     10 piores divergências com QUEM FALTA nomeado;
--   ③ interessado/empresas: taxa de preenchimento, separando "sem empresa por regra" de falha;
--   ④ cobertura 2026 lado-banco (o lado-fonte sai de /api/v1/admin/cobertura-ao-vivo, logado);
--   ⑤ 3 documentos de amostra por agência, com a URL PÚBLICA do PDF original (clicável),
--     os campos extraídos e os votos gerados;
--   ⑥ sondas de causa: mandato 'automatico' invisível ao roster, dedup que colapsou,
--     diretor ANTT fora da lista de alias, distribuição de relatoria.
--
-- Deliberação FINAL (o denominador de tudo) replica regulatory-documents.ts:
--   tipo_documento fora de (pauta, voto_individual, documento_apoio), e 'ata' só conta como
--   final quando é ITEM de ata (documento_pai_id preenchido) com resultado.
-- Roster por data replica vote-inference.ts: mandato cobre a data, diretor aprovado; a versão
--   ESTRITA exclui mandatos fonte_dado='automatico' (é a que a inferência usa de verdade).
-- ═══════════════════════════════════════════════════════════════════════════════

SELECT jsonb_pretty(jsonb_build_object(

  -- ① VOTOS POR DIRETOR, POR AGÊNCIA — a comparação que a tela não faz.
  --   `oportunidades` = deliberações finais da agência DENTRO da janela de mandato do diretor.
  --   Se votos/oportunidades for parecido entre colegas, a desigualdade é janela, não bug.
  '1_votos_por_diretor', (
    SELECT COALESCE(jsonb_agg(t ORDER BY t.sigla, t.votos DESC), '[]'::jsonb) FROM (
      SELECT a.sigla,
             d.nome,
             (SELECT COUNT(*) FROM votos v WHERE v.diretor_id = d.id)                          AS votos,
             (SELECT COUNT(*) FROM votos v WHERE v.diretor_id = d.id AND v.is_nominal)         AS nominais,
             (SELECT COUNT(*) FROM votos v WHERE v.diretor_id = d.id AND NOT v.is_nominal)     AS inferidos,
             (SELECT COUNT(*) FROM votos v WHERE v.diretor_id = d.id
               AND v.tipo_voto IN ('Ausente','Abstencao'))                                     AS ausencias_abstencoes,
             -- Fase 16 — a decomposição que separa "votou" de "estava registrado": efetivo é
             -- Favorável+Desfavorável; ausência/abstenção contadas à parte; recorte 2026; e a
             -- proveniência diz DE ONDE cada número veio (legado NULL = backfill pré-20260824).
             (SELECT COUNT(*) FROM votos v WHERE v.diretor_id = d.id
               AND v.tipo_voto IN ('Favoravel','Desfavoravel'))                                AS efetivos,
             (SELECT COUNT(*) FROM votos v WHERE v.diretor_id = d.id
               AND v.tipo_voto = 'Ausente')                                                   AS ausencias,
             (SELECT COUNT(*) FROM votos v WHERE v.diretor_id = d.id
               AND v.tipo_voto = 'Abstencao')                                                 AS abstencoes,
             (SELECT COUNT(*) FROM votos v JOIN deliberacoes dl ON dl.id = v.deliberacao_id
               WHERE v.diretor_id = d.id AND dl.data_reuniao >= DATE '2026-01-01')            AS votos_2026,
             (SELECT COUNT(*) FROM votos v JOIN deliberacoes dl ON dl.id = v.deliberacao_id
               WHERE v.diretor_id = d.id AND dl.data_reuniao >= DATE '2026-01-01'
                 AND v.tipo_voto IN ('Favoravel','Desfavoravel'))                             AS efetivos_2026,
             -- `to_jsonb(v)->>'...'` e não a coluna: `votos.proveniencia` é condicional
             -- (migration 20260824) e a query NÃO pode quebrar sem ela — sem a coluna, tudo cai
             -- honestamente em prov_legado_null.
             (SELECT COUNT(*) FROM votos v WHERE v.diretor_id = d.id
               AND to_jsonb(v)->>'proveniencia' = 'nominal')                                  AS prov_nominal,
             (SELECT COUNT(*) FROM votos v WHERE v.diretor_id = d.id
               AND to_jsonb(v)->>'proveniencia' = 'inferido_unanimidade')                     AS prov_inferido_unanimidade,
             (SELECT COUNT(*) FROM votos v WHERE v.diretor_id = d.id
               AND to_jsonb(v)->>'proveniencia' = 'inferido_decisao')                         AS prov_inferido_decisao,
             (SELECT COUNT(*) FROM votos v WHERE v.diretor_id = d.id
               AND to_jsonb(v)->>'proveniencia' IS NULL)                                      AS prov_legado_null,
             (SELECT MIN(m.data_inicio) FROM mandatos m
               WHERE m.diretor_id = d.id AND m.fonte_dado <> 'automatico')                     AS mandato_desde,
             (SELECT MAX(COALESCE(m.data_fim, DATE '2100-01-01')) FROM mandatos m
               WHERE m.diretor_id = d.id AND m.fonte_dado <> 'automatico')                     AS mandato_ate,
             EXISTS (SELECT 1 FROM mandatos m
               WHERE m.diretor_id = d.id AND m.fonte_dado <> 'automatico')                     AS mandato_confiavel,
             (SELECT COUNT(*) FROM deliberacoes del
               WHERE del.agencia_id = d.agencia_id
                 AND del.resultado IS NOT NULL
                 AND del.tipo_documento NOT IN ('pauta','voto_individual','documento_apoio')
                 AND (del.tipo_documento <> 'ata' OR del.documento_pai_id IS NOT NULL)
                 AND del.data_reuniao IS NOT NULL
                 AND EXISTS (SELECT 1 FROM mandatos m WHERE m.diretor_id = d.id
                              AND m.fonte_dado <> 'automatico'
                              AND m.data_inicio <= del.data_reuniao
                              AND (m.data_fim IS NULL OR m.data_fim >= del.data_reuniao)))    AS oportunidades
        FROM diretores d
        JOIN agencias a ON a.id = d.agencia_id
       WHERE d.review_status = 'aprovado'
         AND a.sigla IN ('ANTT','ANM','ARTESP')
    ) t
  ),

  -- ② VOTOS × ROSTER, deliberação a deliberação (2026): zero / parcial / completo.
  --   `parcial` é a perda que o backfill NUNCA repara (ele só toca zero-voto).
  -- Fase 16 — o GAP do match 0.6–0.85, CONTADO: a barreira de intenção divergente usa limiar
  -- 0.6 e a gravação da linha `Ausente` exige match ≥0.85. Um nome de "Ausência Justificada:"
  -- que casa entre os dois NÃO vira linha e NÃO deixa rastro — omissão por desenho
  -- (null-não-chuta), mas precisa de número para não virar lenda.
  '1b_ausencia_declarada_sem_linha', (
    SELECT COALESCE(jsonb_agg(t ORDER BY t.sigla), '[]'::jsonb) FROM (
      SELECT a.sigla, COUNT(*) AS finais_com_ausencia_no_raw_sem_linha
        FROM deliberacoes del JOIN agencias a ON a.id = del.agencia_id
       WHERE jsonb_array_length(COALESCE(del.raw_extraction->'nomes_votacao_ausente','[]'::jsonb)) > 0
         AND del.resultado IS NOT NULL
         AND del.tipo_documento NOT IN ('pauta','voto_individual','documento_apoio')
         AND (del.tipo_documento <> 'ata' OR del.documento_pai_id IS NOT NULL)
         AND NOT EXISTS (SELECT 1 FROM votos v
                          WHERE v.deliberacao_id = del.id AND v.tipo_voto = 'Ausente')
       GROUP BY 1
    ) t
  ),

  -- Fase 16 — relatoria por STRING limpa, por agência. O match fuzzy (limparRelator +
  -- contarRelatoriasPorDiretor, melhor-match-único) mora na rota do overview; o SQL entrega a
  -- matéria-prima agrupada para conferência humana, sem fingir que resolve homônimo.
  '1c_relatorias_por_relator', (
    SELECT COALESCE(jsonb_agg(t ORDER BY t.sigla, t.relatorias DESC), '[]'::jsonb) FROM (
      SELECT a.sigla,
             regexp_replace(TRIM(del.relator), '^(Dir[a-z]*\.?\s+|Diretor[a]?\s+)', '', 'i') AS relator_limpo,
             COUNT(*) AS relatorias
        FROM deliberacoes del JOIN agencias a ON a.id = del.agencia_id
       WHERE del.relator IS NOT NULL AND TRIM(del.relator) <> ''
       GROUP BY 1, 2
      HAVING COUNT(*) >= 2
       LIMIT 40
    ) t
  ),

  '2_votos_x_roster_2026', (
    SELECT COALESCE(jsonb_agg(t ORDER BY t.sigla), '[]'::jsonb) FROM (
      SELECT sigla,
             COUNT(*)                                            AS deliberacoes_finais,
             COUNT(*) FILTER (WHERE nv = 0)                      AS zero_votos,
             COUNT(*) FILTER (WHERE nv > 0 AND nv < roster_n)    AS parciais,
             COUNT(*) FILTER (WHERE nv >= roster_n AND roster_n > 0) AS completas,
             COUNT(*) FILTER (WHERE roster_n = 0)                AS sem_roster_na_data,
             ROUND(AVG(nv), 2)                                   AS media_votos,
             ROUND(AVG(roster_n), 2)                             AS media_roster
        FROM (
          SELECT a.sigla,
                 (SELECT COUNT(*) FROM votos v WHERE v.deliberacao_id = del.id) AS nv,
                 (SELECT COUNT(DISTINCT m.diretor_id)
                    FROM mandatos m JOIN diretores di ON di.id = m.diretor_id
                   WHERE di.agencia_id = del.agencia_id
                     AND di.review_status = 'aprovado'
                     AND m.fonte_dado <> 'automatico'
                     AND m.data_inicio <= del.data_reuniao
                     AND (m.data_fim IS NULL OR m.data_fim >= del.data_reuniao)) AS roster_n
            FROM deliberacoes del
            JOIN agencias a ON a.id = del.agencia_id
           WHERE a.sigla IN ('ANTT','ANM','ARTESP')
             AND del.data_reuniao >= DATE '2026-01-01'
             AND del.resultado IS NOT NULL
             AND del.tipo_documento NOT IN ('pauta','voto_individual','documento_apoio')
             AND (del.tipo_documento <> 'ata' OR del.documento_pai_id IS NOT NULL)
        ) x GROUP BY 1
    ) t
  ),

  -- ②b AS 10 PIORES DIVERGENTES, com QUEM FALTA nomeado — é a lista para abrir os PDFs.
  '2b_piores_divergentes', (
    SELECT COALESCE(jsonb_agg(t), '[]'::jsonb) FROM (
      SELECT a.sigla,
             del.numero_deliberacao,
             del.data_reuniao,
             del.processo,
             (SELECT COUNT(*) FROM votos v WHERE v.deliberacao_id = del.id) AS votos_gravados,
             (SELECT COALESCE(jsonb_agg(di2.nome), '[]'::jsonb)
                FROM mandatos m2 JOIN diretores di2 ON di2.id = m2.diretor_id
               WHERE di2.agencia_id = del.agencia_id
                 AND di2.review_status = 'aprovado'
                 AND m2.fonte_dado <> 'automatico'
                 AND m2.data_inicio <= del.data_reuniao
                 AND (m2.data_fim IS NULL OR m2.data_fim >= del.data_reuniao)
                 AND NOT EXISTS (SELECT 1 FROM votos v2
                                  WHERE v2.deliberacao_id = del.id
                                    AND v2.diretor_id = di2.id))            AS quem_falta,
             del.raw_extraction->>'source_url'                              AS pdf_url
        FROM deliberacoes del
        JOIN agencias a ON a.id = del.agencia_id
       WHERE a.sigla IN ('ANTT','ANM','ARTESP')
         AND del.data_reuniao >= DATE '2026-01-01'
         AND del.resultado IS NOT NULL
         AND del.tipo_documento NOT IN ('pauta','voto_individual','documento_apoio')
         AND (del.tipo_documento <> 'ata' OR del.documento_pai_id IS NOT NULL)
         AND (SELECT COUNT(*) FROM votos v WHERE v.deliberacao_id = del.id) > 0
         AND (SELECT COUNT(*) FROM votos v WHERE v.deliberacao_id = del.id) <
             (SELECT COUNT(DISTINCT m.diretor_id)
                FROM mandatos m JOIN diretores di ON di.id = m.diretor_id
               WHERE di.agencia_id = del.agencia_id AND di.review_status = 'aprovado'
                 AND m.fonte_dado <> 'automatico'
                 AND m.data_inicio <= del.data_reuniao
                 AND (m.data_fim IS NULL OR m.data_fim >= del.data_reuniao))
       ORDER BY del.data_reuniao DESC
       LIMIT 10
    ) t
  ),

  -- ③ INTERESSADO / EMPRESAS — taxa por agência, separando "sem empresa POR REGRA"
  --   (órgão interno, que o resolver descarta de propósito) de "sem empresa por falha".
  '3_interessado_empresas', (
    SELECT COALESCE(jsonb_agg(t ORDER BY t.sigla), '[]'::jsonb) FROM (
      SELECT a.sigla,
             COUNT(*)                                                        AS deliberacoes_finais,
             COUNT(*) FILTER (WHERE del.interessado IS NULL)                 AS sem_interessado,
             COUNT(*) FILTER (WHERE del.interessado IS NOT NULL
                                AND del.empresa_id IS NULL
                                AND del.interessado !~* '(superintend[êe]ncia|diretoria|coordena[çc][ãa]o|ger[êe]ncia|assessoria|procuradoria|n[úu]cleo)')
                                                                             AS sem_empresa_por_falha,
             COUNT(*) FILTER (WHERE del.interessado IS NOT NULL
                                AND del.empresa_id IS NULL
                                AND del.interessado ~* '(superintend[êe]ncia|diretoria|coordena[çc][ãa]o|ger[êe]ncia|assessoria|procuradoria|n[úu]cleo)')
                                                                             AS sem_empresa_por_regra,
             COUNT(*) FILTER (WHERE del.empresa_id IS NOT NULL)              AS com_empresa,
             -- itens de ATA sem interessado: se a ANTT destoar, o bug do plural está em produção
             COUNT(*) FILTER (WHERE del.documento_pai_id IS NOT NULL
                                AND del.interessado IS NULL)                 AS itens_de_ata_sem_interessado
        FROM deliberacoes del
        JOIN agencias a ON a.id = del.agencia_id
       WHERE a.sigla IN ('ANTT','ANM','ARTESP')
         AND del.resultado IS NOT NULL
         AND del.tipo_documento NOT IN ('pauta','voto_individual','documento_apoio')
         AND (del.tipo_documento <> 'ata' OR del.documento_pai_id IS NOT NULL)
       GROUP BY 1
    ) t
  ),

  -- ④ COBERTURA 2026, lado BANCO. O lado FONTE (quantas a agência publicou) sai da rota
  --   /api/v1/admin/cobertura-ao-vivo — abra logado e me mande junto.
  '4_cobertura_2026_banco', (
    SELECT COALESCE(jsonb_agg(t ORDER BY t.sigla), '[]'::jsonb) FROM (
      SELECT a.sigla,
             COUNT(DISTINCT del.id) FILTER (WHERE del.data_reuniao >= DATE '2026-01-01'
               AND del.resultado IS NOT NULL
               AND del.tipo_documento NOT IN ('pauta','voto_individual','documento_apoio')
               AND (del.tipo_documento <> 'ata' OR del.documento_pai_id IS NOT NULL)) AS deliberacoes_finais_2026,
             COUNT(v.id) FILTER (WHERE del.data_reuniao >= DATE '2026-01-01')          AS votos_2026,
             COUNT(DISTINCT del.numero_reuniao)
               FILTER (WHERE del.data_reuniao >= DATE '2026-01-01')                    AS reunioes_2026,
             MIN(del.data_reuniao) FILTER (WHERE del.data_reuniao >= DATE '2026-01-01') AS primeira,
             MAX(del.data_reuniao)                                                      AS ultima
        FROM deliberacoes del
        JOIN agencias a ON a.id = del.agencia_id
        LEFT JOIN votos v ON v.deliberacao_id = del.id
       WHERE a.sigla IN ('ANTT','ANM','ARTESP')
       GROUP BY 1
    ) t
  ),

  -- ④b Onde cada coisa PAROU: documentos por status + itens de monitoramento com motivo.
  '4b_onde_parou', (
    SELECT jsonb_build_object(
      'documentos', (
        SELECT COALESCE(jsonb_agg(t ORDER BY t.total DESC), '[]'::jsonb) FROM (
          SELECT COALESCE(a.sigla,'(sem agência)') AS sigla, dr.status, dr.tipo_documento, COUNT(*) AS total
            FROM documentos_regulatorios dr LEFT JOIN agencias a ON a.id = dr.agencia_id
           GROUP BY 1,2,3
        ) t
      ),
      'monitoramento', (
        SELECT COALESCE(jsonb_agg(t ORDER BY t.total DESC), '[]'::jsonb) FROM (
          SELECT COALESCE(a.sigla,'(sem agência)') AS sigla, mi.tipo, mi.status,
                 split_part(COALESCE(mi.metadata->>'enqueue_motivo',''), ':', 1) AS motivo,
                 COUNT(*) AS total
            FROM monitoramento_itens mi LEFT JOIN agencias a ON a.id = mi.agencia_id
           WHERE mi.tipo IN ('voto','ata','deliberacao','pauta','documento','reuniao')
           GROUP BY 1,2,3,4
        ) t
      )
    )
  ),

  -- ⑤ AMOSTRAS: 3 documentos CONFIRMADOS por agência — o PDF (URL pública), a extração e o
  --   que virou métrica. `pdf_url` é a URL no portal da agência: clicável no navegador.
  '5_amostras', (
    SELECT COALESCE(jsonb_agg(t ORDER BY t.sigla, t.n), '[]'::jsonb) FROM (
      SELECT * FROM (
        SELECT a.sigla,
               ROW_NUMBER() OVER (PARTITION BY a.sigla ORDER BY dr.processed_at DESC NULLS LAST) AS n,
               dr.filename,
               dr.tipo_documento,
               COALESCE(dr.metadata->>'source_url', dr.metadata->>'monitoramento_url')  AS pdf_url,
               jsonb_build_object(
                 'numero_deliberacao', dr.campos_detectados->'preview'->'fields'->>'numero_deliberacao',
                 'data_reuniao',       dr.campos_detectados->'preview'->'fields'->>'data_reuniao',
                 'numero_reuniao',     dr.campos_detectados->'preview'->'fields'->>'numero_reuniao',
                 'interessado',        dr.campos_detectados->'preview'->'fields'->>'interessado',
                 'processo',           dr.campos_detectados->'preview'->'fields'->>'processo',
                 'resultado',          dr.campos_detectados->'preview'->'fields'->>'resultado',
                 'relator',            dr.campos_detectados->'preview'->'fields'->>'relator'
               )                                                                        AS extraido,
               (SELECT jsonb_build_object(
                        'numero', del.numero_deliberacao,
                        'data', del.data_reuniao,
                        'resultado', del.resultado,
                        'interessado', del.interessado,
                        'votos', (SELECT COALESCE(jsonb_agg(di.nome || ': ' || v.tipo_voto ||
                                          CASE WHEN v.is_nominal THEN ' (nominal)' ELSE ' (inferido)' END), '[]'::jsonb)
                                    FROM votos v JOIN diretores di ON di.id = v.diretor_id
                                   WHERE v.deliberacao_id = del.id))
                  FROM deliberacoes del
                 WHERE del.upload_job_id = dr.upload_job_id
                 ORDER BY del.documento_pai_id NULLS FIRST LIMIT 1)                     AS metrica_gerada
          FROM documentos_regulatorios dr
          JOIN agencias a ON a.id = dr.agencia_id
         WHERE dr.status = 'confirmed'
           AND a.sigla IN ('ANTT','ANM','ARTESP')
           AND dr.upload_job_id IS NOT NULL
      ) s WHERE s.n <= 3
    ) t
  ),

  -- ⑥ SONDAS DE CAUSA
  '6_sondas', (
    SELECT jsonb_build_object(
      -- (a) diretor cujo ÚNICO mandato é 'automatico': invisível ao roster → nunca recebe
      --     voto inferido, em data nenhuma. inferidos=0 aqui confirma o bug.
      'diretor_so_mandato_automatico', (
        SELECT COALESCE(jsonb_agg(t), '[]'::jsonb) FROM (
          SELECT a.sigla, d.nome,
                 (SELECT COUNT(*) FROM votos v WHERE v.diretor_id = d.id AND NOT v.is_nominal) AS inferidos
            FROM diretores d JOIN agencias a ON a.id = d.agencia_id
           WHERE d.review_status = 'aprovado' AND a.sigla IN ('ANTT','ANM','ARTESP')
             AND EXISTS (SELECT 1 FROM mandatos m WHERE m.diretor_id = d.id)
             AND NOT EXISTS (SELECT 1 FROM mandatos m WHERE m.diretor_id = d.id
                              AND m.fonte_dado <> 'automatico')
        ) t
      ),
      -- (b) dedup que pode ter colapsado deliberações DISTINTAS (mesmo número, >1 processo)
      'numero_com_processos_distintos', (
        SELECT COALESCE(jsonb_agg(t ORDER BY t.processos DESC), '[]'::jsonb) FROM (
          SELECT a.sigla, del.numero_deliberacao, COUNT(DISTINCT del.processo) AS processos,
                 COUNT(*) FILTER (WHERE del.data_reuniao IS NULL) AS sem_data
            FROM deliberacoes del JOIN agencias a ON a.id = del.agencia_id
           WHERE del.numero_deliberacao IS NOT NULL AND a.sigla IN ('ANTT','ANM','ARTESP')
           GROUP BY 1,2 HAVING COUNT(DISTINCT del.processo) > 1
           LIMIT 15
        ) t
      ),
      -- (c) diretor ANTT aprovado FORA da lista de alias hardcoded do parser: invisível à
      --     detecção de presença — qualquer linha aqui é um diretor que nunca é visto presente.
      'antt_fora_dos_aliases', (
        SELECT COALESCE(jsonb_agg(d.nome), '[]'::jsonb)
          FROM diretores d JOIN agencias a ON a.id = d.agencia_id
         WHERE a.sigla = 'ANTT' AND d.review_status = 'aprovado'
           AND d.nome !~* '(Asfor|Queiroz|Azevedo|Baumgartner|Medeiros|Sampaio)'
      ),
      -- (d) inferência que rodou sem roster (só o ramo avulso grava o flag)
      'inferencia_sem_roster', (
        SELECT COUNT(*) FROM deliberacoes
         WHERE raw_extraction->>'inferencia_sem_roster' = 'true'
      ),
      -- (e) distribuição de RELATORIA na ANTT: se reproduzir a ordem da tela, a desigualdade
      --     residual é o +1 estrutural do relator (voto_individual), não perda.
      'relatoria_antt', (
        SELECT COALESCE(jsonb_agg(t ORDER BY t.docs DESC), '[]'::jsonb) FROM (
          SELECT del.relator, COUNT(*) AS docs
            FROM deliberacoes del JOIN agencias a ON a.id = del.agencia_id
           WHERE a.sigla = 'ANTT' AND del.relator IS NOT NULL
           GROUP BY 1 ORDER BY 2 DESC LIMIT 10
        ) t
      )
    )
  ),

  -- ⑦ SONDAS DE SCHEMA — se algum 0 aparecer aqui, o bloco correspondente acima pode estar
  --   incompleto (a query usa só colunas que existem desde as migrations base; isto é conferência).
  '7_migrations', (
    SELECT jsonb_object_agg(objeto, presente) FROM (
      SELECT 'votos.proveniencia (20260824)' AS objeto,
             (SELECT COUNT(*) FROM information_schema.columns
               WHERE table_schema='public' AND table_name='votos' AND column_name='proveniencia') AS presente
      UNION ALL
      SELECT 'documentos_regulatorios.deliberacao_id (20260629)',
             (SELECT COUNT(*) FROM information_schema.columns
               WHERE table_schema='public' AND table_name='documentos_regulatorios'
                 AND column_name='deliberacao_id')
      UNION ALL
      SELECT 'deliberacoes.reuniao_id (20260705)',
             (SELECT COUNT(*) FROM information_schema.columns
               WHERE table_schema='public' AND table_name='deliberacoes' AND column_name='reuniao_id')
    ) m
  )

)) AS auditoria;
