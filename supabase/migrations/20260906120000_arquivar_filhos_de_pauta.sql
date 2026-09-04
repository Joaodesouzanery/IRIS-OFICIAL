-- ═══════════════════════════════════════════════════════════════════════════════
-- Arquivar os filhos fabricados a partir de PAUTA (Fase 19, commit 3 — 06/set/2026)
--
-- ═══ Evidência ═══
-- 35 itens de "ata" da ANTT com pai, `resultado` NULL e nenhum sinal de decisão. Não é falha de
-- extração: são deliberações fabricadas a partir de uma AGENDA. A pauta da reunião de diretoria
-- era classificada como `ata` porque o reconhecimento de pauta só olhava o NOME do arquivo — e o
-- nome que chega do portal é o fallback `documento-monitorado-<ts>.pdf`. O prefixo `PAUTA-` que
-- elas carregam (confirm/route.ts:1258-1260) é a confissão do próprio bug.
-- `ata-splitter.ts:22-24` já dizia: "pauta é agenda (nada foi decidido) e viraria votos
-- fabricados".
--
-- ═══ Arquivar, não deletar ═══
-- `import_counts_as_final: false` no `raw_extraction` é o que o predicado canônico
-- (`isFinalDecisionRecord`, regulatory-documents.ts) lê PRIMEIRO — a linha sai do denominador de
-- todas as métricas na hora, em todos os sítios, sem cada consulta precisar lembrar de filtrar
-- `PAUTA-%` (que seria a receita da divergência entre sítios que a Fase 18 acabou de matar).
-- A linha fica: dá para auditar o que foi arquivado e por quê. E o commit da mesma fase
-- (`declaraSerPauta`) garante que não voltam.
--
-- Idempotente (o predicado exige que a marca ainda não esteja lá) e forward-only.
-- ═══════════════════════════════════════════════════════════════════════════════

BEGIN;

DO $$
DECLARE
  v_arquivados INTEGER;
BEGIN
  WITH arquivados AS (
    UPDATE deliberacoes d
       SET raw_extraction = COALESCE(d.raw_extraction, '{}'::jsonb) || jsonb_build_object(
             'import_counts_as_final', false,
             'arquivado_motivo', 'filho_de_pauta',
             'arquivado_em', NOW()::date)
     WHERE d.numero_deliberacao LIKE 'PAUTA-%'
       AND COALESCE((d.raw_extraction->>'import_counts_as_final')::boolean, true) IS DISTINCT FROM false
    RETURNING d.id
  )
  SELECT COUNT(*) INTO v_arquivados FROM arquivados;

  RAISE NOTICE 'Filhos de PAUTA arquivados (fora do denominador, linha preservada): %', v_arquivados;
END $$;

COMMIT;

NOTIFY pgrst, 'reload schema';
