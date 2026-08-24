# PENDÊNCIAS E OPERAÇÃO — IRIS-Regulação

Ações manuais recorrentes, datas sensíveis e itens adiados por decisão de produto.
Atualize este arquivo quando resolver ou adiar algo (última revisão: Etapa 22, 22/jul/2026).

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

## Invariantes de operação (não quebrar)

- Commits com autor `Joao Nery <214216649+Joaodesouzanery@users.noreply.github.com>`
  (e-mail gmail bloqueia o deploy na Vercel). Nunca force-push em `main`.
- Migrations são aplicadas manualmente pelo usuário no SQL Editor (idempotentes).
- Voto nominal nunca é rebaixado a inferido. Desde a etapa58 há TRÊS writers (confirm, backfill
  retroativo e materializar-faltantes) e todos passam por `src/lib/server/votos-write.ts`, que
  centraliza a proteção, a sonda de capacidade de coluna e a propagação do erro.
- `isResultadoPositivo` (src/lib/utils.ts) é a fonte única de "resultado favorável".
