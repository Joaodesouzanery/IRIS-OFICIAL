---
name: iris-api-conventions
description: Contrato real das rotas de API do IRIS (gate de demo, guards, import dinâmico do Supabase, NextResponse cru, validação manual, degrade proposital). Use ao escrever, alterar ou revisar handlers em src/app/api/v1/**/route.ts. Substitui o api-design genérico neste projeto.
---

# Convenções de rota do IRIS

Este projeto NÃO segue o api-design genérico (sem envelope `{data}`, sem `zod`). Handlers em
`src/app/api/v1/**/route.ts` seguem este contrato — respeite-o em código novo e ao revisar.

## Ordem canônica de um handler
```ts
export async function POST(req: NextRequest) {
  // 1) Gate de demo — SEMPRE primeiro. Escrita é bloqueada em demo.
  if (isDemo() || isDemoRequest(req)) {
    return NextResponse.json(<retrato-demo>); // ou 403 em rotas de escrita
  }
  // 2) Guard de auth — retorna NextResponse de erro OU null.
  const guard = await requireAdmin(req);          // ou requireAdminOrCron(req)
  if (guard) return guard;

  // 3) Client Supabase por IMPORT DINÂMICO dentro do handler.
  const { createSupabaseServerClient } = await import("@/lib/supabase/server");
  const db = createSupabaseServerClient();

  // 4) Validação MANUAL (sem zod). Erro = NextResponse.json({error}, {status}).
  const body = await req.json().catch(() => ({}));
  if (!body.campo) return NextResponse.json({ error: "campo obrigatório" }, { status: 400 });

  // 5) Resposta CRUA: sucesso sem envelope; erro { error } + status.
  return NextResponse.json(resultado); // NÃO { data: resultado }
}
```

## Regras
- **Guards** (`src/lib/server/request-guards.ts`): `requireAdmin` (sessão admin) e `requireAdminOrCron`
  (admin OU Bearer `CRON_SECRET`, para rotas que também são cron). GET sob `/api/v1/*` já é gated pelo
  middleware; escrita depende do guard da rota. `requireCron` = só cron.
- **Sucesso sem envelope**: `NextResponse.json(rows ?? [])`. Não introduzir `{data}` — o front
  (`src/lib/api.ts`) espera o payload cru; erro é `{ error }` normalizado por `extractErrorMessage`.
- **Sem `zod`**: validação imperativa. Não adicionar dependência de schema sem pedido explícito.
- **Import dinâmico do Supabase**: mantém o client server-only fora do bundle e do caminho de demo.
- **Rotas longas (crawl/coleta/PDF)**: usar orçamento de tempo (`src/lib/server/time-budget.ts`:
  `hasBudget`/`budgetRetries`) — `maxDuration` 120s no Vercel é SIGKILL incatchável. Declarar a rota
  em `vercel.json` (`functions.<path>.maxDuration = 120`) quando baixa PDFs/faz crawl.
- **Contrato "parcial"**: rotas retomáveis respondem `{ parcial: boolean, ... }` e o front reexecuta
  em rodadas (ex.: backfill de votos-diretores). Preserve esse shape ao mexer nelas.

## Degrade-gracioso é PROPOSITAL — não sinalizar como bug
Padrões intencionais (NÃO são silent-failure a "corrigir"):
- `ensureReuniao` retorna `null` quando a tabela `reunioes` ainda não foi migrada → o insert só
  inclui `reuniao_id` quando não-null (deploy antes da migration é seguro).
- `buildAnttMeetingSkipSet` catch → `Set` vazio (degrada para crawl completo, nunca bloqueia).
- Dedup de deliberações / enriquecimento catch → segue como insert normal.
- Auditorias (duplicatas, saúde) são melhor-esforço (`try/catch` que só omite o alerta).
Ao revisar, distinga isto de um catch que ESCONDE erro de escrita crítica (esse sim é problema).

## Ao revisar rotas, cheque de verdade
- Gate de demo presente e ANTES de qualquer escrita?
- Guard correto (`requireAdmin` vs `requireAdminOrCron` vs `requireCron`)?
- Rota que baixa PDF/crawl tem `maxDuration` no `vercel.json` e orçamento de tempo?
- Escrita em `votos` usa upsert `onConflict: "deliberacao_id,diretor_id"` (idempotente)?
- Novos writers de `deliberacoes` passam pela dedup (`findDeliberacaoExistente`) e por `ensureReuniao`?
