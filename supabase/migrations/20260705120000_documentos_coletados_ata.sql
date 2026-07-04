-- Corrige a CHECK de documentos_coletados.tipo: a migration 009 não incluiu
-- 'ata', então TODO insert de ata no staging da coleta ANTT violava a constraint
-- em silêncio (o coletor re-baixava as mesmas atas todos os dias e o insert da
-- linha de erro também falhava). O collector emite 'pauta'|'voto'|'ata'|
-- 'deliberacao'|'outro' (AnttDocumentType) — o CHECK passa a aceitar o conjunto real.
-- Idempotente: DROP IF EXISTS + ADD.

BEGIN;

ALTER TABLE public.documentos_coletados
  DROP CONSTRAINT IF EXISTS documentos_coletados_tipo_check;

ALTER TABLE public.documentos_coletados
  ADD CONSTRAINT documentos_coletados_tipo_check
  CHECK (tipo IN ('pauta','voto','ata','deliberacao','outro'));

NOTIFY pgrst, 'reload schema';

COMMIT;
