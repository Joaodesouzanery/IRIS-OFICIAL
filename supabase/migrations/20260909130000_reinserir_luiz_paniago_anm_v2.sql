-- ═══════════════════════════════════════════════════════════════════════════════
-- ANM: reinserir Luiz Paniago Neves — v2, SEM função (Fase 24b — 09/set/2026)
--
-- A v1 (20260909120000) falhou em produção: `42883: function iris_seed_director does not exist`.
-- A migration de maio que cria a função (20260517195947) a DERRUBA no fim dela mesma (linha 337):
-- a função só existiu dentro daquela transação. A v1 é supersedida por esta; não aplicar a v1.
--
-- ORIGEM DA REMOÇÃO (validada): semeado em 20260517; renovação por UPDATE em 20260705; rejeitado
-- pela limpeza v2 (20260821140000) porque a prosa "Luiz Paniago Neves Para A Relatoria…" casava
-- 1.0 com o real; deletado pelo gabarito final (20260821150000) com a nota "volta limpo após
-- Rodar tudo 2×" — premissa que falhou: o extrator se recusa, por desenho, a criar diretor a
-- partir de voto. Hoje a 73ª ROP está em revisão por "diretor não localizado".
--
-- Idempotente (rodar 2× não muda nada): INSERT só se o nome não existe na ANM; mandatos com
-- NOT EXISTS por (diretor_id, data_inicio). Aplicar no SQL Editor; depois "Rodar tudo" 2×.
-- ═══════════════════════════════════════════════════════════════════════════════

BEGIN;

DO $$
DECLARE
  v_agencia_id UUID;
  v_diretor_id UUID;
  v_mandatos   INTEGER;
BEGIN
  SELECT id INTO v_agencia_id FROM public.agencias WHERE sigla = 'ANM';
  IF v_agencia_id IS NULL THEN
    RAISE NOTICE 'ANM não encontrada — nada feito';
    RETURN;
  END IF;

  -- 1 · O cadastro (mesmos campos que o seed institucional gravava via função).
  SELECT id INTO v_diretor_id
    FROM public.diretores
   WHERE agencia_id = v_agencia_id AND lower(nome) = 'luiz paniago neves'
   LIMIT 1;

  IF v_diretor_id IS NULL THEN
    INSERT INTO public.diretores (
      agencia_id, nome, cargo, ativo, needs_review, review_status, situacao,
      data_posse, data_fim_mandato, fonte_dado, lgpd_basis, importado_em, metadata
    ) VALUES (
      v_agencia_id, 'Luiz Paniago Neves', 'Diretor Substituto', TRUE, FALSE, 'aprovado', 'interino',
      DATE '2025-12-05', DATE '2026-11-30', 'verificado', 'public_official_function', NOW(),
      jsonb_build_object('seed', 'fase24_reinsercao', 'motivo', 'apagado pela limpeza v2 de ago/2026; extrator nao recria cadastro')
    ) RETURNING id INTO v_diretor_id;
  ELSE
    UPDATE public.diretores
       SET ativo = TRUE, needs_review = FALSE, review_status = 'aprovado', situacao = 'interino',
           cargo = 'Diretor Substituto',
           data_posse = COALESCE(data_posse, DATE '2025-12-05'),
           data_fim_mandato = DATE '2026-11-30',
           fonte_dado = 'verificado',
           metadata = COALESCE(metadata, '{}'::jsonb) || jsonb_build_object('seed', 'fase24_reinsercao'),
           updated_at = NOW()
     WHERE id = v_diretor_id;
  END IF;

  -- 2 · Mandato original (05/12/2025 → 02/06/2026), como no seed de maio.
  INSERT INTO public.mandatos (diretor_id, data_inicio, data_fim, cargo, fonte_dado, ato_nomeacao, metadata)
  SELECT v_diretor_id, DATE '2025-12-05', DATE '2026-06-02', 'Diretor Substituto', 'verificado',
         'Lista tríplice interna — substitutos para vagas de mandatos encerrados em 04/12/2025',
         jsonb_build_object('seed', 'fase24_reinsercao')
   WHERE NOT EXISTS (SELECT 1 FROM public.mandatos m WHERE m.diretor_id = v_diretor_id AND m.data_inicio = DATE '2025-12-05');

  -- 3 · Renovação (03/06/2026 → 30/11/2026), como em 20260705122000.
  INSERT INTO public.mandatos (diretor_id, data_inicio, data_fim, cargo, fonte_dado, ato_nomeacao, metadata)
  SELECT v_diretor_id, DATE '2026-06-03', DATE '2026-11-30', 'Diretor Substituto', 'verificado',
         'Convocação por até 180 dias a contar de 03/06/2026 (resenha DC/ANM/MME) — fonte [2]',
         jsonb_build_object('seed', 'fase24_reinsercao')
   WHERE NOT EXISTS (SELECT 1 FROM public.mandatos m WHERE m.diretor_id = v_diretor_id AND m.data_inicio = DATE '2026-06-03');

  SELECT COUNT(*) INTO v_mandatos FROM public.mandatos WHERE diretor_id = v_diretor_id;
  RAISE NOTICE 'Luiz Paniago Neves: diretor % (aprovado, verificado), % mandato(s)', v_diretor_id, v_mandatos;
END $$;

COMMIT;

NOTIFY pgrst, 'reload schema';

-- ── Conferência ────────────────────────────────────────────────────────────────
-- SELECT d.nome, d.review_status, d.fonte_dado, m.data_inicio, m.data_fim, m.fonte_dado AS mandato_fonte
--   FROM diretores d LEFT JOIN mandatos m ON m.diretor_id = d.id
--  WHERE d.nome ILIKE 'Luiz Paniago Neves' ORDER BY m.data_inicio;
-- Esperado: aprovado/verificado; 2 mandatos verificados (2025-12-05 e 2026-06-03).
-- Depois: "Rodar tudo" 2× — a 73ª ROP sai da revisão; qa-fase24.sql ④ deixa de vir vazio.
