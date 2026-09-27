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

  -- ⑦ DOCUMENTO SEM AGENCIA (Fase 31, Bloco 3)
  --    Medido em producao: 15 documentos com nome corrompido cairam no grupo de agencia `?` — todos
  --    com procedencia de ZIP, o mais recente de 2026-08-30. `?` e `agencia_id IS NULL`: a coluna e
  --    nullable por desenho (`20260517173457:6`) e nenhuma migration do repo tem `DELETE FROM
  --    agencias`, entao nao e FK orfa.
  --
  --    ⚠️ E DOCUMENTO SEM AGENCIA E BECO SEM SAIDA: `deliberacoes.agencia_id` e NOT NULL
  --    (`001_initial_schema.sql:70`), entao ele nunca vira deliberacao — fica no acervo sem poder
  --    avancar, e sem aparecer em nenhuma contagem por agencia.
  --
  --    Tres caminhos produzem isso (dois seguem abertos):
  --    1. Upload manual de ZIP sem escolher agencia (o seletor nasce vazio) + PDF escaneado, em que a
  --       analise tambem nao resolve. ABERTO.
  --    2. A consulta de retry da esteira nao filtra agencia (`enqueue-pdfs:158-166`), e ha site
  --       seedado com `agencia_id` NULL (`006_associados_documentos.sql:161`). ABERTO.
  --    3. `pipeline.ts` gravava `upload_jobs.agencia_id = analysis.agencia_id_detected` SEM fallback,
  --       apagando a agencia que o job tinha; `upload-queue.ts:143` le esse campo num reenvio.
  --       ✅ CONSERTADO nesta fase (`?? job.agencia_id`, igual a linha do documento).
  --
  --    ESPERADO: `sem_agencia` nao CRESCE depois do deploy. O caminho 3 fechou; se ainda crescer, e 1
  --    ou 2, e ai o numero aponta qual.
  '7_documento_sem_agencia', (
    SELECT jsonb_build_object(
      'total', COUNT(*),
      'de_zip', COUNT(*) FILTER (WHERE dr.source_archive IS NOT NULL OR dr.metadata ? 'source_zip_entry'),
      'com_source_url', COUNT(*) FILTER (WHERE dr.metadata ? 'source_url'),
      -- `storage_path` comeca com `auto/` exatamente quando a agencia era NULL na hora do upload
      -- (`upload-queue.ts:192`: `${agenciaId ?? "auto"}/${fileHash}.pdf`). E a impressao digital do
      -- caminho 1, e ela sobrevive mesmo que a agencia seja preenchida depois.
      'storage_em_auto', COUNT(*) FILTER (WHERE dr.storage_path LIKE 'auto/%'),
      'mais_recente', MAX(dr.created_at)::date,
      'por_status', (
        SELECT COALESCE(jsonb_object_agg(status, n), '{}'::jsonb)
          FROM (SELECT COALESCE(status,'?') AS status, COUNT(*) AS n
                  FROM documentos_regulatorios WHERE agencia_id IS NULL GROUP BY 1) y
      ),
      'amostra', (array_agg(LEFT(dr.filename, 70) ORDER BY dr.created_at DESC))[1:5]
    )
      FROM documentos_regulatorios dr
     WHERE dr.agencia_id IS NULL
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
  ),

  -- ⑧ O DE→PARA DO ROSTER, JA CALCULADO PELA ESTEIRA (Fase 31, Bloco 4)
  --    ⚠️ Este bloco SO LE. Quem compara nome com nome e a esteira, com `resolverPresentesRoster` —
  --    a MESMA funcao que constroi o roster que vira voto. Um laco de comparacao em SQL exigiria
  --    reimplementar `findBestMatch`, e isso criaria a segunda verdade que esta base ja pagou duas
  --    vezes. A esteira grava em `raw_extraction.roster_divergente`; aqui so se agrupa por reuniao.
  --
  --    `recebeu_sem_estar` = tem voto gravado e NAO esta na lista de presentes da ata (o caso do
  --    Caio Mario na 79a). `presente_sem_voto` = esta na ata e tem ZERO voto (Tasso e Roger) — a
  --    metade invisivel, que nao aparece em metrica nenhuma porque voto ausente nao deixa rastro.
  --
  --    VAZIO significa uma de duas coisas, e as duas sao informacao: ou nao ha divergencia, ou a
  --    esteira ainda nao rodou depois do deploy. Quem desempata e o campo `divergencias_gravadas`
  --    da resposta do materializador (`/api/v1/admin/votos/materializar-faltantes`): > 0 com este
  --    bloco vazio seria contradicao; 0 aqui e 0 la significa apenas que a esteira nao passou.
  '8_roster_divergente', (
    SELECT COALESCE(jsonb_agg(t ORDER BY t.itens DESC), '[]'::jsonb) FROM (
      SELECT z.agencia, z.numero_reuniao, z.data_reuniao,
             COUNT(DISTINCT z.id) AS itens,
             jsonb_agg(DISTINCT z.recebeu)   FILTER (WHERE z.recebeu   IS NOT NULL) AS recebeu_sem_estar,
             jsonb_agg(DISTINCT z.presente)  FILTER (WHERE z.presente  IS NOT NULL) AS presente_sem_voto,
             jsonb_agg(DISTINCT z.naorecon)  FILTER (WHERE z.naorecon  IS NOT NULL) AS nome_da_ata_sem_cadastro
        FROM (
          SELECT COALESCE(a.sigla,'?') AS agencia, d.numero_reuniao, d.data_reuniao, d.id,
                 r.v AS recebeu, p.v AS presente, n.v AS naorecon
            FROM deliberacoes d
            LEFT JOIN agencias a ON a.id = d.agencia_id
            LEFT JOIN LATERAL jsonb_array_elements_text(
                   d.raw_extraction->'roster_divergente'->'recebeu_sem_estar') r(v) ON TRUE
            LEFT JOIN LATERAL jsonb_array_elements_text(
                   d.raw_extraction->'roster_divergente'->'presente_sem_voto') p(v) ON TRUE
            LEFT JOIN LATERAL jsonb_array_elements_text(
                   d.raw_extraction->'roster_divergente'->'presentes_nao_reconhecidos') n(v) ON TRUE
           WHERE d.raw_extraction ? 'roster_divergente'
        ) z
       GROUP BY 1, 2, 3
    ) t
  ),

  -- ⑨ O COLEGIADO ESPERADO × QUEM VOTOU, por reuniao (Fase 31, Bloco 4)
  --    ⚠️ Compara por ID DE DIRETOR, nao por nome — entao nao ha matcher nem segunda verdade aqui.
  --    Os predicados espelham `getActiveDiretoresForVote` (`vote-inference.ts:127-137`), que e o
  --    motor que cria os votos: `fonte_dado <> 'automatico'` (mandato FABRICADO a partir do proprio
  --    voto inferido nao conta), `review_status = 'aprovado'`, e janela com bordas INCLUSIVAS.
  --    Ha precedente com teste para esse espelhamento: `etapa77-auditoria-sql.test.ts`.
  --
  --    RESPONDE A PERGUNTA DA 84a: a tela mostra "2 de 4" em 29/04/2026, e os seeds do repo dao
  --    CINCO mandatos ativos naquela data (Mauro, Caio Mario, Jose Fernando, Luiz Paniago, Fabio).
  --    `esperado` diz quem sao os 4 de verdade, e `faltando` diz quem nao votou.
  --
  --    `extra` = recebeu voto SEM ter mandato ativo na data. Se vier nao-vazio, e outra classe de
  --    defeito que ninguem mediu ainda.
  '9_colegiado_por_reuniao', (
    SELECT COALESCE(jsonb_agg(t ORDER BY t.classe, t.data_reuniao DESC, t.agencia), '[]'::jsonb) FROM (
      SELECT COALESCE(a.sigla,'?') AS agencia, r.numero_reuniao, r.data_reuniao,
             -- ⚠️ `reuniao` | `voto_individual` | `documento_avulso`. So a primeira tem colegiado
             --    esperado: nas outras duas a conta "N de 5" nao quer dizer nada, e dizia.
             r.classe,
             CASE WHEN r.classe <> 'reuniao' THEN NULL ELSE
             (SELECT COUNT(*) FROM mandatos m JOIN diretores dir ON dir.id = m.diretor_id
               WHERE dir.agencia_id = r.agencia_id AND dir.review_status = 'aprovado'
                 AND m.fonte_dado <> 'automatico'
                 AND m.data_inicio <= r.data_reuniao
                 AND (m.data_fim IS NULL OR m.data_fim >= r.data_reuniao)) END AS esperado_total,
             CASE WHEN r.classe <> 'reuniao' THEN NULL ELSE
             (SELECT array_agg(DISTINCT dir.nome ORDER BY dir.nome)
                FROM mandatos m JOIN diretores dir ON dir.id = m.diretor_id
               WHERE dir.agencia_id = r.agencia_id AND dir.review_status = 'aprovado'
                 AND m.fonte_dado <> 'automatico'
                 AND m.data_inicio <= r.data_reuniao
                 AND (m.data_fim IS NULL OR m.data_fim >= r.data_reuniao)) END AS esperado,
             (SELECT array_agg(DISTINCT dir.nome ORDER BY dir.nome)
                FROM votos v JOIN deliberacoes d2 ON d2.id = v.deliberacao_id
                             JOIN diretores dir ON dir.id = v.diretor_id
               WHERE d2.agencia_id = r.agencia_id AND d2.data_reuniao = r.data_reuniao
                 AND COALESCE(d2.numero_reuniao,'') = COALESCE(r.numero_reuniao,'')) AS com_voto,
             -- Quem tinha mandato e NAO votou. ⚠️ NULO fora de `classe = 'reuniao'`: era daqui que
             -- saiam os "faltando: 4" de documento avulso e de voto individual.
             CASE WHEN r.classe <> 'reuniao' THEN NULL ELSE
             (SELECT array_agg(DISTINCT dir.nome ORDER BY dir.nome)
                FROM mandatos m JOIN diretores dir ON dir.id = m.diretor_id
               WHERE dir.agencia_id = r.agencia_id AND dir.review_status = 'aprovado'
                 AND m.fonte_dado <> 'automatico'
                 AND m.data_inicio <= r.data_reuniao
                 AND (m.data_fim IS NULL OR m.data_fim >= r.data_reuniao)
                 AND NOT EXISTS (SELECT 1 FROM votos v2 JOIN deliberacoes d3 ON d3.id = v2.deliberacao_id
                                  WHERE v2.diretor_id = dir.id AND d3.agencia_id = r.agencia_id
                                    AND d3.data_reuniao = r.data_reuniao
                                    AND COALESCE(d3.numero_reuniao,'') = COALESCE(r.numero_reuniao,''))) END AS faltando,
             -- Quem VOTOU sem ter mandato ativo na data.
             (SELECT array_agg(DISTINCT dir.nome ORDER BY dir.nome)
                FROM votos v JOIN deliberacoes d2 ON d2.id = v.deliberacao_id
                             JOIN diretores dir ON dir.id = v.diretor_id
               WHERE d2.agencia_id = r.agencia_id AND d2.data_reuniao = r.data_reuniao
                 AND COALESCE(d2.numero_reuniao,'') = COALESCE(r.numero_reuniao,'')
                 AND NOT EXISTS (SELECT 1 FROM mandatos m2
                                  WHERE m2.diretor_id = dir.id AND m2.fonte_dado <> 'automatico'
                                    AND m2.data_inicio <= r.data_reuniao
                                    AND (m2.data_fim IS NULL OR m2.data_fim >= r.data_reuniao))) AS extra
        -- ⚠️ O UNIVERSO CLASSIFICA, e nao chama tudo de "reuniao" (Fase 33, item 4 do usuario).
        --
        --    Antes era `SELECT DISTINCT (agencia_id, data_reuniao, numero_reuniao)` sem filtro
        --    algum de tipo, e com isso QUALQUER linha com voto e data virava "uma reuniao":
        --      · documento SEM `numero_reuniao` virava uma reuniao propria, com 4 `faltando`;
        --      · o documento de VOTO INDIVIDUAL da ANTT tambem, e ele tem 1 voto POR DESENHO (e o
        --        voto do relator; o colegiado vem da ATA).
        --
        --    ⚠️ E o filtro que o projeto usa em tres lugares para isso NAO FILTRA NADA:
        --    `tipo_documento NOT IN ('pauta','voto_individual',…)`. Conferido no fonte: nenhum
        --    caminho de producao escreve `deliberacoes.tipo_documento = 'voto_individual'` — o
        --    rotulo vive no jsonb (`raw_extraction.documento_subtipo` / `documento_antt_tipo`). Por
        --    isso a classificacao aqui le o JSONB, que e a unica fonte que existe.
        --
        --    ⚠️ E ISTO NAO EXPLICA AS NOVE REUNIOES DA ANTT com "1 de 5" (271, 272, 273, 274, 276,
        --    99, 1.028, 1.029, 1.030). Foi a minha hipotese, e a consulta do usuario a REFUTOU: elas
        --    sao `classe = 'reuniao'`, com ata materializada e filhos com `resultado`. O defeito era
        --    outro e esta consertado no codigo (a esteira perdia `documento_antt_tipo`, e o RELATOR
        --    virava o unico votante). Este bloco conserta um falso positivo DIFERENTE.
        FROM (SELECT d.agencia_id, d.data_reuniao, d.numero_reuniao,
                     CASE
                       WHEN d.numero_reuniao IS NULL THEN 'documento_avulso'
                       WHEN bool_and(COALESCE(d.raw_extraction->>'documento_subtipo',
                                              d.raw_extraction->>'documento_antt_tipo')
                                     = 'voto_individual') THEN 'voto_individual'
                       ELSE 'reuniao'
                     END AS classe
                FROM deliberacoes d JOIN votos v ON v.deliberacao_id = d.id
               WHERE d.data_reuniao IS NOT NULL
               GROUP BY d.agencia_id, d.data_reuniao, d.numero_reuniao) r
        LEFT JOIN agencias a ON a.id = r.agencia_id
    ) t
  )
