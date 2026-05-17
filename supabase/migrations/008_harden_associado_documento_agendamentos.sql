-- Migration 008: endurece acesso e indice de FK da camada operacional dos associados

CREATE INDEX IF NOT EXISTS idx_documento_envios_agendamento
  ON documento_envios(agendamento_id);

DROP POLICY IF EXISTS "allow_all_service_role" ON associado_documento_agendamentos;
DROP POLICY IF EXISTS "allow_all_service_role" ON documento_envios;

CREATE POLICY "service_role_all_associado_documento_agendamentos"
  ON associado_documento_agendamentos
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

CREATE POLICY "service_role_all_documento_envios"
  ON documento_envios
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

REVOKE ALL ON associado_documento_agendamentos FROM anon, authenticated;
REVOKE ALL ON documento_envios FROM anon, authenticated;
