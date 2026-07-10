-- ═══════════════════════════════════════════════════════════════════════════
-- Etapa 21 — Correções de seed de diretores (ANTT DSM + ANM José Fernando).
--
-- O parser mapeia DSM → "Severino Medeiros" (antt-manual-parser.ts ANTT_DIRECTOR_INITIALS),
-- mas o seed de 2025 (20260517195947) NÃO tinha esse diretor → os "Voto DSM" ficavam
-- com "relator não casa" e não materializavam. Nome oficial confirmado em fontes ANTT:
-- "Severino Medeiros Ramos Neto" (Diretor). deriveNomeVariantes gera "Severino Medeiros"
-- → findBestMatch ≥0.85 → voto nominal automático.
--
-- Idempotente: só cria se não existir (ILIKE por nome). data_posse conservadora
-- (01/01/2026, antes dos votos de 2026); fonte_dado 'automatico' p/ revisão do termo.
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

DO $$
DECLARE
  v_agencia_id UUID;
  v_diretor_id UUID;
BEGIN
  SELECT id INTO v_agencia_id FROM public.agencias WHERE sigla = 'ANTT' LIMIT 1;
  IF v_agencia_id IS NULL THEN RETURN; END IF;

  -- Já existe algum cadastro que casa "Severino"? (evita duplicar)
  SELECT id INTO v_diretor_id
  FROM public.diretores
  WHERE agencia_id = v_agencia_id AND nome ILIKE '%Severino%Medeiros%'
  LIMIT 1;

  IF v_diretor_id IS NULL THEN
    INSERT INTO public.diretores (
      agencia_id, nome, cargo, situacao, data_posse, data_fim_mandato,
      review_status, needs_review, fonte_dado, lgpd_basis, last_verified_at
    ) VALUES (
      v_agencia_id, 'Severino Medeiros Ramos Neto', 'Diretor', 'titular',
      DATE '2026-01-01', NULL, 'aprovado', false, 'automatico',
      'public_official_function', NOW()
    )
    RETURNING id INTO v_diretor_id;
  END IF;

  -- Mandato (para a inferência/consenso não ficar desligada para ele).
  IF v_diretor_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.mandatos WHERE diretor_id = v_diretor_id
  ) THEN
    INSERT INTO public.mandatos (diretor_id, data_inicio, data_fim, cargo, fonte_dado, review_status, lgpd_basis)
    VALUES (v_diretor_id, DATE '2026-01-01', NULL, 'Diretor', 'automatico', 'aprovado', 'public_official_function');
  END IF;
END $$;

-- ─── ANM: José Fernando com o nome COMPLETO (as atas usam "de Mendonça") ─────
-- O seed de 2025 gravou a forma ABREVIADA "José Fernando Gomes Júnior"; as atas da
-- ANM citam "José Fernando de Mendonça Gomes Júnior" → findBestMatch caía a 0.71
-- (deriveNomeVariantes do abreviado não gera "de Mendonça"). Renomeia para a forma
-- COMPLETA (que gera a abreviada como variante) e guarda a abreviada em variantes.
-- Idempotente: só age enquanto o nome ainda estiver abreviado.
-- nome_variantes é text[] (array Postgres), NÃO jsonb — usar operadores de array.
DO $$
DECLARE
  v_agencia_id UUID;
  v_diretor_id UUID;
BEGIN
  SELECT id INTO v_agencia_id FROM public.agencias WHERE sigla = 'ANM' LIMIT 1;
  IF v_agencia_id IS NULL THEN RETURN; END IF;

  SELECT id INTO v_diretor_id
  FROM public.diretores
  WHERE agencia_id = v_agencia_id
    AND nome ILIKE 'Jos_ Fernando Gomes J_nior'
    AND nome NOT ILIKE '%Mendon%'
  LIMIT 1;

  IF v_diretor_id IS NOT NULL THEN
    UPDATE public.diretores
    SET nome = 'José Fernando de Mendonça Gomes Júnior',
        nome_variantes = CASE
          WHEN 'José Fernando Gomes Júnior' = ANY(COALESCE(nome_variantes, '{}'::text[]))
            THEN nome_variantes
          ELSE array_append(COALESCE(nome_variantes, '{}'::text[]), 'José Fernando Gomes Júnior')
        END,
        updated_at = NOW()
    WHERE id = v_diretor_id;
  END IF;
END $$;

NOTIFY pgrst, 'reload schema';

COMMIT;
