-- ═══════════════════════════════════════════════════════════════════════════════
-- Rotular os arquivados SEM MOTIVO — e devolver a eles o caminho de volta
-- (Fase 17, commit B — 04/set/2026)
--
-- ═══ Evidência (tela do usuário, 04/09) ═══
-- 95 itens arquivados sem `enqueue_motivo`: 50 ANTT·voto, 24 ANM·documento, 21 ANTT·pauta. São
-- responsabilidade do reaper #4 da Fase 16, que gravava `ignorado` sem rótulo — o único write do
-- repo que fazia isso. Consertado no commit A; esta migration cuida do PASSIVO.
--
-- ═══ Por que motivo NULL é pior que um rótulo feio ═══
-- `enqueue_motivo` NULL + `proxima_tentativa_em` NULL põe o item fora dos DOIS filtros da fila de
-- retry (enqueue-pdfs:149 exige carimbo `<= agora`; :163 exige motivo em
-- {download_falhou, sem_pdf}). O item morre em silêncio E fica inalcançável por qualquer
-- migration futura, porque não há por onde selecioná-lo.
--
-- ═══ As duas armadilhas evitadas ═══
-- 1. A COLUNA CERTA: deriva de `dr.campos_detectados->>'arquivado_motivo'`. A migration irmã
--    (20260901120000:43) lê `dr.metadata` e por isso o "herda o motivo" dela sempre foi no-op —
--    quem grava escreve em `campos_detectados` (confirm-lote:74, 20260830120000:46, e agora
--    markDocumentReviewed).
-- 2. O MESMO DIREITO DOS NOVOS: grava `enqueue_motivo_origem`. É esse carimbo — e não o valor
--    'reaper4' — que o reaper usa para devolver um item a `importado` quando o documento é
--    desarquivado. Sem ele, os 95 teriam rótulo legível e nenhum caminho de volta: uma classe
--    permanentemente inferior. O valor é honesto: 'migration_20260904', porque eles NÃO passaram
--    pelo reaper corrigido.
--
-- SEM carimbo de retry (`proxima_tentativa_em` continua NULL): arquivamento por decisão não
-- ressuscita sozinho. Idempotente por construção (o predicado exige motivo NULL) e forward-only.
-- ⚠️ ORDEM: aplicar DEPOIS do deploy do commit A e de ao menos uma rodada da esteira. Rodar antes
-- carimbaria todo mundo com o genérico e congelaria a rotulagem fina para sempre.
-- ═══════════════════════════════════════════════════════════════════════════════

BEGIN;

DO $$
DECLARE
  v_rotulados INTEGER;
  v_sem_documento INTEGER;
BEGIN
  -- 1) Item com documento: herda o motivo do doc; senão, classe pelo tipo; senão, genérico.
  WITH rotulados AS (
    UPDATE monitoramento_itens mi
       SET metadata = COALESCE(mi.metadata, '{}'::jsonb) || jsonb_build_object(
             'enqueue_motivo', COALESCE(
               dr.campos_detectados->>'arquivado_motivo',
               CASE WHEN dr.tipo_documento IN ('pauta', 'documento_apoio', 'voto_individual')
                    THEN 'apoio_nao_final' END,
               'documento_arquivado'),
             'enqueue_motivo_origem', 'migration_20260904')
      FROM documentos_regulatorios dr
     WHERE dr.id = mi.documento_id
       AND mi.status = 'ignorado'
       AND mi.metadata->>'enqueue_motivo' IS NULL
    RETURNING mi.id
  )
  SELECT COUNT(*) INTO v_rotulados FROM rotulados;

  -- 2) Item sem documento vinculado: o rótulo diz exatamente isso, em vez de mentir um motivo.
  WITH sem_doc AS (
    UPDATE monitoramento_itens mi
       SET metadata = COALESCE(mi.metadata, '{}'::jsonb) || jsonb_build_object(
             'enqueue_motivo', 'documento_ausente',
             'enqueue_motivo_origem', 'migration_20260904')
     WHERE mi.status = 'ignorado'
       AND mi.metadata->>'enqueue_motivo' IS NULL
       AND mi.documento_id IS NULL
    RETURNING mi.id
  )
  SELECT COUNT(*) INTO v_sem_documento FROM sem_doc;

  RAISE NOTICE 'Arquivados rotulados: % com documento, % sem documento vinculado', v_rotulados, v_sem_documento;
END $$;

COMMIT;

NOTIFY pgrst, 'reload schema';
