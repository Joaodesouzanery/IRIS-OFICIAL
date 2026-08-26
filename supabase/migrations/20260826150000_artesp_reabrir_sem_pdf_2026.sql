-- Fase 9 · Commit 2 — reabrir os itens da ARTESP arquivados por um gate que não sabia ler ZIP.
--
-- ═══ Por que existe ═══
-- Medição ao vivo da página de reuniões da ARTESP: das 256 URLs de documento, 76 são ZIP e 88% de
-- tudo que ela rotula "Deliberação" é ZIP. O gate do enfileiramento conhecia só "é PDF" ou "é HTML
-- com links de PDF", então esses arquivos viravam `sem_pdf` — um motivo que, por desenho, é
-- terminal e fica FORA do retry. Em produção: 133 deliberações + 65 pautas da ARTESP arquivadas
-- como se a página estivesse vazia. Amostra de 11 ZIPs: 207 PDFs dentro.
--
-- O código já sabe ler ZIP (commit anterior). Falta reabrir o passivo — e o passivo não reabre
-- sozinho: `proxima_tentativa_em` é NULL nessas linhas, e NULL não satisfaz `<= agora`.
--
-- ═══ Por que o CARIMBO é o opt-in ═══
-- O caminho que grava `sem_pdf` LIMPA `proxima_tentativa_em`. Então nenhum item novo entra em
-- retry sozinho: só volta o que este UPDATE marcar. E se o item reaberto continuar sem render
-- documento, ele sai com a coluna nula outra vez — um tiro só, nunca um moinho.
--
-- ═══ Escopo: 2026 ═══
-- Decisão do usuário. O acervo histórico da ARTESP fica para depois; o que interessa agora é o
-- exercício corrente. `data_reuniao` NULL entra também: a data do item vem do parse da página, que
-- é justamente o que o commit seguinte conserta — excluir por data seria excluir pelo bug.
--
-- Idempotente (rodar 2× não muda nada além do carimbo) e forward-only. O código funciona sem ela:
-- sem o carimbo, o passivo simplesmente não é reaberto.
-- ⚠️ Aplicar DEPOIS do deploy do código — antes, os itens reabertos bateriam no gate antigo e
-- voltariam a ser arquivados, gastando o carimbo à toa.

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
     WHERE mi.site_id = ms.id
       AND ms.url = 'https://www.artesp.sp.gov.br/artesp/transparencia/reunioes-diretoria'
       AND mi.status = 'ignorado'
       AND mi.metadata->>'enqueue_motivo' = 'sem_pdf'
       AND (mi.data_reuniao IS NULL OR mi.data_reuniao >= DATE '2026-01-01')
    RETURNING mi.id
  )
  SELECT COUNT(*) INTO v_marcados FROM marcados;

  RAISE NOTICE 'Itens da ARTESP reabertos para retry (2026): %', v_marcados;
END $$;

COMMIT;

NOTIFY pgrst, 'reload schema';
