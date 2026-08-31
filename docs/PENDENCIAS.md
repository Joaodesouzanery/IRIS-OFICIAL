# PENDÊNCIAS E OPERAÇÃO — IRIS-Regulação

Ações manuais recorrentes, datas sensíveis e itens adiados por decisão de produto.
Atualize este arquivo quando resolver ou adiar algo (última revisão: Etapa 22, 22/jul/2026).

## 🔴 FASE 14 (31/ago/2026) — o QA e o acesso que faltou

**O QA está pronto em `docs/qa-fase14.sql`** — cole no SQL Editor e devolva o JSON. Ele mede as
7 frentes: deliberações por agência×ano (427→?), ANM (seletor aplicado? ata nova? títulos dos 51
`diretoria`), finais sem voto diagnosticadas (inclui `inferivel_pela_decisao` — o que o próximo
"Rodar tudo" fecha via materializar), votos órfãos, `queued`×job, mojibake e coleta por site.

**Sobre o MCP (medido nesta sessão, 31/08):**
- O conector Supabase do claude.ai aponta para o projeto de OBRAS (listei as tabelas — RDO,
  frotas): **nunca usar para o IRIS**.
- O `.mcp.json` do repo tem um servidor `supabase` (ref `hjevhwqntqsffqmjocra`) que exige OAuth —
  numa **sessão interativa**, rode `/mcp` e autentique-o; confirme antes se esse ref é mesmo o
  projeto IRIS (Dashboard → Settings → General → Reference ID).
- Se o ref não for o IRIS (ou preferir sem OAuth): `claude mcp add supabase-iris --scope project
  -e SUPABASE_ACCESS_TOKEN=<token> -- npx -y @supabase/mcp-server-supabase@latest --read-only
  --project-ref=<ref do IRIS>` — e **abra uma sessão nova** (MCP adicionado não carrega na
  sessão corrente).

## 🔴 FASE 13 (30/ago/2026) — 2 migrations para aplicar, e o MCP que automatiza tudo

**Migrations no SQL Editor (nesta ordem; idempotentes):**
1. `20260830120000_limpeza_falsos_positivos.sql` — remove as falsas "deliberações" da ANM
   (manuais de site) e os 4 diretores-lixo da ARTESP com seus 5 votos. O `RAISE NOTICE` mostra
   as contagens.
2. `20260830130000_anm_seletor_pdf.sql` — troca o seletor dos 4 sites da ANM para
   `a:not(.state-published)`: corta as ~760 âncoras de menu do gov.br que poluíam a coleta.
   **Depois dela, rodar a coleta/"Rodar tudo"**: a 87ª ROP (21/08/2026) e as demais atas de 2026
   da ANM entram.

**Configuração única que elimina o colar-SQL (sua pergunta "o Claude Code traz tudo?"):**
```bash
claude mcp add supabase-iris --scope project \
  -e SUPABASE_ACCESS_TOKEN=<token de supabase.com/dashboard/account/tokens> \
  -- npx -y @supabase/mcp-server-supabase@latest --read-only --project-ref=<ref do projeto IRIS>
```
Feito isso, `/auditoria-producao` (skill nova) roda a auditoria e entrega o relatório sozinha.
O conector Supabase do claude.ai não serve (amarrado a outro projeto); `--read-only` é inegociável.

**Fechados nesta fase:** guard C21 (manual ≠ deliberação) · `fonteNominaVotos` (fonte que não
nomina não gera voto nominal/candidato/pessoa) · `isStrictPersonName` endurecido · "Ausência
Justificada:" extraída (o caso Raquel/férias — divergentes da ARTESP eram legítimas) · seletor
`:not`/`$=` no monitoramento.

## 🔴 FASE 12 (30/ago/2026) — a AUDITORIA de votos: o que rodar e o que ficou registrado

**Ação sua (2 passos), e é ela que fecha a investigação dos votos desiguais:**

1. Cole **`docs/auditoria-votos-cobertura.sql`** no SQL Editor e me mande o JSON. Ele mede:
   votos por diretor POR AGÊNCIA com janela de mandato e oportunidades (bloco ①), votos × roster
   deliberação a deliberação com as 10 piores divergentes e QUEM FALTA (②/②b), interessados e
   empresas (③), cobertura 2026 lado-banco (④), 3 amostras por agência com a URL pública do PDF
   (⑤) e as sondas de causa (⑥).
2. Logado, abra `/api/v1/admin/cobertura-ao-vivo` e mande junto — é o lado-FONTE da cobertura.

> Contexto que a investigação já estabeleceu: 4 dos 5 nomes do print "Votos por Diretor" eram da
> ARTESP (o widget misturava agências — corrigido: a sigla agora aparece); dois bugs reais de
> perda silenciosa foram consertados (a inferência chamada sem o cadastro de diretores, e o
> plural "INTERESSADOS:" na ANTT); e a desigualdade RESIDUAL dentro da ANTT tem um suspeito
> estrutural — o voto individual dá +1 só ao relator (bloco ⑥/relatoria decide).

### Adiado por decisão, aguardando os números da auditoria
- **Backfill de voto PARCIAL**: `materializar-faltantes` só repara deliberação com ZERO voto —
  3-de-5 fica assim para sempre. Completar o roster às cegas FABRICARIA voto; o bloco ② diz o
  tamanho do passivo antes de decidir.
- **Múltiplos interessados**: só o primeiro é guardado (`firstMatch` + coluna escalar em
  `deliberacoes.interessado`). Mudança de schema; decisão de produto.
- **Aliases ANTT hardcoded** (`antt-manual-parser.ts`): presença detectada só pelos 6 diretores
  atuais — troca de diretoria os tornaria invisíveis. A sonda ⑥c mede se já há alguém de fora.
- **Alegação DERRUBADA (não refazer):** `dedupeItems` da ANTT colidindo `"3.1|null"` — os
  extratores sempre preenchem `processo`; a chave nunca tem processo nulo nesses sítios.

## 🔴 FASE 10-11 (28/ago/2026) — como medir o tempo da esteira, sem rota nem página

**Tudo pelo SQL Editor que você já usa.** Cole isto para ver as últimas execuções:

```sql
SELECT status, rodadas, motivo_parada,
       ROUND(EXTRACT(EPOCH FROM (atualizado_em - iniciado_em))::numeric, 1) AS segundos_total,
       ROUND((EXTRACT(EPOCH FROM (atualizado_em - iniciado_em)) / NULLIF(rodadas,0))::numeric, 1)
         AS seg_por_rodada,
       passos_ok, passos_erro, contadores
  FROM esteira_runs
 ORDER BY iniciado_em DESC
 LIMIT 5;
```

⚠️ **O que essa consulta prova e o que NÃO prova.** Se `seg_por_rodada` der ~54s, isso prova que a
rodada COMPLETA dentro do orçamento. **Não** prova qual é o teto de execução da conta — para isso
seria preciso uma rodada que TENTE ultrapassar.

⚠️ **Por que o teto de tempo não sobe além de 70s hoje.** O cliente aborta em 90s
(`REQUEST_TIMEOUT_MS` em `src/lib/api.ts`), mas o abort **não mata a função** no Vercel: ela segue
rodando e o laço dispara a rodada seguinte sobre a MESMA run — duas invocações concorrentes nas
mesmas linhas. O teto seguro é ~86s (90 menos a folga). Para passar disso, subir
`REQUEST_TIMEOUT_MS` **antes** de `HOBBY_BUDGET_MS`, nessa ordem.

> Uma rota `/api/v1/admin/diagnostico/teto-tempo` foi criada e **removida** na Fase 11: ela só
> gerava trabalho manual para medir o que `esteira_runs` já responde.

### Medição do bloco 1 (depois de rodar "Rodar tudo")

Comparar com a linha de base de 26/08: **26 rodadas · 0 PDF extraído · 0 métrica · 62 presos**.

1. Quantas rodadas até terminar.
2. Se o banner mostra **PDFs extraídos > 0** e **presos religados > 0**.
3. `docs/diagnostico-producao.sql`: os **62 `queued`** têm de ir a zero.

Nenhum commit do bloco 1 acrescenta trabalho à fila, então o número é comparável.

### O que ficou para o bloco 2 (por decisão, medir antes)

- **513 itens em `em_revisao`** — estado absorvente: nada no repositório os tira de lá. A
  reconciliação precisa gravar motivo e contar reincidência, senão troca poço estático por ciclo.
- **51 atas da ANM em `diretoria`** e 83 em `noticia` — é a **terceira** aparição do mesmo bug.
  Causa provável achada: `parseGovBrNewsHtml` classifica por `classifyGovBrType`, que **só sabe
  devolver `noticia`/`politica_publica`/`consulta_publica`** — nunca `ata`, nunca `deliberacao`.
  A Fase 7 reordenou o OUTRO classificador (`classifyLinkType`); este ficou intacto.
  **Sem migration cega:** rodar antes o SQL abaixo e escrever o teste com as URLs reais.

```sql
SELECT tipo, status, titulo, url_item
  FROM monitoramento_itens
 WHERE tipo IN ('diretoria','noticia') AND status = 'novo'
   AND agencia_id = (SELECT id FROM agencias WHERE sigla = 'ANM')
 ORDER BY tipo, url_item;
```

- **A tela**: mostrar os contadores que `/pipeline/status` já devolve, o botão único que não
  segura a aba, e os botões separados por etapa.

## ⚠️ Plano Vercel GRÁTIS (Hobby): crons NÃO rodam de forma autônoma
No plano grátis a Vercel agenda no máximo ~2 crons/dia e limita funções a 60s. A Etapa 21
ENXUGOU o `vercel.json` para **2 crons** (`noticias/cron` 11:00 e `upload/auto-confirm` 12:30)
e a esteira é operada **manualmente** por botões:
- **Notícias** (tela Notícias): "Coletar Notícias" (cobre as 12) + "Recuperar imagens"
  (re-resolve a foto de itens já coletados — a coleta normal pula URLs conhecidas).
- **Votos** (tela Votos dos Diretores): **"Rodar tudo"** encadeia Verificar novos → Processar
  atas/votos → Auto-confirmar (loop) → Recalcular matches (auto-aprova + mescla duplicatas).
  E **"Gerar relatório"** abre o relatório imprimível por diretor.

**Ao migrar para o PRO, restaurar no `vercel.json` os 8 crons** (e o fan-out do `noticias/cron`
da Etapa 20): monitoramento/check 10:00 · noticias/cron 11:00 · antt/2026/collect 10:30 ·
upload/process 12:00 · upload/auto-confirm 12:30 · mandatos/recalcular 08:00 ·
qualidade derivadas seg 09:00 · votos-diretores/backfill dom 09:00. Aí a esteira volta a
ser zero-toque.

## Fluxo de operação semanal sugerido (manual no plano grátis)

**Desde ago/2026 a esteira é ZERO-TOQUE**: "Rodar tudo" chama a pipeline server-side
(`/api/v1/pipeline/run`) que faz TUDO — coleta → reclassificação → extração → aprovação
automática em camadas (dedup em 4 barreiras; ilegível não vira métrica; duplicata exata
arquivada com link; semântica fundida idempotente; diretor novo <0.6+nome estrito auto-criado)
→ dedup final. Não há mais fila de aprovação manual; o painel "Exceções" é informativo.

1. Abrir **Dashboard → Deliberações → Votos dos Diretores** e clicar **"Rodar tudo"** (faz
   coleta→processa→auto-confirma em loop→recalcula/mescla numa tacada).
2. Card **"Revisão humana"**: o que sobrar aparece aqui com o motivo (sem direção do voto /
   confiança baixa / relator ambíguo) — clicar "Revisar →" e ajustar no Upload (exceção).
3. Card **"Cobertura ao vivo"** (Etapa 22): clicar **"Conferir contra os sites"** — é a
   auditoria que enumera AO VIVO as reuniões que ANTT/ARTESP/ANM publicam e mostra o que
   FALTA no banco (por nº de reunião). É a prova de "temos TUDO?" e o diagnóstico de coleta:
   se aparecer "faltam X", rodar "Rodar tudo" de novo ou investigar a fonte da agência.
