-- ═══════════════════════════════════════════════════════════════════════════════
-- Reconciliar o poço `em_revisao` de monitoramento_itens (Fase 16, commit C — 01/set/2026)
--
-- ═══ Evidência (QA de 31/08) ═══
-- Itens com documento E job, parados em `em_revisao` há meses: a pauta da 87ª ROP, 4 "Voto DFQ"
-- da ANTT (desde 09/07), 43 itens da ANM. O poço é TERMINAL por construção: nenhuma query do
-- repo lê `em_revisao` — a fila de enfileiramento só olha `novo`, o retry só olha `ignorado`,
-- e o confirm não toca monitoramento_itens. O item congela no instante do auto-enqueue,
-- qualquer que seja o destino do documento.
--
-- ═══ O que esta migration faz (e o que ela se recusa a fazer) ═══
-- Espelha o destino TERMINAL do documento no item:
--   · doc `confirmed` → item `importado` (o funil passa a dizer a verdade);
--   · doc `ignored`   → item `ignorado`, herdando o motivo do doc (metadata->arquivado_motivo)
--     e com `proxima_tentativa_em = NULL` — SEM carimbo, a fila de retry não ressuscita os
--     manuais que a 20260830120000 arquivou de propósito;
--   · documento apagado (documento_id NULL pela FK ON DELETE SET NULL) → item `novo`, limpo —
--     re-entra pela porta da frente do enfileiramento.
-- Doc em TRÂNSITO (queued/review_pending/failed/processing) NÃO é tocado: quem move o doc é a
-- esteira, e o reaper #4 (mesmo commit) reconcilia quando ele estacionar num terminal.
--
-- Idempotente (o predicado exige `em_revisao`; rodar 2× não acha mais nada) e forward-only.
-- O código funciona sem ela: o reaper #4 drena o mesmo passivo, só que 50 por rodada.
-- ═══════════════════════════════════════════════════════════════════════════════

BEGIN;

DO $$
DECLARE
  v_espelhados INTEGER;
  v_orfaos INTEGER;
BEGIN
  -- 1) Espelhar o destino terminal do documento.
  WITH espelhados AS (
    UPDATE monitoramento_itens mi
       SET status = CASE dr.status WHEN 'confirmed' THEN 'importado'
                                   WHEN 'ignored'   THEN 'ignorado' END,
           proxima_tentativa_em = NULL,
           tentativas = 0,
           metadata = COALESCE(mi.metadata, '{}'::jsonb)
                      || CASE WHEN dr.status = 'ignored'
                              THEN jsonb_build_object('enqueue_motivo',
                                     COALESCE(dr.metadata->>'arquivado_motivo', 'documento_arquivado'))
                              ELSE '{}'::jsonb END
      FROM documentos_regulatorios dr
     WHERE dr.id = mi.documento_id
       AND mi.status = 'em_revisao'
       AND dr.status IN ('confirmed', 'ignored')
    RETURNING mi.id
  )
  SELECT COUNT(*) INTO v_espelhados FROM espelhados;

  -- 2) Item órfão: o documento foi apagado (FK pôs documento_id em NULL) — volta ao começo.
  WITH orfaos AS (
    UPDATE monitoramento_itens mi
       SET status = 'novo',
           upload_job_id = NULL,
           enfileirado_em = NULL
     WHERE mi.status = 'em_revisao'
       AND mi.documento_id IS NULL
    RETURNING mi.id
  )
  SELECT COUNT(*) INTO v_orfaos FROM orfaos;

  RAISE NOTICE 'em_revisao reconciliados: % espelhados do documento, % órfãos devolvidos a novo', v_espelhados, v_orfaos;
END $$;

COMMIT;

NOTIFY pgrst, 'reload schema';
