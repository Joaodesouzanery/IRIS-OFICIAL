# Módulo "Voto dos Diretores" — guia de extração para outro projeto

A "esteira de votos" é a **fonte única**: coleta (monitoramento de sites/ANTT) → extração de PDFs
oficiais → **deliberações** → **votos por diretor** → métricas. **Writer único de votos =
`upload/confirm`**. Este guia lista TUDO que precisa ir junto (código + Supabase) e as MÉTRICAS geradas.

Stack: Next.js 15 (App Router) + Supabase (service_role). Sem ORM; migrations idempotentes aplicadas
manualmente no SQL Editor.

---

## 1. ARQUIVOS DE CÓDIGO A COPIAR

### 1.1 Rotas de API — `src/app/api/v1/`
**Upload / extração de PDF (o writer de votos):**
`upload/batch`, `upload/preview`, `upload/confirm` ⭐(writer), `upload/process`, `upload/auto-confirm`,
`upload/reprocess`, `upload/documentos`, `upload/clear-test-queue`, `upload/jobs/[jobId]`,
`upload/jobs/[jobId]/stream` — cada um `/route.ts`.

**Deliberações:** `deliberacoes`, `deliberacoes/[id]`, `deliberacoes/[id]/download`,
`deliberacoes/enqueue-pdfs`, `deliberacoes/export`, `deliberacoes/votos-diretores`,
`deliberacoes/votos-diretores/backfill`.

**Votos:** `votos/recalcular-divergencia`, `votos/reprocessar-abstencoes`,
`relatorios/votos-diretores`, `dashboard/diretores/[id]/votos`.

**Coleta / monitoramento / ANTT:** `monitoramento/check`, `monitoramento/sites`,
`monitoramento/sites/[id]/test`, `monitoramento/alertas`, `monitoramento/alertas/[id]/review`,
`monitoramento/runs`, `antt/2026/collect`, `antt/2026/documentos`, `antt/2026/documentos/[id]`,
`antt/2026/documentos/[id]/download`.

**Diretores / candidatos / mandatos:** `diretores/candidatos`, `diretores/candidatos/[id]/aprovar`,
`diretores/candidatos/[id]/rejeitar`, `diretores/candidatos/aprovar-lote`,
`admin/diretores/candidatos/recompute`, `admin/diretores/duplicatas`, `admin/upload/pendencias-voto`,
`admin/upload/reprocess-ignorados`, `admin/deliberacoes/dedup`, `mandatos`, `mandatos/analytics`,
`mandatos/recalcular`, `mandatos/stats`.

**Métricas/analytics (leem votos):** `votacao/{matrix,distribution,fidelidade,sectors,consenso-timeline}`,
`dashboard/{overview,diretores/overview,governanca-agencias,microtemas,microtemas/evolution,reunioes/calendar,reunioes/stats}`,
`admin/{saude-dados,completude-2026,cobertura-documentos}`.

### 1.2 Lib de servidor — `src/lib/server/` (NÚCLEO exclusivo da esteira)
`vote-inference`, `nlp-extractor`, `upload-analysis`, `upload-queue`, `pipeline`, `auto-confirm`,
`pdf-extractor`, `zip-extractor`, `ocr`, `ata-splitter`, `classifier`, `antt-manual-parser`,
`deliberacao-dedup`, `candidato-approval`, `retroactive-votes`, `diretor-duplicatas`, `diretor-merge`,
`reunioes`, `colegiado-sources`.
**Coleta:** `antt-2026-collector`, `monitoring`, `monitoring-runner`, `headless`, `resilient-fetch`, `url-guard`.

### 1.3 Lib COMPARTILHADA (serve outros módulos, mas é dependência — vai junto)
`request-guards`, `is-demo`, `admin-emails`, `http-params`, `time-budget`, `name-matcher`,
`empresa-resolver`, `area-regulatoria`, `regulatory-documents`, `analytics-engine`, `local-data-store`.
**Fora de `server/`:** `src/lib/supabase/server.ts` ⭐(cliente service_role), `src/lib/utils.ts`,
`src/lib/demo-data.ts`, `src/lib/mandatos.ts`.

### 1.4 Tipos
`src/types/index.ts` — **copiar inteiro** (monolítico; contém `Deliberacao`, `Voto`, `Diretor`,
`Mandato`, `UploadJob`, etc.).

### 1.5 Frontend (opcional — só se levar a UI)
Páginas `src/app/dashboard/{votacao,deliberacoes,deliberacoes/[id],deliberacoes/votos-diretores,mandatos,mandatos/[id],analytics,analytics/diretores,analytics/institucional,analytics/temas,360}/page.tsx`.
Componentes `src/components/charts/{ChartWrapper,GaugeChart,IrisArea/Bar/Line/Pie Chart,IrisHeatmap,MandatoGanttChart}.tsx`,
`src/components/ui/{HelpTooltip,ModuleTabs}.tsx`, `src/components/DataSyncProvider.tsx`.

