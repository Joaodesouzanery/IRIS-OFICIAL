-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- Fase 35 · Bloco F — as datas oficiais que o usuario levantou (gov.br/ANTT, Senado, DOU, ANM)
--
-- ⚠️ O QUE ISTO CONSERTA, medido no QA de producao
--
-- O bloco ② do QA nomeou as 5 reunioes que faltam fechar, e TRES das causas sao CADASTRO, nao
-- esteira:
--   · ANTT 295a (24/08/2026) acusa o Alessandro -- o mandato dele esta ABERTO no banco (data_fim
--     nula), entao ele e esperado a votar numa reuniao posterior ao fim real do seu mandato;
--   · ANM 84a/85a/86a acusam o Caio Mario, que esta AFASTADO desde 09/2025;
--   · o substituto do Alessandro (Marcelo Cardoso Fonseca) NAO EXISTE no cadastro, entao a 295a
--     tambem nao tem quem devia ter votado.
--
-- ⚠️ AFASTAMENTO NAO E FIM DE MANDATO, e esta migration nao mente sobre isso
--
-- Fechar o mandato do Caio Mario em 17/09/2025 gravaria coisa falsa: afastamento e suspensao do
-- EXERCICIO, o mandato continua. Por isso a janela vai em `situacao = 'afastado'` +
-- `metadata->>'afastado_desde'`, e o codigo (colegiado-na-data.ts / vote-inference.ts) exclui do
-- colegiado ESPERADO A VOTAR quem estava afastado naquele dia, sem tocar no mandato.
--
-- ⚠️ POR QUE EM `metadata` E NAO EM COLUNA NOVA
--
-- A regra do projeto e "deploy antes da migration e seguro". Se o `select` do motor de voto pedisse
-- uma coluna ainda nao criada, o PostgREST erraria, `getActiveDiretoresForVote` cairia no
-- `if (error) return []` e o motor pararia de produzir voto para TODAS as agencias. `situacao` e
-- `metadata` ja existem, entao o codigo no ar hoje le nulo e ninguem e excluido -- comportamento
-- identico ao atual ate esta migration rodar.
--
-- ⚠️ A DATA DO AFASTAMENTO DO CAIO MARIO E INFERENCIA, E ESTA MARCADA COMO TAL
--
-- A evidencia que o usuario tem e a pauta da 34a REP chamando-o de "Diretor afastado"; 17/09/2025 e a
-- data do fato noticiado, nao de um ato publicado que eu tenha lido. Por isso
-- `metadata->>'afastado_desde_e_inferencia' = 'true'` e `fonte_dado` do mandato NAO vai para
-- 'verificado'. Se aparecer o ato, e uma linha de UPDATE -- e a marca de inferencia sai com ele.
--
-- IDEMPOTENTE (roda 2x sem erro). FORWARD-ONLY. Casa registro por nome com ILIKE, como as seeds
-- anteriores, e so escreve quando o valor difere.
--
-- ⚠️ INLINE, sem funcao auxiliar: a Fase 24b descobriu que a migration que cria `iris_seed_director`
-- a DERRUBA na mesma transacao, e a v2 teve de inlinar tudo.
-- ═══════════════════════════════════════════════════════════════════════════════════════════════

BEGIN;

-- ── 0. ⚠️ A CONSTRAINT PRECISA ACEITAR 'afastado' — SEM ISTO A MIGRATION INTEIRA ABORTA ──────────
--
-- `diretores.situacao` tem `CHECK (situacao IN ('titular','substituto','interino','inativo',
-- 'designado'))`, criado em `20260517195947_expand_directors_schema.sql:52` e nunca relaxado. O passo
-- 5 grava 'afastado' e levaria a:
--     ERROR: 23514: new row for relation "diretores" violates check constraint "diretores_situacao_check"
-- Como tudo está num único `BEGIN;/COMMIT;`, o rollback desfaria TAMBÉM os passos 1-4 — Severino,
-- Alessandro, Marcelo e Roger/Tasso. Nada seria aplicado.
--
-- ⚠️ ESTE ERRO NÃO CHEGOU A ACONTECER: uma auditoria adversarial o achou antes de o arquivo ser
-- aplicado. Mas ele é EXATAMENTE a armadilha que a skill `iris-migrations` já registra por escrito —
-- *"CHECK constraint incompleta: a `documentos_coletados.tipo` não incluía 'ata' → todo insert de ata
-- falhava"* —, e eu a repeti mesmo com a lição escrita no repositório.
--
-- Estender um enum-via-CHECK é seguro por construção: o conjunto novo CONTÉM o antigo, então nenhuma
-- linha existente passa a violar.
ALTER TABLE public.diretores
  DROP CONSTRAINT IF EXISTS diretores_situacao_check;
