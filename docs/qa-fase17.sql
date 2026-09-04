-- ═══════════════════════════════════════════════════════════════════════════════
-- QA DA FASE 17 — a medição que fecha a fase (somente LEITURA)
--
-- ORDEM OPERACIONAL (a Fase 15 ficou sem veredito por medir ANTES da esteira):
--   1. deploy verde → 2. "Rodar tudo" até "drenou" → 3. aplicar as 2 migrations desta fase
--   (20260904120000 rotulagem, 20260904130000 arquivo da ANM) → 4. "Rodar tudo" de novo
--   → 5. SÓ ENTÃO colar isto e devolver o JSON.
--
-- Responde:
--  ① AUTORIA dos 95 sem motivo — e quantos sobraram depois do conserto;
--  ② a decomposição 1028 → 692, por motivo (o que a tela agora mostra);
--  ③ ARTESP: o bloqueio é REAL em produção? (a medição local de 04/09 diz que a página está
--    acessível e o parser extrai 264 itens — o detector é que dava falso positivo);
--  ④ a população do OCR — a frente fecha se for zero;
--  ⑤ cobertura por fonte, com a run ANTERIOR ao lado (o alarme de queda);
--  ⑥ os chips do painel reconciliados com o banco;
--  ⑦ o poço `em_revisao` e a reconciliação de mão dupla.
-- ═══════════════════════════════════════════════════════════════════════════════

SELECT jsonb_pretty(jsonb_build_object(

  '1_autoria_dos_sem_motivo', (
    SELECT jsonb_build_object(
      'ainda_sem_motivo', (
        SELECT COUNT(*) FROM monitoramento_itens
         WHERE status = 'ignorado' AND metadata->>'enqueue_motivo' IS NULL
      ),
      'por_origem_do_carimbo', (
        SELECT COALESCE(jsonb_agg(t ORDER BY t.total DESC), '[]'::jsonb) FROM (
          SELECT COALESCE(mi.metadata->>'enqueue_motivo_origem', '(sem carimbo de origem)') AS origem,
                 COALESCE(mi.metadata->>'enqueue_motivo', '(sem motivo)') AS motivo,
                 COUNT(*) AS total
            FROM monitoramento_itens mi
           WHERE mi.status = 'ignorado'
           GROUP BY 1, 2
        ) t
      )
    )
  ),

  '2_decomposicao_do_total', (
    SELECT jsonb_build_object(
      'linhas_totais', (SELECT COUNT(*) FROM deliberacoes),
      'por_tipo_e_desfecho', (
        SELECT COALESCE(jsonb_agg(t ORDER BY t.total DESC), '[]'::jsonb) FROM (
          SELECT COALESCE(d.tipo_documento, '(sem tipo)') AS tipo_documento,
                 (d.documento_pai_id IS NOT NULL) AS tem_pai,
                 (d.resultado IS NOT NULL) AS tem_resultado,
                 COUNT(*) AS total
            FROM deliberacoes d GROUP BY 1, 2, 3
        ) t
      )
    )
  ),

  '3_artesp_bloqueio_real', (
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
             'site', ms.nome, 'ultimo_check', ms.ultimo_check,
             'ultima_run', (
               SELECT jsonb_build_object('quando', mr.finished_at::date, 'status', mr.status,
                        'itens', mr.itens_encontrados, 'novos', mr.novos_itens,
                        'erro', LEFT(mr.error_message, 120))
                 FROM monitoramento_runs mr
                WHERE mr.site_id = ms.id AND mr.finished_at IS NOT NULL
                ORDER BY mr.finished_at DESC LIMIT 1
             ))), '[]'::jsonb)
      FROM monitoramento_sites ms JOIN agencias a ON a.id = ms.agencia_id
     WHERE a.sigla = 'ARTESP'
  ),

  '4_populacao_do_ocr', (
    SELECT jsonb_build_object(
      'por_metodo', (
        SELECT COALESCE(jsonb_agg(t), '[]'::jsonb) FROM (
          SELECT COALESCE(dr.campos_detectados->>'extracao_metodo', '(nao registrado)') AS metodo,
                 COUNT(*) AS total
            FROM documentos_regulatorios dr GROUP BY 1
        ) t
      ),
      'suspeitos_de_escaneado', (
        SELECT COUNT(*) FROM documentos_regulatorios
         WHERE chars_per_page IS NOT NULL AND chars_per_page < 80
      ),
      'menor_chars_por_pagina', (
        SELECT MIN(chars_per_page) FROM documentos_regulatorios WHERE chars_per_page > 0
      )
    )
  ),

  '5_cobertura_por_fonte', (
    SELECT COALESCE(jsonb_agg(t ORDER BY t.sigla, t.nome), '[]'::jsonb) FROM (
      SELECT a.sigla, ms.nome, ms.ultimo_check::date AS ultimo_check,
             (SELECT mr.itens_encontrados FROM monitoramento_runs mr
               WHERE mr.site_id = ms.id AND mr.finished_at IS NOT NULL
               ORDER BY mr.finished_at DESC LIMIT 1)                       AS itens_ultima,
             (SELECT mr.itens_encontrados FROM monitoramento_runs mr
               WHERE mr.site_id = ms.id AND mr.finished_at IS NOT NULL
               ORDER BY mr.finished_at DESC LIMIT 1 OFFSET 1)              AS itens_anterior,
             (SELECT COUNT(*) FROM monitoramento_alertas al
               WHERE al.site_id = ms.id AND al.tipo = 'queda_de_volume')   AS alertas_de_queda
        FROM monitoramento_sites ms JOIN agencias a ON a.id = ms.agencia_id
       WHERE ms.tipo_fonte <> 'noticias'
    ) t
  ),

  '6_chips_do_painel', (
    SELECT COALESCE(jsonb_agg(t ORDER BY t.total DESC), '[]'::jsonb) FROM (
      SELECT a.sigla, mi.tipo, mi.status,
             COALESCE(mi.metadata->>'enqueue_motivo', '(sem motivo)') AS motivo,
             COUNT(*) AS total
        FROM monitoramento_itens mi
        JOIN monitoramento_sites ms ON ms.id = mi.site_id
        JOIN agencias a ON a.id = ms.agencia_id
       WHERE mi.status IN ('novo', 'ignorado', 'em_revisao')
       GROUP BY 1, 2, 3, 4
    ) t
  ),

  '7_poco_em_revisao', (
    SELECT COALESCE(jsonb_agg(t ORDER BY t.total DESC), '[]'::jsonb) FROM (
      SELECT COALESCE(dr.status, '(sem documento)') AS doc_status, COUNT(*) AS total
        FROM monitoramento_itens mi
        LEFT JOIN documentos_regulatorios dr ON dr.id = mi.documento_id
       WHERE mi.status = 'em_revisao'
       GROUP BY 1
    ) t
  )

));
