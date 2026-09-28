-- ═══════════════════════════════════════════════════════════════════════════════
-- ANM: reinserir José Fernando de Mendonça Gomes Júnior (Fase 34 — 27/set/2026)
--
-- ⚠️ POR QUE ELE SUMIU — a cadeia inteira está nas próprias migrations deste repositório:
--   1. 20260517195947:323 o semeou como 'José Fernando Gomes Júnior' (forma ABREVIADA), com
--      mandato 'verificado' de 2025-09-01 a 2028-12-04;
--   2. 20260710120000:51-87 corrigiu o nome para a forma COMPLETA e guardou a abreviada em
--      `nome_variantes`, com o motivo medido: as atas da ANM citam "José Fernando de Mendonça
--      Gomes Júnior" e `findBestMatch` caía a 0.71 contra a forma abreviada;
--   3. 20260821140000 + 20260821150000:39-51 o APAGARAM, sob a nota escrita
--      "José Fernando e Luiz Paniago voltam limpos (com votos) após «Rodar tudo» 2×";
--   4. essa premissa é FALSA, e o próprio repositório já registrou isso em
--      20260909130000:10-13 — "o extrator se recusa, por desenho, a criar diretor a partir de
--      voto". O Luiz Paniago ganhou a migration de reinserção dele. O José Fernando não.
--
-- ⚠️ O QUE ISTO NÃO É: não é inventar dado. O mandato abaixo é o que a 20260517195947 já declarava;
-- esta migration restaura o que uma limpeza apagou por engano. As datas do DOU que continuam
-- FALTANDO são outras — Roger Cabral, Tasso Mendonça, posse do Severino, afastamento do Caio Mário —
-- e nenhuma delas está aqui.
--
-- ⚠️ E O NOME É O COMPLETO, com a variante abreviada em `nome_variantes`. Medido com o próprio
-- `name-matcher` do projeto, contra os três nomes que as atas usam:
--      cadastro COMPLETO + variante:   "…de Mendonça Gomes Júnior" 1.000 · "…Gomes Jr" 0.8947 ·
--                                      "José Fernando Gomes Júnior" 1.000   → os três casam
--      cadastro ABREVIADO sem variante: 0.684 · 0.676 · 1.000                → dois ficam abaixo
--                                      do limiar de 0.85 e viram `needsReview`
-- Gravar a forma abreviada aqui reabriria o defeito que a 20260710120000 consertou.
--
-- ⚠️ SEM `iris_seed_director`: a migration que a cria (20260517195947) a DERRUBA no fim dela mesma
-- (linha 337), então ela só existiu dentro daquela transação. A v1 do Luiz Paniago falhou em
-- produção com `42883` por chamá-la. Este arquivo é inline, no molde da 20260909130000 (v2).
--
-- ⚠️ E `metadata->>'seed'` preenchido NÃO é enfeite: o predicado da limpeza de agosto era
-- `fonte_dado <> 'verificado' AND metadata->>'seed' = ''`. É ele que blinda esta linha contra a
-- próxima varredura do mesmo tipo.
--
-- Idempotente (rodar 2× não muda nada): o diretor é procurado por nome E por variante; o mandato
-- entra com NOT EXISTS por (diretor_id, data_inicio). Aplicar no SQL Editor; depois "Rodar tudo".
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

  -- 1 · Procura pelas DUAS formas. Se a limpeza deixou a abreviada viva, esta migration a
  --     promove em vez de criar uma segunda pessoa — duplicar diretor seria pior que o defeito.
  SELECT id INTO v_diretor_id
    FROM public.diretores
   WHERE agencia_id = v_agencia_id
     AND (lower(nome) IN ('josé fernando de mendonça gomes júnior', 'josé fernando gomes júnior')
          OR 'José Fernando Gomes Júnior' = ANY(COALESCE(nome_variantes, '{}'::text[]))
          OR 'José Fernando de Mendonça Gomes Júnior' = ANY(COALESCE(nome_variantes, '{}'::text[])))
   ORDER BY (lower(nome) = 'josé fernando de mendonça gomes júnior') DESC
   LIMIT 1;

  IF v_diretor_id IS NULL THEN
    INSERT INTO public.diretores (
      agencia_id, nome, nome_variantes, cargo, ativo, needs_review, review_status, situacao,
      data_posse, data_fim_mandato, fonte_dado, lgpd_basis, importado_em, metadata
    ) VALUES (
      v_agencia_id, 'José Fernando de Mendonça Gomes Júnior',
      ARRAY['José Fernando Gomes Júnior']::text[],
      'Diretor', TRUE, FALSE, 'aprovado', 'titular',
      DATE '2025-09-01', DATE '2028-12-04', 'verificado', 'public_official_function', NOW(),
      jsonb_build_object(
        'seed', 'fase34_reinsercao',
        'motivo', 'apagado por 20260821150000 sob premissa falsa; extrator nao recria cadastro a partir de voto')
    ) RETURNING id INTO v_diretor_id;
  ELSE
    UPDATE public.diretores
       SET nome = 'José Fernando de Mendonça Gomes Júnior',
           -- Acrescenta a variante SEM duplicar — a coluna é text[], não jsonb.
           nome_variantes = CASE
             WHEN 'José Fernando Gomes Júnior' = ANY(COALESCE(nome_variantes, '{}'::text[]))
               THEN nome_variantes
             ELSE array_append(COALESCE(nome_variantes, '{}'::text[]), 'José Fernando Gomes Júnior')
           END,
           ativo = TRUE, needs_review = FALSE, review_status = 'aprovado', situacao = 'titular',
           cargo = 'Diretor',
           data_posse = COALESCE(data_posse, DATE '2025-09-01'),
           data_fim_mandato = COALESCE(data_fim_mandato, DATE '2028-12-04'),
           fonte_dado = 'verificado',
           metadata = COALESCE(metadata, '{}'::jsonb) || jsonb_build_object('seed', 'fase34_reinsercao'),
           updated_at = NOW()
     WHERE id = v_diretor_id;
  END IF;

  -- 2 · O mandato, exatamente como a 20260517195947:323 já o declarava.
  INSERT INTO public.mandatos (diretor_id, data_inicio, data_fim, cargo, fonte_dado, ato_nomeacao, metadata)
  SELECT v_diretor_id, DATE '2025-09-01', DATE '2028-12-04', 'Diretor', 'verificado',
         'Seed institucional 20260517195947 — restaurado após remoção indevida em 20260821150000',
         jsonb_build_object('seed', 'fase34_reinsercao')
   WHERE NOT EXISTS (
     SELECT 1 FROM public.mandatos m
      WHERE m.diretor_id = v_diretor_id AND m.data_inicio = DATE '2025-09-01');

  -- 3 · Se a limpeza tinha rejeitado o CANDIDATO homônimo, ele deixa de bloquear a aprovação
  --     futura. `candidato-approval.ts:61-73` recusa nome que case ≥0.85 com diretor rejeitado.
  UPDATE public.diretor_candidatos
     SET review_status = 'aprovado', diretor_id = v_diretor_id
   WHERE agencia_id = v_agencia_id
     AND review_status = 'rejeitado'
     AND nome_detectado ILIKE '%Jos%Fernando%Gomes%';

  SELECT COUNT(*) INTO v_mandatos FROM public.mandatos WHERE diretor_id = v_diretor_id;
  RAISE NOTICE 'José Fernando: diretor % (aprovado, verificado), % mandato(s)', v_diretor_id, v_mandatos;
END $$;

COMMIT;

NOTIFY pgrst, 'reload schema';

-- ── Conferência ────────────────────────────────────────────────────────────────
-- SELECT d.nome, d.nome_variantes, d.review_status, d.fonte_dado,
--        m.data_inicio, m.data_fim, m.fonte_dado AS mandato_fonte
--   FROM diretores d LEFT JOIN mandatos m ON m.diretor_id = d.id
--  WHERE d.nome ILIKE '%Jos%Fernando%' ORDER BY m.data_inicio;
-- Esperado: UMA pessoa, nome COMPLETO, variante abreviada presente, aprovado/verificado,
-- 1 mandato verificado de 2025-09-01 a 2028-12-04.
--
-- Depois: "Rodar tudo" e conferir o PLACAR (/api/v1/admin/placar) — a ANM deve sair de
-- `defeito_nosso` nas reuniões 84, 85 e 86, onde hoje o Caio Mário recebe o voto no lugar dele.
