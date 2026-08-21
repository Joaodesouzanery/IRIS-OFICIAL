-- Limpeza de artefatos da esteira de votos (QA ago/2026).
--
-- Causa: (1) detectAgenciaSigla casava sigla como SUBSTRING ("ANS" dentro de "TRANSPORTES")
-- e documentos ANTT/ARTESP foram gravados como ANS/ANA; (2) a criação de diretor e a
-- fabricação de mandato eram agnósticas de agência → "diretores" de ANS com voto inferido;
-- (3) o aprovar-lote criava diretor para QUALQUER nome citado (signatário/servidor de ata
-- da ANM virou "diretor" — 25 aprovados num colegiado de ~7).
-- O código desta versão fecha as 3 portas; esta migration limpa o legado.
--
-- Escopo: NÃO toca notícias (regulatory_news), qualidade, monitoramento.
-- Idempotente; aplicar no SQL Editor do Supabase. REVISAR antes: os SELECTs de conferência
-- no fim mostram o que sobrou.

BEGIN;

-- ── 1 · Agências NÃO-colegiadas (fora de ANTT/ANM/ARTESP): zera a esteira de votos ──────

-- 1a. Votos de deliberações dessas agências (artefatos de inferência).
DELETE FROM public.votos v
USING public.deliberacoes d, public.agencias a
WHERE v.deliberacao_id = d.id
  AND d.agencia_id = a.id
  AND a.sigla NOT IN ('ANTT','ANM','ARTESP');

-- 1b. Mandatos de diretores dessas agências (fabricados).
DELETE FROM public.mandatos m
USING public.diretores dir, public.agencias a
WHERE m.diretor_id = dir.id
  AND dir.agencia_id = a.id
  AND a.sigla NOT IN ('ANTT','ANM','ARTESP');

-- 1c. Diretores dessas agências saem do "aprovado" (rejeitado = fora de todas as telas).
UPDATE public.diretores dir
SET review_status = 'rejeitado', needs_review = TRUE, updated_at = NOW()
FROM public.agencias a
WHERE dir.agencia_id = a.id
  AND a.sigla NOT IN ('ANTT','ANM','ARTESP')
  AND dir.review_status <> 'rejeitado';

-- 1d. Candidatos pendentes dessas agências.
UPDATE public.diretor_candidatos c
SET review_status = 'rejeitado', reviewed_at = NOW()
FROM public.agencias a
WHERE c.agencia_id = a.id
  AND a.sigla NOT IN ('ANTT','ANM','ARTESP')
  AND c.review_status = 'pendente';

-- 1e. Solta os vínculos de documentos com as deliberações que vão sair (FKs nullable).
UPDATE public.documentos_regulatorios doc
SET deliberacao_id = NULL
FROM public.deliberacoes d, public.agencias a
WHERE doc.deliberacao_id = d.id
  AND d.agencia_id = a.id
  AND a.sigla NOT IN ('ANTT','ANM','ARTESP');

UPDATE public.documentos_regulatorios doc
SET duplicate_deliberacao_id = NULL
FROM public.deliberacoes d, public.agencias a
WHERE doc.duplicate_deliberacao_id = d.id
  AND d.agencia_id = a.id
  AND a.sigla NOT IN ('ANTT','ANM','ARTESP');

-- 1f. As deliberações-artefato (poucas linhas — misclassificação de upload).
DELETE FROM public.deliberacoes d
USING public.agencias a
WHERE d.agencia_id = a.id
  AND a.sigla NOT IN ('ANTT','ANM','ARTESP');

-- ── 2 · ANM: rejeita os "diretores" que a esteira inventou ──────────────────────────────
-- Falso = aprovado, SEM nenhum voto e SEM mandato de fonte confiável (seed 'verificado' ou
-- com ato de nomeação). Os 7 do seed oficial têm iris_seed_director → fonte_dado='verificado'.

-- 2a. Apaga mandatos NÃO-confiáveis dos falsos (fabricados por código: fonte 'automatico'
--     ou o default 'manual' sem ato de nomeação).
DELETE FROM public.mandatos m
USING public.diretores dir, public.agencias a
WHERE m.diretor_id = dir.id
  AND dir.agencia_id = a.id
  AND a.sigla = 'ANM'
  AND COALESCE(m.fonte_dado, 'manual') <> 'verificado'
  AND m.ato_nomeacao IS NULL
  AND NOT EXISTS (SELECT 1 FROM public.votos v WHERE v.diretor_id = dir.id);

-- 2b. Rejeita os diretores ANM sem voto e sem mandato confiável.
UPDATE public.diretores dir
SET review_status = 'rejeitado', needs_review = TRUE, updated_at = NOW()
FROM public.agencias a
WHERE dir.agencia_id = a.id
  AND a.sigla = 'ANM'
  AND dir.review_status = 'aprovado'
  AND NOT EXISTS (SELECT 1 FROM public.votos v WHERE v.diretor_id = dir.id)
  AND NOT EXISTS (
    SELECT 1 FROM public.mandatos m
    WHERE m.diretor_id = dir.id
      AND (m.fonte_dado = 'verificado' OR m.ato_nomeacao IS NOT NULL)
  );

-- 2c. Candidatos pendentes cujo nome é de diretor recém-rejeitado.
UPDATE public.diretor_candidatos c
SET review_status = 'rejeitado', reviewed_at = NOW()
WHERE c.review_status = 'pendente'
  AND EXISTS (
    SELECT 1 FROM public.diretores dir
    WHERE dir.agencia_id = c.agencia_id
      AND dir.review_status = 'rejeitado'
      AND LOWER(dir.nome) = LOWER(c.nome_detectado)
  );

COMMIT;

NOTIFY pgrst, 'reload schema';

-- ── Conferência (rodar depois; só leitura) ──────────────────────────────────────────────
-- SELECT a.sigla, count(*) FROM deliberacoes d JOIN agencias a ON a.id=d.agencia_id GROUP BY 1 ORDER BY 1;
-- SELECT a.sigla, dir.review_status, count(*) FROM diretores dir JOIN agencias a ON a.id=dir.agencia_id GROUP BY 1,2 ORDER BY 1,2;
-- Esperado: deliberações só em ANTT/ANM/ARTESP; ANM com ~7 aprovados.