ALTER TABLE public.diretores
  ADD CONSTRAINT diretores_situacao_check
  CHECK (situacao IN ('titular','substituto','interino','inativo','designado','afastado'));

-- ── 1. ANTT · Severino Medeiros Ramos Neto — 19/11/2025 a 18/02/2026 ──────────────────────────
UPDATE public.mandatos m
   SET data_inicio = DATE '2025-11-19',
       data_fim    = DATE '2026-02-18',
       fonte_dado  = 'verificado',
       metadata    = COALESCE(m.metadata, '{}'::jsonb)
                     || jsonb_build_object('fonte', 'DOU/gov.br ANTT', 'ajustado_em', 'fase35')
  FROM public.diretores d, public.agencias a
 WHERE d.id = m.diretor_id AND a.id = d.agencia_id AND a.sigla = 'ANTT'
   AND d.nome ILIKE '%Severino%Medeiros%'
   AND (m.data_inicio IS DISTINCT FROM DATE '2025-11-19'
     OR m.data_fim    IS DISTINCT FROM DATE '2026-02-18');

-- ── 2. ANTT · Alessandro Baumgartner — 23/02/2026 a 21/08/2026 ────────────────────────────────
-- ⚠️ E o `data_fim` que faz a 295a (24/08/2026) parar de acusa-lo: hoje o mandato esta ABERTO.
UPDATE public.mandatos m
   SET data_inicio = DATE '2026-02-23',
       data_fim    = DATE '2026-08-21',
       fonte_dado  = 'verificado',
       metadata    = COALESCE(m.metadata, '{}'::jsonb)
                     || jsonb_build_object('fonte', 'DOU/gov.br ANTT', 'ajustado_em', 'fase35')
  FROM public.diretores d, public.agencias a
 WHERE d.id = m.diretor_id AND a.id = d.agencia_id AND a.sigla = 'ANTT'
   AND d.nome ILIKE '%Alessandro%Baumgartner%'
   AND (m.data_inicio IS DISTINCT FROM DATE '2026-02-23'
     OR m.data_fim    IS DISTINCT FROM DATE '2026-08-21');

-- ── 3. ANTT · Marcelo Cardoso Fonseca — ENTRA NOVO (Portaria DG 190/2026) ─────────────────────
-- Substituto do Alessandro: 24/08/2026 a 20/02/2027. Sem ele, a 295a nao tem quem devia ter votado.
INSERT INTO public.diretores (nome, nome_variantes, agencia_id, cargo, ativo, needs_review,
                              review_status, situacao, fonte_dado, lgpd_basis, metadata)
SELECT 'Marcelo Cardoso Fonseca',
       ARRAY['Marcelo Fonseca', 'Marcelo C. Fonseca'],
       a.id, 'Diretor', TRUE, FALSE, 'aprovado', 'titular', 'verificado',
       'public_official_function',
       jsonb_build_object('seed', 'fase35_substituto_antt', 'ato', 'Portaria DG 190/2026')
  FROM public.agencias a
 WHERE a.sigla = 'ANTT'
   AND NOT EXISTS (
     SELECT 1 FROM public.diretores d2
      WHERE d2.agencia_id = a.id AND d2.nome ILIKE '%Marcelo%Cardoso%Fonseca%'
   );

INSERT INTO public.mandatos (diretor_id, data_inicio, data_fim, cargo, fonte_dado, ato_nomeacao,
                             review_status, metadata)
