-- ═══════════════════════════════════════════════════════════════════════════════
-- LIMPEZA DOS DOIS FALSOS POSITIVOS QUE A AUDITORIA DA FASE 13 PROVOU (30/ago/2026)
--
-- ① ANM: manuais do site institucional gravados como `deliberacao` e contados como decisão
--    final (manual-da-agenda-regulatoria, manual-de-sistema-dipem, sdm-instrucoes-de-uso…).
--    Critério = o MESMO do guard C21 que agora impede novas entradas: deliberação sem número,
--    sem processo, sem relator, sem reunião e sem itens NUNCA foi uma decisão.
-- ② ARTESP: cabeçalhos de tabela promovidos a "diretores" com voto nominal — os ÚNICOS votos
--    nominais da agência eram esse lixo ("Função Confiança Quantidadenível" etc.).
--
-- Idempotente (rodar 2× não muda nada) e forward-only. O DELETE de `deliberacoes` aqui segue o
-- precedente do `redatar`: linhas que NUNCA foram decisões são artefato de parse, não dado
-- primário. `votos` cai por CASCADE (as falsas não têm voto — conferido pela auditoria: votos=[]).
-- ═══════════════════════════════════════════════════════════════════════════════

BEGIN;

DO $$
DECLARE
  v_anm UUID;
  v_docs INT := 0;
  v_delibs INT := 0;
  v_empresas INT := 0;
  v_votos_lixo INT := 0;
  v_diretores_lixo INT := 0;
BEGIN
  SELECT id INTO v_anm FROM public.agencias WHERE sigla = 'ANM' LIMIT 1;

  IF v_anm IS NOT NULL THEN
    -- ①a Os documentos de origem saem de 'confirmed' → 'ignored' com motivo auditável.
    --    (Mesmo critério do C21, aplicado ao que JÁ está gravado.)
    WITH falsas AS (
      SELECT d.id, d.upload_job_id, d.empresa_id
        FROM public.deliberacoes d
       WHERE d.agencia_id = v_anm
         AND d.tipo_documento = 'deliberacao'
         AND d.numero_deliberacao IS NULL
         AND d.processo IS NULL
         AND d.relator IS NULL
         AND d.numero_reuniao IS NULL
         AND d.documento_pai_id IS NULL
         AND NOT EXISTS (SELECT 1 FROM public.deliberacoes f WHERE f.documento_pai_id = d.id)
    )
    UPDATE public.documentos_regulatorios dr
       SET status = 'ignored',
           campos_detectados = COALESCE(dr.campos_detectados, '{}'::jsonb)
             || jsonb_build_object('arquivado_motivo', 'nao_deliberativo'),
           updated_at = NOW()
      FROM falsas
     WHERE dr.status = 'confirmed'
       AND (dr.deliberacao_id = falsas.id
            OR (dr.upload_job_id IS NOT NULL AND dr.upload_job_id = falsas.upload_job_id));
    GET DIAGNOSTICS v_docs = ROW_COUNT;

    -- ①b As falsas deliberações saem. (empresa_id é ON DELETE SET NULL na direção inversa;
    --    aqui apenas apagamos a linha filha — nada mais referencia deliberacoes além de votos,
    --    que caem por CASCADE e são zero nas falsas.)
    DELETE FROM public.deliberacoes d
     WHERE d.agencia_id = v_anm
       AND d.tipo_documento = 'deliberacao'
       AND d.numero_deliberacao IS NULL
       AND d.processo IS NULL
       AND d.relator IS NULL
       AND d.numero_reuniao IS NULL
       AND d.documento_pai_id IS NULL
       AND NOT EXISTS (SELECT 1 FROM public.deliberacoes f WHERE f.documento_pai_id = d.id);
    GET DIAGNOSTICS v_delibs = ROW_COUNT;

    -- ①c Empresas fabricadas AUTOMATICAMENTE que ficaram órfãs ("desejada para cadastrar os
    --    colaboradores." virou empresa). Só as sem NENHUMA referência restante.
    DELETE FROM public.empresas e
     WHERE e.agencia_id = v_anm
       AND e.fonte_dado = 'automatico'
       AND NOT EXISTS (SELECT 1 FROM public.deliberacoes d WHERE d.empresa_id = e.id);
    GET DIAGNOSTICS v_empresas = ROW_COUNT;
  END IF;

  -- ② Os "diretores" de cabeçalho de tabela. Nome EXATO (normalizado como o cadastro gravou);
  --   ILIKE para tolerar variação de caixa. Rejeitado não ressuscita (guard da overview).
  WITH lixo AS (
    SELECT d.id FROM public.diretores d
    JOIN public.agencias a ON a.id = d.agencia_id
    WHERE a.sigla = 'ARTESP'
      AND (d.nome ILIKE 'Função Confiança Quantidadenível'
        OR d.nome ILIKE 'Funcao Confianca Quantidadenivel'
        OR d.nome ILIKE 'Confiança Quantidadenível'
        OR d.nome ILIKE 'Confianca Quantidadenivel'
        OR d.nome ILIKE 'Uma Vez Que'
        OR d.nome ILIKE 'Renovação De Frota'
        OR d.nome ILIKE 'Renovacao De Frota')
  ), del_votos AS (
    DELETE FROM public.votos v USING lixo WHERE v.diretor_id = lixo.id RETURNING v.id
  ), del_mandatos AS (
    DELETE FROM public.mandatos m USING lixo WHERE m.diretor_id = lixo.id RETURNING m.id
  ), rej AS (
    UPDATE public.diretores d SET review_status = 'rejeitado', updated_at = NOW()
      FROM lixo WHERE d.id = lixo.id AND d.review_status IS DISTINCT FROM 'rejeitado'
      RETURNING d.id
  )
  SELECT (SELECT COUNT(*) FROM del_votos), (SELECT COUNT(*) FROM rej)
    INTO v_votos_lixo, v_diretores_lixo;

  -- Cartões de candidato com os mesmos nomes: rejeitados para não re-propor.
  UPDATE public.diretor_candidatos SET review_status = 'rejeitado', reviewed_by = 'limpeza-fase13'
   WHERE review_status IS DISTINCT FROM 'rejeitado'
     AND (nome_detectado ILIKE '%Confiança Quantidadenível%'
       OR nome_detectado ILIKE '%Confianca Quantidadenivel%'
       OR nome_detectado ILIKE 'Uma Vez Que'
       OR nome_detectado ILIKE 'Renovação De Frota'
       OR nome_detectado ILIKE 'Renovacao De Frota');

  RAISE NOTICE 'LIMPEZA FASE 13 → ANM: % deliberações falsas removidas, % documentos arquivados (nao_deliberativo), % empresas órfãs removidas · ARTESP: % votos-lixo removidos, % diretores rejeitados',
    v_delibs, v_docs, v_empresas, v_votos_lixo, v_diretores_lixo;
END $$;

COMMIT;

NOTIFY pgrst, 'reload schema';