4. Conferir "Métricas por diretor" (lidos vs inferidos) e "Completude 2026"; **"Gerar
   relatório"** para o PDF imprimível por diretor.
5. Na tela **Notícias**: "Coletar Notícias" + "Recuperar imagens" se houver cards sem foto.

## Ações manuais recorrentes

| Ação | Quando | Onde |
|---|---|---|
| Reprocessar votos ignorados (dry-run → aplicar) | Após deploy que amplia o parser; legado | Votos dos Diretores → card Revisão humana |
| Recalcular matches (backfill retroativo) | Após cadastrar/corrigir diretores; após ingestão grande | Votos dos Diretores |
| Mesclar deliberações duplicadas | Quando o painel de duplicatas apontar pares | Votos dos Diretores / rota admin dedup |
| Aplicar migrations | A cada nova migration em `supabase/migrations/` | Supabase SQL Editor (manual, pelo usuário) |
| Revisar documentos `review_pending` | Quando o card "Revisão humana" > 0 | Dashboard → Upload |
| Re-coletar notícias (imagens) | Após deploy que melhora o scraper de imagem | POST `/api/v1/noticias/coletar` (ou aguardar cron) — re-resolve imagem/limpa resumo lixo |
| **Conferir que prod NÃO está em modo demo** | Após qualquer mudança de env na Vercel; se "o sistema não pedir login" | Abrir `/api/v1/system/status` → tem de vir `is_demo:false` / `persistence:"supabase"`. `is_demo:true` = falta `NEXT_PUBLIC_SUPABASE_URL` ou `SUPABASE_SERVICE_ROLE_KEY` na Vercel → app roda SEM login. Setar env + redeploy. |
| **Regerar Relatórios do Observatório após lote grande** | Após aprovar muitos docs em lote (os relatórios salvos são SNAPSHOTS; janela de ~200 delibs por período) | Documentos de Associados → gerar de novo o relatório do período |
| **Backfill de `area_regulatoria` histórica** | Uma vez (deliberações confirmadas ANTES de ago/2026 ficaram com a coluna NULL — o confirm só grava daqui em diante) | Adiado: migration de backfill (classificar pelo texto) quando fizer falta nos filtros |

## ⚠️ Migration PENDENTE (ago/2026, limpeza de agências)
`supabase/migrations/20260821120000_limpeza_agencias_nao_colegiadas.sql` — remove os artefatos
de ANS/ANA (deliberações/votos/mandatos/diretores criados por misclassificação de sigla) e
rejeita os ~18 "diretores" fabricados da ANM (signatários de ata sem voto e sem mandato
verificado). Aplicar no SQL Editor DEPOIS do deploy do código (o código fecha as portas; a
migration limpa o legado). Os SELECTs de conferência estão no fim do arquivo.

## ⚠️ Migration PENDENTE (ago/2026, otimizações)
`supabase/migrations/20260818120000_idx_deliberacoes_agencia_data.sql` — índice composto
`deliberacoes(agencia_id, data_reuniao DESC)` + índice de `documentos_regulatorios(status)`.
Aplicar no SQL Editor (idempotente; o código funciona sem ela, só fica mais lento).

## ⚠️ Migration PENDENTE (ago/2026, limpeza RESIDUAL da ANM)
`supabase/migrations/20260821130000_limpeza_residual_anm.sql` — allow-list explícita do
colegiado ANM; rejeita os ~12 "diretores" fabricados que sobreviveram (tinham votos que a
própria esteira inventou) e APAGA esses votos/mandatos. ⚠️ Rodar antes o SQL de diagnóstico
(chat de 21/08) e conferir se algum nome fora da lista é diretor real; aplicar DEPOIS do
deploy (o código fecha as portas: filtro review_status em toda carga de cadastro, mandato
'automatico' fora do roster, nome rejeitado não renasce).

## Adiados na rodada de otimização (ago/2026)
- ~~Iniciais ANTT dinâmicas~~ FEITO (21/08): derivadas do cadastro (buildAnttDirectorInitials),
  hardcode curado vence em conflito — troca de diretoria não exige mais deploy.
- **Refactor completude-2026** — votos órfãos por count dedicado (hoje baixa o acervo inteiro).
- **Unificação de marca newsletter×report** — cores/fontes IRIS duplicadas em
  `newsletter-document.ts` e `report-theme.ts`; extrair módulo único quando mexer de novo nos dois.

## Usuário VIEWER (somente visualização) — como adicionar (ago/2026)
1. Supabase → Authentication → Users → **Add user** (e-mail + senha; "Auto confirm").
2. Pronto: qualquer usuário que NÃO esteja em `IRIS_OWNER_EMAIL`/`ADMIN_EMAILS` (nem em
   `admin_users`) entra como **viewer** — vê todos os dashboards, não altera nada (escritas
   barradas nos guards; UI esconde as ações e mostra o selo "Visualização").
3. ⚠️ PRÉ-REQUISITO: **signup público DESLIGADO** no Supabase (Authentication → Sign In /
   Providers → desmarcar "Allow new users to sign up") — senão qualquer pessoa cria conta e
   vira viewer. Conferir 1x.

## Backlog que depende do usuário (auditoria de otimizações, ago/2026)
O código da esteira está sem TODO/FIXME pendente; estes itens precisam de ação/informação do usuário:
1. **OCR dos escaneados** — código PRONTO (auto-OCR no reprocesso + botão na tela Upload + **chunking
   de 3 páginas com pdf-lib, ago/2026**: o limite de 3 págs/PDF do tier free deixou de importar — PDFs
   maiores são divididos e enviados em blocos). Falta só criar **`OCR_SPACE_API_KEY`** na Vercel
   (ocr.space; grátis, sem cartão). Depois: selecionar os escaneados na fila → Reprocessar. PDFs >5 MB
   avisam explicitamente. Nota: PDFs SEI (ANM/ANTT/ARTESP) têm camada de texto — OCR é exceção.
2. **Backfill de `area_regulatoria`** — rodar `SELECT count(*) FROM deliberacoes WHERE area_regulatoria
   IS NULL` no SQL Editor; se for relevante, pedir a rota de backfill (molde do empresas/backfill).
3. **View `reunioes_consolidadas` órfã** — nada no código a lê; se nada externo consome, gerar migration
   `DROP VIEW IF EXISTS` (1 linha).
4. **Vercel Pro** — restaura os 8 crons (coleta/derivadas zero-toque); hoje é clique manual por decisão.
5. **Certificação ampliada** — enviar PDFs reais de: (a) voto ANTT com direção conhecida, (b) ata com
   divergência nomeada, (c) deliberação Indeferida → entram no gabarito do golden-set. (Opcional:
   verificador Haiku para o resíduo da revisão — custo por uso, precisa ANTHROPIC_API_KEY.)
6. **Troca de diretoria da ANTT** — quando acontecer, adicionar as novas iniciais em
   `ANTT_DIRECTOR_INITIALS` (antt-manual-parser.ts); a extração agora AVISA quando encontra iniciais
   fora da tabela.
| **Recomputar derivadas da fonte única** (Hobby não tem cron p/ isso) | Após ingestão grande de votos; semanalmente | `empresas/backfill` (preenche `empresa_id` → visões por empresa), `qualidade-regulatoria/coletas/derivadas/run` (evidências de qualidade a partir de votos), `votos/recalcular-divergencia` e `votos/reprocessar-abstencoes`. Sem isso, Qualidade/Empresas ficam estagnadas em modo real. |

## Migrations pendentes de aplicação manual (SQL Editor)

- **`20260709120000_mandatos_rede_votos.sql`** (Etapa 19) — cria mandato para diretores que
  têm voto mas não têm mandato (religa a inferência). Idempotente e forward-only.
- **`20260715120000_auditoria2_rls_arquivo_e_indices.sql`** (Auditoria 2ª rodada) — ⚠️ **SEC-1
  ALTO**: habilita RLS em `qualidade_regulatoria_avaliacoes_arquivo` (nasceu de `LIKE` sem RLS →
  legível pela chave anon) + índices de performance (trgm da busca de notícias, sort, dedup).
  **Após aplicar, rodar `get_advisors`** para confirmar que não sobrou tabela sem RLS.
- **`20260718120000_auditoria4_rls_reassert_all.sql`** (Auditoria 4ª rodada) — 🔴 **P0/LGPD**:
  RE-ASSERT de RLS `TO service_role` + `REVOKE anon` na **lista completa da 010**. A 010 endureceu
  24 tabelas num único bloco `DO $$` sem guarda `IF EXISTS`/`ENABLE RLS`/`REVOKE` → se qualquer
  tabela não existia ao rodar, o bloco INTEIRO abortou e NENHUMA foi endurecida (o `get_advisors`
  de jul re-sinalizou `antt_*`, que estão na lista da 010 → indício de que a 010 não aplicou).
  Idempotente/guardada por tabela: no-op onde já correto, fecha onde a 010 não pegou. Cobre a
  esteira (`votos`/`diretores`/`mandatos`/`deliberacoes`) e os dados de associados (LGPD).
  **Após aplicar, rodar `get_advisors`** (deve zerar `rls_policy_always_true`) + smoke com a anon
  key em `/rest/v1/votos` (deve vir `[]`). **Habilitar Leaked Password Protection no painel.**
- **`20260720120000_news_runs_status_empty.sql`** (QA notícias jul/2026, PR-G) — 🔴 **keystone da
  honestidade do coletor**: alarga o CHECK de `regulatory_news_collection_runs.status` para aceitar
  `'empty'`. A tabela nasceu com `CHECK (status IN ('ok','error'))`, mas o coletor grava `'empty'`
  (fonte respondeu sem item novo) num insert EM LOTE → qualquer rodada com ≥1 fonte vazia viola o
  CHECK e o insert INTEIRO falha (só `console.warn`), deixando o histórico ~vazio → o health nunca
  vê erro real. Idempotente, varre `pg_constraint` (não confia no nome). **Sem ela, o aviso honesto
  de notícias fica cego a falhas** (não distingue "coletor quebrado" de "fonte quieta").
- **`20260724120000_harden_security_definer_views.sql`** (Auditoria 5ª rodada, segurança) — 🟡
  **fecha leitura anon de 2 views**: `reunioes_consolidadas` e `coleta_execucoes` foram criadas sem
  `security_invoker` → rodam com privilégio do dono e ignoram a RLS das tabelas-base, podendo ser
  lidas por `anon` via `/rest/v1` (só contagens/status, sem dado pessoal). Aplica `security_invoker=
  true` + `REVOKE ... FROM anon, authenticated`, guardado por existência. Impacto no app = ZERO (o
  servidor usa service_role). **Aplicar SÓ se `get_advisors` (security) listar `security_definer_view`
  para elas**; depois rodar `get_advisors` de novo (deve zerar) + smoke anon em
  `/rest/v1/reunioes_consolidadas` (deve vir `[]`). **Habilitar Leaked Password Protection no painel.**

## Datas sensíveis

- **30/11/2026 — mandatos interinos ANM vencem**: atualizar o seed de diretores
  (`diretores` / mandatos) quando houver nomeação definitiva; sem isso, votos novos dos
  substitutos viram candidatos em revisão.
- **04/07–25/10/2026 — DEFESO ELEITORAL (notícias)**: os órgãos gov.br reorganizaram as
  seções de notícias (ANTT congelou `ultimas-noticias` — virou login-walled — e publica em
  `noticias-defeso-eleitoral`; ANEEL publica em AMBAS). O coletor tenta as listagens irmãs
  automaticamente (Etapa 22). **Após 25/10/2026**: conferir se as seções voltaram ao normal
  e se as URLs configuradas seguem válidas (o aviso "fontes sem notícia nova" na tela
  Notícias acusa qualquer nova mudança).
  - **Probe ao vivo 20/07/2026 (QA notícias):** **ANAC** publica normalmente e tem listagem
    server-side OK (`/anac/pt-br/noticias`) — staleness era só rodízio/orçamento (corrigido no
    PR-J). **ANA/ANCINE/ANS** têm as seções em **Volto/React** (0 âncoras estáticas) ou
    login-walled no defeso e a **API Plone dá 404** → coleta estática zera; dependem de
    **headless** (instável no Vercel). **ARTESP** legado exige headless; o fallback CCM
    (`ccm.artesp.sp.gov.br/noticias/todas`) apareceu degradado. O aviso honesto (PR-G/H/I)
    agora rotula esses casos corretamente ("coletor não traz nada / listagem indisponível") em
    vez de fingir "sem notícia". **Follow-up possível:** headless confiável no Vercel OU loop
    do botão "Coletar Notícias" (padrão "Rodar tudo") para drenar todas as fontes numa sessão;
    reavaliar após o defeso (25/10), quando as seções canônicas devem voltar.

