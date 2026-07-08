-- Dedup ESTRUTURAL de deliberações (Etapa 16). A tabela nunca teve chave única;
-- a dedup era só heurística de código (deliberacao-dedup.ts), e dois caminhos de
-- materialização (ata-mãe vs item/voto avulso) podiam duplicar a mesma decisão.
--
-- Índice único PARCIAL sobre (agencia_id, numero_deliberacao) para números não-nulos:
--   - ata-mãe ("PREFIX-276") e itens ("PREFIX-276-3") têm números distintos → não colidem;
--   - a MESMA deliberação importada 2× tem o mesmo número → a 2ª é barrada (a dedup de
--     código já reusa, mas a constraint garante mesmo se algum caminho escapar);
--   - voto avulso SEM número (numero_deliberacao NULL) fica de fora do índice e segue
--     coberto pela dedup de código (processo + data).
--
-- ⚠️ APLICAR SOMENTE APÓS rodar POST /api/v1/admin/deliberacoes/dedup?dry_run=0 para
-- colapsar duplicatas legadas — senão a criação do índice falha por linhas conflitantes.
-- Idempotente (IF NOT EXISTS).

BEGIN;

CREATE UNIQUE INDEX IF NOT EXISTS idx_deliberacoes_agencia_numero_uniq
  ON public.deliberacoes (agencia_id, numero_deliberacao)
  WHERE numero_deliberacao IS NOT NULL;

NOTIFY pgrst, 'reload schema';

COMMIT;
