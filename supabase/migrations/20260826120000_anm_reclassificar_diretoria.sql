-- Fase 7 · Commit 4 — destravar a ANM: apagar os itens presos em tipo='diretoria'.
--
-- ═══ Por que apagar, e não corrigir com UPDATE ═══
--
-- `monitoramento_itens.hash_item` é `sha256(tipo | url | reuniao | data)` (monitoring.ts) sob
-- `UNIQUE (site_id, hash_item)` (migration 005). O `tipo` faz parte da CHAVE. Então, quando o
-- classificador passa a devolver 'ata' em vez de 'diretoria' para o mesmo link, o próximo crawl
-- calcula um hash DIFERENTE e insere uma LINHA NOVA — a antiga não é atualizada, não é encontrada,
-- e fica em status 'novo' para sempre, inflando o contador de "detectados não processados" com
-- fantasmas. Um UPDATE de `tipo` também não resolveria: deixaria o hash inconsistente com o
-- conteúdo e o crawl seguinte reinseriria a linha correta mesmo assim.
--
-- Apagar é seguro porque estas linhas NUNCA foram processadas (status='novo' significa
-- literalmente "detectado e nada mais": nenhum PDF baixado, nenhum documento, nenhuma deliberação,
-- nenhum voto depende delas). O próximo crawl redescobre os mesmos links e, com o classificador
-- corrigido, os grava como 'ata'/'pauta'/'voto' — aí sim enfileiráveis.
--
-- ⚠️ ORDEM: aplicar DEPOIS do deploy do código. Aplicada antes, o crawl seguinte recriaria as
-- linhas com o tipo errado e o efeito seria nulo (inofensivo, mas inútil — bastaria reaplicar).
--
-- Escopo deliberadamente estreito: só sites ATIVOS de documentos (os que serão re-crawleados).
-- Itens 'diretoria' de sites desativados (os ministérios do seed antigo) NÃO são tocados: como
-- ninguém vai redescobri-los, apagá-los seria perda de dado sem ganho — eles ficam visíveis como
-- "fora da esteira" na separação de contador do commit 7.
--
-- Idempotente (rodar 2× não quebra: na segunda vez não há o que apagar) e forward-only.

BEGIN;

DO $$
DECLARE
  v_apagados INTEGER;
BEGIN
  -- A tabela pode não existir num ambiente ainda não migrado — degradar em silêncio é o padrão
  -- do projeto (deploy antes da migration é seguro).
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'monitoramento_itens'
  ) THEN
    RAISE NOTICE 'monitoramento_itens ainda não existe — nada a fazer.';
    RETURN;
  END IF;

  WITH apagados AS (
    DELETE FROM monitoramento_itens mi
    USING monitoramento_sites ms
    WHERE mi.site_id = ms.id
      AND mi.status = 'novo'
      AND mi.tipo = 'diretoria'
      AND ms.ativo = TRUE
      AND COALESCE(ms.tipo_fonte, '') <> 'noticias'
    RETURNING mi.id
  )
  SELECT COUNT(*) INTO v_apagados FROM apagados;

  RAISE NOTICE 'Itens diretoria/novo apagados para reclassificação: %', v_apagados;
END $$;

COMMIT;

NOTIFY pgrst, 'reload schema';
