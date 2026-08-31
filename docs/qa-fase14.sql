-- ═══════════════════════════════════════════════════════════════════════════════
-- QA DA FASE 14 — o "Rodar tudo" sob medição (somente LEITURA)
--
-- COMO USAR: cole TUDO no SQL Editor (projeto IRIS) e Run. UMA consulta; copie o JSON e me mande.
--
-- Responde, na ordem das perguntas do usuário:
--  ① 427 → quantas deliberações agora (por agência × ano — mede quanto 2023 entrou nos ZIPs);
--  ② ANM: a migration do seletor pegou? entrou ata NOVA? os 51 `diretoria` são o quê (títulos);
--  ③ as finais SEM VOTO, diagnosticadas linha a linha (sem data / roster zero / contestado /
--    inferível-agora — esta última é o que o materializar fecha com a inferência por decisão);
--  ④ votos órfãos; ⑤ os `queued` (job pendente legítimo × preso); ⑥ mojibake (U+FFFD);
--  ⑦ staleness da coleta por site (ultimo_check/erro/última run) + as últimas esteira_runs.
-- ═══════════════════════════════════════════════════════════════════════════════

SELECT jsonb_pretty(jsonb_build_object(

  '1_deliberacoes_por_agencia_ano', (
    SELECT COALESCE(jsonb_agg(t ORDER BY t.sigla, t.ano), '[]'::jsonb) FROM (
      SELECT COALESCE(a.sigla,'(sem agência)') AS sigla,
             EXTRACT(YEAR FROM d.data_reuniao)::int AS ano,
             COUNT(*) AS deliberacoes
        FROM deliberacoes d LEFT JOIN agencias a ON a.id = d.agencia_id
       GROUP BY 1,2
    ) t
  ),
  '1b_total_geral', (SELECT COUNT(*) FROM deliberacoes),

  '2_anm', (
    SELECT jsonb_build_object(
      'seletor_dos_sites', (
        SELECT COALESCE(jsonb_agg(jsonb_build_object('nome', ms.nome, 'seletor', ms.seletor_links,
                 'ultimo_check', ms.ultimo_check, 'ultimo_erro', LEFT(ms.ultimo_erro, 120))), '[]'::jsonb)
          FROM monitoramento_sites ms JOIN agencias a ON a.id = ms.agencia_id
         WHERE a.sigla = 'ANM'
      ),
      'itens_novos_desde_30_08', (
        SELECT COALESCE(jsonb_agg(t ORDER BY t.total DESC), '[]'::jsonb) FROM (
          SELECT mi.tipo, mi.status, COUNT(*) AS total
            FROM monitoramento_itens mi JOIN agencias a ON a.id = mi.agencia_id
           WHERE a.sigla = 'ANM' AND mi.first_seen_at >= TIMESTAMPTZ '2026-08-30'
           GROUP BY 1,2
        ) t
      ),
      'docs_anm_por_status', (
        SELECT COALESCE(jsonb_agg(t), '[]'::jsonb) FROM (
          SELECT dr.status, dr.tipo_documento, COUNT(*) AS total,
                 COUNT(*) FILTER (WHERE dr.created_at >= TIMESTAMPTZ '2026-08-30') AS criados_apos_30_08
            FROM documentos_regulatorios dr JOIN agencias a ON a.id = dr.agencia_id
           WHERE a.sigla = 'ANM' GROUP BY 1,2
        ) t
      ),
      'os_51_diretoria', (
        SELECT COALESCE(jsonb_agg(jsonb_build_object('titulo', LEFT(mi.titulo, 90),
                 'url', LEFT(mi.url_item, 110))), '[]'::jsonb)
          FROM monitoramento_itens mi JOIN agencias a ON a.id = mi.agencia_id
         WHERE a.sigla = 'ANM' AND mi.tipo = 'diretoria' AND mi.status = 'novo'
         LIMIT 60
      )
    )
  ),

  '3_finais_sem_voto_diagnostico', (
    SELECT COALESCE(jsonb_agg(t ORDER BY t.sigla), '[]'::jsonb) FROM (
      SELECT sigla,
             COUNT(*)                                              AS sem_voto,
             COUNT(*) FILTER (WHERE sem_data)                      AS sem_data_reuniao,
             COUNT(*) FILTER (WHERE NOT sem_data AND roster_n = 0) AS roster_zero_na_data,
             COUNT(*) FILTER (WHERE contestado)                    AS contestado_sem_nomes,
             COUNT(*) FILTER (WHERE NOT sem_data AND roster_n > 0 AND NOT contestado)
                                                                   AS inferivel_pela_decisao
        FROM (
          SELECT a.sigla,
                 d.data_reuniao IS NULL AS sem_data,
                 COALESCE((SELECT COUNT(DISTINCT m.diretor_id)
                    FROM mandatos m JOIN diretores di ON di.id = m.diretor_id
                   WHERE di.agencia_id = d.agencia_id AND di.review_status = 'aprovado'
                     AND m.fonte_dado <> 'automatico'
                     AND m.data_inicio <= d.data_reuniao
                     AND (m.data_fim IS NULL OR m.data_fim >= d.data_reuniao)), 0) AS roster_n,
                 (COALESCE(d.fundamento_decisao,'') || ' ' ||
                  COALESCE(array_to_string(d.decisoes_todas,' '),'') || ' ' ||
                  COALESCE(d.raw_extraction->>'decisao','')
                 ) ~* 'por\s+maioria|voto\s+de\s+qualidade|empate|vencid|prevaleceu|maioria\s+de\s+votos'
                   AS contestado
            FROM deliberacoes d JOIN agencias a ON a.id = d.agencia_id
           WHERE a.sigla IN ('ANTT','ANM','ARTESP')
             AND d.resultado IS NOT NULL AND d.resultado <> 'Retirado de Pauta'
             AND d.tipo_documento NOT IN ('pauta','voto_individual','documento_apoio')
             AND (d.tipo_documento <> 'ata' OR d.documento_pai_id IS NOT NULL)
             AND NOT EXISTS (SELECT 1 FROM votos v WHERE v.deliberacao_id = d.id)
        ) x GROUP BY 1
    ) t
  ),

  '4_votos_orfaos', (
    SELECT jsonb_build_object(
      'total', (SELECT COUNT(*) FROM votos v
                 WHERE NOT EXISTS (SELECT 1 FROM deliberacoes d WHERE d.id = v.deliberacao_id)),
      'amostra', (SELECT COALESCE(jsonb_agg(jsonb_build_object(
                    'diretor', di.nome, 'tipo', v.tipo_voto, 'criado', v.created_at::date)), '[]'::jsonb)
                    FROM votos v JOIN diretores di ON di.id = v.diretor_id
                   WHERE NOT EXISTS (SELECT 1 FROM deliberacoes d WHERE d.id = v.deliberacao_id)
                   LIMIT 14)
    )
  ),

  '5_queued', (
    SELECT COALESCE(jsonb_agg(t ORDER BY t.total DESC), '[]'::jsonb) FROM (
      SELECT COALESCE(a.sigla,'(sem agência)') AS sigla,
             COALESCE(uj.status, '(sem job)')  AS job_status,
             COUNT(*) AS total,
             MIN(dr.updated_at)::date AS mais_antigo
        FROM documentos_regulatorios dr
        LEFT JOIN agencias a ON a.id = dr.agencia_id
        LEFT JOIN upload_jobs uj ON uj.id = dr.upload_job_id
       WHERE dr.status = 'queued'
       GROUP BY 1,2
    ) t
  ),

  '6_mojibake', (
    SELECT jsonb_build_object(
      'documentos_com_fffd', (SELECT COUNT(*) FROM documentos_regulatorios
                               WHERE position(chr(65533) in filename) > 0),
      'itens_monitorados_com_fffd', (SELECT COUNT(*) FROM monitoramento_itens
                                      WHERE position(chr(65533) in COALESCE(titulo,'')) > 0),
      'amostra', (SELECT COALESCE(jsonb_agg(LEFT(filename, 80)), '[]'::jsonb)
                    FROM (SELECT filename FROM documentos_regulatorios
                           WHERE position(chr(65533) in filename) > 0 LIMIT 8) s)
    )
  ),

  '7_coleta_por_site', (
    SELECT COALESCE(jsonb_agg(t ORDER BY t.sigla, t.nome), '[]'::jsonb) FROM (
      SELECT a.sigla, ms.nome,
             ms.ultimo_check,
             LEFT(ms.ultimo_erro, 100) AS ultimo_erro,
             (SELECT jsonb_build_object('status', r.status, 'itens', r.itens_encontrados,
                     'novos', r.novos_itens, 'quando', r.started_at::date,
                     'erro', LEFT(r.error_message, 90))
                FROM monitoramento_runs r WHERE r.site_id = ms.id
               ORDER BY r.started_at DESC LIMIT 1) AS ultima_run
        FROM monitoramento_sites ms JOIN agencias a ON a.id = ms.agencia_id
       WHERE a.sigla IN ('ANTT','ANM','ARTESP') AND ms.ativo
    ) t
  ),

  '8_esteira_runs', (
    SELECT COALESCE(jsonb_agg(t ORDER BY t.iniciado_em DESC), '[]'::jsonb) FROM (
      SELECT status, rodadas, motivo_parada, iniciado_em, concluido_em,
             ROUND(EXTRACT(EPOCH FROM (atualizado_em - iniciado_em))::numeric) AS segundos,
             passos_ok, passos_erro,
             contadores - 'legal_notice' AS contadores
        FROM esteira_runs ORDER BY iniciado_em DESC LIMIT 3
    ) t
  )

)) AS qa_fase14;
