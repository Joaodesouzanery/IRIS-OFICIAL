-- ═══════════════════════════════════════════════════════════════════════════════
-- ANM: o ARQUIVO de atas da ROP vira fonte monitorada (Fase 17, commit E — 04/set/2026)
--
-- ═══ Evidência ═══
-- A página real de atas da ROP tem, no rodapé, um link de arquivo que NINGUÉM segue — está na
-- fixture verbatim baixada do portal: `fixtures/anm/atas-da-rop.html:858`
--   <a href=".../reunioes-da-diretoria-colegiada/atas-da-rop/atas-reunioes-ordinarias">More…</a>
-- A ANM é a única das três agências sem paginação E sem seguir arquivo: profundidade 1 por
-- construção. Tudo que sai do topo da listagem some da coleta para sempre.
--
-- ═══ Por que uma LINHA e não código de paginação ═══
-- Ensinar o crawler a seguir link de "próxima/arquivo" genérico custa orçamento (a coleta é o
-- passo mais caro da rodada, ~25s) e traz risco de laço. O projeto já tem o mecanismo certo:
-- uma FONTE é uma linha. Como linha, o arquivo ganha `ultimo_check` próprio, histórico em
-- `monitoramento_runs` e — de graça — o alarme de queda de volume do mesmo commit.
--
-- Seletor idêntico ao das outras fontes de decisão da ANM (`a:not(.state-published)`), que a
-- Fase 13 mediu contra a página real: âncora de CONTEÚDO não tem classe; âncora de MENU tem
-- `class="state-published"`.
--
-- Idempotente (NOT EXISTS por URL) e forward-only. O código funciona sem ela: sem a linha, a
-- ANM continua com profundidade 1.
-- ═══════════════════════════════════════════════════════════════════════════════

BEGIN;

INSERT INTO monitoramento_sites (agencia_id, nome, url, estrategia, seletor_links, tipo_fonte, auto_enfileirar_pdf, metadata)
SELECT id,
       'ANM - Atas da ROP (arquivo)',
       'https://www.gov.br/anm/pt-br/composicao/diretoria-colegiada/reunioes-da-diretoria-colegiada/atas-da-rop/atas-reunioes-ordinarias',
       'html-static',
       'a:not(.state-published)',
       'documentos_regulatorios',
       TRUE,
       jsonb_build_object('tipos_esperados', ARRAY['ata'], 'fonte_oficial', true, 'origem', 'link More… da listagem de atas')
FROM agencias
WHERE sigla = 'ANM'
  AND NOT EXISTS (
    SELECT 1 FROM monitoramento_sites
     WHERE url = 'https://www.gov.br/anm/pt-br/composicao/diretoria-colegiada/reunioes-da-diretoria-colegiada/atas-da-rop/atas-reunioes-ordinarias'
  );

COMMIT;

NOTIFY pgrst, 'reload schema';
