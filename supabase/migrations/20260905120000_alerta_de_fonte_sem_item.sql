-- ═══════════════════════════════════════════════════════════════════════════════
-- Alerta de FONTE não tem item (Fase 18, commit 2 — 05/set/2026)
--
-- ═══ A regressão que esta migration conserta ═══
-- A Fase 17 criou o alarme de queda de volume e ele NUNCA gravou uma linha:
-- `monitoramento_alertas.item_id` é `UUID NOT NULL` (005:159) e um alerta de FONTE — "esta
-- listagem parou de trazer itens" — por definição não tem item. O insert falhava com 23502, o
-- supabase-js devolve {error} em vez de lançar, o retorno foi descartado e o catch não via nada.
-- Alarme perfeitamente calibrado, invisível.
--
-- A coluna passa a aceitar NULL. Alerta de ITEM continua preenchendo — nada muda para ele; a FK
-- e o ON DELETE CASCADE seguem valendo para quem tem item.
--
-- Idempotente (rodar 2× não muda nada) e forward-only. O código funciona sem ela: sem a
-- migration, o alarme de fonte continua falhando — só que agora em voz alta, porque o commit
-- desta fase passou a checar e logar o erro.
-- ═══════════════════════════════════════════════════════════════════════════════

BEGIN;

ALTER TABLE monitoramento_alertas ALTER COLUMN item_id DROP NOT NULL;

COMMIT;

NOTIFY pgrst, 'reload schema';