,

  -- ⑩ A FRASE REAL DO AFASTAMENTO — antes de eu escrever regex nenhuma (Fase 31, Bloco 4)
  --
  --    ⚠️ ESTE BLOCO EXISTE PORQUE EU NAO TENHO A FRASE, e escrever detector sem amostra e
  --    exatamente o erro que produziu a CP850: a Fase 14 ACERTOU ao descartar CP437 (testou) e
  --    ERROU ao concluir Latin-1 (nao testou). Nao vou repetir com "afastado".
  --
  --    O que o REPO diz hoje, medido:
  --      · o preambulo REAL da 79a ROP (fixture `PREAMBULO_79`, etapa24) NAO contem "afastad" —
  --        Caio Mario simplesmente NAO E NOMEADO ali. A ausencia dele e por OMISSAO;
  --      · a unica mencao a ele no codigo e da 83a, e e como RELATOR ANTERIOR: "por se tratar de
  --        materia anteriormente relatada pelo Diretor Caio Mario..., NAO HAVIA IMPEDIMENTO". Ha
  --        guard explicito (`RE_IMPEDIMENTO_NEGADO`) para nao ler isso como impedimento;
  --      · ZERO fixtures do repo contem a palavra num rotulo de ausencia.
  --
  --    Logo a hipotese "a ata diz que ele esta afastado" NAO esta sustentada pelo que eu alcanco.
  --    Este bloco busca no `raw_text` (que tem indice trigram, entao o ILIKE e barato) e devolve o
  --    TRECHO. Com a frase na mao, a regex nasce de amostra real.
  --
  --    ⚠️ E o detector NAO foi escrito: nao ha constante desligada esperando, porque nao ha o que
  --    ligar. Escrever agora seria adivinhar a forma e chamar de "medido e desligado".
  '10_frase_do_afastamento', (
    SELECT COALESCE(jsonb_agg(t ORDER BY t.data_reuniao DESC NULLS LAST), '[]'::jsonb) FROM (
      SELECT COALESCE(a.sigla,'?') AS agencia, d.numero_reuniao, d.data_reuniao,
             d.tipo_documento,
             -- O trecho em volta da PRIMEIRA ocorrencia: 120 caracteres antes e 200 depois.
             -- E o bastante para ver o rotulo, o nome e o motivo, que e o que a regex precisa.
             substring(d.raw_text
                       FROM greatest(1, position('afastad' IN lower(d.raw_text)) - 120)
                       FOR 320) AS trecho,
             -- Quantas vezes aparece: 1 e provavelmente prosa solta; varias sugere rotulo estruturado.
             (length(lower(d.raw_text)) - length(replace(lower(d.raw_text), 'afastad', ''))) / 7
               AS ocorrencias
        FROM deliberacoes d
        LEFT JOIN agencias a ON a.id = d.agencia_id
       WHERE d.raw_text IS NOT NULL
         AND d.raw_text ILIKE '%afastad%'
         -- "Afastamento em Ferias" dentro do rotulo da ARTESP ja e tratado (Fase 13/23): ele e
         -- MOTIVO de ausencia rotulada, nao a classe nova. Sai, para o bloco mostrar o que e novo.
         AND d.raw_text NOT ILIKE '%Afastamento em F%rias%'
       LIMIT 40
    ) t
  ),

  -- ⑪ E A 79a ESPECIFICAMENTE: o preambulo dela, cru (Fase 31, Bloco 4)
  --    ⚠️ Responde a pergunta que o fixture do repo nao responde. Se vier vazio ou sem "afastad",
  --    a ausencia de Caio Mario na 79a e por OMISSAO — e o conserto dela e o `PRESENTES_DO_PAI_VALEM`
  --    (bloco ⑧), nao um detector de afastamento.
  '11_preambulo_da_79', (
    SELECT COALESCE(jsonb_agg(t), '[]'::jsonb) FROM (
      SELECT COALESCE(a.sigla,'?') AS agencia, d.numero_reuniao, d.data_reuniao, d.tipo_documento,
             left(d.raw_text, 1200) AS primeiros_1200_caracteres,
             d.raw_text ILIKE '%afastad%' AS menciona_afastado,
             d.raw_text ILIKE '%Caio M%' AS menciona_caio_mario
        FROM deliberacoes d
        LEFT JOIN agencias a ON a.id = d.agencia_id
       WHERE COALESCE(a.sigla,'') = 'ANM'
         AND d.raw_text IS NOT NULL
         AND (d.numero_reuniao IN ('79','79ª') OR d.data_reuniao = DATE '2025-11-26')
         AND d.documento_pai_id IS NULL   -- o PAI da ata carrega o preambulo; os filhos, nao
       LIMIT 5
    ) t
  )

)) AS qa_fase31;
