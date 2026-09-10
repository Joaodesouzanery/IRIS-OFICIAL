-- ⚠️ SUPERSEDIDA — NÃO APLICAR. Falhou em produção (42883): `iris_seed_director` não existe fora
-- da transação de 20260517195947, que a cria e a derruba no fim. Use 20260909130000 (v2, inline).
-- ═══════════════════════════════════════════════════════════════════════════════
-- ANM: reinserir Luiz Paniago Neves (Fase 24 — 09/set/2026)
--
-- ORIGEM DA REMOÇÃO, validada antes deste arquivo:
--   · 20260517195947 semeou Luiz Paniago Neves (Diretor Substituto, 05/12/2025 → 02/06/2026);
--   · 20260705122000 registrou a RENOVAÇÃO (03/06/2026 → 30/11/2026) por UPDATE — só em linha
--     existente;
--   · 20260821140000 (limpeza v2) marcou como rejeitado o nome, porque a prosa antiga "Luiz
--     Paniago Neves Para A Relatoria…" casava 1.0 com o real, e a v2 apagou votos e mandatos dos
--     rejeitados; 20260821150000 (gabarito final) re-aprovou a lista de nomes reais e DELETOU os
--     rejeitados restantes, com a nota "José Fernando e Luiz Paniago voltam limpos após Rodar
--     tudo 2×".
--   · A premissa falhou: `upload-analysis.ts` se recusa, por desenho, a criar diretor a partir de
--     um voto ("seria fabricar cadastro"). Ele nunca voltou. Hoje a 73ª ROP está em revisão com
--     "Voto proferido em sessão anterior por Luiz Paniago Neves — diretor não localizado".
--
-- Idempotente: `iris_seed_director` só insere se o nome não existir (ILIKE); a renovação usa
-- NOT EXISTS pela data de início. Aplicar no SQL Editor; depois "Rodar tudo" 2×.
-- ═══════════════════════════════════════════════════════════════════════════════

BEGIN;

DO $$
DECLARE
  v_agencia_id UUID;
  v_diretor_id UUID;
BEGIN
  SELECT id INTO v_agencia_id FROM public.agencias WHERE sigla = 'ANM';
  IF v_agencia_id IS NULL THEN
    RAISE NOTICE 'ANM não encontrada — nada feito';
    RETURN;
  END IF;

  -- 1 · O cadastro e o mandato original (mesmos parâmetros do seed institucional).
  v_diretor_id := iris_seed_director(
    v_agencia_id, 'Luiz Paniago Neves', 'Diretor Substituto', 'interino',
    DATE '2025-12-05', DATE '2026-06-02', NULL
  );

  -- 2 · Garante aprovado (o seed pode ter devolvido uma linha já existente e rejeitada).
  UPDATE public.diretores
     SET review_status = 'aprovado', needs_review = FALSE, fonte_dado = 'verificado',
         data_fim_mandato = DATE '2026-11-30', situacao = 'interino', updated_at = NOW()
   WHERE id = v_diretor_id;

  -- 3 · A renovação (03/06/2026 → 30/11/2026), como em 20260705122000.
  INSERT INTO public.mandatos (diretor_id, data_inicio, data_fim, cargo, fonte_dado, ato_nomeacao)
  SELECT v_diretor_id, DATE '2026-06-03', DATE '2026-11-30', 'Diretor Substituto', 'verificado',
         'Convocação por até 180 dias a contar de 03/06/2026 (resenha DC/ANM/MME) — fonte [2]'
  WHERE NOT EXISTS (
    SELECT 1 FROM public.mandatos m WHERE m.diretor_id = v_diretor_id AND m.data_inicio = DATE '2026-06-03'
  );

  RAISE NOTICE 'Luiz Paniago Neves: diretor % pronto (aprovado, mandatos 05/12/2025 e 03/06/2026)', v_diretor_id;
END $$;

COMMIT;

NOTIFY pgrst, 'reload schema';

-- ── Conferência ────────────────────────────────────────────────────────────────
-- SELECT d.nome, d.review_status, m.data_inicio, m.data_fim, m.fonte_dado
--   FROM diretores d JOIN mandatos m ON m.diretor_id = d.id
--  WHERE d.nome ILIKE 'Luiz Paniago Neves' ORDER BY m.data_inicio;
-- Esperado: aprovado; 2 mandatos verificados. Depois: "Rodar tudo" 2× — a 73ª ROP sai da revisão.