SELECT d.id, DATE '2026-08-24', DATE '2027-02-20', 'Diretor', 'verificado',
       'Portaria DG 190/2026', 'aprovado',
       jsonb_build_object('fonte', 'DOU/gov.br ANTT', 'seed', 'fase35_substituto_antt')
  FROM public.diretores d JOIN public.agencias a ON a.id = d.agencia_id
 WHERE a.sigla = 'ANTT' AND d.nome ILIKE '%Marcelo%Cardoso%Fonseca%'
   AND NOT EXISTS (
     SELECT 1 FROM public.mandatos m2
      WHERE m2.diretor_id = d.id AND m2.data_inicio = DATE '2026-08-24'
   );

-- ── 4. ANM · Roger Romão Cabral e Tasso Mendonça Júnior — posse 24/05/2022, fim 04/12/2025 ────
UPDATE public.mandatos m
   SET data_inicio = DATE '2022-05-24',
       data_fim    = DATE '2025-12-04',
       fonte_dado  = 'verificado',
       metadata    = COALESCE(m.metadata, '{}'::jsonb)
                     || jsonb_build_object('fonte', 'DOU/Senado', 'ajustado_em', 'fase35')
  FROM public.diretores d, public.agencias a
 WHERE d.id = m.diretor_id AND a.id = d.agencia_id AND a.sigla = 'ANM'
   AND (d.nome ILIKE '%Roger%Cabral%' OR d.nome ILIKE '%Tasso%Mendon%')
   AND (m.data_inicio IS DISTINCT FROM DATE '2022-05-24'
     OR m.data_fim    IS DISTINCT FROM DATE '2025-12-04');

-- ── 4b. ⚠️ E se Roger ou Tasso NÃO tiverem linha em `mandatos`, o passo 4 grava ZERO ────────────
-- O passo 4 é só UPDATE. A limpeza da ANM (`20260821130000`/`20260821150000`) apagou mandatos
-- fabricados, e o José Fernando chegou a ser removido inteiro — não dá para presumir que a linha
-- existe. Sem isto, o ACEITE do rodapé nunca fecharia para eles e a causa não seria óbvia.
INSERT INTO public.mandatos (diretor_id, data_inicio, data_fim, cargo, fonte_dado, review_status, metadata)
SELECT d.id, DATE '2022-05-24', DATE '2025-12-04', 'Diretor', 'verificado', 'aprovado',
       jsonb_build_object('fonte', 'DOU/Senado', 'seed', 'fase35_mandato_ausente')
  FROM public.diretores d JOIN public.agencias a ON a.id = d.agencia_id
 WHERE a.sigla = 'ANM'
   AND (d.nome ILIKE '%Roger%Cabral%' OR d.nome ILIKE '%Tasso%Mendon%')
   AND NOT EXISTS (SELECT 1 FROM public.mandatos m2 WHERE m2.diretor_id = d.id);

-- ── 5. ANM · Caio Mário Trivellato Seabra Filho — AFASTADO desde 17/09/2025 ───────────────────
-- ⚠️ O mandato NAO e tocado. Afastamento e suspensao do exercicio; gravar fim de mandato aqui seria
-- afirmar coisa que o ato nao diz. A janela vai no diretor, e e o colegiado ESPERADO A VOTAR que o
-- exclui — ver `afastadoNaData` em src/lib/server/colegiado-na-data.ts.
--
-- ⚠️ E a DATA e INFERENCIA: a evidencia e a pauta da 34a REP chamando-o "Diretor afastado". Por isso
-- a marca `afastado_desde_e_inferencia`, para nenhum relatorio futuro apresentar 17/09/2025 como se
-- tivesse saido de um ato publicado.
UPDATE public.diretores d
   SET situacao = 'afastado',
       metadata = COALESCE(d.metadata, '{}'::jsonb)
                  || jsonb_build_object(
                       'afastado_desde', '2025-09-17',
                       'afastado_desde_e_inferencia', 'true',
                       'afastado_evidencia', 'pauta da 34a REP da ANM trata-o como "Diretor afastado"',
                       'ajustado_em', 'fase35')
  FROM public.agencias a
 WHERE a.id = d.agencia_id AND a.sigla = 'ANM'
   AND d.nome ILIKE '%Caio%Trivellato%'
   AND (d.situacao IS DISTINCT FROM 'afastado'
     OR COALESCE(d.metadata ->> 'afastado_desde', '') <> '2025-09-17');

