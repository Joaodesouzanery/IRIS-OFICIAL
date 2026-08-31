-- ═══════════════════════════════════════════════════════════════════════════════
-- ANM: a QUINTA fonte (órfã) ganha o seletor — e os 51 itens de menu são arquivados
-- (Fase 15, commit A — 31/ago/2026)
--
-- ═══ Evidência (QA da Fase 14, medido em produção) ═══
-- O bloco `seletor_dos_sites` mostrou 4 fontes ANM com `a:not(.state-published)` e UMA ainda
-- com `a[href]`: "ANM - Reunioes da Diretoria Colegiada" (a página-ÍNDICE). É dela que saem os
-- 51 itens `diretoria` — os títulos provam: "Ir para o Conteúdo 1", "Abrir menu principal de
-- navegação", 25 Gerências Regionais. Menu do gov.br, nenhuma ata.
--
-- Por que escapou de 3 fases: é uma linha ÓRFÃ. `ensureColegiadoSources` a criou quando
-- `colegiado-sources.ts` apontava para a página-índice; o commit 33ca7cf trocou a URL da
-- constante para `atas-da-rop` e o seed casa por URL — nenhum código a atualiza mais. A
-- migration 20260830130000 listou as 4 URLs do seed SQL (20260518160356); a órfã não estava lá.
--
-- ═══ Por que ARQUIVAR os 51, e não deletar ═══
-- A 20260826120000 deletou essa classe uma vez — e o crawl re-inseriu (hash apagado = insert
-- volta a ter sucesso). `ignorado` é terminal para `tipo='diretoria'`: a fila de retry só olha
-- tipos da esteira, e a colisão de hash nunca toca `status`. Um tiro só, nunca um moinho.
--
-- URL EXATA, não LIKE: `/composicao/diretoria-colegiada/<nome>` são páginas de DIRETOR.
-- "ANM - Noticias" fica de fora de propósito (pipeline govbr-news, auto_enfileirar_pdf=FALSE).
-- Idempotente (rodar 2× não muda nada) e forward-only. O código funciona sem ela: sem a
-- migration, a órfã só continua colhendo menu — que o classificador já segura fora da esteira.
-- ═══════════════════════════════════════════════════════════════════════════════

BEGIN;

-- 1) A órfã ganha o mesmo seletor das outras 4.
UPDATE public.monitoramento_sites
   SET seletor_links = 'a:not(.state-published)'
 WHERE url = 'https://www.gov.br/anm/pt-br/composicao/diretoria-colegiada/reunioes-da-diretoria-colegiada'
   AND seletor_links IS DISTINCT FROM 'a:not(.state-published)';

-- 2) Os 51 itens de menu são arquivados com motivo declarado.
DO $$
DECLARE
  v_arquivados INTEGER;
BEGIN
  WITH arquivados AS (
    UPDATE monitoramento_itens mi
       SET status = 'ignorado',
           metadata = COALESCE(mi.metadata, '{}'::jsonb)
                      || jsonb_build_object('enqueue_motivo', 'pagina_institucional')
      FROM monitoramento_sites ms
      JOIN agencias a ON a.id = ms.agencia_id
     WHERE mi.site_id = ms.id
       AND a.sigla = 'ANM'
       AND ms.tipo_fonte <> 'noticias'
       AND mi.tipo = 'diretoria'
       AND mi.status = 'novo'
    RETURNING mi.id
  )
  SELECT COUNT(*) INTO v_arquivados FROM arquivados;

  RAISE NOTICE 'Itens de menu da ANM arquivados como pagina_institucional: %', v_arquivados;
END $$;

COMMIT;

NOTIFY pgrst, 'reload schema';
