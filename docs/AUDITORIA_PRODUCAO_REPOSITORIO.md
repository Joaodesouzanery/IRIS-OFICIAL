> # ⛔ DOCUMENTO HISTÓRICO — NÃO DESCREVE O SISTEMA ATUAL
>
> **Escrito em 17/05/2026. Marcado como histórico em 27/09/2026 (Fase 32).**
>
> Este arquivo retrata o repositório **antes de a autenticação existir**, e cinco dos seus achados
> já não valem. Ele estava sendo lido como diagnóstico do presente — e é a explicação mais provável
> para a impressão de que "a autenticação foi desligada".
>
> ## O que MUDOU desde então (verificado na auditoria de 27/09/2026)
>
> | achado de mai/2026 | estado hoje |
> |---|---|
> | *"Não há camada de autenticação/autorização protegendo rotas de escrita"* | ❌ **FALSO.** Auditadas as **66** rotas de escrita: todas alcançam um guard (`requireAdmin` / `requireAdminOrCron` / `requireCron`). As 8 sem guard no corpo delegam para quem tem. |
> | *"Produção está em modo demo, sem Supabase"* | ❌ Produção roda em modo real com Supabase. |
> | *"Policies RLS abertas com `USING (true)` sem `TO service_role`"* | 🟡 **Corrigido no repositório** (`20260716120000`, `20260718120000`, `20260724120000`). ⚠️ Migrations aqui são aplicadas **à mão** — a conferência com a chave anon está no plano da Fase 32. |
> | *"Ainda não há suíte automatizada de testes"* | ❌ **FALSO.** 223 arquivos de teste, ~2.733 expectativas. |
> | Rotas citadas como "expostas" (`agencias`, `upload/confirm`, `monitoramento/sites`, `antt/2026/collect`) | ❌ Todas com guard hoje. |
>
> **Para o estado atual, leia `docs/PENDENCIAS.md`** — que já registrava, desde ago/2026:
> *"Confirmado: auth ATIVA e endurecida (nada removido)"*.
>
> Não apago este arquivo: o registro do que o projeto era tem valor. O que ele não pode é ser lido
> como o que o projeto é.

---

# Auditoria de Producao - IRIS

## Resumo executivo

O projeto builda e foi publicado no Vercel, mas ainda nao esta pronto para producao real com dados persistentes sem correcoes de seguranca e operacao.

Pontos mais criticos:

1. Producao esta em modo demo, sem Supabase configurado.
2. Nao ha camada de autenticacao/autorizacao protegendo rotas de escrita.
3. `npm audit` apontou vulnerabilidades em `next` e `lodash`.
4. Varias policies RLS estao abertas com `USING (true)` sem restringir `TO service_role`.
5. Ainda nao ha suite automatizada de testes.

## Deploy e ambiente

Deploy publicado:

```text
https://iris-oficial.vercel.app
```

Status runtime verificado em producao:

```json
{
  "is_demo": true,
  "has_supabase_url": false,
  "has_service_role_key": false,
  "persistence": "demo"
}
```

Risco: sem `NEXT_PUBLIC_SUPABASE_URL` e `SUPABASE_SERVICE_ROLE_KEY`, a aplicacao roda, mas nao persiste dados no Supabase.

Acao recomendada:

- Configurar variaveis de ambiente no Vercel.
- Aplicar migrations no Supabase de producao.
- Rodar `/api/v1/system/status` novamente e confirmar `is_demo: false`.

## Seguranca

### Autenticacao ausente

Foram encontradas varias rotas `POST`, `PATCH` e `DELETE` expostas em `src/app/api/v1`. Como o servidor usa `SUPABASE_SERVICE_ROLE_KEY`, qualquer rota de escrita sem autenticacao vira uma porta administrativa publica.

Exemplos:

- `src/app/api/v1/agencias/route.ts`
- `src/app/api/v1/upload/confirm/route.ts`
- `src/app/api/v1/monitoramento/sites/route.ts`
- `src/app/api/v1/antt/2026/collect/route.ts`
- `src/app/api/v1/antt/2026/documentos/[id]/route.ts`