### 1.6 Testes + fixtures (recomendado — é o padrão-ouro)
`src/lib/server/__tests__/`: `vote-certification`, `vote-extraction`, `vote-extraction-golden`,
`vote-inference`, `name-validation`, `etapa17-metricas-votos`, `etapa18-voto-zero-toque`,
`etapa19-votos-esteira`, `etapa21-votos-confiavel`, `auto-confirm-gate`, `etapa14-budget-dedup`,
`etapa16-cobertura-dedup`, `time-budget`, `ocr`, `artesp-parser`, `parser-improvements`,
`monitoring-pagination`. **Fixtures:** `__tests__/fixtures/votos/` (NÃO precisa `fixtures/news/`).

### ❌ NÃO copiar (outros módulos): `news-*`, `newsletter-*`, `qualidade-*`, `agencias-crud`,
`associado-*`, `docx-export`, `html-dom`, `votacao-filters`.

---

## 2. DEPENDÊNCIAS NPM
`pdf-parse` + `@types/pdf-parse`, `node-html-parser`, `puppeteer-core`, `@sparticuz/chromium`,
`@supabase/supabase-js`, `clsx`, `tailwind-merge`, `date-fns`, `next`. (`zlib`/`crypto` são nativos.)

## 3. ENV VARS
**Críticas:** `NEXT_PUBLIC_SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `CRON_SECRET`, `ADMIN_EMAILS`,
`IRIS_OWNER_EMAIL`, `OCR_SPACE_API_KEY`.
**Coleta (opcionais):** `HEADLESS_FALLBACK`, `COLLECTOR_HOST_THROTTLE_MS`.

---

## 4. SUPABASE — recriar o schema do módulo

### 4.1 Migrations a aplicar, NESTA ORDEM (as demais do repo NÃO pertencem à esteira)
`001_initial_schema` → `002_expand_deliberacoes` → `003_add_assunto` → `004_expand_resultado_microtema`
→ `005_monitoramento_multiagency` → `009_antt_2026_secure_collection`
→ `20260517173457_documentos_regulatorios_async_upload` → `20260517195947_expand_directors_schema`
→ `20260518160356_document_monitoring_upload_queue` → `20260519123000_repair_deliberacoes_columns`
→ `20260622120000_deliberacoes_data_publicacao` → `20260622130000_coleta_telemetria_hardening`
→ `20260623120000_votos_audit_retroativo` → `20260623121000_empresas_normalizacao`
→ `20260624120000_mandatos_higiene` → `20260624130000_reunioes_consolidadas_view`
→ `20260629120000_documentos_rastreabilidade` → `20260705120000_documentos_coletados_ata`
→ `20260705121000_reunioes_materializadas` → `20260705122000_mandatos_seed_2026`
→ `20260708120000_deliberacoes_unique` → `20260709120000_mandatos_rede_votos`
→ `20260710120000_seed_diretor_antt_dsm` → `20260715120000_auditoria2_rls_arquivo_e_indices`
→ `20260716120000_auditoria3_seguranca_fk_pk`.

### 4.2 ⚠️ AJUSTES obrigatórios ao portar só a esteira
- **`20260517195947`**: remova os blocos `lista_triplice` / `iris_seed_lista_triplice` (a tabela
  `lista_triplice` é do módulo Associados). Sem isso a migration falha.
- **`20260622130000`**: a view `coleta_execucoes` faz `UNION ALL` com `regulatory_news_collection_runs`
  (módulo Notícias). Remova esse 2º SELECT ou pule a view.
- **`20260705121000`**: o bloco que derruba a FK órfã `reunioes_regulatorias` roda inofensivo num
  projeto novo (não acha FK). **NÃO recrie `reunioes_regulatorias`.**
- **`20260716120000`**: o `REVOKE` das funções `sync_deliberacao_partes_*` é guardado por `pg_proc` —
  roda sem erro mesmo elas não existindo (são órfãs de produção, ligadas a `deliberacao_partes`, fora do repo). Ignore.

### 4.3 Tabelas do módulo
`agencias`, `diretores`, `mandatos`, `upload_jobs`, `deliberacoes`, `votos`, `monitoramento_sites`,
`monitoramento_itens`, `monitoramento_alertas`, `monitoramento_runs`, `diretor_candidatos`,
`documentos_regulatorios`, `antt_reunioes_coletadas`, `antt_processos_coletados`, `documentos_coletados`,
`empresas`, `votos_retroativos_audit`, `reunioes`, `fontes_oficiais`, `diretor_fontes`, `mandato_fontes`.
Views: `reunioes_consolidadas`, `coleta_execucoes`.

### 4.4 Grafo de FKs (núcleo mínimo para materializar um voto)
```
agencias → diretores → mandatos
agencias → deliberacoes → votos      (votos.diretor_id → diretores)
UNIQUE(votos.deliberacao_id, diretor_id)  ← chave de idempotência
deliberacoes.{upload_job_id→upload_jobs, empresa_id→empresas, reuniao_id→reunioes, documento_pai_id→self}
```
Cadeia de coleta: `antt_reunioes_coletadas → antt_processos_coletados → documentos_coletados →
documentos_regulatorios → deliberacoes`. `monitoramento_sites → monitoramento_itens →
monitoramento_alertas`.

### 4.5 Funções / extensões / RLS / storage
- **`update_updated_at()`** (001) — trigger BEFORE UPDATE em quase todas as tabelas. **Obrigatória.**
- `iris_seed_director()` — só p/ seed; a própria migration a dropa. Objeto não permanente.
- Extensões: `uuid-ossp`, `pg_trgm` (+ `gen_random_uuid()` nativo pg≥13). Bucket storage `pdfs` (privado, 50MB, application/pdf).
- **RLS**: aplique o padrão `FOR ALL TO service_role USING(true) WITH CHECK(true)` + `REVOKE ALL FROM
  anon, authenticated` em TODAS as tabelas base (001/005/009 nasceram com policy ABERTA — a `20260716120000` só corrigiu 3).

### 4.6 Seed mínimo (para a esteira rodar do zero)
Agências ANTT/ANM/ARTESP + diretores + mandatos iniciais (vêm nas migrations `20260517195947`,
`…05122000`, `…09120000`, `…10120000`) + sites de monitoramento (009, `…18160356`).

---

## 5. MÉTRICAS GERADAS (o que o módulo produz)
Calculadas em dois modos que replicam a mesma fórmula: `analytics-engine.ts` (demo/synced) e as rotas de
API (real/Supabase).

### Deliberações / Overview
Total de deliberações finais · Deferidos/Indeferidos/Sem resultado · **Taxa de deferimento** · Reuniões
únicas · Confiança média de extração (IA) · Top microtema · % auto-classificado · Pauta interna vs externa.

### Diretores
Total de votos por diretor · Favoráveis/Desfavoráveis/Abstenção/Divergente · **Nominais vs inferidos** ·
% favorável · **Perfil** (Consensual / Moderadamente divergente / Divergente por faixa de % divergência) ·
Taxa de aprovação · Microtema dominante · Histórico cronológico · Votos por microtema.

### Votação (painel)
**Matriz diretor×voto** · Distribuição de votos (Favorável/Desfavorável/Abstenção/Ausente, contagem e %) ·
**Taxa de fidelidade** (1 − divergentes/total) · Setores/microtemas por volume de votos · **Timeline de
consenso** (por mês) · **Cobertura nominal** (% de itens/mês com ≥1 voto nominal).

### Reuniões (colegiado)
Por reunião: itens, votos, nominais, inferidos, divergências, **% de consenso** · Deferidos/indeferidos ·
Calendário (itens/data) · Stats por mês.

### Mandatos
Diretores ativos · **Participações colegiadas** · **Taxa de consenso** · **Taxa de litígio** · **Taxa de
sanção** · Distribuição de decisão · Evolução mensal · Período do mandato (derivado das reuniões votadas).

### Governança por agência
Consenso · Cobertura nominal · Deferimento · Qualidade IA (média de confiança) · Sanção — todas por agência.

### Microtemas / temas
Volume e resultado por tema · % deferido/indeferido por tema · Evolução mensal por tema.

### Empresas / 360 / Alertas
Ranking de empresas por deliberações (% deferido) · **Risco regulatório** (alto/médio/baixo) · Tendência
(melhorando/estável/piorando) · Alertas: empresa em risco, tema emergente, diretor divergente.

### Motor de inferência (base de tudo)
`is_nominal` (extraído por nome vs inferido por mandato) · `is_divergente` (relativo ao resultado da
maioria; abstenção sempre diverge) · Origem do voto (nominal/inferido_mandato/contrario/abstencao/ausente).

### Saúde de dados & completude (qualidade das métricas)
% cobertura de votos · % nominal · buckets de confiança (alta/média/baixa) · diretores sem mandato ·
deliberações duplicadas/votos órfãos · funil do scraper (descobertas → coletadas → deliberações finais) · staleness.

---

## 6. ACOPLAMENTO (o que revisar ao portar)
`request-guards.ts` e as rotas assumem o padrão IRIS: **gate de demo** (`is-demo`/`demo-data`),
**`CRON_SECRET`**, **`ADMIN_EMAILS`** e **Supabase service_role**. Esses arquivos são o acoplamento real com
o app — leve-os junto ou substitua o guard/gate de demo pela auth do projeto novo. `agencias`,
`diretores` e `mandatos` são **raízes compartilhadas** (também servem o painel institucional); no projeto
novo elas são a base — traga-as inteiras. O ritual de verificação (`type-check && test && build && lint`) e
o `vote-certification.test.ts` (46 expectativas sobre PDFs reais) são o padrão-ouro; mantenha-os verdes.
