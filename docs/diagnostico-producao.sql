-- ═══════════════════════════════════════════════════════════════════════════════
-- DIAGNÓSTICO DE PRODUÇÃO — somente LEITURA (Fase 8)
--
-- Cole no SQL Editor do Supabase (projeto hjevhwqntqsffqmjocra) e mande o resultado.
-- Nenhuma query aqui escreve: são SELECTs. Pode rodar com a esteira em andamento.
--
-- Por que este arquivo existe: todo o diagnóstico das Fases 7 e 8 foi feito lendo CÓDIGO.
-- Nenhuma linha do banco de produção foi consultada. Estas seis perguntas são as que separam
-- "as métricas estão incompletas" de "as métricas descrevem um universo de 3 documentos".
-- ═══════════════════════════════════════════════════════════════════════════════


-- ① A PERGUNTA QUE REENQUADRA TUDO ────────────────────────────────────────────
-- Deliberações e votos por agência e por ANO. Se a ANM tiver dados apesar de a coleta estar
-- morta, eles vieram de outro lugar (ver ②).
SELECT a.sigla,
       EXTRACT(YEAR FROM d.data_reuniao)::int      AS ano,
       COUNT(DISTINCT d.id)                        AS deliberacoes,
       COUNT(v.id)                                 AS votos,
       COUNT(v.id) FILTER (WHERE v.is_nominal)     AS votos_nominais,
       MIN(d.data_reuniao)                         AS primeira,
       MAX(d.data_reuniao)                         AS ultima
  FROM deliberacoes d
  LEFT JOIN agencias a ON a.id = d.agencia_id
  LEFT JOIN votos     v ON v.deliberacao_id = d.id
 GROUP BY a.sigla, ano
 ORDER BY a.sigla, ano;


-- ② DE ONDE VEIO CADA DELIBERAÇÃO: esteira × mão ──────────────────────────────
-- `auto_confirmado` / `aprovado_em_lote` são carimbos da esteira. Sem nenhum dos dois, a
-- deliberação entrou por upload manual — é a hipótese das 3 atas de certificação da ANM.
SELECT a.sigla,
       CASE
         WHEN d.raw_extraction->>'auto_confirmado'   IS NOT NULL THEN 'esteira (auto-confirm)'
         WHEN d.raw_extraction->>'aprovado_em_lote'  IS NOT NULL THEN 'esteira (confirm-lote)'
         ELSE 'upload manual / origem antiga'
       END                                          AS origem,
       COUNT(*)                                     AS deliberacoes,
       COUNT(DISTINCT d.numero_reuniao)             AS reunioes_distintas
  FROM deliberacoes d
  LEFT JOIN agencias a ON a.id = d.agencia_id
 GROUP BY a.sigla, origem
 ORDER BY a.sigla, deliberacoes DESC;


-- ③ O NÚMERO REAL POR TRÁS DOS "676" ──────────────────────────────────────────
SELECT COALESCE(a.sigla, '(sem agência)') AS agencia,
       mi.tipo,
       mi.status,
       mi.metadata->>'enqueue_motivo'     AS motivo,
       COUNT(*)                           AS total
  FROM monitoramento_itens mi
  LEFT JOIN agencias a ON a.id = mi.agencia_id
 GROUP BY a.sigla, mi.tipo, mi.status, motivo
 ORDER BY total DESC;


-- ④ ONDE OS PDFs EXTRAÍDOS MORRERAM ───────────────────────────────────────────
-- "174 extraídos · 0 materializados": esta query diz em que estado eles pararam e com que motivo.
SELECT COALESCE(a.sigla, '(sem agência)')            AS agencia,
       dr.status,
       dr.tipo_documento,
       dr.campos_detectados->>'arquivado_motivo'     AS arquivado_motivo,
       COUNT(*)                                      AS total
  FROM documentos_regulatorios dr
  LEFT JOIN agencias a ON a.id = dr.agencia_id
 GROUP BY a.sigla, dr.status, dr.tipo_documento, arquivado_motivo
 ORDER BY total DESC;


-- ⑤ COBERTURA DE 2026 POR AGÊNCIA ─────────────────────────────────────────────
SELECT a.sigla,
       COUNT(DISTINCT d.numero_reuniao) FILTER (WHERE d.data_reuniao >= '2026-01-01') AS reunioes_2026,
       COUNT(*)                          FILTER (WHERE d.data_reuniao >= '2026-01-01') AS deliberacoes_2026,
       MIN(d.numero_reuniao) FILTER (WHERE d.data_reuniao >= '2026-01-01')             AS menor_reuniao,
       MAX(d.numero_reuniao) FILTER (WHERE d.data_reuniao >= '2026-01-01')             AS maior_reuniao
  FROM deliberacoes d
  LEFT JOIN agencias a ON a.id = d.agencia_id
 GROUP BY a.sigla
 ORDER BY a.sigla;


-- ⑥ AS MIGRATIONS DAS FASES 7 E 8 ESTÃO MESMO APLICADAS? ──────────────────────
SELECT 'esteira_runs (tabela)'                        AS objeto,
       to_char(COUNT(*), 'FM999999')                  AS presente
  FROM information_schema.tables
 WHERE table_schema = 'public' AND table_name = 'esteira_runs'
UNION ALL
SELECT 'monitoramento_itens.proxima_tentativa_em', to_char(COUNT(*), 'FM999999')
  FROM information_schema.columns
 WHERE table_schema='public' AND table_name='monitoramento_itens' AND column_name='proxima_tentativa_em'
UNION ALL
SELECT 'monitoramento_itens.tentativas', to_char(COUNT(*), 'FM999999')
  FROM information_schema.columns
 WHERE table_schema='public' AND table_name='monitoramento_itens' AND column_name='tentativas'
UNION ALL
SELECT 'votos.confianca_match', to_char(COUNT(*), 'FM999999')
  FROM information_schema.columns
 WHERE table_schema='public' AND table_name='votos' AND column_name='confianca_match';
