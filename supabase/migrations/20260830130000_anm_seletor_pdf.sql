-- ═══════════════════════════════════════════════════════════════════════════════
-- ANM: o seletor deixa de engolir o MENU do gov.br (Fase 13, passo 5 — 30/ago/2026)
--
-- A investigação ao vivo provou: a fonte TEM 2026 (87ª ROP publicada em 21/08/2026), mas os
-- sites da ANM usavam `seletor_links = 'a[href]'`, que pega TODAS as âncoras — inclusive as
-- ~760 do menu do template gov.br. Foi por aí que manuais de sistema viraram "deliberação"
-- (limpos pela migration 20260830120000) e que a ANM acumulou 110 itens `documento`.
--
-- A assinatura medida na página real: âncora de CONTEÚDO não tem classe e o href termina em
-- .pdf; âncora de MENU tem class="state-published" e href de página. O seletor novo
-- `a:not(.state-published)` (suporte adicionado em matchesLinkSelector na mesma fase) deixa entrar só
-- documentos. Idempotente: UPDATE por URL exata; rodar 2× não muda nada.
-- ═══════════════════════════════════════════════════════════════════════════════

BEGIN;

UPDATE public.monitoramento_sites
   SET seletor_links = 'a:not(.state-published)'
 WHERE url IN (
   'https://www.gov.br/anm/pt-br/composicao/diretoria-colegiada/pautas',
   'https://www.gov.br/anm/pt-br/composicao/diretoria-colegiada/atas',
   'https://www.gov.br/anm/pt-br/composicao/diretoria-colegiada/reunioes-da-diretoria-colegiada/pautas-da-rop',
   'https://www.gov.br/anm/pt-br/composicao/diretoria-colegiada/reunioes-da-diretoria-colegiada/atas-da-rop'
 )
   AND seletor_links IS DISTINCT FROM 'a:not(.state-published)';

COMMIT;

NOTIFY pgrst, 'reload schema';
