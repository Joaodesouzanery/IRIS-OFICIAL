-- ═══════════════════════════════════════════════════════════════════════════════
-- QA DA FASE 22 — as ausências que (talvez) não existem, e a exceção que diz por quê
-- (somente LEITURA — uma instrução, para colar no SQL Editor)
--
-- ORDEM: deploy verde → colar isto → OLHAR 3-5 linhas do bloco ② contra os PDFs originais →
--        me dizer o que viu. Sem isso, o conserto (commit 3) não entra.
--
-- ① AUSÊNCIAS POR DIRETOR (ARTESP) — quem tem linha `Ausente`, com que motivo e proveniência.
--    Na fixture certificada da ARTESP o extrator produz ZERO ausentes (etapa127): se aqui houver
--    dezenas para o Diretor-Presidente, elas vieram de documentos que o corpus não cobre.
-- ② DETALHE DO ANDRÉ ISPER — cada linha `Ausente`, com o que o documento diz. A coluna
--    `presente_no_mesmo_doc` é a contradição que PROVA o artefato: ninguém está presente e
--    ausente no mesmo documento. O `trecho` mostra o que a regex casou.
-- ③ ATAS DA ANM CLASSIFICADAS COMO `diretoria` — itens fora da esteira por defeito de
--    classificação (esteira-tipos.ts:13-16). Só medir: se > 0, vira fase própria.
-- ④ MOTIVO DAS EXCEÇÕES — por que cada documento está em `review_pending`, agrupado. É o
--    número que transforma "146 para revisar" em 5-6 causas.
-- ═══════════════════════════════════════════════════════════════════════════════

SELECT jsonb_pretty(jsonb_build_object(

  '1_ausencias_por_diretor_artesp', (
    SELECT COALESCE(jsonb_agg(t ORDER BY t.linhas DESC), '[]'::jsonb) FROM (
      SELECT dir.nome,
             v.tipo_voto,
             COALESCE(v.motivo_nao_voto, '(nulo)') AS motivo,
             COALESCE(v.proveniencia, '(nulo)') AS proveniencia,
             v.is_nominal,
             COUNT(*) AS linhas
        FROM votos v
        JOIN diretores dir ON dir.id = v.diretor_id
        JOIN agencias a ON a.id = dir.agencia_id
       WHERE a.sigla = 'ARTESP' AND v.tipo_voto IN ('Ausente', 'Abstencao')
       GROUP BY 1, 2, 3, 4, 5
    ) t
  ),

  '2_detalhe_andre_isper', (
    SELECT COALESCE(jsonb_agg(t ORDER BY t.data_reuniao DESC), '[]'::jsonb) FROM (
      SELECT d.id AS deliberacao_id,
             d.numero_deliberacao,
             d.data_reuniao,
             d.tipo_documento,
             COALESCE(v.motivo_nao_voto, '(nulo)') AS motivo,
             COALESCE(v.proveniencia, '(nulo)') AS proveniencia,
             d.raw_extraction->'nomes_votacao_ausente' AS ausentes_extraidos,
             d.raw_extraction->'impedimentos' AS impedidos_extraidos,
             EXISTS (
               SELECT 1 FROM jsonb_array_elements_text(COALESCE(d.raw_extraction->'nomes_presentes', '[]'::jsonb)) p
                WHERE p ILIKE '%Barnab%'
             ) AS presente_no_mesmo_doc,
             -- 300 chars ao redor da primeira ocorrência de "ausen…" no texto persistido
             -- (`deliberacoes.raw_text` é COLUNA — conferido na 001_initial_schema, índice trgm).
             substring(
               COALESCE(d.raw_text, d.fundamento_decisao, '')
               FROM GREATEST(1, position('usen' IN lower(COALESCE(d.raw_text, d.fundamento_decisao, ''))) - 150)
               FOR 300
             ) AS trecho
        FROM votos v
        JOIN diretores dir ON dir.id = v.diretor_id
        JOIN deliberacoes d ON d.id = v.deliberacao_id
       WHERE dir.nome ILIKE '%Isper%Barnab%'
         AND v.tipo_voto = 'Ausente'
       LIMIT 50
    ) t
  ),

  '2b_contradicoes_presente_e_ausente_artesp', (
    SELECT COUNT(*)
      FROM votos v
      JOIN diretores dir ON dir.id = v.diretor_id
      JOIN agencias a ON a.id = dir.agencia_id
      JOIN deliberacoes d ON d.id = v.deliberacao_id
     WHERE a.sigla = 'ARTESP' AND v.tipo_voto = 'Ausente'
       AND EXISTS (
         SELECT 1 FROM jsonb_array_elements_text(COALESCE(d.raw_extraction->'nomes_presentes', '[]'::jsonb)) p
          WHERE lower(p) = lower(dir.nome)
       )
  ),

  '3_atas_anm_classificadas_como_diretoria', (
    SELECT jsonb_build_object(
      'itens', COUNT(*),
      'amostra', COALESCE(jsonb_agg(mi.titulo) FILTER (WHERE mi.titulo IS NOT NULL), '[]'::jsonb)
    )
      FROM (
        SELECT mi.titulo
          FROM monitoramento_itens mi
          JOIN agencias a ON a.id = mi.agencia_id
         WHERE a.sigla = 'ANM' AND mi.tipo = 'diretoria'
           AND (mi.titulo ILIKE '%ata%' OR mi.url_item ILIKE '%ata%')
         LIMIT 10
      ) mi
  ),

  '4_motivo_das_excecoes', (
    SELECT COALESCE(jsonb_agg(t ORDER BY t.documentos DESC), '[]'::jsonb) FROM (
      SELECT COALESCE(a.sigla, '?') AS sigla,
             COALESCE(dr.tipo_documento, '?') AS tipo,
             COALESCE(dr.campos_detectados->>'auto_skip', '(sem motivo gravado)') AS motivo,
             COUNT(*) AS documentos
        FROM documentos_regulatorios dr
        LEFT JOIN agencias a ON a.id = dr.agencia_id
       WHERE dr.status = 'review_pending'
       GROUP BY 1, 2, 3
    ) t
  )

)) AS qa_fase22;
