-- ════════════════════════════════════════════════════════════════════════════════════════════════
-- Livro-razão, portão 1 — a REFERÊNCIA do site, gravada (Fase 38).
--
-- O que é: a lista de reuniões que cada agência PUBLICA, como a conferência ao vivo
-- (`/api/v1/admin/cobertura-ao-vivo`) a enumerou. É o DENOMINADOR do livro-razão: "pronta" é medido
-- contra o que o site mostra, não contra o que o banco já tem.
--
--   · reunioes_referencia — uma linha por (agência, série, número). CUMULATIVA: uma enumeração nova
--     acrescenta e atualiza, NUNCA apaga. Reunião que some da listagem continua aqui com `visto_em`
--     antigo — some do site não é o mesmo que nunca ter existido.
--   · referencia_fontes   — por URL de listagem: quando foi a última enumeração BOA, a última
--     tentativa e o erro dela. Enumeração vazia ou bloqueada (WAF) só atualiza a TENTATIVA; a
--     referência boa continua valendo, com a data, e o livro a marca «desatualizada» após 7 dias.
--
-- Idempotente, forward-only, sem função auxiliar, sem tabela temporária. O código degrada sem ela:
-- a conferência ao vivo segue respondendo e diz "referência não gravada (tabela ausente)", e o
-- livro-razão mostra o portão 1 VERMELHO com "referência indisponível" — nunca "0 reuniões".
-- ════════════════════════════════════════════════════════════════════════════════════════════════

BEGIN;

CREATE TABLE IF NOT EXISTS public.reunioes_referencia (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agencia_id         UUID NOT NULL REFERENCES public.agencias(id) ON DELETE CASCADE,
  -- '' quando a fonte não diz a série (NULL quebraria a unicidade: NULL ≠ NULL no índice).
  serie              TEXT NOT NULL DEFAULT '',
  numero             INTEGER NOT NULL CHECK (numero > 0),
  -- Data da REUNIÃO quando a listagem a dá (ANTT, ARTESP). A ANM só dá a de publicação.
  data_reuniao       DATE,
  ano_publicacao     INTEGER,
  -- Itens que a fonte mostra (processos da ANTT, deliberações listadas da ARTESP).
  itens_na_fonte     INTEGER,
  -- FALSE = só a pauta saiu; NULL = a fonte não distingue.
  decisao_publicada  BOOLEAN,
  fonte              TEXT NOT NULL,
  url                TEXT,
  primeiro_visto_em  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  visto_em           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT reunioes_referencia_chave UNIQUE (agencia_id, serie, numero)
);

CREATE INDEX IF NOT EXISTS idx_reunioes_referencia_agencia ON public.reunioes_referencia (agencia_id);

CREATE TABLE IF NOT EXISTS public.referencia_fontes (
  fonte                 TEXT PRIMARY KEY,
  agencia_id            UUID REFERENCES public.agencias(id) ON DELETE CASCADE,
  ultima_boa_em         TIMESTAMPTZ,
  itens_na_ultima_boa   INTEGER,
  ultima_tentativa_em   TIMESTAMPTZ,
  ultimo_erro           TEXT
);

ALTER TABLE public.reunioes_referencia ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS reunioes_referencia_service_role_all ON public.reunioes_referencia;
CREATE POLICY reunioes_referencia_service_role_all ON public.reunioes_referencia
  FOR ALL TO service_role USING (true) WITH CHECK (true);

ALTER TABLE public.referencia_fontes ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS referencia_fontes_service_role_all ON public.referencia_fontes;
CREATE POLICY referencia_fontes_service_role_all ON public.referencia_fontes
  FOR ALL TO service_role USING (true) WITH CHECK (true);

COMMIT;

NOTIFY pgrst, 'reload schema';

-- Conferência (rode depois): as duas tabelas existem e estão vazias até a 1ª conferência ao vivo.
-- SELECT (SELECT count(*) FROM reunioes_referencia) AS reunioes, (SELECT count(*) FROM referencia_fontes) AS fontes;
