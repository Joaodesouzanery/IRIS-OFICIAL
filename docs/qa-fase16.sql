-- ═══════════════════════════════════════════════════════════════════════════════
-- QA DA FASE 16 — vereditos das Fases 15+16 em uma consulta (somente LEITURA)
--
-- ORDEM OPERACIONAL (lição da Fase 15, que ficou sem veredito por medir ANTES da esteira):
--   1. deploy verde → 2. aplicar 20260901120000 no SQL Editor → 3. "Rodar tudo" até "drenou"
--   → 4. SÓ ENTÃO colar isto e devolver o JSON.
--
-- Responde:
--  ① a run terminou POR "drenou"? em quantas rodadas/segundos? (prova dos commits A/B da F16)
--    + contadores novos: redatadas, datas_para_revisao, reconciliados_*;
--  ② deliberações por agência × ano — 1996 → 0? os 74 `ano null` → quantos?
--  ③ o poço em_revisao: o que restou, cruzado com o status do DOC (só trânsito é aceitável);
--  ④ a 87ª ROP e os Votos DFQ, nominalmente, item + documento;
--  ⑤ o carimbo da ANM foi consumido? (tentativas, status atual dos 65);
--  ⑥ votos por diretor DECOMPOSTOS — o veredito das 3 agências;
--  ⑦ finais sem voto + datas marcadas para revisão;
--  ⑧ ANM 2026 existe?
-- ═══════════════════════════════════════════════════════════════════════════════

