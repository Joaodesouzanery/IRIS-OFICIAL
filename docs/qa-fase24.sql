-- ═══════════════════════════════════════════════════════════════════════════════
-- QA DA FASE 24 — a trava aberta, a ANM destravada, o número que só cai
-- (somente LEITURA — uma instrução)
--
-- ORDEM: aplicar `20260909120000_reinserir_luiz_paniago_anm.sql` → deploy verde → "Rodar tudo" 2×
--        (a 1ª limpa carimbos e reanalisa; a 2ª confirma) → colar.
--
-- ① CARIMBOS `auto_skip` POR MOTIVO — os obsoletos (C06, duplicata, "não conta como final",
--    "Sinais contraditórios", "sessão anterior") devem ter ZERADO; o que sobra é revisão real.
-- ② ANM 2026 — a lacuna: atas de 2026 conhecidas pelo monitoramento × deliberações de 2026 no
--    banco × documentos de 2026 ainda em revisão. É a resposta a "por que só 1 reunião".
-- ③ VOTOS POR AGÊNCIA — ANM deve SUBIR (3 atas × ~40 itens); ARTESP sobe (85 do C06).
-- ④ LUIZ PANIAGO — o cadastro e os dois mandatos verificados.
-- ⑤ ATAS ARQUIVADAS COMO `ata_fonte_nao_deliberativa` — esperado: 18 (ARTESP).
-- ═══════════════════════════════════════════════════════════════════════════════

SELECT jsonb_pretty(jsonb_build_object(

  '1_carimbos_por_motivo', (
    SELECT COALESCE(jsonb_agg(t ORDER BY t.documentos DESC), '[]'::jsonb) FROM (
      SELECT COALESCE(a.sigla,'?') AS sigla, COALESCE(dr.tipo_documento,'?') AS tipo,
             COALESCE(left(dr.campos_detectados->>'auto_skip', 80), '(sem motivo gravado)') AS motivo,
             COUNT(*) AS documentos
        FROM documentos_regulatorios dr LEFT JOIN agencias a ON a.id = dr.agencia_id
       WHERE dr.status = 'review_pending'
       GROUP BY 1, 2, 3
    ) t
  ),

  '2_anm_2026', (
    SELECT jsonb_build_object(
      'itens_monitoramento_2026', (SELECT COUNT(*) FROM monitoramento_itens mi JOIN agencias a ON a.id = mi.agencia_id
                                    WHERE a.sigla = 'ANM' AND mi.data_reuniao >= DATE '2026-01-01'),
      'itens_monitoramento_2026_por_status', (SELECT COALESCE(jsonb_object_agg(s, n), '{}'::jsonb) FROM (
                                    SELECT mi.status AS s, COUNT(*) AS n FROM monitoramento_itens mi JOIN agencias a ON a.id = mi.agencia_id
                                     WHERE a.sigla = 'ANM' AND mi.data_reuniao >= DATE '2026-01-01' GROUP BY 1) q),
      'docs_2026_em_revisao', (SELECT COUNT(*) FROM documentos_regulatorios dr JOIN agencias a ON a.id = dr.agencia_id
                                WHERE a.sigla = 'ANM' AND dr.status = 'review_pending'),
      'reunioes_2026_no_banco', (SELECT COUNT(DISTINCT d.data_reuniao) FROM deliberacoes d JOIN agencias a ON a.id = d.agencia_id
                                  WHERE a.sigla = 'ANM' AND d.data_reuniao >= DATE '2026-01-01'),
      'deliberacoes_2026_no_banco', (SELECT COUNT(*) FROM deliberacoes d JOIN agencias a ON a.id = d.agencia_id
                                      WHERE a.sigla = 'ANM' AND d.data_reuniao >= DATE '2026-01-01')
    )
  ),

  '3_votos_por_agencia', (
    SELECT COALESCE(jsonb_agg(t ORDER BY t.votos DESC), '[]'::jsonb) FROM (
      SELECT COALESCE(a.sigla,'?') AS sigla, COUNT(v.id) AS votos,
             COUNT(v.id) FILTER (WHERE v.is_nominal) AS nominais,
             COUNT(v.id) FILTER (WHERE v.tipo_voto = 'Ausente') AS ausentes,
             COUNT(DISTINCT v.deliberacao_id) AS deliberacoes_com_voto
        FROM votos v JOIN deliberacoes d ON d.id = v.deliberacao_id LEFT JOIN agencias a ON a.id = d.agencia_id
       GROUP BY 1
    ) t
  ),

  '4_luiz_paniago', (
    SELECT COALESCE(jsonb_agg(jsonb_build_object('nome', d.nome, 'review_status', d.review_status, 'inicio', m.data_inicio, 'fim', m.data_fim, 'fonte', m.fonte_dado) ORDER BY m.data_inicio), '[]'::jsonb)
      FROM diretores d LEFT JOIN mandatos m ON m.diretor_id = d.id
     WHERE d.nome ILIKE 'Luiz Paniago Neves'
  ),

  '5_atas_arquivadas_fonte_nao_deliberativa', (
    SELECT COUNT(*) FROM documentos_regulatorios WHERE campos_detectados->>'arquivado_motivo' = 'ata_fonte_nao_deliberativa'
  )

)) AS qa_fase24;
