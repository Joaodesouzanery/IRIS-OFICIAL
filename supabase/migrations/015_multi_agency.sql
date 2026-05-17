-- =============================================================
-- IRIS Regulação — Migration 003
-- Suporte multi-agência: tipo de documento, relator, items de ata,
-- documento pai, microtemas ANM.
-- =============================================================

-- 1. Tipo de documento original (para saber qual estratégia de extração usar)
ALTER TABLE deliberacoes ADD COLUMN IF NOT EXISTS tipo_documento VARCHAR(20)
  DEFAULT 'deliberacao'
  CHECK (tipo_documento IN ('deliberacao','ata','resolucao','portaria'));

-- 2. Relator (presente em atas ANM, não em ARTESP)
ALTER TABLE deliberacoes ADD COLUMN IF NOT EXISTS relator VARCHAR(200);

-- 3. Item number dentro da ata (I, II, 1.1.1, etc.)
ALTER TABLE deliberacoes ADD COLUMN IF NOT EXISTS item_numero VARCHAR(20);

-- 4. Link para documento pai (mesma ata pode gerar N deliberações)
ALTER TABLE deliberacoes ADD COLUMN IF NOT EXISTS documento_pai_id UUID
  REFERENCES deliberacoes(id) ON DELETE SET NULL;

-- 5. Índice para buscar filhos de um documento pai
CREATE INDEX IF NOT EXISTS idx_deliberacoes_pai ON deliberacoes(documento_pai_id);

-- 6. Expandir microtema CHECK para incluir temas de mineração (ANM)
ALTER TABLE deliberacoes DROP CONSTRAINT IF EXISTS deliberacoes_microtema_check;
ALTER TABLE deliberacoes ADD CONSTRAINT deliberacoes_microtema_check
  CHECK (microtema IN (
    -- ARTESP
    'tarifa','obras','multa','contrato','reequilibrio','fiscalizacao',
    'seguranca','ambiental','desapropriacao','adimplencia','pessoal',
    'usuario',
    -- ANM (mineração)
    'lavra','pesquisa','licenciamento','servidao','cfem',
    'disponibilidade','recursos',
    -- Genérico
    'outros'
  ));