Acao recomendada:

- Implementar login e sessao.
- Separar permissao de leitura e escrita.
- Bloquear rotas administrativas sem usuario autenticado.
- Para crons, usar `CRON_SECRET` conforme documentacao da Vercel.

### RLS aberta demais

Migrations antigas criam policies como:

```sql
CREATE POLICY "allow_all_service_role" ON deliberacoes USING (true) WITH CHECK (true);
```

O nome sugere service role, mas sem `TO service_role` a policy pode se aplicar a roles expostas se houver grants.

Acao recomendada:

- Trocar policies administrativas para `TO service_role`.
- Criar policies separadas para usuarios autenticados.
- Evitar expor tabelas sensiveis na Data API sem necessidade.

### HTML gerado/renderizado

Ha uso de `document.write` e `srcDoc` em telas de documentos/boletins. Hoje parece vir de HTML gerado internamente, mas se qualquer parte passar a aceitar HTML de usuario ou fonte externa, vira risco de XSS.

Arquivos:

- `src/app/dashboard/documentos-associados/page.tsx`
- `src/app/dashboard/boletim/page.tsx`
- `src/app/api/v1/associados/documentos/[id]/html/route.ts`

Acao recomendada:

- Sanitizar HTML antes de salvar.
- Usar sandbox em iframe quando possivel.
- Nunca renderizar HTML extraido de PDF ou site externo.

## Dependencias

Comando executado:

```text
npm.cmd audit --omit=dev --json
```

Resultado:

- `next`: severidade critica no conjunto de advisories.
- `postcss`: moderada, transitive via Next.
- `lodash`: alta/moderada.

Acao recomendada:

- Prioridade 1: atualizar Next.js para uma versao corrigida compativel.
- Depois rodar build, smoke test e auditoria novamente.
- Conferir se `lodash` vem de dependencia transitiva e se some apos atualizar pacotes.

## Performance e confiabilidade

### PDF e scraping

Pontos positivos:

- Existe limite de tamanho de PDF.
- Existe timeout.
- Existe deduplicacao por hash.
- Existe validacao por magic bytes.

Pontos a melhorar:

- Dividir coleta grande em lotes menores para evitar timeout de serverless.
- Persistir cursor de pagina/coleta.
- Registrar metricas de tempo por reuniao/documento.
- Criar alerta quando o parser encontrar processos mas zero documentos.

### Banco de dados

Pontos positivos:

- Existem indices em datas, status, hashes e relacionamentos principais.
- `raw_text` tem indice trigram em deliberacoes.

Pontos a melhorar:

- Criar migrations de hardening para todas as policies abertas.
- Evitar guardar textos muito grandes sem estrategia de retencao.
- Criar job de limpeza para uploads/jobs antigos com erro.
- Validar se Storage bucket `pdfs` esta privado em producao.

## Qualidade de engenharia

O repo nao tem testes automatizados detectados por nome comum (`test`, `spec`, `jest`, `vitest`, `playwright`, `cypress`). Hoje a garantia vem de `type-check`, build e testes manuais.

Acao recomendada:

- Adicionar testes unitarios para parsers: ANTT, PDF, ata, NLP.
- Adicionar teste de integracao para rotas criticas.
- Adicionar smoke test Playwright para telas principais.
- Rodar CI em PR: type-check, build, lint, tests, audit.

## Prioridade recomendada

1. Configurar Supabase em producao e aplicar migrations.
2. Implementar autenticacao/autorizacao antes de gravar dados reais.
3. Atualizar Next.js para corrigir vulnerabilidades.
4. Endurecer RLS com `TO service_role` e policies reais.
5. Criar cron seguro para coleta ANTT com `CRON_SECRET`.
6. Adicionar testes automatizados para parser ANTT e rotas.
7. Rodar coleta real e validar amostra manual de reunioes/processos/votos.
