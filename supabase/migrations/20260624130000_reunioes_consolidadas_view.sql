-- View consolidada de reuniões: agrupa deliberações por (agência, data, número),
-- com contagens e consenso. Apoia consultas/observabilidade (a API agrega em
-- memória, mas a view facilita queries diretas). Idempotente.

CREATE OR REPLACE VIEW public.reunioes_consolidadas AS
  SELECT
    d.agencia_id,
    d.data_reuniao,
    d.numero_reuniao,
    max(d.tipo_reuniao)                                   AS tipo_reuniao,
    count(*)                                              AS total_itens,
    count(*) FILTER (WHERE EXISTS (
      SELECT 1 FROM public.votos v
      WHERE v.deliberacao_id = d.id AND v.is_divergente
    ))                                                    AS itens_com_divergencia,
    min(d.created_at)                                     AS primeira_insercao
  FROM public.deliberacoes d
  WHERE d.data_reuniao IS NOT NULL
    -- Apenas itens finais (exclui ata-mãe sem item, pauta, voto isolado e apoio).
    AND d.tipo_documento NOT IN ('pauta', 'voto_individual', 'documento_apoio')
    AND NOT (d.tipo_documento = 'ata' AND d.documento_pai_id IS NULL)
  GROUP BY d.agencia_id, d.data_reuniao, d.numero_reuniao;

NOTIFY pgrst, 'reload schema';
