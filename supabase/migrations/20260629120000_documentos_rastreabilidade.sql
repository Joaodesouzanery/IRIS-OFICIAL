-- Rastreabilidade do pipeline de documentos:
--   documentos_coletados → documentos_regulatorios → deliberacoes
-- Hoje só dava para seguir o caminho via upload_job_id / metadata (frágil).
-- Estes vínculos permitem auditar um doc da coleta até a deliberação final e
-- alimentam o painel de Cobertura de Documentos. Tudo idempotente e nullable
-- (ON DELETE SET NULL) — não quebra linhas existentes.

-- 1) coletado → regulatório (qual documento bruto a coleta gerou)
ALTER TABLE documentos_coletados
  ADD COLUMN IF NOT EXISTS documento_regulatorio_id UUID
    REFERENCES documentos_regulatorios(id) ON DELETE SET NULL;

-- 2) regulatório → coletado (origem da coleta) e regulatório → deliberação (decisão produzida)
ALTER TABLE documentos_regulatorios
  ADD COLUMN IF NOT EXISTS documento_coletado_id UUID
    REFERENCES documentos_coletados(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS deliberacao_id UUID
    REFERENCES deliberacoes(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_documentos_coletados_regulatorio
  ON documentos_coletados(documento_regulatorio_id)
  WHERE documento_regulatorio_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_documentos_reg_coletado
  ON documentos_regulatorios(documento_coletado_id)
  WHERE documento_coletado_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_documentos_reg_deliberacao
  ON documentos_regulatorios(deliberacao_id)
  WHERE deliberacao_id IS NOT NULL;

-- 3) Acelera a dedup nova (mesma matéria já em revisão): chave semântica + status.
CREATE INDEX IF NOT EXISTS idx_documentos_reg_semkey_status
  ON documentos_regulatorios(semantic_duplicate_key, status)
  WHERE semantic_duplicate_key IS NOT NULL;
