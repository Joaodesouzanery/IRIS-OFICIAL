-- Dedup estrutural de deliberações — 2 correções reveladas pelos 58 PDFs ARTESP (jul/2026):
--
-- C-2 [correção]: o índice único vivo `idx_deliberacoes_agencia_numero_uniq
--   (agencia_id, numero_deliberacao)` NÃO escopa por ANO. O Regimento ARTESP (Art. 22)
--   renova a numeração ANUALMENTE → Deliberação Nº 08/2025 e Nº 08/2026 são DECISÕES
--   DISTINTAS, mas colidiriam (a de 2026 seria barrada como "duplicata" da de 2025).
--   Substitui por um índice escopado por ano de `data_reuniao` (coluna DATE → date_part
--   é IMUTÁVEL/indexável). Os 58 docs são todos 2026, então não há colisão hoje — é
--   preventivo, mas fecha um erro de integridade latente. As numerações ANTT "PREFIX-276"
--   e itens "PREFIX-276-3" continuam únicas dentro do ano (sem regressão).
--
-- C-1 [SEC-6]: deliberação SEM número (numero_deliberacao NULL) fica FORA do índice →
--   uma corrida pode duplicá-la. Adiciona índice único parcial pela chave natural dos
--   sem-número COM data e processo. NÃO-FATAL: se houver duplicata legada, apenas avisa
--   (rode o dedup e reaplique) — não aborta o C-2.
--
-- Idempotente / forward-only. Aplicar no SQL Editor. `get_advisors` depois.

BEGIN;

-- ── C-2: índice único escopado por ANO ──────────────────────────────────────
-- Seguro: o novo índice é MAIS estrito (adiciona o ano) para linhas com data, então
-- só pode conflitar onde o índice antigo JÁ conflitava (mesma agência+número) — logo
-- não introduz violação nova. Solta a colisão entre anos (o objetivo).
DROP INDEX IF EXISTS public.idx_deliberacoes_agencia_numero_uniq;

CREATE UNIQUE INDEX IF NOT EXISTS idx_deliberacoes_agencia_ano_numero_uniq
  ON public.deliberacoes (agencia_id, date_part('year', data_reuniao), numero_deliberacao)
  WHERE numero_deliberacao IS NOT NULL AND data_reuniao IS NOT NULL;

-- Preserva a proteção para o caso raro de deliberação COM número mas SEM data (sem ano
-- para escopar → mantém a unicidade simples por agência+número).
CREATE UNIQUE INDEX IF NOT EXISTS idx_deliberacoes_agencia_numero_semdata_uniq
  ON public.deliberacoes (agencia_id, numero_deliberacao)
  WHERE numero_deliberacao IS NOT NULL AND data_reuniao IS NULL;

COMMIT;

-- ── C-1: índice único dos SEM-NÚMERO (SEC-6) — NÃO-FATAL ─────────────────────
-- Fora do BEGIN/COMMIT acima para não abortar o C-2 se houver duplicata legada. O
-- handler de exceção (subtransação) captura a violação e apenas avisa.
DO $$
BEGIN
  CREATE UNIQUE INDEX IF NOT EXISTS idx_deliberacoes_semnumero_uniq
    ON public.deliberacoes (agencia_id, data_reuniao, processo)
    WHERE numero_deliberacao IS NULL AND data_reuniao IS NOT NULL AND processo IS NOT NULL;
  RAISE NOTICE '[sec-6] índice único de deliberações sem-número criado.';
EXCEPTION WHEN unique_violation THEN
  RAISE NOTICE '[sec-6] índice sem-número NÃO criado: há duplicatas legadas. Rode o dedup (POST /api/v1/admin/deliberacoes/dedup?dry_run=0) e reaplique esta migration.';
END $$;

NOTIFY pgrst, 'reload schema';
