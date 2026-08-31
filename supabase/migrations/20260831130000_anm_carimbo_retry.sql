-- ═══════════════════════════════════════════════════════════════════════════════
-- ANM: carimbo de retry para o passivo já visto e arquivado (Fase 15, commit B — 31/ago/2026)
--
-- ═══ Evidência (QA da Fase 14) ═══
-- Todas as fontes ANM rodaram 31/08 com status ok e `novos: 0` — e a fixture verbatim (etapa84)
-- prova que o seletor novo PEGA a 87ª ROP. Ou seja: as atas já estão em `monitoramento_itens`
-- com o tipo certo (o `tipo` entra no hash; se estivessem com tipo velho, o insert de hoje
-- teria sucesso e `novos` > 0). Na colisão de hash o runner atualiza só titulo/reuniao/data/
-- last_seen_at — `status` intocado, sem re-enqueue. O que está `ignorado` sem carimbo
-- (`proxima_tentativa_em IS NULL`) nunca satisfaz o `<= NOW()` da fila de retry.
--
-- ═══ O precedente ═══
-- Mesma cirurgia da 20260826150000 (ARTESP/ZIP): carimbo = opt-in de UM tiro. Se o item
-- reaberto continuar sem render documento, sai com a coluna nula outra vez — nunca um moinho.
-- Diferenças: aqui entram os DOIS motivos que a fila aceita (sem_pdf E download_falhou — na
-- época do a[href] havia downloads de página HTML falhando), e o site é casado por sigla,
-- porque a ANM tem 5 fontes de documentos (a ARTESP tinha 1).
--
-- `em_revisao`/`importado` ficam DE FORA: reset cego ressuscitaria os manuais que a
-- 20260830120000 ignorou de propósito. `download_falhou_desistido` idem — esgotou os ciclos
-- com dias de intervalo; se o QA provar que precisa, será conserto dirigido.
--
-- Escopo 2026 + data nula (a data do item vem do parse da página — excluir por ela seria
-- excluir pelo bug). Idempotente e forward-only.
-- ⚠️ Aplicar junto com a 20260831120000, ANTES do próximo "Rodar tudo".
-- ═══════════════════════════════════════════════════════════════════════════════

BEGIN;

DO $$
DECLARE
  v_marcados INTEGER;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'monitoramento_itens'
      AND column_name = 'proxima_tentativa_em'
  ) THEN
    RAISE NOTICE 'Coluna proxima_tentativa_em ausente — aplique 20260826140000 antes. Nada a fazer.';
    RETURN;
  END IF;

  WITH marcados AS (
    UPDATE monitoramento_itens mi
       SET proxima_tentativa_em = NOW(),
           tentativas = 0
      FROM monitoramento_sites ms
      JOIN agencias a ON a.id = ms.agencia_id
     WHERE mi.site_id = ms.id
       AND a.sigla = 'ANM'
       AND ms.tipo_fonte <> 'noticias'
       AND mi.status = 'ignorado'
       AND mi.metadata->>'enqueue_motivo' IN ('sem_pdf', 'download_falhou')
       AND mi.tipo IN ('voto', 'ata', 'deliberacao', 'pauta', 'documento', 'reuniao')
       AND (mi.data_reuniao IS NULL OR mi.data_reuniao >= DATE '2026-01-01')
    RETURNING mi.id
  )
  SELECT COUNT(*) INTO v_marcados FROM marcados;

  RAISE NOTICE 'Itens da ANM reabertos para retry (2026 + sem data): %', v_marcados;
END $$;

COMMIT;

NOTIFY pgrst, 'reload schema';
