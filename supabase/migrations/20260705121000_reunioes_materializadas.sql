-- ═══════════════════════════════════════════════════════════════════════════
-- Entidade "reunião" MATERIALIZADA (Etapa 14-D). Antes, reuniões eram
-- reconstruídas em memória a partir de deliberacoes (agencia+data+numero) — e
-- reuniões descobertas pela coleta ANTT sem ata processada não existiam em
-- lugar nenhum. Esta migration cria a tabela canônica, liga deliberacoes a ela
-- (reuniao_id) e faz o backfill a partir do que já existe.
-- Idempotente (IF NOT EXISTS / ON CONFLICT DO NOTHING / WHERE ... IS NULL).
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

CREATE TABLE IF NOT EXISTS public.reunioes (
  id             UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  agencia_id     UUID NOT NULL REFERENCES public.agencias(id) ON DELETE CASCADE,
  numero_reuniao VARCHAR(20),
  tipo_reuniao   VARCHAR(20),
  data_reuniao   DATE,
  url_fonte      TEXT,
  source         VARCHAR(40) NOT NULL DEFAULT 'deliberacoes',
  metadata       JSONB NOT NULL DEFAULT '{}',
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Chave natural: mesma agência + mesma data + mesmo número (número NULL vira ''
-- na expressão — reuniões sem número na mesma data colapsam numa só, espelhando
-- o comportamento atual do rollup em memória).
CREATE UNIQUE INDEX IF NOT EXISTS idx_reunioes_chave_natural
  ON public.reunioes (agencia_id, data_reuniao, COALESCE(numero_reuniao, ''));

CREATE INDEX IF NOT EXISTS idx_reunioes_agencia_data
  ON public.reunioes (agencia_id, data_reuniao DESC);

ALTER TABLE public.deliberacoes
  ADD COLUMN IF NOT EXISTS reuniao_id UUID REFERENCES public.reunioes(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_deliberacoes_reuniao_id
  ON public.deliberacoes (reuniao_id);

-- ─── Backfill 1: reuniões a partir das deliberações existentes ───────────────
INSERT INTO public.reunioes (agencia_id, numero_reuniao, tipo_reuniao, data_reuniao, source)
SELECT DISTINCT ON (d.agencia_id, d.data_reuniao, COALESCE(d.numero_reuniao, ''))
       d.agencia_id, d.numero_reuniao, d.tipo_reuniao, d.data_reuniao, 'deliberacoes'
FROM public.deliberacoes d
WHERE d.data_reuniao IS NOT NULL
ORDER BY d.agencia_id, d.data_reuniao, COALESCE(d.numero_reuniao, ''), d.created_at ASC
ON CONFLICT (agencia_id, data_reuniao, COALESCE(numero_reuniao, '')) DO NOTHING;

-- ─── Backfill 2: liga cada deliberação à sua reunião ─────────────────────────
UPDATE public.deliberacoes d
SET reuniao_id = r.id
FROM public.reunioes r
WHERE d.reuniao_id IS NULL
  AND d.data_reuniao IS NOT NULL
  AND r.agencia_id = d.agencia_id
  AND r.data_reuniao = d.data_reuniao
  AND COALESCE(r.numero_reuniao, '') = COALESCE(d.numero_reuniao, '');

-- ─── Backfill 3: reuniões descobertas pela coleta ANTT ───────────────────────
-- Inclui reuniões AINDA SEM deliberação processada (cobertura honesta) e
-- enriquece com tipo/URL as que já existiam via deliberações.
INSERT INTO public.reunioes (agencia_id, numero_reuniao, tipo_reuniao, data_reuniao, url_fonte, source, metadata)
SELECT arc.agencia_id,
       arc.numero,
       CASE arc.tipo
         WHEN 'ordinaria' THEN 'Ordinaria'
         WHEN 'extraordinaria' THEN 'Extraordinaria'
         ELSE NULL
       END,
       arc.data_inicio,
       arc.url_reuniao,
       'antt-coleta',
       jsonb_build_object('antt_reuniao_coletada_id', arc.id, 'titulo', arc.titulo)
FROM public.antt_reunioes_coletadas arc
WHERE arc.agencia_id IS NOT NULL
  AND arc.data_inicio IS NOT NULL
ON CONFLICT (agencia_id, data_reuniao, COALESCE(numero_reuniao, '')) DO UPDATE
SET url_fonte    = COALESCE(public.reunioes.url_fonte, EXCLUDED.url_fonte),
    tipo_reuniao = COALESCE(public.reunioes.tipo_reuniao, EXCLUDED.tipo_reuniao),
    metadata     = public.reunioes.metadata || EXCLUDED.metadata,
    updated_at   = NOW();

-- updated_at automático (update_updated_at é a função padrão criada na 001).
CREATE OR REPLACE TRIGGER trg_reunioes_updated_at
  BEFORE UPDATE ON public.reunioes
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- RLS espelhando o padrão do projeto (empresas/20260623121000): service_role
-- opera; anon não lê nada.
ALTER TABLE public.reunioes ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS reunioes_service_role_all ON public.reunioes;
CREATE POLICY reunioes_service_role_all ON public.reunioes
  FOR ALL TO service_role USING (true) WITH CHECK (true);

NOTIFY pgrst, 'reload schema';

COMMIT;
