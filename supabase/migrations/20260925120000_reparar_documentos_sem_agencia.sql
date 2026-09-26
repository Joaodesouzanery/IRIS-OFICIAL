-- ═══════════════════════════════════════════════════════════════════════════════
-- Fase 31, Bloco 4 — REPARAR os documentos sem agência, pela PROCEDÊNCIA
--
-- ⚠️ O QUE A PRODUÇÃO MEDIU, e como isso inverteu meu diagnóstico
-- 19 documentos com `agencia_id IS NULL`. Eu havia apontado o upload manual de ZIP sem escolher
-- agência como "o caminho mais curto". A medição respondeu: `storage_em_auto` = 1 e
-- `com_source_url` = 18. Ou seja 18 dos 19 vieram da ESTEIRA, não do upload manual — e os nomes
-- dizem SEI 134.xxx, que é da ARTESP.
--
-- ⚠️ E documento sem agência é BECO SEM SAÍDA: `deliberacoes.agencia_id` é NOT NULL
-- (001_initial_schema.sql), então ele NUNCA vira deliberação. Fica no acervo sem poder avançar e
-- sem constar em contagem por agência nenhuma. Todos os 19 estão `ignored`: foram arquivados, não
-- estão em fila, e não voltam sozinhos.
--
-- ⚠️ ESTA MIGRATION NÃO ADIVINHA AGÊNCIA. A derivação é pela PROCEDÊNCIA que o próprio modelo já
-- registra, em dois saltos exatos:
--
--     documentos_regulatorios.metadata->>'monitoramento_item_id'
--       → monitoramento_itens.site_id            (NOT NULL, migration 005)
--         → monitoramento_sites.agencia_id
--
-- Nada de parsear nome de arquivo, nada de casar sigla no texto, nada de heurística. Se a cadeia
-- não chega a uma agência, a linha FICA COMO ESTÁ — e o bloco de verificação no fim mostra quantas
-- sobraram, porque sobrar aqui é defeito de cadastro de FONTE e tem de ficar visível.
--
-- Idempotente: o `WHERE agencia_id IS NULL` faz a 2ª execução não tocar nada.
-- Forward-only. Sem DDL — é reparo de DADO.
-- ═══════════════════════════════════════════════════════════════════════════════

BEGIN;

-- ── 1. O ANTES, para comparar ────────────────────────────────────────────────
DO $$
DECLARE v_antes INT;
BEGIN
  SELECT COUNT(*) INTO v_antes FROM public.documentos_regulatorios WHERE agencia_id IS NULL;
  RAISE NOTICE 'ANTES: % documento(s) sem agencia', v_antes;
END $$;

-- ── 2. O reparo, pela procedência (item → site → agência) ────────────────────
-- `DISTINCT ON` não é necessário: o caminho é 1:1 por documento (um item, um site, uma agência).
-- Mas o JOIN precisa do cast explícito — `metadata->>` devolve TEXT e `id` é UUID; sem o cast o
-- Postgres recusa a comparação, e num `UPDATE ... FROM` isso falharia a transação inteira.
UPDATE public.documentos_regulatorios AS dr
   SET agencia_id = s.agencia_id,
       updated_at = NOW()
  FROM public.monitoramento_itens AS mi
  JOIN public.monitoramento_sites AS s ON s.id = mi.site_id
 WHERE dr.agencia_id IS NULL
   AND dr.metadata ? 'monitoramento_item_id'
   AND mi.id = (dr.metadata->>'monitoramento_item_id')::uuid
   AND s.agencia_id IS NOT NULL;

-- ── 3. E o JOB correspondente, que é o que a tela de Upload mostra ───────────
-- `upload_jobs.agencia_id` era zerado pelo pipeline sem fallback (consertado em f9c1026), e
-- `upload-queue` lê esse campo de volta num reenvio: deixá-lo nulo reintroduziria o defeito no
-- próximo upload do mesmo PDF.
UPDATE public.upload_jobs AS uj
   SET agencia_id = dr.agencia_id,
       updated_at = NOW()
  FROM public.documentos_regulatorios AS dr
 WHERE uj.documento_id = dr.id
   AND uj.agencia_id IS NULL
   AND dr.agencia_id IS NOT NULL;

-- ── 4. O DEPOIS, com o motivo de quem sobrou ─────────────────────────────────
DO $$
DECLARE
  v_depois INT;
  v_sem_item INT;
  v_site_sem_agencia INT;
BEGIN
  SELECT COUNT(*) INTO v_depois FROM public.documentos_regulatorios WHERE agencia_id IS NULL;

  -- Quem sobrou e POR QUÊ — duas causas diferentes, dois consertos diferentes.
  SELECT COUNT(*) INTO v_sem_item
    FROM public.documentos_regulatorios dr
   WHERE dr.agencia_id IS NULL
     AND NOT (dr.metadata ? 'monitoramento_item_id');

  SELECT COUNT(*) INTO v_site_sem_agencia
    FROM public.documentos_regulatorios dr
    JOIN public.monitoramento_itens mi ON mi.id = (dr.metadata->>'monitoramento_item_id')::uuid
    JOIN public.monitoramento_sites s ON s.id = mi.site_id
   WHERE dr.agencia_id IS NULL
     AND dr.metadata ? 'monitoramento_item_id'
     AND s.agencia_id IS NULL;

  RAISE NOTICE 'DEPOIS: % sem agencia', v_depois;
  RAISE NOTICE '  dos quais % sem monitoramento_item_id (upload MANUAL: so o operador sabe a agencia)', v_sem_item;
  RAISE NOTICE '  dos quais % com o SITIO tambem sem agencia (defeito de cadastro de FONTE)', v_site_sem_agencia;
  IF v_depois > 0 AND v_sem_item = 0 AND v_site_sem_agencia = 0 THEN
    RAISE NOTICE '  ⚠️ ATENCAO: sobrou % sem nenhuma das duas causas conhecidas — investigar.', v_depois;
  END IF;
END $$;

NOTIFY pgrst, 'reload schema';

COMMIT;

-- ═══ CONFERÊNCIA (rodar DEPOIS, fora da transação) ═════════════════════════════
-- Quais fontes de DOCUMENTO estão ativas sem agência — cada uma produz novos documentos inertes.
-- O código já passou a criar essas fontes INATIVAS (`monitoramento/sites`), mas as que já existem
-- continuam como estão: desativá-las por migration seria decisão de produto tomada por mim.
--
--   SELECT id, nome, url, ativo, tipo_fonte
--     FROM monitoramento_sites
--    WHERE agencia_id IS NULL AND tipo_fonte = 'documentos_regulatorios'
--    ORDER BY ativo DESC, nome;
