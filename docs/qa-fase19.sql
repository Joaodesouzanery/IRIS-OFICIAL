-- ═══════════════════════════════════════════════════════════════════════════════
-- QA DA FASE 19 — a prova do reparo (somente LEITURA)
--
-- ORDEM: deploy verde → aplicar 20260905120000 (alerta) e 20260906120000 (filhos de pauta)
--        → "Rodar tudo" → colar isto.
--
-- ① os itens de ata sem `resultado` — mede o DISPOSITIVO na coluna CERTA (`resumo_pleito`);
-- ② a JANELA DE REPARO: quantos pendentes ainda têm o pai com `ata_items` (a fonte do UPDATE);
-- ③ os filhos de PAUTA sumiram do denominador?
-- ④ VOTOS: quantos existem por agência e quantos itens de ata já geraram voto;
-- ⑤ o alarme voltou a gravar (a regressão do item_id NOT NULL);
-- ⑥ cobertura por fonte, com `novos` da última run — a prova do commit da Fase 18.
-- ═══════════════════════════════════════════════════════════════════════════════

SELECT jsonb_pretty(jsonb_build_object(

  '1_itens_de_ata_sem_resultado', (
    SELECT COALESCE(jsonb_agg(t ORDER BY t.total DESC), '[]'::jsonb) FROM (
      SELECT COALESCE(a.sigla,'?') AS sigla,
             COUNT(*) AS total,
             COUNT(*) FILTER (WHERE COALESCE(d.resumo_pleito,'') <> '') AS tem_dispositivo,
             COUNT(*) FILTER (WHERE d.numero_deliberacao LIKE 'PAUTA-%') AS filhos_de_pauta
        FROM deliberacoes d LEFT JOIN agencias a ON a.id = d.agencia_id
       WHERE d.tipo_documento = 'ata' AND d.documento_pai_id IS NOT NULL AND d.resultado IS NULL
       GROUP BY 1
    ) t
  ),

  '2_janela_de_reparo', (
    SELECT jsonb_build_object(
      'pendentes_com_fonte', (
        SELECT COUNT(*) FROM deliberacoes d
         WHERE d.tipo_documento = 'ata' AND d.documento_pai_id IS NOT NULL AND d.resultado IS NULL
           AND d.numero_deliberacao NOT LIKE 'PAUTA-%'
           AND EXISTS (SELECT 1 FROM documentos_regulatorios dr
                        WHERE dr.deliberacao_id = d.documento_pai_id
                          AND dr.ata_items IS NOT NULL)
      ),
      'pendentes_sem_fonte', (
        SELECT COUNT(*) FROM deliberacoes d
         WHERE d.tipo_documento = 'ata' AND d.documento_pai_id IS NOT NULL AND d.resultado IS NULL
           AND d.numero_deliberacao NOT LIKE 'PAUTA-%'
           AND NOT EXISTS (SELECT 1 FROM documentos_regulatorios dr
                            WHERE dr.deliberacao_id = d.documento_pai_id
                              AND dr.ata_items IS NOT NULL)
      )
    )
  ),

  '3_filhos_de_pauta', (
    SELECT jsonb_build_object(
      'total', (SELECT COUNT(*) FROM deliberacoes WHERE numero_deliberacao LIKE 'PAUTA-%'),
      'ja_arquivados', (
        SELECT COUNT(*) FROM deliberacoes
         WHERE numero_deliberacao LIKE 'PAUTA-%'
           AND (raw_extraction->>'import_counts_as_final') = 'false'
      )
    )
  ),

  '4_votos', (
    SELECT jsonb_build_object(
      'por_agencia', (
        SELECT COALESCE(jsonb_agg(t ORDER BY t.votos DESC), '[]'::jsonb) FROM (
          SELECT COALESCE(a.sigla,'?') AS sigla, COUNT(v.id) AS votos,
                 COUNT(*) FILTER (WHERE v.tipo_voto IN ('Favoravel','Desfavoravel')) AS efetivos
            FROM votos v
            JOIN diretores di ON di.id = v.diretor_id
            LEFT JOIN agencias a ON a.id = di.agencia_id
           GROUP BY 1
        ) t
      ),
      'itens_de_ata_com_voto', (
        SELECT COUNT(*) FROM deliberacoes d
         WHERE d.tipo_documento = 'ata' AND d.documento_pai_id IS NOT NULL AND d.resultado IS NOT NULL
           AND EXISTS (SELECT 1 FROM votos v WHERE v.deliberacao_id = d.id)
      ),
      'itens_de_ata_COM_resultado_SEM_voto', (
        SELECT COUNT(*) FROM deliberacoes d
         WHERE d.tipo_documento = 'ata' AND d.documento_pai_id IS NOT NULL AND d.resultado IS NOT NULL
           AND NOT EXISTS (SELECT 1 FROM votos v WHERE v.deliberacao_id = d.id)
      )
    )
  ),

  '5_alarme', (
    SELECT jsonb_build_object(
      'por_tipo', (
        SELECT COALESCE(jsonb_agg(t ORDER BY t.total DESC), '[]'::jsonb) FROM (
          SELECT al.tipo, COUNT(*) AS total, MAX(al.created_at)::date AS mais_recente
            FROM monitoramento_alertas al GROUP BY 1
        ) t
      ),
      'de_fonte_sem_item', (SELECT COUNT(*) FROM monitoramento_alertas WHERE item_id IS NULL)
    )
  ),

  '6_cobertura_por_fonte', (
    SELECT COALESCE(jsonb_agg(t ORDER BY t.sigla, t.nome), '[]'::jsonb) FROM (
      SELECT COALESCE(a.sigla,'?') AS sigla, ms.nome, ms.ultimo_check::date AS ultimo_check,
             (SELECT mr.itens_encontrados FROM monitoramento_runs mr
               WHERE mr.site_id = ms.id AND mr.finished_at IS NOT NULL
               ORDER BY mr.started_at DESC LIMIT 1) AS itens_ultima,
             (SELECT mr.novos_itens FROM monitoramento_runs mr
               WHERE mr.site_id = ms.id AND mr.finished_at IS NOT NULL
               ORDER BY mr.started_at DESC LIMIT 1) AS novos_ultima
        FROM monitoramento_sites ms LEFT JOIN agencias a ON a.id = ms.agencia_id
       WHERE ms.tipo_fonte <> 'noticias' AND ms.ativo
    ) t
  )

));
