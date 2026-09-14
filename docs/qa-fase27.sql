-- ═══════════════════════════════════════════════════════════════════════════════
-- QA DA FASE 27 — o parser com teto real, o recálculo que termina, a pauta fora da fila
-- (somente LEITURA — uma instrução)
--
-- ORDEM: deploy verde → "Rodar tudo" 2× → colar.
--
-- ① OS PRESOS — esperado: ZERO em `processing`; as pautas antigas arquivadas `parser_travou`;
--    o que sobrar em `failed` tem `reprocesso_encerrado` e instrução de reenvio (ata/deliberação).
-- ② DIREÇÃO DO VOTO INFERIDO — esperado: `pendentes` = 0 e o % Favorável perto de
--    ARTESP 73 · ANM 79 · ANTT 99. Se `pendentes` > 0, faltam rodadas (o número só cai).
-- ③ ANM 2026 — esperado: mais de 3 reuniões (as atas deixam de disputar com as pautas de 2023).
-- ④ PAUTAS DE ANO ENCERRADO arquivadas sem baixar, por agência.
-- ═══════════════════════════════════════════════════════════════════════════════

SELECT jsonb_pretty(jsonb_build_object(

  '1_presos', (
    SELECT COALESCE(jsonb_agg(t ORDER BY t.status, t.sigla), '[]'::jsonb) FROM (
      SELECT COALESCE(a.sigla,'?') AS sigla, dr.status, dr.tipo_documento,
             COUNT(*) AS documentos,
             COUNT(*) FILTER (WHERE dr.campos_detectados ? 'reprocesso_encerrado') AS encerrados,
             COUNT(*) FILTER (WHERE dr.campos_detectados->>'arquivado_motivo' = 'parser_travou') AS arquivados_parser,
             left(COALESCE(max(dr.error_message), ''), 100) AS exemplo_erro
        FROM documentos_regulatorios dr LEFT JOIN agencias a ON a.id = dr.agencia_id
       WHERE dr.status IN ('processing', 'failed', 'queued')
          OR dr.campos_detectados->>'arquivado_motivo' = 'parser_travou'
       GROUP BY 1, 2, 3
    ) t
  ),

  '2_direcao_do_voto_inferido', (
    SELECT COALESCE(jsonb_agg(t ORDER BY t.sigla), '[]'::jsonb) FROM (
      SELECT a.sigla,
             COUNT(DISTINCT d.id) FILTER (WHERE NOT v.is_nominal AND v.tipo_voto = 'Favoravel' AND d.resultado = 'Indeferido') AS pendentes,
             COUNT(v.id) FILTER (WHERE v.tipo_voto = 'Favoravel') AS favoraveis,
             COUNT(v.id) FILTER (WHERE v.tipo_voto = 'Desfavoravel') AS desfavoraveis,
             ROUND(100.0 * COUNT(v.id) FILTER (WHERE v.tipo_voto = 'Favoravel')
                   / NULLIF(COUNT(v.id) FILTER (WHERE v.tipo_voto IN ('Favoravel','Desfavoravel')), 0), 1) AS pct_favoravel
        FROM votos v JOIN deliberacoes d ON d.id = v.deliberacao_id JOIN agencias a ON a.id = d.agencia_id
       GROUP BY 1
    ) t
  ),

  '3_cobertura_2026', (
    SELECT COALESCE(jsonb_agg(t ORDER BY t.sigla), '[]'::jsonb) FROM (
      SELECT a.sigla,
             COUNT(DISTINCT d.data_reuniao) AS reunioes,
             COUNT(DISTINCT d.id) AS deliberacoes,
             COUNT(v.id) AS votos
        FROM deliberacoes d JOIN agencias a ON a.id = d.agencia_id LEFT JOIN votos v ON v.deliberacao_id = d.id
       WHERE d.data_reuniao >= DATE '2026-01-01'
       GROUP BY 1
    ) t
  ),

  '4_pautas_fora_do_ano', (
    SELECT COALESCE(jsonb_object_agg(sigla, n), '{}'::jsonb) FROM (
      SELECT COALESCE(a.sigla,'?') AS sigla, COUNT(*) AS n
        FROM monitoramento_itens mi LEFT JOIN agencias a ON a.id = mi.agencia_id
       WHERE mi.metadata->>'enqueue_motivo' = 'pauta_fora_do_ano'
       GROUP BY 1
    ) t
  )

)) AS qa_fase27;
