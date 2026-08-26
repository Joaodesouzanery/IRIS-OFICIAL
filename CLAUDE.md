# IRIS-Regulação — Instruções do projeto

Plataforma de inteligência regulatória (Next.js 15 App Router + Supabase). O coração é a
**esteira de votos dos diretores** (coleta → extração de PDFs → votos), que é a **fonte única**
de todos os módulos (Analytics, Votação, Governança, Mandatos, Empresas, Qualidade, Boletim).

## Stack
- **Next.js 15** (App Router) + **React 18** + **TypeScript** · **npm** (só `package-lock.json`).
- **Supabase** (`@supabase/supabase-js` + `@supabase/ssr`) — persistência e auth.
- **TanStack React Query** (server-state no front) · **Zustand** (estado local).
- **Tailwind** + **Radix** + `lucide-react` · gráficos **Recharts** + **D3**.
- Scraping/PDF: `pdf-parse`, `puppeteer-core` + `@sparticuz/chromium`, `node-html-parser`.
- Deploy: **Vercel** (região `gru1`), crons em `vercel.json`. **Sem** Docker/k8s/CI-GitHub/Python/Go.
- **Sem `zod`**: validação de input é **manual/imperativa** (escolha do projeto).

## Comandos
```bash
# Ritual de verificação (o Node vem do nvm — exporte o PATH ou "node: command not found"):
export PATH="$HOME/.nvm/versions/node/v24.17.0/bin:$PATH" \
  && npm run type-check && npm run test && npm run build && npm run lint
```
- `npm run type-check` = `tsc --noEmit` · `npm run test` = `vitest run` · `npm run lint` = `next lint`.
- Testes ficam em `src/lib/server/__tests__/` (Vitest, **unit/domínio**; sem coverage tooling nem
  testing-library). O harness `vote-certification.test.ts` (46 expectativas sobre PDFs oficiais
  reais) é o **padrão-ouro**: novas mudanças na extração devem manter esse teste verde.

## Convenções de rota de API (o que difere do genérico)
Handler típico em `src/app/api/v1/**/route.ts`, nesta ordem:
1. **Gate de demo**: `if (isDemo() || isDemoRequest(req)) return NextResponse.json(<demo>)`. Escrita
   é bloqueada em demo. TODA rota respeita isso.
2. **Guard de auth** (`src/lib/server/request-guards.ts`): `const guard = await requireAdmin(req);
   if (guard) return guard;` — o guard retorna um `NextResponse` de erro OU `null`. Use
   `requireAdminOrCron` para rotas que também rodam como cron (Bearer `CRON_SECRET`).
3. **Client Supabase por import dinâmico** dentro do handler:
   `const { createSupabaseServerClient } = await import("@/lib/supabase/server")`.
4. **Resposta CRUA** via `NextResponse.json`: sucesso devolve o payload direto (SEM envelope
   `{data}`); erro usa `{ error: string }` + `{ status }`. Não introduzir envelope `{data}`.
5. **Validação manual** (checagens explícitas + `NextResponse.json({error}, {status:400})`). Não
   adicionar `zod` sem pedido explícito.

## Degrade-gracioso é PROPOSITAL (não é silent-failure)
Vários caminhos degradam de propósito para o deploy ser seguro antes de migrations e para nunca
derrubar a esteira: `ensureReuniao`→`null` (tabela ainda não migrada), `buildAnttMeetingSkipSet`
catch→`Set` vazio (re-crawl completo), dedup de deliberações catch→segue como insert normal.
Ao revisar, trate isso como desenho — ver a skill `iris-api-conventions`.

## Migrations (Supabase)
Aplicadas **manualmente** pelo usuário no **SQL Editor**, **idempotentes** e **forward-only**
(sem ORM). O código deve degradar sem elas (deploy antes da migration é seguro). Detalhes,
armadilhas (FK órfã `reunioes_regulatorias`, nunca confiar em nome de constraint) e checklist:
ver a skill `iris-migrations`. RLS/indexação/pooling: `.agents/skills/supabase-postgres-best-practices`.

## Commits e deploy
- **E-mail de commit OBRIGATÓRIO**: `214216649+Joaodesouzanery@users.noreply.github.com` (nome
  "Joao Nery"). Commit com e-mail gmail **bloqueia o deploy no Vercel**.
- Rodapé: `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`.
- **NUNCA** force-push em `main`. Push em `main` → **deploy automático no Vercel**.
- **Tempo de função — o número que vale é 60s, não 120s.** O `vercel.json` pede `maxDuration: 120`,
  mas (a) no plano **Hobby** o SIGKILL vem aos **60s** independentemente disso (o 120 só vale no Pro)
  e (b) **14 rotas declaram `export const maxDuration = 60` no próprio arquivo**, e o segment config
  do Next tem precedência sobre o `vercel.json` (só `pipeline/run` declara 120). Estourar =
  **SIGKILL incatchável** (nem success nem error gravam). Por isso `HOBBY_BUDGET_MS = 50s`
  (`src/lib/server/time-budget.ts`) é o orçamento real de uma rodada.
- **Regra de orçamento (Fase 7):** nenhum passo pode receber uma FATIA menor que a RESERVA interna
  que ele exige — senão ele roda, gasta o round-trip de auth e devolve zero em silêncio. Foi assim
  que a coleta (fatia 8s × reserva 25s) inseriu zero itens por rodada durante semanas.
- **`vercel.json` NÃO aceita comentário nem chave desconhecida.** JSON não tem comentários, e o
  schema do Vercel rejeita propriedade extra — inclusive `"_comentario"`. A falha é de VALIDAÇÃO
  DE CONFIGURAÇÃO: quebra em 4-5s, antes de qualquer build, então `npm run build` local passa
  verde e não vê nada. Isso derrubou 8 deploys seguidos (26/08). A explicação de uma mudança vai
  no COMMIT e em `docs/PENDENCIAS.md`, nunca no JSON. O teste `etapa71-vercel-config` valida o
  arquivo (chaves de crons/functions, rotas que existem, schedule de 5 campos) — rode o ritual
  antes de pushar mudanças de config.
- Sem segredos versionados; segredos só em env do Vercel/Supabase.

## Pendências e operação
Ações manuais recorrentes, datas sensíveis (ex.: mandatos interinos ANM vencem 30/11/2026) e itens
adiados por decisão: **`docs/PENDENCIAS.md`** — atualizar ao resolver/adiar pendências.

## Dados / LGPD
Diretores são agentes públicos — base legal `public_official_function`. A esteira de votos é a
FONTE ÚNICA dos módulos; ver o roadmap e migrations pendentes na memória do projeto
(`~/.claude/projects/.../memory/`). Checklist de segurança/LGPD: skill `iris-security-lgpd`.

## Configuração Claude Code deste repo (`.claude/`)
- `.claude/agents/` — code-reviewer, silent-failure-hunter, security-reviewer, build-error-resolver,
  planner (curadoria enxuta; adicionar outros só se necessário — agents pesam no contexto).
- `.claude/skills/` — skills da stack + as próprias do IRIS: **iris-migrations**,
  **iris-api-conventions**, **iris-security-lgpd**.
- **Fora de propósito** (não instalar; adicionar só se a stack mudar): Docker, Kubernetes,
  deployment/CI genérico, Python, Playwright/e2e, cloud-AWS/Terraform, api-design (colide com as
  convenções acima — usar `iris-api-conventions`). Docs-lookup/deep-research: só com MCP
  Context7/firecrawl configurado.
