-- ═══════════════════════════════════════════════════════════════════════════════
-- QA DA FASE 31 — a certificação do voto, e os números que afirmavam demais
-- (somente LEITURA · UMA instrução · colar no SQL Editor do Supabase)
--
-- ORDEM: deploy verde → "Rodar tudo" → colar isto → exportar o CSV da Auditoria de votos.
--
-- Um bloco por tarefa, com o ESPERADO declarado. Onde a resposta não vier por SQL (o CSV, a
-- medição do mojibake, o diagnóstico de inferência), o bloco diz qual URL abrir — não inventa
-- um número aproximado em SQL para fingir cobertura.
-- ═══════════════════════════════════════════════════════════════════════════════

SELECT jsonb_pretty(jsonb_build_object(

  -- ① O GABARITO POR DIRETOR, no BANCO (Tarefa 0)
  --    O teste `etapa163` certifica a EXTRAÇÃO contra os PDFs. Este bloco certifica o BANCO.
  --    Se os dois divergirem, a causa está entre eles (materialização, roster de produção,
  --    janela de mandatos) e é outra investigação — não é erro do gabarito.
  --
  --    ESPERADO, contado à mão contra os PDFs:
  --      ANM 79ª (26/11/2025): Mauro 49 · José Fernando 49 · Tasso 49 · Roger 49
  --      ANM 81ª (28/01/2026): Mauro 64 · Luiz 64 · Fábio 64 · José Fernando 63
  --      ANM 83ª (25/03/2026): Mauro 49 · Luiz 49 · Fábio 47 · José Fernando 44
  --      ANTT 1.024ª e 264ª RDE: 5 diretores × 6 e × 2, todos Favorável inferido
  --
  --    ⚠️ `votos_efetivos` EXCLUI impedimento e ausência — é a mesma definição do gabarito
  --    (49 − 2 = 47 para o Fábio). `linhas` inclui tudo, e a diferença entre os dois é o que
  --    torna a conta conferível.
  '1_gabarito_por_diretor', (
    SELECT COALESCE(jsonb_agg(t ORDER BY t.data_reuniao DESC, t.diretor), '[]'::jsonb) FROM (
      SELECT COALESCE(a.sigla, '?')            AS agencia,
             d.numero_reuniao,
             d.data_reuniao,
             dir.nome                          AS diretor,
             COUNT(*)                          AS linhas,
             COUNT(*) FILTER (WHERE v.tipo_voto IN ('Favoravel','Desfavoravel','Abstencao'))
                                               AS votos_efetivos,
             COUNT(*) FILTER (WHERE v.motivo_nao_voto = 'impedimento') AS impedimentos,
             COUNT(*) FILTER (WHERE v.motivo_nao_voto = 'ausencia')    AS ausencias
        FROM votos v
        JOIN deliberacoes d  ON d.id = v.deliberacao_id
        JOIN diretores  dir  ON dir.id = v.diretor_id
        LEFT JOIN agencias a ON a.id = d.agencia_id
       WHERE (a.sigla = 'ANM'  AND d.data_reuniao IN (DATE '2025-11-26', DATE '2026-01-28', DATE '2026-03-25'))
          OR (a.sigla = 'ANTT' AND d.data_reuniao = DATE '2026-01-19')
       GROUP BY 1,2,3,4
    ) t
  ),

  -- ② A COLUNA QUE VINHA ZERADA (Commit A)
  --    O defeito era do EXPORT, não do banco: um `.in()` de 820 ids estourava a URL e o erro era
  --    engolido por um `?? []`. Aqui o número sai do banco, para comparar com o CSV novo.
  --    ESPERADO: `votos_na_deliberacao` VARIANDO por linha no CSV, e batendo com esta contagem.
  --    ⚠️ Se o CSV vier zerado de novo, o conserto não subiu — não é dado, é export.
  '2_votos_por_deliberacao', (
    SELECT jsonb_build_object(
      'deliberacoes_com_voto', COUNT(*),
      'distribuicao', (
        SELECT COALESCE(jsonb_object_agg(votos::text, n), '{}'::jsonb)
          FROM (SELECT votos, COUNT(*) AS n FROM (
                  SELECT deliberacao_id, COUNT(*) AS votos FROM votos GROUP BY 1
                ) z GROUP BY 1 ORDER BY 1) y
      ),
      'nota', 'Se a distribuição tem mais de uma chave, o número VARIA — e o CSV tem de refletir isso.'
    ) FROM (SELECT DISTINCT deliberacao_id FROM votos) s
  ),

  -- ③ O MOJIBAKE (Commits B e C)
  --    ⚠️ Este bloco mede as DUAS assinaturas. A da Fase 14 (U+FFFD) e a que o conserto da Fase 14
  --    CRIOU (CP850 lido como Latin-1: U+0080 no lugar do Ç, § no lugar do º, µ no lugar do Á).
  --    O monitor antigo (`qa-fase14.sql` bloco 6) contava só a primeira e marcava ZERO enquanto
  --    623 nomes estavam quebrados.
  --
  --    ESPERADO depois do reparo: `cp850_controle_c1` e `cp850_sem_controle` = 0 onde
  --    `com_procedencia_zip` > 0. Fora do ZIP o reparo NÃO age de propósito — candidato ali é
  --    achado novo, e o endpoint o mostra sem tocar.
  --    ⚠️ `mais_recente` POSTERIOR ao deploy do decoder significa que o caminho novo AINDA produz —
  --    aí não é resíduo, é fluxo vivo, e o decoder não pegou o caso.
  '3_mojibake', (
    SELECT COALESCE(jsonb_agg(t ORDER BY t.total DESC), '[]'::jsonb) FROM (
      SELECT COALESCE(a.sigla, '?') AS agencia,
             COUNT(*) AS total,
             COUNT(*) FILTER (WHERE dr.filename ~ '[\u0080-\u009f]')        AS cp850_controle_c1,
             -- O caso SEM controle nenhum: 'Ata ordinária' → 'Ata ordin ria' (á = 0xA0 = NBSP).
             COUNT(*) FILTER (WHERE dr.filename ~ '[\u00a0§µ¶·¤]')          AS cp850_sem_controle,
             COUNT(*) FILTER (WHERE position(chr(65533) IN dr.filename) > 0) AS fffd_irreparavel,
             COUNT(*) FILTER (WHERE dr.source_archive IS NOT NULL
                                 OR dr.metadata ? 'source_zip_entry')        AS com_procedencia_zip,
             MAX(dr.created_at)::date AS mais_recente,
             (array_agg(LEFT(dr.filename, 70) ORDER BY dr.created_at DESC))[1:3] AS amostra
        FROM documentos_regulatorios dr
        LEFT JOIN agencias a ON a.id = dr.agencia_id
       WHERE dr.filename ~ '[\u0080-\u009f\u00a0§µ¶·¤]'
          OR position(chr(65533) IN dr.filename) > 0
       GROUP BY 1
    ) t
  ),

  -- ④ O ELO documento↔job nos quatro estados inválidos.
  --    É o defeito que custou 62 documentos na Fase 10 e 35 votos da ANTT na Fase 9.
  --    ESPERADO: zero nos quatro.
  '4_elo_documento_job', (
    SELECT jsonb_build_object(
      'queued_com_job_done', (SELECT COUNT(*) FROM documentos_regulatorios dr
         JOIN upload_jobs j ON j.id = dr.upload_job_id WHERE dr.status='queued' AND j.status='done'),
      'failed_com_job_pending', (SELECT COUNT(*) FROM documentos_regulatorios dr
         JOIN upload_jobs j ON j.id = dr.upload_job_id WHERE dr.status='failed' AND j.status='pending'),
      'job_pending_sem_documento', (SELECT COUNT(*) FROM upload_jobs
         WHERE status='pending' AND documento_id IS NULL),
      'voto_de_agencia_diferente_da_deliberacao', (SELECT COUNT(*) FROM votos v
         JOIN deliberacoes d ON d.id=v.deliberacao_id JOIN diretores dir ON dir.id=v.diretor_id
        WHERE dir.agencia_id IS DISTINCT FROM d.agencia_id)
    )
  ),

  -- ⑤ O QUE NÃO VEM POR SQL — as três medições que são ROTA, e a razão de cada uma.
  '5_medicoes_fora_do_sql', jsonb_build_object(
    'inferencia_bloqueada_por_nome',
      'GET /api/v1/admin/votos/diagnostico-inferencia?ano=2026&amostra=10 — o predicado usa '
      || 'findBestMatch e RE_CONTESTADO_AMPLO, que são TypeScript; reimplementá-los em SQL criaria '
      || 'uma segunda verdade, que é o defeito que esta base já pagou duas vezes.',
    'mojibake_reparo',
      'GET /api/v1/admin/documentos/mojibake?amostra=10 mede (não escreve); '
      || 'POST ...?dry_run=0 aplica. O histograma de bytes altos decide a página de código pelo '
      || 'DADO — latin1 preserva byte↔codepoint, então a coluna filename carrega os originais.',
    'votos_na_deliberacao',
      'Exportar o CSV da aba Auditoria de votos e conferir que a coluna VARIA por linha. O bloco '
      || '② dá o número do banco para comparar.'
  )

)) AS qa_fase31;
