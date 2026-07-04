-- ═══════════════════════════════════════════════════════════════════════════
-- Mandatos completos das 3 agências (Etapa 14-C) — dados pesquisados em fontes
-- oficiais em 04/07/2026. REVISAR antes de aplicar (as fontes estão citadas
-- linha a linha). Idempotente: usa ILIKE por nome + ON CONFLICT/NOT EXISTS.
--
-- Efeito: zera `diretores_sem_mandato` → a inferência de voto por mandato
-- (getActiveDiretoresForVote) passa a funcionar para TODOS os diretores.
--
-- Fontes:
--  [1] ANM — Diretoria Colegiada: https://www.gov.br/anm/pt-br/composicao/diretoria-colegiada
--      (composição vigente em 07/2026: Mauro H. M. Sousa DG; Caio Mário T. Seabra
--       Filho; José Fernando de M. Gomes Júnior; substitutos Luiz Paniago Neves e
--       Fábio Fernando Borges)
--  [2] ANM/Datalegis — resenha: convocação de Luiz Paniago Neves e Fábio Fernando
--      Borges como substitutos de Diretor por ATÉ 180 DIAS a contar de 03/06/2026
--      (vagas dos mandatos findos de Roger Romão Cabral e Tasso Mendonça Júnior).
--      https://anmlegis.datalegis.net (resenhas DC/ANM/MME)
--  [3] ARTESP — Relação de autoridades: https://www.artesp.sp.gov.br/artesp/institucional/relacao-de-autoridades
--      (André Isper Rodrigues Barnabé, Diego Zanatto, Raquel França Carneiro,
--       Fernanda Esbízaro Rodrigues Rudnik)
--  [4] ALESP — aprovação de Fernanda Esbízaro Rodrigues (PDL 26/2025) em 27/08/2025:
--      https://www.al.sp.gov.br/noticia/?27/08/2025/fernanda-rodrigues-e-aprovada-
--      por-comissao-da-alesp-como-nova-diretora-da-artesp
--      Posse noticiada em 28/08/2025 (Diário do Grande ABC). FIM do mandato não
--      publicado nas fontes consultadas → mandato ABERTO (data_fim NULL); ajustar
--      quando o decreto com o termo final for localizado no DOE-SP.
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

-- ─── ANM: nova convocação dos substitutos (03/06/2026 + até 180 dias) [2] ────
-- A convocação anterior (05/12/2025→02/06/2026) já está no seed institucional;
-- esta é a RENOVAÇÃO vigente. 03/06/2026 + 180 dias ⇒ 30/11/2026.
DO $$
DECLARE
  v_diretor RECORD;
BEGIN
  FOR v_diretor IN
    SELECT d.id, d.nome
    FROM public.diretores d
    JOIN public.agencias a ON a.id = d.agencia_id
    WHERE a.sigla = 'ANM'
      AND (d.nome ILIKE 'Luiz Paniago Neves' OR d.nome ILIKE 'F_bio Fernando Borges')
  LOOP
    -- Reabre a vigência do diretor (o mandato interino anterior venceu em 02/06/2026).
    UPDATE public.diretores
    SET data_posse = COALESCE(data_posse, DATE '2025-12-05'),
        data_fim_mandato = DATE '2026-11-30',
        situacao = 'interino',
        fonte_dado = 'verificado',
        updated_at = NOW()
    WHERE id = v_diretor.id;

    INSERT INTO public.mandatos (diretor_id, data_inicio, data_fim, cargo, fonte_dado, ato_nomeacao)
    SELECT v_diretor.id, DATE '2026-06-03', DATE '2026-11-30', 'Diretor Substituto', 'verificado',
           'Convocação por até 180 dias a contar de 03/06/2026 (resenha DC/ANM/MME) — fonte [2]'
    WHERE NOT EXISTS (
      SELECT 1 FROM public.mandatos m
      WHERE m.diretor_id = v_diretor.id AND m.data_inicio = DATE '2026-06-03'
    );
  END LOOP;
END $$;

-- ─── ARTESP: Fernanda Esbízaro Rodrigues Rudnik [3][4] ───────────────────────
-- Aprovada pela ALESP em 27/08/2025 (PDL 26/2025); posse noticiada em 28/08/2025.
-- data_fim NULL = mandato em aberto (termo final ainda não publicado).
DO $$
DECLARE
  v_id UUID;
BEGIN
  SELECT d.id INTO v_id
  FROM public.diretores d
  JOIN public.agencias a ON a.id = d.agencia_id
  WHERE a.sigla = 'ARTESP' AND d.nome ILIKE 'Fernanda Esb_zaro Rodrigues Rudnik'
  LIMIT 1;

  IF v_id IS NOT NULL THEN
    UPDATE public.diretores
    SET data_posse = COALESCE(data_posse, DATE '2025-08-28'),
        fonte_dado = 'verificado',
        updated_at = NOW()
    WHERE id = v_id;

    INSERT INTO public.mandatos (diretor_id, data_inicio, data_fim, cargo, fonte_dado, ato_nomeacao)
    SELECT v_id, DATE '2025-08-28', NULL, 'Diretora', 'verificado',
           'Aprovação ALESP (PDL 26/2025) em 27/08/2025; posse em 28/08/2025 — fontes [3][4]'
    WHERE NOT EXISTS (
      SELECT 1 FROM public.mandatos m
      WHERE m.diretor_id = v_id AND m.data_inicio = DATE '2025-08-28'
    );
  END IF;
END $$;

-- ─── Rede de segurança: qualquer diretor aprovado com data_posse e sem mandato ─
-- (mesmo padrão da 20260624120000_mandatos_higiene; cobre diretores criados pela
-- esteira de candidatos depois que o admin preencher a posse no formulário).
INSERT INTO public.mandatos (diretor_id, data_inicio, data_fim, cargo, fonte_dado)
SELECT d.id, d.data_posse, d.data_fim_mandato, d.cargo, 'automatico'
FROM public.diretores d
WHERE d.data_posse IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM public.mandatos m WHERE m.diretor_id = d.id);

NOTIFY pgrst, 'reload schema';

COMMIT;