NOTIFY pgrst, 'reload schema';

COMMIT;

-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- CONFERENCIA — rodar DEPOIS, fora da transacao.
--
-- ① As cinco linhas, com o gabarito ao lado.
--
-- SELECT a.sigla, d.nome, d.situacao, d.metadata ->> 'afastado_desde' AS afastado_desde,
--        m.data_inicio, m.data_fim, m.fonte_dado
--   FROM public.diretores d
--   JOIN public.agencias a ON a.id = d.agencia_id
--   LEFT JOIN public.mandatos m ON m.diretor_id = d.id
--  WHERE (a.sigla = 'ANTT' AND (d.nome ILIKE '%Severino%' OR d.nome ILIKE '%Alessandro%'
--                            OR d.nome ILIKE '%Marcelo%Cardoso%'))
--     OR (a.sigla = 'ANM'  AND (d.nome ILIKE '%Roger%' OR d.nome ILIKE '%Tasso%'
--                            OR d.nome ILIKE '%Caio%'))
--  ORDER BY a.sigla, d.nome, m.data_inicio;
--
-- ACEITE:
--   Severino  2025-11-19 → 2026-02-18
--   Alessandro 2026-02-23 → 2026-08-21   (era data_fim NULA: e isso que acusava a 295a)
--   Marcelo Cardoso Fonseca 2026-08-24 → 2027-02-20, UMA linha (duas = a guarda NOT EXISTS falhou)
--   Roger e Tasso 2022-05-24 → 2025-12-04
--   Caio Mario  situacao='afastado', afastado_desde='2025-09-17', MANDATO INTACTO
--
-- ② ⚠️ QUANTAS linhas de mandato cada um tem. Os UPDATEs dos passos 1-4 alcançam TODAS as linhas do
--    diretor; se alguém tiver duas, as duas ficam com a mesma janela — e o colegiado esperado não
--    muda, mas o cadastro fica confuso. Duas linhas para o mesmo nome pedem decisão sua.
--
-- SELECT a.sigla, d.nome, COUNT(m.id) AS linhas_de_mandato,
--        ARRAY_AGG(m.fonte_dado ORDER BY m.data_inicio) AS fontes,
--        ARRAY_AGG(m.data_inicio ORDER BY m.data_inicio) AS inicios
--   FROM public.diretores d
--   JOIN public.agencias a ON a.id = d.agencia_id
--   LEFT JOIN public.mandatos m ON m.diretor_id = d.id
--  WHERE (a.sigla = 'ANTT' AND (d.nome ILIKE '%Severino%' OR d.nome ILIKE '%Alessandro%'
--                            OR d.nome ILIKE '%Marcelo%Cardoso%'))
--     OR (a.sigla = 'ANM'  AND (d.nome ILIKE '%Roger%' OR d.nome ILIKE '%Tasso%' OR d.nome ILIKE '%Caio%'))
--  GROUP BY a.sigla, d.nome ORDER BY a.sigla, d.nome;
--
-- ⚠️ E ATENÇÃO A UM EFEITO DECLARADO: o mandato do Severino hoje é `fonte_dado='automatico'` (posse
--    placeholder 2026-01-01, registrada em docs/PENDENCIAS.md). O passo 1 o promove a 'verificado'
--    com as datas oficiais — e `getActiveDiretoresForVote` IGNORA mandato 'automatico'. Ou seja: ele
--    passa a CONTAR no colegiado esperado da ANTT entre 19/11/2025 e 18/02/2026, e a cobertura
--    publicada MUDA por causa disto. É o que as suas datas do DOU mandam fazer; está escrito aqui
--    para o número não mudar sem explicação.
--
-- ③ E o efeito no placar, que e o motivo de tudo isto: depois de "Rodar tudo", a 295a da ANTT nao
--    pode mais acusar o Alessandro, e as 84a/85a/86a da ANM nao podem mais acusar o Caio Mario.
--    O que sobrar ali e trabalho de esteira de verdade (o voto do Jose Fernando e do Luiz).
-- ═══════════════════════════════════════════════════════════════════════════════════════════════