SELECT jsonb_pretty(jsonb_build_object(

  '1_ultimas_runs', (
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
             'iniciado_em', t.iniciado_em, 'status', t.status, 'rodadas', t.rodadas,
             'segundos', EXTRACT(EPOCH FROM (t.concluido_em - t.iniciado_em))::int,
             'motivo_parada', t.motivo_parada,
             'redatadas', t.contadores->'redatadas',
             'datas_para_revisao', t.contadores->'datas_para_revisao',
             'reconciliados_importado', t.contadores->'reconciliados_importado',
             'reconciliados_ignorado', t.contadores->'reconciliados_ignorado',
             'reconciliados_novo', t.contadores->'reconciliados_novo',
             'materializados', t.contadores->'materializados',
             'processados', t.contadores->'processados',
             'votos', t.contadores->'votos')), '[]'::jsonb)
      FROM (SELECT * FROM esteira_runs ORDER BY iniciado_em DESC LIMIT 3) t
  ),

  '2_deliberacoes_por_agencia_ano', (
    SELECT COALESCE(jsonb_agg(t ORDER BY t.sigla, t.ano), '[]'::jsonb) FROM (
      SELECT COALESCE(a.sigla,'(sem agência)') AS sigla,
             EXTRACT(YEAR FROM d.data_reuniao)::int AS ano, COUNT(*) AS deliberacoes
        FROM deliberacoes d LEFT JOIN agencias a ON a.id = d.agencia_id GROUP BY 1,2
    ) t
  ),
  '2b_total_geral', (SELECT COUNT(*) FROM deliberacoes),

  '3_em_revisao_restante_x_doc', (
    SELECT COALESCE(jsonb_agg(t ORDER BY t.total DESC), '[]'::jsonb) FROM (
      SELECT a.sigla, COALESCE(dr.status, '(sem documento)') AS doc_status, COUNT(*) AS total
        FROM monitoramento_itens mi
        JOIN monitoramento_sites ms ON ms.id = mi.site_id
        JOIN agencias a ON a.id = ms.agencia_id
        LEFT JOIN documentos_regulatorios dr ON dr.id = mi.documento_id
       WHERE mi.status = 'em_revisao'
       GROUP BY 1,2
    ) t
  ),

  '4_87rop_e_dfq', (
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
             'titulo', LEFT(mi.titulo, 60), 'item_status', mi.status,
             'doc_status', dr.status, 'doc_tipo', dr.tipo_documento,
             'tem_deliberacao', dr.deliberacao_id IS NOT NULL)), '[]'::jsonb)
      FROM monitoramento_itens mi
      LEFT JOIN documentos_regulatorios dr ON dr.id = mi.documento_id
     WHERE mi.url_item ILIKE '%ata-87%' OR mi.url_item ILIKE '%pauta-da-87%'
        OR mi.titulo ILIKE '%Voto DFQ%' OR mi.url_item ILIKE '%Voto+DFQ%'
     LIMIT 12
  ),

  '5_carimbo_anm_consumido', (
    SELECT COALESCE(jsonb_agg(t), '[]'::jsonb) FROM (
      SELECT mi.status, mi.tipo,
             COUNT(*) AS total,
             COUNT(*) FILTER (WHERE mi.tentativas > 0) AS re_tentados,
             COUNT(*) FILTER (WHERE mi.proxima_tentativa_em IS NOT NULL) AS ainda_carimbados
        FROM monitoramento_itens mi
        JOIN monitoramento_sites ms ON ms.id = mi.site_id
        JOIN agencias a ON a.id = ms.agencia_id
       WHERE a.sigla = 'ANM' AND ms.tipo_fonte <> 'noticias'
         AND mi.metadata->>'enqueue_motivo' IN ('sem_pdf','download_falhou')
       GROUP BY 1,2
    ) t
  ),

  '6_votos_por_diretor', (
    SELECT COALESCE(jsonb_agg(t ORDER BY t.sigla, t.efetivos DESC), '[]'::jsonb) FROM (
      SELECT a.sigla, d.nome,
             (SELECT COUNT(*) FROM votos v WHERE v.diretor_id = d.id
               AND v.tipo_voto IN ('Favoravel','Desfavoravel'))                     AS efetivos,
             (SELECT COUNT(*) FROM votos v WHERE v.diretor_id = d.id
               AND v.tipo_voto = 'Ausente')                                        AS ausencias,
             (SELECT COUNT(*) FROM votos v WHERE v.diretor_id = d.id
               AND v.tipo_voto = 'Abstencao')                                      AS abstencoes,
             (SELECT COUNT(*) FROM votos v JOIN deliberacoes dl ON dl.id = v.deliberacao_id
               WHERE v.diretor_id = d.id AND dl.data_reuniao >= DATE '2026-01-01'
                 AND v.tipo_voto IN ('Favoravel','Desfavoravel'))                  AS efetivos_2026,
             (SELECT COUNT(*) FROM deliberacoes del
               WHERE del.agencia_id = d.agencia_id
                 AND del.resultado IS NOT NULL
                 AND del.tipo_documento NOT IN ('pauta','voto_individual','documento_apoio')
                 AND (del.tipo_documento <> 'ata' OR del.documento_pai_id IS NOT NULL)
                 AND del.data_reuniao IS NOT NULL
                 AND EXISTS (SELECT 1 FROM mandatos m WHERE m.diretor_id = d.id
                              AND m.fonte_dado <> 'automatico'
                              AND m.data_inicio <= del.data_reuniao
                              AND (m.data_fim IS NULL OR m.data_fim >= del.data_reuniao))) AS oportunidades
        FROM diretores d JOIN agencias a ON a.id = d.agencia_id
       WHERE d.review_status = 'aprovado' AND a.sigla IN ('ANTT','ANM','ARTESP')
         AND EXISTS (SELECT 1 FROM votos v WHERE v.diretor_id = d.id)
    ) t
  ),

  '7_sem_voto_e_datas', (
    SELECT jsonb_build_object(
      'finais_sem_voto', (
        SELECT COALESCE(jsonb_agg(t ORDER BY t.sigla), '[]'::jsonb) FROM (
          SELECT a.sigla, COUNT(*) AS sem_voto
            FROM deliberacoes del JOIN agencias a ON a.id = del.agencia_id
           WHERE del.resultado IS NOT NULL
             AND del.tipo_documento NOT IN ('pauta','voto_individual','documento_apoio')
             AND (del.tipo_documento <> 'ata' OR del.documento_pai_id IS NOT NULL)
             AND NOT EXISTS (SELECT 1 FROM votos v WHERE v.deliberacao_id = del.id)
           GROUP BY 1
        ) t
      ),
      'datas_marcadas_revisao', (
        SELECT COUNT(*) FROM deliberacoes d
         WHERE (d.raw_extraction->>'precisa_revisao_data') = 'true'
      )
    )
  ),

  '8_anm_2026', (
    SELECT jsonb_build_object(
      'deliberacoes_2026', (
        SELECT COUNT(*) FROM deliberacoes d JOIN agencias a ON a.id = d.agencia_id
         WHERE a.sigla = 'ANM' AND d.data_reuniao >= DATE '2026-01-01'
      ),
      'docs_criados_apos_01_09', (
        SELECT COUNT(*) FROM documentos_regulatorios dr JOIN agencias a ON a.id = dr.agencia_id
         WHERE a.sigla = 'ANM' AND dr.created_at >= TIMESTAMPTZ '2026-09-01'
      )
    )
  )

));
