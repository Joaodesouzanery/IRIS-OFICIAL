---
name: iris-security-lgpd
description: Checklist de segurança e LGPD específico do IRIS (Supabase service_role, CRON_SECRET, guards de admin, dados de agentes públicos, segredos, regra do e-mail de commit). Use ao adicionar rotas, mexer em auth/env/segredos, ou revisar segurança. Complementa o security-review genérico com o contexto real do projeto.
---

# Segurança & LGPD — IRIS

Aplique este bloco ANTES do checklist OWASP genérico (skill `security-review`). Contexto real do
projeto — não teoria.

## Segredos e chaves
- `SUPABASE_SERVICE_ROLE_KEY` é **só server-side** — nunca em componente client, nunca prefixado
  `NEXT_PUBLIC_`. Só `NEXT_PUBLIC_SUPABASE_URL` e `NEXT_PUBLIC_SUPABASE_ANON_KEY` podem ir ao client.
- `CRON_SECRET`: Vercel Cron manda `Authorization: Bearer $CRON_SECRET`. Comparação em tempo
  constante já está em `request-guards.ts` (`timingSafeEqualStr`). Não reintroduzir comparação `===`.
- **Nenhum segredo versionado.** Segredos vivem no painel do Vercel/Supabase. `.env.example` só
  documenta nomes (não é segredo). Ao ver `sk-`/`service_role`/token hardcoded → CRÍTICO.
- Env vars atuais: `SUPABASE_SERVICE_ROLE_KEY`, `CRON_SECRET`, `IRIS_OWNER_EMAIL`,
  `IRIS_SETUP_TOKEN`, `ADMIN_EMAILS`, `OCR_SPACE_API_KEY`, `TRIGGER_SECRET_KEY`.

## Autorização (o modelo do projeto)
- Toda escrita passa por `requireAdmin` (sessão) ou `requireAdminOrCron` (admin OU CRON_SECRET).
  `requireCron` = só cron. GET `/api/v1/*` é gated no middleware; escrita depende do guard da rota.
- Admin = `isConfiguredAdminEmail` (IRIS_OWNER_EMAIL/ADMIN_EMAILS) OU `app_metadata.iris_role/owner`
  OU linha ativa em `admin_users`. Não afrouxar esse gate.
- Modo demo bloqueia escrita — manter o gate de demo em toda rota de escrita.

## RLS
- Tabelas de dados usam RLS com policy `..._service_role_all` (o servidor opera via service_role;
  anon não lê). Ao criar tabela nova, seguir esse padrão (ver skill `iris-migrations`).

## LGPD / dados pessoais
- Diretores/mandatos são **agentes públicos exercendo função pública** — base legal
  `public_official_function` / `lgpd_basis` gravada nas linhas. Coleta é de atos oficiais públicos
  (DOU/DOE, sites das agências). Não expandir a coleta para dados pessoais sensíveis fora disso.
- Não logar dado pessoal desnecessário; erros ao usuário são genéricos, detalhe só no server.

## Deploy / operação (peculiaridades que já causaram incidente)
- **E-mail de commit**: usar SEMPRE o noreply do GitHub
  (`214216649+Joaodesouzanery@users.noreply.github.com`). Commit com gmail **bloqueia o deploy no
  Vercel** — incidente real.
- Push em `main` → deploy automático. **Nunca** force-push em main.
- `maxDuration` 120s = SIGKILL incatchável → rotas de crawl usam `time-budget.ts`. Timeout que
  mata a função no meio pode deixar estado órfão (ex.: `monitoramento_runs` "running") — há limpeza
  oportunista; preservá-la.

## Checklist rápido (rota nova / mudança sensível)
- [ ] service_role e segredos só no servidor; nada `NEXT_PUBLIC_` com segredo.
- [ ] Guard correto + gate de demo em escrita.
- [ ] Sem segredo hardcoded/versionado.
- [ ] RLS na tabela nova.
- [ ] Coleta dentro do escopo de atos públicos (LGPD).
- [ ] Commit com e-mail noreply; sem force-push em main.
