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
  --    ESPERADO depois do reparo: `reparavel` = 0 onde `com_procedencia_zip` > 0. Fora do ZIP o
  --    reparo NAO age de proposito — candidato ali e achado novo, e o endpoint o mostra sem tocar.
  --
  --    ⚠️⚠️ AS TRES CLASSES SAO MUTUAMENTE EXCLUSIVAS, e isso conserta um defeito MEDIDO desta
  --    propria consulta (Fase 31, Bloco 3). A versao anterior fazia:
  --        cp850_controle_c1  = filename ~ '[C1]'
  --        cp850_sem_controle = filename ~ '[NBSP§µ¶·¤]'        <- SEM `AND NOT [C1]`
  --    Em producao os dois deram 286 e 286 nos TRES grupos, porque todo nome com C1 tambem tem `§`
  --    ou `¡`. O comentario prometia "o caso SEM controle nenhum" e o predicado nao prometia isso:
  --    o rotulo mentia, e o ponto cego que o contador existe para cobrir — 'Ata ordinaria' ->
  --    'Ata ordin ria', onde o `a` vira NBSP e NAO ha C1 — ficava indistinguivel dentro dos 286.
  --    Agora `cp850_sem_controle` e exatamente esse caso, e `reparavel + fffd_irreparavel = total`
  --    fecha por construcao (o WHERE garante que toda linha tem ao menos uma assinatura).
  --
  --    ⚠️ E a DATA e por assinatura. `MAX(created_at)` sobre o grupo inteiro nao sabe QUAL familia
  --    produziu o mais recente, entao culparia o decoder novo (CP850, consertado em 2026-09-24) por
  --    residuo pre-Fase-14 (U+FFFD). So `mais_recente_cp850` posterior a 2026-09-24 08:16 significa
  --    fluxo vivo; `mais_recente_fffd` recente e outro problema, de outro caminho.
  --
  --    ⚠️ `?sem-id` vs `?fk-orfa`: um `COALESCE(a.sigla,'?')` sozinho junta "nunca teve agencia" com
  --    "aponta para agencia que nao existe", e o conserto de cada um e outro. Medido no repo: nenhuma
  --    migration tem `DELETE FROM agencias`, entao `?fk-orfa` deve vir ZERO — se nao vier, e achado novo.
  '3_mojibake', (
    SELECT COALESCE(jsonb_agg(t ORDER BY t.total DESC), '[]'::jsonb) FROM (
      SELECT CASE WHEN dr.agencia_id IS NULL THEN '?sem-id'
                  WHEN a.id IS NULL          THEN '?fk-orfa'
                  ELSE a.sigla END AS agencia,
             COUNT(*) AS total,
             -- Reparavel = a assinatura CP850 sobreviveu nos bytes. U+FFFD e destrutivo: o byte
             -- original nao esta mais na coluna, e so volta do ZIP no Storage.
             COUNT(*) FILTER (WHERE position(chr(65533) IN dr.filename) = 0) AS reparavel,
             COUNT(*) FILTER (WHERE position(chr(65533) IN dr.filename) > 0) AS fffd_irreparavel,
             -- As duas parcelas de `reparavel`, agora disjuntas.
             COUNT(*) FILTER (WHERE position(chr(65533) IN dr.filename) = 0
                                AND dr.filename ~ '[\u0080-\u009f]')         AS cp850_controle_c1,
             -- ⚠️ O caso SEM controle nenhum: 'Ata ordinaria' -> 'Ata ordin ria' (a = 0xA0 = NBSP).
             COUNT(*) FILTER (WHERE position(chr(65533) IN dr.filename) = 0
                                AND dr.filename !~ '[\u0080-\u009f]'
                                AND dr.filename ~ '[\u00a0§µ¶·¤]')           AS cp850_sem_controle,
             COUNT(*) FILTER (WHERE dr.source_archive IS NOT NULL
                                 OR dr.metadata ? 'source_zip_entry')        AS com_procedencia_zip,
             MAX(dr.created_at) FILTER (WHERE position(chr(65533) IN dr.filename) = 0)::date
                                                                             AS mais_recente_cp850,
             MAX(dr.created_at) FILTER (WHERE position(chr(65533) IN dr.filename) > 0)::date
                                                                             AS mais_recente_fffd,
             -- Amostra dos REPARAVEIS: e essa lista que o operador confere antes de escrever.
             (array_agg(LEFT(dr.filename, 70) ORDER BY dr.created_at DESC)
                FILTER (WHERE position(chr(65533) IN dr.filename) = 0))[1:3] AS amostra_reparavel,
             (array_agg(LEFT(dr.filename, 70) ORDER BY dr.created_at DESC)
                FILTER (WHERE position(chr(65533) IN dr.filename) > 0))[1:3] AS amostra_irreparavel
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

  -- ⑥ AGENCIA DO DOCUMENTO × AGENCIA CITADA NO NOME (Fase 31, Bloco 3)
  --    Medido em producao: duas Deliberacoes da ARTESP estao arquivadas como documentos da ANTT
  --    (`"DELIBERACAO ARTESP No 593_SEI - …_SUMEF_ACT_ANTT_ARTESP"`; SEI 134.xxx e da ARTESP, e
  --    SUMEF/SUCOL sao superintendencias da ANTT, citadas porque o assunto e um ACT entre as duas).
  --
  --    ⚠️ O MECANISMO, MEDIDO (e nao o que eu supus primeiro):
  --    · `parseAnttManualDocument(...).isAntt` da FALSE nesses nomes. A hipotese era que o
  --      `normalize` apagaria o `_` e faria `\bantt\b` casar em `_ACT_ANTT_`; o normalize que o
  --      parser usa e LOCAL (`antt-manual-parser.ts:1095`) e preserva o `_`, que e `\w`.
  --    · `detectAgenciaSigla(filename)` da ARTESP — o nome esta CERTO.
  --    Logo a contagem virou pelo TEXTO. O defeito real: `detectAgenciaSigla` decide autoria por
  --    MAIORIA DE MENCOES (`classifier.ts:218-226`), e num documento interagencias as mencoes a
  --    contraparte podem dominar o corpo. O TITULO e autoridade; o CORPO e assunto.
  --
  --    Consertar isso e mudanca de atribuicao em massa e NAO entrou nesta fase. Este bloco MEDE.
  --
  --    ⚠️ ISTO E TRIAGEM, NAO VEREDITO. A contagem de siglas que decide a agencia mora em
  --    `detectAgenciaSigla` (TypeScript); reimplementa-la aqui criaria uma segunda verdade — o mesmo
  --    defeito que `RE_CONTESTADO` e a chave de dedup ja custaram a esta base. O SQL so LISTA o par
  --    suspeito para conferencia humana, e vai dar falso positivo em documento que legitimamente
  --    cita outra agencia (um ACT entre duas). Conferir pelo titulo, nao pelo numero.
  --
  --    ESPERADO: o par (ANTT no banco × ARTESP no nome) some para documentos NOVOS depois do deploy.
  '6_agencia_citada_no_nome', (
    SELECT COALESCE(jsonb_agg(t ORDER BY t.total DESC), '[]'::jsonb) FROM (
      SELECT COALESCE(a.sigla, '?') AS agencia_no_banco,
             outra.sigla            AS agencia_citada_no_nome,
             COUNT(*)               AS total,
             MAX(dr.created_at)::date AS mais_recente,
             (array_agg(LEFT(dr.filename, 70) ORDER BY dr.created_at DESC))[1:3] AS amostra
        FROM documentos_regulatorios dr
        LEFT JOIN agencias a ON a.id = dr.agencia_id
        JOIN agencias outra
          ON outra.sigla <> COALESCE(a.sigla, '')
         AND dr.filename ~* ('\m' || outra.sigla || '\M')
       WHERE dr.filename IS NOT NULL
       GROUP BY 1, 2
    ) t
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