## Adiados por decisão (reavaliar quando fizer sentido)

- **Alerta externo (e-mail/Slack) de falha da esteira** — decisão "nenhum por enquanto";
  hoje o sinal é o painel Saúde dos Dados (rota admin) + card de revisão na tela de votos.
- **`OCR_SPACE_API_KEY`** — OCR externo para PDFs escaneados (Etapa 10-B) fica inativo sem
  a chave; PDFs sem camada de texto caem em revisão com aviso. Configurar a env na Vercel
  quando quiser habilitar.

### Otimizações adiadas — auditoria de segurança/performance (jul/2026)
Estas ficaram fora do lote de correção por exigirem **migration** ou **refactor arriscado na
fonte única** (que precisa verificação com dados reais antes de subir). Reavaliar num PR dedicado:
- **`dashboard/overview` agrega a tabela inteira em JS** ([route.ts](../src/app/api/v1/dashboard/overview/route.ts)):
  o `select` traz `raw_extraction` (JSON grande) de TODAS as deliberações porque o predicado
  `isFinalDecisionRecord` lê 3 sub-chaves dele. Ganho real = promover essas chaves a colunas
  (migration) ou selecionar sub-chaves JSON via PostgREST e adaptar o predicado. Mesmo padrão em
  `admin/completude-2026`, `admin/saude-dados`, `admin/cobertura-documentos` (40k-80k linhas).
- **Lista de `noticias`: `count:"exact"` + `ILIKE` em `conteudo`** força seq-scan por request →
  índice `pg_trgm`/`tsvector` (migration) + `count:"planned"`.
- **Dedup 1-a-1 no coletor ANTT** (`antt-2026-collector.ts` `findExistingDocument*`): custo é
  dominado pela rede (SELECT indexado é barato); pré-carregar Set exige refactor do loop de
  ingestão — só com verificação contra dados reais (risco de duplicar na fonte única).
- **Charts sem `next/dynamic`** (recharts/d3 em `src/components/charts/*`): ganho só de bundle;
  code-splitting muda o render dos gráficos no dashboard — fazer com verificação visual do front.
- **SSRF por redirect no stack de coleta** (sistêmico, pré-existente): `assertPublicUrl`/`isPublicUrl`
  validam só a **primeira** URL, e os `fetch` de coleta usam `redirect:"follow"` (default) — um host
  público que responde 302→`169.254.169.254`/RFC1918 seria seguido. O `probeImageUrl` já foi
  endurecido (`redirect:"manual"`); falta um **wrapper de fetch com redirect validado por hop** para
  `resilient-fetch.ts` e `fetchGovbrApiLinks`. Baixo risco no Vercel (sem IMDS clássico + hosts
  admin-configurados), mas fechar o vetor por completo exige esse wrapper. SSRF é cega (só status/timing).

### Auditoria 2ª rodada (jul/2026) — status e itens deferidos
**Já corrigido nesta rodada** (commits): proxy de imagem SSRF+bytes, bypass `?dry_run=1`, zip-bomb,
`fetchGovbrApiLinks` (guard+redirect), cap dos probes de lead-image (regressão), lista de notícias sem
`conteudo`, `mandatos/stats` paralelo, migration RLS+índices (inclui o trgm que substitui o item
"count/ILIKE"), **sub-select de `raw_extraction` (PERF-1, 8 rotas, predicado dual-shape)**, **time-budget
no `recompute` (PERF-5)**, **PATCH re-deriva `is_divergente` (SEC-5)**, **batch das abstenções (PERF-8)**.
**Deferido — esteira/robustez** (risco/complexidade; verificar com dados reais):
- **PERF-10** `auto-confirm`: `ineligibleIds` cresce em `.not("id","in",(...))` (~1500 UUIDs → URL grande).
  Se estourar, retorna 500 e o loop para SEM corromper (cada rodada já commitou) → é reliability, não
  integridade. Fix robusto = keyset pagination `(extraction_confidence, id)` — arriscado c/ nulls; adiar.
- **PERF-11** `upload/preview`: NLP de até 500 PDFs em `Promise.all` sem budget → fatiar (reestrutura o
  fluxo de preview, user-controlado — adiar).
- **SEC-6** corrida duplica deliberação quando `numero_deliberacao` é null → índice único **parcial**
  (migration) — ⚠️ exige **dedup das linhas já duplicadas** antes de criar o índice, senão falha.
**Deferido — refactor maior (precisa RPC/migration ou verificação de front):**
- **PERF-4** `completude-2026`/`saude-dados` agregam 40k-80k linhas em JS **e sofrem undercount
  silencioso** quando a base passa do LIMIT → mover contagens p/ RPC/`count`/`GROUP BY`.
- **PERF-6** rotas de Votação (`matrix/distribution/fidelidade/sectors`) agregam `votos` inteiro em JS
  3×/load → agregação em SQL (RPC/view).
- **PERF-12** charts sem `next/dynamic` (13 páginas) — ganho de bundle, verificação visual.
**Deferido — defense-in-depth leve:** SEC-8 (wrapper redirect validado no `resilient-fetch`),
SEC-9 (paridade demo nos GET de qualidade), SEC-10 (rate-limit em `/auth/*`), SEC-11 (`system/status`
expõe flags `has_*`), SEC-13 (`applyRetroactiveVotes` via `upsertVotosProtegido`), SEC-14 (validar ISO
em `vote-inference.ts:77`), SEC-15 (teste/CI que exija `require*` em rotas de escrita).

### Auditoria 3ª/4ª rodada (jul/2026) — revisão de segurança GERAL + itens deferidos
**Corrigido nesta rodada** (commits): **P0/LGPD** — migration `20260718120000` re-assertando RLS em
TODA a lista da 010 (fecha exposição anônima de `votos`/`diretores`/`associados` se a 010 não aplicou);
**`ws` ALTO de produção** subido via `npm audit fix`; **SEC-10** — `setup-owner` agora **fail-closed
pós-bootstrap** (recusa 409 quando já existe admin ativo, matando o takeover por brute-force do token);
**SEC-8** — `resilient-fetch` segue redirects manualmente revalidando cada hop com `assertPublicUrl`
(+teste); **SEC-11** — `/system/status` só devolve `has_service_role_key`/`has_cron_secret` a chamadas
autenticadas. Verificado limpo: segredos (nada no history/bundle/log), headers/CSP, CSRF (Bearer, não
cookie), storage `pdfs` (privado, RLS `TO service_role`, signed URLs 60s), guards de escrita (122 rotas),
injeção/IDOR/ReDoS/upload.
- **⚠️ `IRIS_SETUP_TOKEN` deve ser longo/aleatório** enquanto o endpoint existir. Escape hatch: para
  re-bootstrap legítimo (ex.: perda de acesso), desativar temporariamente a linha em `admin_users`
  (`active=false`) no SQL Editor libera o `setup-owner` de novo; rotação normal de senha é pelo reset
  do Supabase Auth (e-mail).
**Ainda deferido — defense-in-depth leve (LOW/INFO, não urgente):** SEC-9 (paridade demo nos GET de
qualidade — já não vaza a anônimo pelo middleware), SEC-13 (`applyRetroactiveVotes` via
`upsertVotosProtegido`), SEC-14 (revalidar ISO no sink `.or()` de `vote-inference.ts:77` — os 3 call-sites
atuais já chegam validados), SEC-15 (teste/CI de guards), guard in-handler nas rotas de download (hoje
confiam no middleware), validar `agencia_id` como UUID no `upload/confirm`, e trocar `error.message` cru
por msg genérica + log server nas rotas `qualidade-regulatoria/*` e `noticias/*`. Cookies de sessão
não-HttpOnly (inerente ao `@supabase/ssr`): aceito; mitigação é a CSP + rigor anti-XSS.
- **`npm audit` residual** (não-bloqueante): `postcss` aninhado no `next` (build-time) → resolver num bump
  de patch do `next` 15.x; `vitest`/`vite` (crítica/alta) são **dev-only** (não vão ao runtime Vercel) →
  `npm audit fix --force` sobe `vitest` p/ 4.x (semver-major, revisar testes) — fazer em janela dedicada.

### Auditoria 5ª rodada (jul/2026) — login minimalista + hardening essencial
**Corrigido nesta rodada** (commit): **B2/SSRF** — `noticias/adicionar` valida a URL com `assertPublicUrl`
na fronteira (host interno/loopback/metadata bloqueado antes do fetch, não só o protocolo); **B4** —
`/system/status` **não devolve `warnings` a chamadas anônimas** (eles nomeavam a env var ausente —
SERVICE_ROLE/CRON — inclusive em modo real; o DemoBanner usa só `mode_reason`, preservado); **UX** — tela
de login enxugada para card único (removido o painel de branding). Migration `20260724120000` (views
`security_definer`) preparada — aplicar só se o advisor flagar. Confirmado: auth ATIVA e endurecida (nada
removido); a entrada já é auth→sistema (`/`→`/dashboard`→`/login`), sem landing page.
**Adiados por decisão do usuário ("essencial, sem infra nova"):**
- **Rate limiting** (login/setup-owner/coleta/upload) — precisa de store compartilhado (Upstash Redis;
  memória por processo não serve no serverless). Nova dependência + env + conta. Prioridade em `setup-owner`.
- **CSP por nonce** (remover `'unsafe-inline'`/`'unsafe-eval'` de `script-src` em `next.config.mjs`) —
  invasivo no runtime do Next (middleware injeta nonce por request); risco de regressão visual.

## Fase 0 — corpus de certificação ampliado (24/08/2026)

10 PDFs oficiais novos entraram em `src/lib/server/__tests__/fixtures/votos/` (ANM 79ª/81ª/83ª ROP e
34ª REP; ANTT 1.024ª, 264ª RDE e Voto DAB 002; ARTESP 22, 23 e 303). O gabarito foi levantado por
LEITURA INDEPENDENTE de cada documento — não copiando a saída do extrator, senão o padrão-ouro
certificaria os próprios defeitos. Certificação passou de **46 expectativas em 6 documentos** para
**150 em 16**.

**Divergências ABERTAS entre a leitura do documento e o extrator** (não asseridas no gabarito de
propósito — asserir um valor contestado congelaria o erro):

- **79ª ROP · voto contrário.** A leitura do documento aponta *Roger Romão Cabral* e *Tasso Mendonça
  Júnior* como vencidos (item 1.4.1, empate resolvido por voto de qualidade do DG; item 2.2.1). O
  extrator marca *Mauro Henrique Moreira Sousa*. Investigar antes de asserir.
- **83ª ROP · voto contrário.** O extrator marca *Mauro Henrique Moreira Sousa*; a leitura do
  documento não encontra dissidente. Possível falso positivo do contrário-por-cargo (etapa51).
- **83ª ROP · nome truncado.** O impedimento sai como *"Fábio Borges"*; o nome completo é *Fábio
  Fernando Borges*. Impede o casamento com o cadastro.
- **81ª ROP · contagem de itens.** Extrator = 72, leitura = 69. `ata_items_min` foi fixado abaixo dos
  dois para não travar a suíte numa contagem em disputa.

**Defeitos CORRIGIDOS que estes documentos revelaram** (só existiam fora do corpus antigo):

- Ligadura "ti": o substituto depende da FONTE — `7` (pauta 1.036), `%` (ata 1.024) e `,` (264ª RDE),
  três documentos da MESMA agência. A regra passou a ser ancorada em VOCABULÁRIO.
- `parseDataExtensoANM` não lia o mês **março** (`\w` em JS é ASCII e quebra no "ç") nem ordinais
  compostos ("décimo nono"). Data ausente caía num fallback que pescava data CITADA no corpo: a 83ª
  de 25/03/2026 era gravada como 02/05/2022. **Data errada escolhe o roster de mandatos errado.**
- `extractAnttDate`: captura do ano GULOSA engolia a frase inteira → a 1.024ª (19/01/2026) saía
  26/12/2025.
- **Voto DAB 002: direção INVERTIDA.** O voto transcreve a liminar do juiz ("Ante o exposto, DEFIRO,
  em parte…") na seção de fatos; o extrator ancorava na PRIMEIRA ocorrência e gravava "Deferido"
  quando o diretor votou "pelo indeferimento". Numa peça de voto o dispositivo é o ÚLTIMO.
- Data do voto individual: vinha de um fato do processo (05/11/2025) em vez do fecho assinado
  (09/03/2026).
- Roster da ANTT saía vazio ("sob a presidência do Diretor-Geral, X; presentes os Diretores A, B…"
  não era reconhecido) — e **sem roster não há inferência de voto naquela agência**.

## Fases 2 e 3 concluídas (24/08/2026)

Migration `20260824120000_votos_proveniencia.sql` **aplicada**. O código já grava `proveniencia`,
`motivo_nao_voto` e `voto_em_autos`; `deliberacoes.juizo` recebe o valor extraído.

**Modo duplo nos denominadores.** Toda rota de métrica passou a publicar o denominador ao lado da
taxa: `total_deliberacoes` (pautado, inalterado) + `total_decidido`, `total_admissibilidade`,
`total_retirado`, `total_sem_resultado`, `total_com_voto`. Os números de deferimento **sobem** e os
de consenso **caem** — nenhum dos dois é melhora ou piora de governança: é o divisor deixando de
estar errado. Ver `docs/METODOLOGIA-METRICAS.md`.

**Ainda duplicado (dívida conhecida, registrada em vez de escondida):**
- A fórmula do Score de Governança existe em 3 cópias literais (`dashboard/governanca/page.tsx`,
  `dashboard/analytics/institucional/page.tsx`, `lib/boletim-document.ts:calcGovScore`). Mudar a
  semântica de consenso move as três — e o PDF do boletim.
- A definição de "sanção" (`microtema === "multa" || resultado === "Indeferido"`) está em 4
  arquivos, sem helper compartilhado.
- `isFinalDecisionRecord` tem um predicado PARALELO mais frouxo em `associado-documents.ts`.
- Seis cópias locais do conjunto `NAO_FINAL` (pauta/voto/apoio) espalhadas por rotas admin.

**Write-paths fora do writer compartilhado** (fazem UPDATE/DELETE direto em `votos`, não upsert —
por isso não passam por `votos-write.ts`): `votos/reprocessar-abstencoes`,
`votos/recalcular-divergencia`, `deliberacoes/[id]` (PATCH que re-deriva `is_divergente`),
`admin/deliberacoes/dedup` e `diretor-merge`. Nenhum grava voto novo; todos alteram voto existente.
Unificá-los é o próximo passo natural do endurecimento.

**Assimetria conhecida:** `deliberacoes/[id]:175` chama `isDivergentVote(tipo, resultado)` SEM o 3º
argumento (`unanime`), enquanto `recalcular-divergencia` passa. Uma edição manual de resultado
reintroduz divergência falsa em item indeferido-por-unanimidade até o cron rodar.

## Fase 4 · bloco 1 — direção do voto (24/08/2026)

**Corrigido:** o extrator invertia a direção do voto do VENCEDOR. Nas atas da ANM, "divergente"
qualifica divergência **do relator**, e essa posição frequentemente é a que PREVALECE; as regexes
tratavam `divergente|dissidente|contrário|vencido` como sinônimos. Dois falsos positivos medidos,
com dispositivo literal em sentido oposto:

- **79ª ROP, item 2.2.1** — *"teve divergência apresentada pelo Diretor-Geral […] este foi APROVADO
  por maioria"* → gravava voto CONTRÁRIO de Mauro Henrique Moreira Sousa.
- **83ª ROP, item 2.3.1** — *"o voto divergente do Diretor-Geral […] Voto do Revisor, Diretor-Geral,
  APROVADO por maioria"* (venceu 3×2) → idem.

A trava é `extractAutoresDoVotoAprovado` (nlp-extractor.ts): quem o DISPOSITIVO credita com o voto
aprovado não entra em `contra`. Se a ata diz as duas coisas, o dispositivo decide. Impacto medido
nas 16 fixtures: remove exatamente os dois falsos positivos e **não toca em mais nada** — a
divergência REAL da 32ª REP (o Diretor-Geral divergiu e perdeu) permanece.

**Também corrigido:** o rótulo de item passou a ser exigido COLADO ao número no splitter. Testar a
linha inteira abria item falso sempre que ela começava com nº de processo quebrado pelo wrap do PDF
e citava "Relator" adiante. Medido: **465 aberturas reais preservadas, 10 falsas eliminadas** — 4 na
81ª, 2 na 83ª, 1 na 34ª e 3 parágrafos numerados do voto individual da ANTT (que não é ata). A 81ª
passou a dar **68 itens**, igual à contagem dura do PDF (70 cabeçalhos `N.N.N` − 2 repetidos).

### Hipótese DERRUBADA pela medição (não implementar)
Estava planejado aceitar infinitivo/gerúndio em `RE_VOTO_DISSIDENTE_VERBAL`, porque a 79ª/1.4.1 diz
*"optando, assim, por divergir do relator"* e os dissidentes reais (Roger Romão Cabral e Tasso
Mendonça Júnior) escapam. **Medido: 18 ocorrências de `divergir|divergindo|discordar|discordando`
nas 6 atas da ANM, e 13 delas são o diretor divergindo de PARECER TÉCNICO, Voto CS ou Procuradoria
— não de colega** (*"divergindo das manifestações técnicas"*, *"divergir do posicionamento da
Procuradoria"*, *"Divergindo do Voto CS/ANM nº 532/2025"*). Relaxar a regex fabricaria voto
contrário em massa. As duas ocorrências verdadeiras estão a 176 e 267 caracteres do nome, distância
maior que a dos casos falsos — não há como separá-las por proximidade.
**Comportamento correto e mantido:** o item emite o aviso *"Divergência declarada no texto sem
dissidente identificável — atribuir manualmente"*. Não fabricar é a resposta certa; a atribuição é
humana.

### Aberto: normalização de nome (não é bug de extração)
A 83ª escreve **"Fábio Fernando Borges"** no preâmbulo e nas relatorias, e **"Fábio Borges"**
exatamente nas duas sentenças de impedimento. A captura não trunca nada — é o documento. Resolver
por alias/`nome_variantes` no cadastro, não por regex. Mesmo caso na 32ª, onde convivem
`"Caio Mário Trivellato Seabra Filho"` e `"Caio Mario Seabra Filho"`.

### Regra de processo (causa-raiz de incidente real)
**`git add` SELETIVO enquanto houver agente escrevendo no repo.** Um `git add -A` varreu dois
arquivos de sonda de agente (`zzz-adv-probe*.test.ts`) para dentro do commit `e6007c4`. Nenhum teste
permanente foi perdido (verificado: 74 arquivos em `d10cb93`, 77 hoje), mas a regra fica.

## Fase 4 · bloco 2 — invariantes globais (24/08/2026)

`src/lib/server/__tests__/etapa65-invariantes.test.ts` roda sobre um corpus ADVERSARIAL sintético
(item retirado carregando `microtema='multa'`, admissibilidade com resultado positivo, base vazia,
array só de ausentes) e sobre TODAS as agregações puras do `analytics-engine`. Não descreve o valor
certo — descreve o que é impossível. Seis invariantes: taxa em [0,100]; denominador ≥ numerador;
retirado nunca é mérito; impedido só figura como `Ausente`; inferência por mandato não alcança quem
não estava ativo; consenso sem base é `null`.

**Achado NOVO pela invariante 1, sem ninguém procurar:** `analytics-engine.taxa_sancao` chegava a
**120%**. O comentário dizia ser "espelho EXATO da rota /mandatos/analytics", mas o espelho fora
feito só no DENOMINADOR — o numerador seguia varrendo `rows` inteiro, então item retirado com
`microtema='multa'` entrava em cima e saía de baixo. **Corrigido**, e a definição de sanção virou
fonte única (`isSancao` em `regulatory-documents.ts`), eliminando as 4 cópias com 3 semânticas.

**`null` sem base, agora uniforme.** A decisão existia só em `governanca-agencias`; `pct_consenso`
ainda saía `0` em 4 outros lugares (`consenso-timeline`, `reunioes`, e 3 agregações do engine) — a
MESMA reunião aparecia com "0% consenso" num painel e "—" no outro. Todos passaram a `null`.
Princípio da etapa61 mantido: **exibir com a base à vista, nunca esconder o painel** — a lista de
reuniões mostra `— consenso (0 itens com voto)`, e na linha do tempo o mês sem base vira LACUNA no
gráfico, não um mergulho a 0%.

### Como medir a frequência de `null` (pendente do usuário — precisa de produção)
O corte só deve ser revisto com o número na mão. Duas vias, sem credencial de produção da parte do
código:
- **Sem SQL:** `GET /api/v1/admin/saude-dados` devolve `deliberacoes_com_voto` /
  `deliberacoes_sem_voto` por agência; `GET /api/v1/votacao/consenso-timeline` devolve
  `total_com_voto` por mês. A leitura agência×período já está disponível hoje.
- **Com SQL** (SQL Editor):
  ```sql
  SELECT a.sigla,
         to_char(d.data_reuniao,'YYYY-MM') AS mes,
         count(*)                                        AS itens,
         count(*) FILTER (WHERE v.n > 0)                 AS com_voto,
         round(100.0 * count(*) FILTER (WHERE v.n = 0) / nullif(count(*),0), 1) AS pct_sem_base
  FROM deliberacoes d
  JOIN agencias a ON a.id = d.agencia_id
  LEFT JOIN LATERAL (SELECT count(*) AS n FROM votos WHERE deliberacao_id = d.id) v ON true
  WHERE d.data_reuniao IS NOT NULL
  GROUP BY 1,2 ORDER BY 1,2 DESC;
  ```
  Se `pct_sem_base` for maioria na maior parte das agências/meses, a decisão de publicar `null`
  precisa vir acompanhada de um estado de UI mais explícito que `—` (ex.: faixa "sem base nominal
  neste período"), **não** de voltar a publicar 0.

## Fase 4 · bloco 3 — validação cruzada de data (24/08/2026)

Dois validadores INDEPENDENTES, ambos de graça no próprio documento, ambos **bloqueantes** e ambos
PUROS (rodam com `db: null`, logo exercitáveis contra as 16 fixtures antes de ligar o bloqueio):

- **C17 · `checarDataAnteriorAoProcesso`** — a reunião nunca é ANTERIOR ao processo mais novo que
  ela julga. Regra **assimétrica por MEDIÇÃO**: a versão simétrica (±1 ano) daria falso positivo em
  série, porque as atas da ANM misturam protocolos de **1935 a 2026** (36 anos distintos só na 79ª)
  e a `artesp-delib-22` tem delta +3. Varre o TEXTO, não o campo `processo` — este é o primeiro
  match e diverge do ano da reunião em até 6 anos. Cobre os dois formatos (`NNNNN.NNNNNN/AAAA` da
  ANM/ANTT e `NNN.NNNNNNNN/AAAA` da ARTESP).
- **C18 · `checarAnoProtocoloDaAta`** — o ano do protocolo SEI do PRÓPRIO documento é IGUAL ao ano
  da reunião. Não é limite, é igualdade: medido pelo caminho real de análise, bate em **9/9** das
  fixtures que têm o rodapé. ARTESP não tem — ali o check fica silencioso em vez de inventar base.
  ⚠️ O protocolo é capturado em `extractPdfText` **antes** de `removeSeiHeadersFooters`, que apaga
  exatamente a linha que o carrega.

Medido: **0 bloqueios nas 16 fixtures sadias**, e os DOIS pegam sozinhos o bug real (83ª de
25/03/2026 lida como 02/05/2022). Ambos entram no guard `INFO_WARNING_RE` da etapa63 — um bloqueio
de data classificado como informativo deixaria passar exatamente o defeito que ele existe para pegar.

**Bug latente corrigido:** `RE_NUMERO_REUNIAO` casava só `(\d{3,4})`, então "ATA DA 1.024ª REUNIÃO"
virava **"024"** — a reunião 1.024 lida como a 24. Ficava escondido porque o parser dedicado da ANTT
já devolvia "1.024"; aparece assim que o dedicado não assume. O FORMATO com ponto foi preservado de
propósito: `numero_reuniao` é chave de dedup (`.eq()` em `deliberacao-dedup.ts` e `reunioes.ts`), e
normalizá-lo na gravação faria a mesma reunião deixar de casar com a linha persistida. A comparação
ordinal vive em `numeroReuniaoOrdinal`.

**Achado de brinde (não corrigido, mascarado hoje):** o extrator GENÉRICO devolve datas erradas para
documentos da ANTT — `2025-12-26` para a 1.024ª (correto 2026-01-19) e **`2022-04-07` para a pauta
1.036** (correto 2026-07-02). Mesma classe do bug da 83ª. Em produção o parser dedicado sobrescreve,
então não aparece; se um documento da ANTT não disparar `isAntt`, aparece. O C17/C18 agora o pegaria.

### ADIADO com diagnóstico: monotonicidade da série (a 83ª não pode preceder a 81ª)
A ideia está certa, mas exige uma coisa que **não existe no modelo de dados hoje**: `tipo_reuniao`
NÃO separa as séries da ANTT — RD e RDE recebem ambos `"Ordinaria"` (`antt-manual-parser.ts:331`).
Prova no corpus: `antt-ata-1024` (RD) e `antt-ata-264-rde` (RDE) têm a **mesma data** (2026-01-19)
com números 1024 e 264. Comparar sem separar série produz alarme falso imediato — e a 34ª
extraordinária da ANM contra a 79ª ordinária, idem. Além disso o validador precisa de `db`, então
fica **inerte e silencioso** nas 16 fixtures e exigiria teste próprio com banco falso (foi assim que
o C16 entrou incapaz de disparar). Pré-requisito: derivar uma chave de série confiável para a ANTT.
O `numeroReuniaoOrdinal` já está pronto para quando isso for feito.

## Fase 4 · bloco 4 — o cast não checado (24/08/2026)

`api.get<T>` termina em `res.json() as Promise<T>`: o `T` do call-site é **asserção, não
verificação**. Se a rota muda de forma, o `tsc` fica VERDE e a tela quebra em runtime. Medido: **179
call-sites de `api.*`, 69 declarando ARRAY; 128 rotas, 6 com amarração de compilação, 1 com teste de
contrato, 0 error boundaries**. E `?? []` **não protege** — testa `undefined`, não forma; um objeto
é truthy, passa pelo `??` e chega vivo no primeiro `.reduce`.

Quatro camadas, da mais barata para a mais específica:

1. **`src/app/dashboard/error.tsx`** — não conserta nenhum bug, **limita o custo de todos**. Sem ele
   o `TypeError` sobe até a raiz e a rota vira tela branca (foi o que aconteceu com a Saúde dos
   Dados). Agora vira tela recuperável com o erro visível e botão de retry.
2. **`etapa65-contratos-rota.test.ts`** — teste de contrato de VERDADE: importa os **handlers reais**
   e assere forma (array × envelope) + conjunto de chaves de topo, num snapshot EXPLÍCITO. Cobre 14
   rotas (antes: 1). Barato porque o ramo demo roda antes do guard de auth e não toca o banco.
   ⚠️ O teste da etapa64 **não** era contrato — testava uma réplica local do consumidor, então
   continuaria verde se a rota trocasse envelope por array cru. Foi substituído.
3. **`listaDe<T>()` em `src/lib/api.ts`** — guard de FORMA, aplicado em **27 call-sites** de
   agregação imediata (`.reduce`/`.map` direto) em 10 telas.
4. **Quatro divergências demo×real fechadas** — cada uma sumia um painel em silêncio:
   `nao-enfileirados` (faltava `total_nao_enfileirados`), `pendencias-voto` (`confirmaveis`),
   `votos-diretores/backfill` (`novos_itens` e cia — o loop de progresso saía na 1ª rodada) e
   `completude-2026` (`totais: {}`, com o consumidor lendo `totais.documentos_2026_detectados`
   encadeado e sem guard). **Os ramos demo são alcançáveis em produção**: `attachRuntimeHeaders`
   injeta `x-iris-demo: 1` a partir do `localStorage`.

Bug ativo corrigido de brinde: `api.upload` **reimplementava** a extração de erro em vez de chamar
`extractErrorMessage`, perdendo justamente o caso `{ error: <objeto> }` (erro cru do Supabase) que
vira `"[object Object]"` na tela — e é nos uploads que ele é mais provável.

**Ainda descoberto (dívida honesta):** 114 das 128 rotas seguem sem teste de contrato, e 42 dos 69
call-sites de array seguem sem `listaDe`. O error boundary cobre o dano de todos; a cobertura
seletiva foi para onde o consumidor agrega direto, que é onde errar derruba a tela.

## Fase 4 · bloco 5 — dívida de duplicação e diagnóstico da ANTT (24/08/2026)

Decisão: **unificar só o que JÁ divergiu; o que ainda está idêntico ganha teste de paridade**.
Refatorar tudo custa risco sem pagar nada — mas deixar cópias sem amarra nenhuma foi exatamente como
a "sanção" acumulou 3 semânticas sem ninguém perceber.

**Unificado (já tinha divergido):**
- `isSancao` — 4 cópias, 3 semânticas. Ver bloco 2.
- `TIPOS_NAO_FINAIS` / `TIPOS_NAO_FINAIS_SET` / `TIPOS_NAO_FINAIS_PG` / `isTipoNaoFinal` — a lista
  `pauta|voto_individual|documento_apoio` estava em **14 sítios**: 6 `Set` locais com 3 nomes
  diferentes (`NAO_FINAL`, `TIPOS_APOIO`, `tiposApoio`), 5 arrays inline e 3 strings PostgREST.
  ⚠️ **Exceção preservada e TESTADA**: `admin/upload/pendencias-voto` omite `voto_individual` do
  `RESIDUO` **de propósito** (classifica voto individual em categoria própria antes de consultar os
  sets). Há um teste travando a exceção, para que a próxima limpeza não a "conserte".
- `repartirPorDivergencia` / `deriveUnanime` — `deliberacoes/[id]` (PATCH manual) chamava
  `isDivergentVote(tipo, resultado)` com **dois** argumentos, omitindo `unanime`, enquanto
  `votos/recalcular-divergencia` passava o terceiro. Uma edição manual de resultado reintroduzia
  divergência FALSA num item indeferido-por-unanimidade, e ela ficava lá até o cron rodar.

**Com teste de paridade (ainda idênticas):** fórmula do Score de Governança (3 cópias, duas delas
dentro de componentes client não exportados — a comparação é do código-fonte, e é melhor que o
comentário "não deixar divergir" que existia e não impedia nada) e `RuntimeStatus` (2 declarações).
Mutação verificada: mudar o peso do consenso em uma das cópias deixa o teste vermelho.

### Diagnóstico do voto individual da ANTT — investigar, NÃO implementar (decisão do usuário)
A pergunta inverteu. **Não falta scraper:** o coletor já reconhece, classifica e persiste voto
individual ponta a ponta — `classifyDocumentLink` devolve `"voto"` (antt-2026-collector.ts:836),
`parseProcessos` guarda apenas documentos de voto por processo deliberado (:767), o persist grava
`tipo: "voto"` (:121), o enfileiramento inclui voto (:324, :537), `monitoring-runner` o aceita
(:275) e `votos-diretores` o lê (:44).

**E não existe listagem separada a raspar:** cada reunião publica quatro atalhos para a MESMA página
(`…/1033-reuniao-de-diretoria` + `#pauta`, `#ata`, `#voto`). O fragmento é client-side — não há URL
nova. Um coletor dedicado não teria o que coletar.

**Por que rende 0%, então** — quatro pontos, todos no caminho de DESCOBERTA:
1. `parseAnttMeetingPage:517-521` **descarta explicitamente** todo anchor de voto de nível superior
   ("voto costuma vir dos processos, abaixo"), e `parseProcessos:764-774` só olha dentro de blocos
   `"Processo Deliberado:"`. Se a seção `#voto` não estiver dentro de um desses blocos, nada é
   coletado. Pior: o último bloco do `split` engole o resto do HTML, então voto publicado depois dos
   processos é atribuído ao **último processo**.
2. `classifyDocumentLink:834` exige `.pdf` no href — link para visualizador SEI vira `"outro"`.
3. `enqueuePdfBuffer` recebe como `filename` o **texto do anchor** (:329), não o arquivo real:
   anchor sem texto vira `"Voto.pdf"`, e `isAnttVotoFilename` falha por falta de número/ano.
4. **O que fecha a conta:** o único voto individual certificado (`antt-voto-dab-002.pdf`) tem fonte
   `SEI/ANTT 40351373` — entrou por **upload manual**. E **não existe nenhuma fixture de HTML de
   página de reunião** no repo: nem `parseAnttMeetingPage` nem `parseProcessos` têm um único teste.
   `colegiado-sources.ts:145` promete `"ANTT|voto_individual": "sempre"` e diz que os votos vêm
   "ingeridos à parte" — o único caminho verificado dessa ingestão é a mão humana.

**Esforço estimado (quando for implementar):** capturar 1 HTML real de página de reunião como
fixture (~1h) → teste de `parseAnttMeetingPage`/`parseProcessos` contra ele (~2h) → corrigir os
pontos 1–3 medidos contra a fixture (~3h). **Não é coletor novo.** Registrar também a 4ª cópia
divergente do reconhecimento de voto ANTT: `regulatory-documents.ts:36` usa regex mais frouxa (sem
número/ano, sem validar iniciais contra o cadastro) que `antt-manual-parser.ts:149`.

## Fase 5 · bloco 1 — o laço do `juizo`, e a CLASSE por trás dele (24/08/2026)

**A terceira ocorrência do mesmo padrão**: extração certa, consumidor cego.

| # | Rodada | Onde a informação morreu |
|---|---|---|
| 1 | Fase 1 | a coluna existia sem write-path que a preenchesse |
| 2 | Revisão adversarial | o write-path existia, mas a projeção não trazia `juizo_raw` |
| 3 | **esta** | a projeção traz `juizo_raw`, mas o filho de ata só escrevia a COLUNA |

**A classe não é o `juizo` — é a montagem CHAVE A CHAVE.** O `raw_extraction` do filho era montado
declarando as INCLUSÕES, então todo campo novo do item nascia invisível por omissão. Medido nas 16
fixtures, o mecanismo já tinha **duas** vítimas:

| Campo | Itens com valor | Destino real antes |
|---|---|---|
| `juizo` | 13 de 320 | só a COLUNA → invisível a toda rota, que projeta o JSON |
| **`area_regulatoria`** | **320 de 320** | **nenhum** — o item calculava a sua e o insert gravava a do DOCUMENTO por cima |

**Correção:** `src/lib/server/ata-item-materializacao.ts` inverte a lógica — declara as OMISSÕES,
com motivo, e propaga o resto. Campo novo viaja por padrão. Duas categorias de omissão são
legítimas e ficam explícitas: `coluna:` (vira coluna própria) e `tamanho:` (texto que incharia o
JSON de toda linha — `decisao`/`raw_text` seguem fora, como a otimização `3bca9ea` decidiu).

Também corrigido: `upload-analysis.ts` — o ramo da ANTT SOBRESCREVIA `ata_items` inteiro e o parser
dedicado nunca produz `juizo`, então toda ata da ANTT perdia o campo. E a projeção passou a incluir
a COLUNA nas 4 rotas que chamam `decisionStatus`, via `juizoSelect(db)` — sonda memoizada, porque
projetar coluna inexistente **derruba a query inteira** (não devolve null) e o deploy antes da
migration tem de continuar seguro.

**Testes (`etapa66-materializacao-item.test.ts`), em duas camadas — a segunda sugerida pelo usuário
e melhor que a primeira versão:**
- **(a) completude de chaves** — compara a união das chaves que o analisador produz nos 16 PDFs com
  o contrato; quebra quando aparece chave não declarada. **É o que fecha a classe.**
- **(b) soma dos baldes sobre a linha SERIALIZADA** — avalia `decisionStatus` sobre a linha *como a
  rota a vê* (só o que o sub-select projeta), não sobre o objeto rico do analisador. O defeito
  estava na serialização, e um teste em memória passa verde com ele presente.

⚠️ Uma não substitui a outra: **a soma dos baldes só protege campo com FORMA DE BALDE** — nem
`juizo` nem `area_regulatoria` têm, e os dois escapariam dela.
Mutação verificada: as três correções desfeitas deixam testes vermelhos, e a de completude nomeia a
chave órfã com contagem e arquivo de exemplo.

### SQL de conferência — banco × painel (colar no SQL Editor)
`invisivel_ao_painel > 0` confirma linhas antigas com a coluna preenchida e o JSON vazio (elas
precisam de reprocessamento; a correção é forward-only). `coluna_nao_backfillada > 0` indica que a
migration `20260824120000` não foi aplicada ou que o insert caiu no fallback de coluna ausente.

```sql
WITH base AS (
  SELECT d.id, d.agencia_id, d.tipo_documento, d.documento_pai_id, d.resultado,
         d.juizo                                         AS juizo_coluna,
         d.raw_extraction ->> 'juizo'                    AS juizo_json,
         COALESCE(d.juizo, d.raw_extraction ->> 'juizo') AS juizo_efetivo,
         COALESCE(d.raw_extraction ->> 'documento_subtipo',
                  d.raw_extraction ->> 'documento_antt_tipo') AS subtipo,
         (d.raw_extraction -> 'import_counts_as_final')  AS icf
  FROM public.deliberacoes d
),
finais AS (               -- espelha isFinalDecisionRecord()
  SELECT * FROM base
  WHERE icf IS DISTINCT FROM 'false'::jsonb
    AND tipo_documento NOT IN ('pauta','voto_individual','documento_apoio')
    AND COALESCE(subtipo,'') NOT IN ('pauta','voto_individual',
        'reuniao_deliberativa_eletronica','reuniao_diretoria_publica','reuniao_extraordinaria')
    AND ((tipo_documento = 'ata' AND documento_pai_id IS NOT NULL AND resultado IS NOT NULL)
         OR tipo_documento IN ('deliberacao','resolucao','portaria'))
)
SELECT a.sigla,
  COUNT(*)                                                          AS pautado,
  COUNT(*) FILTER (WHERE f.juizo_efetivo = 'admissibilidade')       AS real_admissibilidade,
  COUNT(*) FILTER (WHERE f.juizo_json    = 'admissibilidade')       AS painel_admissibilidade,
  COUNT(*) FILTER (WHERE f.juizo_coluna = 'admissibilidade'
                     AND f.juizo_json IS DISTINCT FROM 'admissibilidade') AS invisivel_ao_painel,
  COUNT(*) FILTER (WHERE f.juizo_json = 'admissibilidade'
                     AND f.juizo_coluna IS DISTINCT FROM 'admissibilidade') AS coluna_nao_backfillada
FROM finais f
LEFT JOIN public.agencias a ON a.id = f.agencia_id
GROUP BY ROLLUP (a.sigla) ORDER BY a.sigla NULLS LAST;
```

## Fase 5 · bloco 7 — diagnóstico READ-ONLY da inversão de sinal (24/08/2026)

`GET /api/v1/admin/votos/diagnostico-direcao` — **não escreve nada**, não tem `?dry_run`, não tem
ramo de aplicação. O teste prova a propriedade: o banco falso lança em `insert`/`update`/`delete`/
`upsert`, então uma escrita acidental quebra a suíte.

**Ela não é só prudência: é a VERIFICAÇÃO de que a correção da etapa65 funciona em dado real** —
coisa que teste de unidade não dá.
- Listar exatamente o que o gabarito prevê (79ª e 83ª ROP da ANM) ⇒ correção provada em produção.
- Listar **muito mais** ⇒ ela mexeu em algo não previsto, e é melhor descobrir antes de escrever.

Como funciona: para cada voto `Desfavoravel`, reaplica `extractAutoresDoVotoAprovado` sobre o
DISPOSITIVO persistido (`resumo_pleito`) usando o `roleMap` do PREÂMBULO — que vive no documento
PAI, porque o filho de ata não persiste `raw_text` (omissão por tamanho). Cargo não resolvido não
acusa ninguém.

### ⚠️ Rodar DUAS vezes — o número envelhece
Qualquer mudança nos caminhos que gravam `contra` muda este resultado, e a rodada seguinte
(simetria do extrator) mexe justamente neles.

| Execução | Quando | Para quê |
|---|---|---|
| #1 | agora, antes da simetria | verificação da correção da etapa65 em dado real |
| #2 | depois da simetria | **base da decisão** de retroação |

Registrar as duas contagens lado a lado: a diferença entre elas é o efeito da simetria sobre dado
real, que nenhum teste de unidade mede.

**Operação:** chamar a rota autenticado como admin e anotar `total_afetadas`,
`total_votos_invertidos` e `por_agencia`. A aplicação retroativa é decisão separada, em commit
separado — e quando acontecer, a data entra em `docs/METODOLOGIA-METRICAS.md`, porque este dado
alimenta perfil público de diretor: sem a data, um relatório de setembro diverge de um de agosto
sem explicação.

## Fase 5 · bloco 2 — simetria entre FAVORÁVEL e CONTRÁRIO (24/08/2026)

O achado veio de fora e a **medição o dividiu em duas metades com veredictos opostos**:

- **ESTRUTURA — correta, e pior que o descrito.** `RE_VOTO_CONCORDANCIA` tem os dois ramos no mesmo
  regex e só o de divergência exigia objeto; o de adesão também não passava por
  `isStrictPersonName`. O lado que grava FAVORÁVEL era o mais frouxo — e favorável é justamente o
  sinal já inflado pela inferência de unanimidade.
- **FREQUÊNCIA — não traduziu.** Nas 16 fixtures há **150 ocorrências da PALAVRA**
  (`acompanh|segui|aderi`) e a regex casa **3**, porque exige NOME adjacente. As 3 são adesão a voto
  de colega: **zero votos fabricados hoje.**

A correção entrou porque a proteção era **acidental** (vinha da adjacência do nome, não de desenho)
e porque custa nada — medido: **preserva 3/3 dos casos reais e bloqueia 4/4 dos adversariais**
("acompanhou a manifestação técnica", "o parecer da Procuradoria", "as conclusões da área técnica",
"Superintendência … acompanhou a sessão").

⚠️ **`isStrictPersonName` NÃO é a defesa** — medido, ele aceita `"Superintendência de Fiscalização"`
e `"Ante O Exposto"`. Quem segura é o objeto obrigatório; a validação de nome é complemento.
⚠️ `aderiu **AO** voto do X` precisou de "ao" como token único na alternância de artigo, senão o
"a" isolado casa e o "o voto" seguinte não fecha — vira falso negativo.

**Os quatro furos LATENTES fechados** (medido: `RE_VOTO_DIRECAO` e `RE_VOTARAM_FAVOR` têm **0
matches** nos 16 PDFs — são risco para formato novo, não bug vivo):
1. `extractItemVotes` — o ramo tabular gravava `contra` sem `isStrictPersonName` **e sem
   `autoresAprovado`**: era o único caminho de CONTRA fora do helper, e portanto **o único furo
   dentro da correção que dá nome ao bloco 1 da Fase 4**. Passa por `moveToContra`.
2. `extractFields` — mesmo ramo, mesma falta de `autoresAprovado`. Passa por `markContra` (o bloco
   de declaração subiu no arquivo para isso).
3. `RE_VOTARAM_FAVOR` — 180 chars de complemento livre com flag `i`, destino sem validação nenhuma,
   enquanto o gêmeo `RE_VOTARAM_CONTRA`, com a MESMA janela, ia para `moveToContra` validado. Agora
   os dois lados validam.
4. Abstenção do item usava `.trim()` sem colapsar espaço. Reprodutor medido: com nome de espaço
   duplo, o `indexOf` em `favor` falha e o diretor fica nos **dois** baldes, com grafias diferentes.
   ⚠️ Lição do teste: asserir "ninguém está nas duas listas" passa VERDE com o bug, porque as
   grafias diferem — a asserção tem de ser sobre a REMOÇÃO.

**Gabarito:** a 32ª REP passou a travar `nomes_contra` — era o único VERDADEIRO positivo do
`markContra` sem cobertura. Os três verificados no PDF: `"com voto contrário do Diretor Tasso
Mendonça Jr."` (questão de ordem), `"…do Diretor Caio Mario Seabra Filho, relator original"` e
`"…do Diretor-Geral, relator original da matéria"` — este último citado por CARGO, resolvido pelo
preâmbulo. Certificação 153 → **154**.

Mutação verificada nas quatro correções.

## Fase 5 · bloco 3 — o teste FIM-A-FIM (24/08/2026)

`etapa66-fim-a-fim.test.ts` — o primeiro que atravessa **PDF real → `analyzeUploadPdf` →
`buildVotoRows` → `analytics-engine`** e assere invariantes sobre o resultado final.

Por que faltava, medido por varredura: `analyzeUploadPdf` aparecia em 4 arquivos de teste,
`buildVotoRows` em 6, `analytics-engine` em 2 — e **nenhum cruzava os três**. A maior parte dos
defeitos das últimas rodadas apareceu justamente na COMPOSIÇÃO (rota × engine, numerador ×
denominador, extração × projeção SQL), e as invariantes da etapa65 só viam corpus SINTÉTICO.

**Duas lições que o próprio teste ensinou na primeira execução:**

1. **O primeiro "achado" era artefato da INVARIANTE, não do código.** Ele acusou a 81ª — "impedido
   com voto Favoravel" — porque eu agreguei impedidos por DOCUMENTO. Medido: por ITEM o
   impedimento é tratado certo (`Ausente`); o diretor está impedido no 2.1.1 e vota legitimamente
   em outro item. Escopo corrigido para o item. **Mesma classe do C03** — alarme que dispara pelo
   motivo errado treina o revisor a ignorá-lo.
2. **O corpus REAL não substitui o sintético.** A regressão de `taxa_sancao` (numerador sobre todas
   as linhas) **passou verde** no fim-a-fim, porque os 16 documentos não contêm o estado
   adversarial que faz a taxa estourar — item retirado com `microtema='multa'`. A trava foi
   reescrita para comparar o valor PUBLICADO pelo engine com um cálculo independente, e aí a
   mutação fica vermelha. Os dois corpora ficam: **o sintético cobre estados que os documentos não
   têm; o real cobre a composição que o sintético não vê.**

Invariantes cobertas: taxa em [0,100] em 5 agregações; soma dos quatro estados = pautado por
documento; admissibilidade sobrevive ao pipeline; impedido só `Ausente` **no mesmo item**; nenhum
voto para quem o documento não nomeia; ninguém em CONTRA que o dispositivo declara vencedor;
`taxa_sancao` bate com o cálculo independente; consenso sem base é `null`.

⚠️ Limite declarado no cabeçalho do arquivo: o harness roda com `db: null`, então o roster é
SINTETIZADO dos nomes que o próprio documento cita. É fiel ao que a produção faz quando não há
mandato cadastrado, mas não substitui conferência contra o cadastro real.

## Fase 5 · bloco 4 — terminar o que a Fase 4 deixou pela metade (24/08/2026)

A auditoria da própria Fase 4 achou promessas cumpridas só em parte. Registradas aqui **com a
correção do registro**, porque duas delas eu havia declarado fechadas sem estarem.

**`listaDe` chegou onde o plano mandava.** `painel-regulatorio/*` era o **primeiro alvo nomeado**,
tinha ZERO aplicações e agregava imediatamente (`.filter(...).reduce(...)`). Idem `analytics/temas`.
A cobertura anterior foi por arquivo tocado, não por sítio de agregação — que era o critério
declarado. Agora: **todo sítio que agrega imediatamente está protegido** (auditado por varredura nas
12 telas com `.reduce`). Restam 29 call-sites `api.get<X[]>` em telas que NÃO agregam — listagens
que só mapeiam para JSX, onde o error boundary já cobre o dano.

**⚠️ Correção de registro: `agencias/[id]/importar` NÃO estava fechada.** O `PENDENCIAS` dizia "4
divergências fechadas" mas trocou esta por `completude-2026`. Agora fechada de fato: o ramo genérico
publica `diretores`/`lista_triplice` vazios, como o curado. Era armadilha **dormente** — o consumidor
declara os dois campos e hoje só invalida o cache, então bastava alguém lê-los para quebrar.

**`resultado_nao_pode_ser` saiu de 1 para 4 documentos**, todos ancorados em regressão documentada:
- `artesp-delib-22` ≠ "Ratificado" (a regressão que a etapa54 corrigiu);
- `antt-voto-dab-002` ≠ "Deferido"/"Aprovado" — a direção **saía invertida**: o extrator ancorava na
  PRIMEIRA ocorrência de "Ante o exposto", que era a liminar do JUIZ transcrita nos fatos;
- as duas PAUTAS ≠ qualquer decisão — pauta é agenda, e ganhar resultado significa voto FABRICADO
  (a regressão "PAUTA antes de ATA" da etapa12).

Certificação **154 → 164 expectativas**.

### Dívida registrada (não corrigida, conforme prometido no plano da Fase 4)
`isFinalDecisionDelib` (`src/lib/server/associado-documents.ts:149-160`) é um predicado PARALELO e
mais frouxo que `isFinalDecisionRecord` (`regulatory-documents.ts`): não olha
`tipo_documento === "voto_individual"` nem `documento_apoio`, só descarta pauta/reunião ANTT e ata
sem resultado. Consumidores diferentes podem contar universos diferentes. Unificar quando alguém
mexer no módulo de associados — o registro estava prometido na Fase 4 e não foi feito.

## Fase 5 · bloco 5 — ANTT: ⚠️ o diagnóstico da Fase 4 estava ERRADO (24/08/2026)

A Fase 4 concluiu que os 0% de cobertura nominal da ANTT vinham do caminho de DESCOBERTA e listou
quatro correções. **Medido contra três páginas REAIS de 2026 do portal, nenhuma das quatro
reproduz.**

| Verificação | 1036ª RD | 1037ª RD | 288ª RDE |
|---|---|---|---|
| anchors de voto no HTML → capturados | 5 → **5** | 6 → **6** | 3 → **3** |
| votos com `.pdf` só no href decodificado | 0 | 0 | 0 |
| títulos que NÃO casam `VOTO-DXX-NNN-AAAA` | 0 | 0 | 0 |
| documentos do rodapé no último bloco | 0 | 0 | 0 |

O critério de aceite era: **cada correção precisa de um assert que FALHE ANTES e passe depois**.
Nenhuma falha antes — logo **nenhuma entrou**. Consertar o que não está quebrado só adiciona risco.
O critério evitou quatro mudanças inúteis, e é a segunda vez nesta série que a exigência de medição
derruba uma hipótese minha.

**O que o coletor realmente produz** numa página real (1036ª): 5 votos, cada um ligado ao seu
processo (`50500.027626/2025-67` etc.), mais **o RELATOR NOMINAL de cada item** ("DIRETOR FELIPE
QUEIROZ", "DIRETOR ALESSANDRO BAUMGARTNER") e a decisão ("APROVADO POR UNANIMIDADE"). É exatamente
o dado que a cobertura nominal precisa, e ele chega até o fim do parser.

### Entregue: a fixture e a cobertura que faltavam
`src/lib/server/__tests__/fixtures/antt/` (516 KB) com a 1036ª RD, a 288ª RDE e a listagem.
`etapa66-antt-descoberta.test.ts` — 16 testes. Antes disto **nenhum arquivo chamava
`parseAnttMeetingPage`, `parseProcessos` ou `classifyDocumentLink`**; a cobertura existente era só
de orçamento e skip-set. Sem fixture, uma mudança de layout do portal zera a cobertura de voto em
silêncio — a mesma classe de defeito que produziu quase tudo desta série. Seis funções privadas do
collector foram exportadas para que o teste LOCALIZE a regressão em vez de só sinalizá-la.

### ⚠️ Onde investigar de verdade (não é a descoberta)
Se o dado chega íntegro ao fim do parser e a agência aparece com 0% nominal, o gargalo está **a
jusante ou é operacional**. Candidatos, em ordem de probabilidade:
1. **O coletor não está RODANDO.** O plano Hobby da Vercel permite 2 crons/dia e a Etapa 21 moveu
   tudo para botão — `POST /api/v1/antt/2026/collect` precisa ser disparado. **Verificar primeiro**:
   `GET /admin/completude-2026` mostra `ultima_captura` por agência.
2. O documento é coletado mas o confirm não materializa voto nominal — o `antt-voto-dab-002.pdf` do
   corpus prova que a EXTRAÇÃO funciona, então seria no gate de confirmação.
3. `discoverAntt2026Meetings` filtra por `data_inicio?.startsWith("2026-")`; reunião sem data
   parseada é descartada em silêncio.

Nenhum desses é verificável sem produção. **A pergunta certa mudou de "por que o parser perde os
votos" para "por que o coletor não roda ou o confirm não materializa".**

## Fase 5 · bloco 6 — a SÉRIE entra na identidade da reunião (25/08/2026)

### ⚠️ MIGRATION PENDENTE: `20260825120000_reunioes_serie.sql`
Aplicar no SQL Editor. **Deploy antes da migration é seguro** — `ensureReuniao` sonda a coluna e a
omite do payload enquanto ela não existir (mesma disciplina de `votos-write.ts`).

**O problema, medido:** os contadores de reunião são INDEPENDENTES por série, e a chave natural não
tinha série — `UNIQUE (agencia_id, data_reuniao, COALESCE(numero_reuniao,''))`. Prova no corpus: a
**1.024ª Reunião de Diretoria** e a **264ª Reunião Deliberativa Eletrônica** da ANTT compartilham a
data **2026-01-19**. Uma RD 264 e uma RDE 264 na mesma data colidiriam numa linha só.

**Segundo defeito, no backfill da `20260705121000`:** o `CASE` mapeava `ELSE NULL` e
`antt_reunioes_coletadas.tipo` tem TRÊS valores — toda RDE chegou em `reunioes` com
`tipo_reuniao IS NULL`, e o `COALESCE` do `ON CONFLICT` preservou o NULL. Era **o único ponto do
sistema onde a distinção RDE era descartada por código**. A migration repara.

A informação sempre esteve no TÍTULO: `deriveSerie` o lê, e `reuniao_ordinaria` (VARCHAR 100) já
guardava o título completo. Quem perdia era o enum `tipo_reuniao`, de duas cardinalidades.

**Defeito que o TESTE achou antes de ir para produção:** filtrar direto por `serie` faria
`ensureReuniao` **duplicar** toda reunião legada (`serie IS NULL`) em vez de encontrá-la. Corrigido
com busca em DOIS PASSOS — série exata, e se não achar, a linha legada, que é então ENRIQUECIDA
(mesmo princípio já usado para `tipo_reuniao` e `url_fonte`). O insert também passou a gravar
`metadata.titulo`, que antes só o backfill SQL populava.

### C19 · monotonicidade — e por que ela é AVISO, não bloqueante
Dentro da mesma série, número maior não pode ter data anterior. É o terceiro sinal independente
sobre `data_reuniao` (ao lado do C17 e do C18) e o único que enxerga o documento no CONTEXTO.

Duas decisões de desenho:
1. **O check é PURO** — quem busca as vizinhas é o confirm. Receber o `db` deixaria o check inerte
   e silencioso no harness: foi assim que o C16 entrou incapaz de disparar.
2. **Nível `aviso`, e isto é desvio DELIBERADO do plano.** A disciplina desta série exige provar
   ZERO falso positivo contra dado real antes de bloquear (o C03 recusava 8 de 8 atas). Aqui é
   impossível: as 16 fixtures são documentos ISOLADOS, sem vizinhos de série, e remarcação de
   reunião e publicação fora de ordem são hipóteses que não consigo descartar sem produção.
   **Vira bloqueante quando alguém rodar contra a base e mostrar o número.**

Mutação verificada em três direções (série colapsada, milhar não normalizado, busca de um passo só).

## Fase 5 · ANTT — como descobrir onde o funil para (25/08/2026)

`GET /api/v1/admin/antt/diagnostico-coleta` — **READ-ONLY** (o teste prova: o banco falso lança em
`insert`/`update`/`delete`/`upsert`). Responde sem SQL à pergunta que sobrou: **se o parser extrai
os votos corretamente, por que a agência aparece com 0% nominal?**

Mede o funil inteiro e diz **em qual degrau o número cai**:

| Degrau | O que significa cair aqui |
|---|---|
| **1 · descoberta** | reuniões coletadas = 0, ou última coleta > 7 dias. **Candidato nº 1**: plano Hobby (2 crons/dia) + Etapa 21 moveu tudo para botão ⇒ ninguém dispara `POST /api/v1/antt/2026/collect` |
| **2 · download** | reuniões coletadas mas nenhum documento de voto baixado |
| **3 · extração** | voto baixado que não virou `voto_individual` ⇒ ver `/admin/upload/pendencias-voto` |
| **4 · voto nominal** | extraído sem linha NOMINAL ⇒ o gate do confirm não materializa, ou o relator não casa o cadastro |

Também acusa se a série **eletrônica** (RDE) está ausente: a ANTT publica nas duas, e se a listagem
tem RDE e ela não aparece na coleta, o filtro de título está descartando.

**Operação:** chamar autenticado como admin e ler `degrau_que_para` + `diagnostico`. Se for o degrau
1, a resposta é operacional, não de código.

## ⚠️ Incidente de deploy (26/08/2026) — `vercel.json` com chave desconhecida

Oito deploys seguidos falharam em 4-5s durante ~4 horas. Causa: eu adicionei `"_comentario"` dentro
de uma entrada de `crons` para explicar a troca do cron da Fase 7. JSON não tem comentários e o
schema do Vercel **rejeita propriedade desconhecida**.

**O que torna isso perigoso:** a falha é de validação de CONFIGURAÇÃO, não de build. Ela acontece
antes de o Next compilar, então o ritual local inteiro (`type-check`, `test`, `build`, `lint`)
passa verde. Nada no repositório olhava para o `vercel.json`.

**Conserto:** propriedade removida; a explicação da troca do cron vive no commit `ec484b7` e no
bloco da Fase 7 acima. E o teste `etapa71-vercel-config.test.ts` passa a validar o arquivo —
chaves de topo, `crons` com exatamente `path`+`schedule`, rota existente que exporta `GET` (o cron
dispara GET), `schedule` de 5 campos, e `functions` apontando para arquivos reais.

## Fase 9 — o que a produção revelou (26/08/2026)

Primeira fase guiada por **medição do banco de produção**, não por leitura de código. 7 commits.

1. **ZIP na esteira.** 88% das "Deliberações" da ARTESP são `.zip`; o gate conhecia só PDF e HTML.
   `zip-extractor.ts` existia desde julho, ligado só ao upload manual. ~2.500 deliberações
   inacessíveis. Inclui guard de DOCX (que **é** ZIP) e fim do livelock (teto de PDFs só entre itens).
2. **Reabrir os `sem_pdf` de 2026** (migration `20260826150000`). A regra da Fase 8 foi revista:
   `sem_pdf` volta, mas só carimbado — e o caminho que grava `sem_pdf` limpa o carimbo, então é um
   tiro só, nunca moinho.
3. **WAF deixa de ser `ok`.** O portal da ARTESP responde 200 com desafio do Imperva (reproduzido:
   6.183 bytes). Uma única âncora derrotava a heurística de headless.
4. **ARTESP: 76% dos documentos na reunião errada.** `HEAD_RE` não casava "Reunião Extraordinária"
   (ZWSP + `&nbsp;` no meio). Inclui **crawl auto-reparador** — e a normalização **preserva o
   comprimento**, porque as âncoras são ligadas por índice de byte.
5. **A data vinha da lei citada no preâmbulo.** Fallback sem âncora morto, sobrescrita
   incondicional corrigida, e guard C20 que conhece o **ano de criação da agência**.
6. **Rota `admin/deliberacoes/redatar`** — re-deriva as datas impossíveis. Anular seria pior:
   `year-filter` conta deliberação sem data em TODOS os anos.
7. **Os presos**: terceiro reaper (`queued`), `requeueDocument` atômico e com o elo,
   `reprocess-ignorados` honrando o orçamento, passo novo para `failed` com teto, legenda honesta.

Suíte 1097 → **1197**. Migration desta fase: **`20260826150000`** (aplicar DEPOIS do deploy).

### ⚠️ Registrado e NÃO corrigido

- **A chave semântica tem DUAS implementações e só uma foi consertada.** `buildSemanticDuplicateKey`
  (etapa71) passou a distinguir os votos da mesma reunião, mas o parser manual da ANTT emite a
  própria `dedupe_semantic_key` (`ANTT|reuniao|processo|diretor|tipo`) e TEM PRECEDÊNCIA sobre ela
  em `upload-analysis.ts` e no `preview`. Aquela chave não colide hoje (carrega o diretor), e
  mexer nela criaria ponto cego contra os 437 votos já gravados — por isso ficou como está. Se um
  dia o diretor e o processo saírem vazios no mesmo voto, ela volta a fundir documentos.
- **32 pautas da ARTESP são DOCX** e o projeto não lê DOCX. Hoje saem com motivo honesto
  (`formato_nao_suportado:docx`) em vez de se disfarçarem de "página sem PDF". Ingerir exigiria
  ~40 linhas usando o `inflateRawSync` que já está no repo.
- **O disjuntor é cego para falha de enfileiramento** (`contarPassos` só conta a chave `erro`, e
  `etapas.extracao` não tem canal de erro).

## Fase 8 — "nada fica para trás" (26/08/2026)

Origem: a pergunta "a coleta puxa tudo, sem deixar documento para trás?". A resposta era NÃO, por
três caminhos — e a análise de risco (4 agentes) desenterrou um quarto, maior que os três.

1. **Um VOTO perdido por reunião.** Medido: a 1.036ª RD da ANTT publica 7 PDFs (pauta, ata e 5
   votos); `maxFilhos = 6` cortava sempre o sétimo, e como pauta e ata vêm primeiro no DOM a perda
   caía sempre sobre um voto de diretor. Teto agora é 12.
2. **7 documentos, 1 nome.** As URLs do Liferay terminam em UUID, então todos os documentos de uma
   reunião caíam no slug do título — `1-036-Reuniao-de-Diretoria.pdf`, sete vezes. Isso quebrava o
   RESGATE de votos mal classificados da esteira, que casa `voto[ _-]+d[a-z]{1,2}` no filename.
   Agora: 7 nomes, e os 5 votos voltam a casar.
3. **Falha de rede virava morte permanente.** E as "3 tentativas" queimavam em segundos na mesma
   rodada. Agora o item é arquivado COM PRAZO (1, 3, 7, 14 dias) e volta sozinho.
4. **Arquivados invisíveis.** A rota sempre os devolveu; a tela filtrava só `novo`.

### Migrations desta fase (SQL Editor)

- **`20260826140000_monitoramento_itens_retry.sql`** — colunas `tentativas` e
  `proxima_tentativa_em` + índice + **backfill do passivo** (sem ele o conserto nasceria sem efeito
  sobre os itens que já estão arquivados). Pode ser aplicada antes ou depois do deploy; sem ela o
  retry simplesmente não acontece.

### ⚠️ Riscos que ficaram registrados, não corrigidos

- **O disjuntor é cego para falha de enfileiramento.** `contarPassos` só conta erro quando a etapa
  tem a chave `erro`, e `etapas.extracao` é montada sem canal de erro. Um retry que falha
  sistematicamente não abre o disjuntor nem aparece.
- **`.limit(60)` é aplicado pelo Postgres antes de qualquer filtro em JS.** Vale para qualquer
  filtro de elegibilidade futuro: se não virar cláusula WHERE, os inelegíveis continuam ocupando
  as vagas — o modo de falha documentado em "208 detectados / 0 na fila".

## Fase 7 — dívidas registradas (26/08/2026)

### ⚠️ DÍVIDA DE MODELAGEM: `hash_item` embute o `tipo` (a causa, não o sintoma)

`monitoramento_itens.hash_item = sha256(tipo | url | reuniao | data)` (`monitoring.ts:261`) sob
`UNIQUE (site_id, hash_item)` (migration `005`). **A chave de deduplicação depende de um campo
derivado por classificador.** Consequência: qualquer ajuste em `classifyLinkType` muda o hash dos
mesmos links → o crawl insere **linhas novas** e as antigas viram órfãs imortais em `status='novo'`,
inflando o contador de "detectados não processados" com fantasmas. Foi exatamente o que aconteceu
com as 326 atas da ANM, e foi preciso a migration `20260826120000` para limpar.

**Se `hash_item` fosse `f(site_id, url)`, reclassificar seria um `UPDATE`** — sem linhas novas, sem
órfãos, sem migration de limpeza. Não entrou na Fase 7 porque é expand-contract sobre a chave única
de uma tabela viva (adicionar `hash_url` → backfill → trocar a constraint → dropar a antiga), e a
Fase 7 já mexe na classificação. **Fica registrado para a Fase 8 não repetir a Fase 7**: sem isso,
o próximo ajuste de classificador paga o mesmo pedágio.

### Migrations desta fase (aplicar no SQL Editor, nesta ordem)

1. **`20260826120000_anm_reclassificar_diretoria.sql`** — apaga os `monitoramento_itens` presos em
   `status='novo' AND tipo='diretoria'` dos sites ativos, para o crawl seguinte redescobri-los já
   como `ata`/`pauta`/`voto`. ⚠️ **Aplicar DEPOIS do deploy do código** (antes, o crawl recriaria
   com o tipo errado — inofensivo, mas seria preciso reaplicar). Idempotente; o código funciona sem
   ela (só continua contando os fantasmas).
2. **`20260826130000_esteira_runs.sql`** — a tabela de execução da esteira (retomar, lock,
   disjuntor). Sem ela a esteira roda exatamente como antes: executa, mas não lembra — nem o
   painel "está rodando agora", nem o lock entre abas, nem o disjuntor funcionam. Pode ser aplicada
   antes ou depois do deploy.

### ⚠️ O que MUDA na operação depois desta fase

- **O cron das 12:30 deixa de ser `upload/auto-confirm` e passa a ser `pipeline/run`** (a esteira
  completa CONTÉM o auto-confirm — é o passo 1 dela). O plano Hobby só permite 2 crons/dia, então
  trocar foi a forma de a esteira andar sozinha sem gastar slot novo.
- **A ordem da rodada inverteu**: aprovar o que já está em revisão vem ANTES de coletar material
  novo. Numa primeira rodada com fila cheia, é normal ver muita aprovação e pouca coleta.
- **O contador de "detectados" vai CAIR de sentido, não de valor**: passa a separar
  `total_na_esteira_votos` (trabalho de voto que falta) de `total_fora_da_esteira_votos`
  (notícia/consulta/política, que nunca virariam voto e continuam alimentando outros módulos).
- **Teto de 60 documentos novos por rodada.** Não é limite de capacidade: o excedente fica na fila
  e entra na rodada seguinte.

## Fase 6 — UI confiável e esteira que decide sozinha (25/08/2026)

Sete commits a partir dos quatro achados de produção do usuário (com prints), na ordem que ele
reordenou: **dano ativo antes de elegância**.

**Commit 0 · Qualidade "parar de mentir"** — persistência engolida virou `persist_error` visível;
timeout de rede deixou de virar nota 0 (`fetch_failed` ≠ `inexistente`, com
`rebaixamentos_evitados_por_portal_inacessivel` na resposta); o texto falso "apenas evidencias
validadas alimentam a pontuacao" saiu (nenhuma evidência alimenta pontuação — a nota vem das
avaliações).

**Navegação** — "melhor casamento vence" (`nav-active.ts`): as 5 colisões de item/aba duplo-ativo
resolvidas; rotas órfãs adotadas (perfil do diretor → Diretores; reuniões → Deliberações).

**Drenagem + auto-resolver** — o lixo legado ("Você Pode" etc.) é rejeitado em cascata pelo
recompute; o piso inventado de 35% morreu; e a fila deixou de ser etapa: o resolver desambigua pelo
MANDATO ativo na data → margem → fallback que aprova carimbando `confianca_match` (primeira
escrita da coluna). **A medição está embutida**: `resolvidos_por_mandato / por_margem / sem_margem
/ rejeitados_lixo` no resumo do "Rodar tudo" — a primeira rodada em produção diz se o fallback é
raro como a hipótese (titular × ex-titular) prevê.

**Relatoria + 3 famílias** — `deliberacoes.relator` ganhou seu primeiro consumidor de métrica
(era denso nas 3 agências e ninguém olhava); o perfil do diretor reorganizado em Carga e
desfecho / Dissenso (base nominal com n visível) / Conduta processual; matriz de capacidade POR
EIXO substituiu a matriz morta e virou legenda na tela.

**Qualidade plumbing** — "Coletar todas" encadeia web → derivadas → classificar (o módulo real
estava DESLIGADO: os dois coletores bons não tinham botão nem cron); fontes genéricas viraram
check de conectividade (⚠️ **contadores de evidência CAEM** — cortada a fabricação de ~108
pseudo-evidências por rodada; decisão do usuário); painel "última coleta por agência"; Prêmio
Evolução sem base histórica declara "sem base" em vez de eleger vencedora arbitrária; banner
LGPD/LAI removido da UI (conformidade praticada, não anunciada — payload `legal` segue nos
relatórios); acentuação corrigida nas strings visíveis.

### ⚠️ Pendências registradas (não corrigidas)
- **Logo**: aguardando o usuário salvar a arte nova em **`public/brand/logo-iris.png`** — a troca
  na sidebar+login está desenhada (chip preto, `h-10`/`h-12`) e é um commit pequeno quando o
  arquivo chegar. O asset atual (`newsletter-logo-wide.png`) é lettering para 140px espremido a
  32px — NÃO mexer nele: newsletter/boletim/relatórios o usam no tamanho certo e 2 testes travam
  o caminho.
- **Seed antigo da Qualidade é uma mina**: `20260604123000_qualidade_regulatoria_seed_2026.sql`
  gera níveis do modelo antigo (`'avancado'` etc.) — se REAPLICADO depois da migration IMQN
  (`20260702120000`), falha no CHECK novo. Forward-only na prática; não reaplicar.
- **Constante × tabela de agências**: o ranking itera `QUALIDADE_AGENCIAS` (hardcoded, 12) e não a
  tabela `qualidade_regulatoria_agencias` — agência cadastrada só no banco nunca entra no ranking,
  e vice-versa. Reconciliar quando o módulo ganhar agência nova.
- **Métricas de voto de qualidade e voto vista**: exigem persistência nova (`papel` é coluna morta;
  nenhum caminho grava `motivo_nao_voto: "vista"`). Desenho: gravar `papel`/`motivo` no confirm e
  agregar na família Conduta processual.

## Invariantes de operação (não quebrar)

- Commits com autor `Joao Nery <214216649+Joaodesouzanery@users.noreply.github.com>`
  (e-mail gmail bloqueia o deploy na Vercel). Nunca force-push em `main`.
- Migrations são aplicadas manualmente pelo usuário no SQL Editor (idempotentes).
- Voto nominal nunca é rebaixado a inferido. Desde a etapa58 há TRÊS writers (confirm, backfill
  retroativo e materializar-faltantes) e todos passam por `src/lib/server/votos-write.ts`, que
  centraliza a proteção, a sonda de capacidade de coluna e a propagação do erro.
- `isResultadoPositivo` (src/lib/utils.ts) é a fonte única de "resultado favorável".
