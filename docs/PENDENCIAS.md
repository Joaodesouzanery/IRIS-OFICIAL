# PENDÊNCIAS E OPERAÇÃO — IRIS-Regulação

Ações manuais recorrentes, datas sensíveis e itens adiados por decisão de produto.
Atualize este arquivo quando resolver ou adiar algo (última revisão: Etapa 18, jul/2026).

## Fluxo de operação semanal sugerido (zero-toque com conferência)

A esteira automática roda sozinha (crons: monitoramento 10:00 → coleta ANTT 10:30 →
processamento 12:00 → auto-confirmação 12:30 → backfill semanal dom 09:00). A conferência
humana semanal é:

1. Abrir **Dashboard → Deliberações → Votos dos Diretores**.
2. Card **"Revisão humana"**: se houver documentos pendentes, clicar "Revisar →" e
   confirmar/ajustar no Upload (é a exceção, não a regra).
3. Se houver votos ignorados legados: **"Reprocessar votos ignorados"** (dry-run mostra a
   contagem → confirmar). Depois os crons de processamento/auto-confirmação absorvem.
4. Após ingestões grandes: **"Recalcular matches"** (converte candidatos em votos quando o
   diretor foi cadastrado depois) e **mesclar duplicatas** apontadas no painel.
5. Conferir "Métricas por diretor" (lidos vs inferidos) e "Completude 2026".

## Ações manuais recorrentes

| Ação | Quando | Onde |
|---|---|---|
| Reprocessar votos ignorados (dry-run → aplicar) | Após deploy que amplia o parser; legado | Votos dos Diretores → card Revisão humana |
| Recalcular matches (backfill retroativo) | Após cadastrar/corrigir diretores; após ingestão grande | Votos dos Diretores |
| Mesclar deliberações duplicadas | Quando o painel de duplicatas apontar pares | Votos dos Diretores / rota admin dedup |
| Aplicar migrations | A cada nova migration em `supabase/migrations/` | Supabase SQL Editor (manual, pelo usuário) |
| Revisar documentos `review_pending` | Quando o card "Revisão humana" > 0 | Dashboard → Upload |

## Datas sensíveis

- **30/11/2026 — mandatos interinos ANM vencem**: atualizar o seed de diretores
  (`diretores` / mandatos) quando houver nomeação definitiva; sem isso, votos novos dos
  substitutos viram candidatos em revisão.

## Adiados por decisão (reavaliar quando fizer sentido)

- **Alerta externo (e-mail/Slack) de falha da esteira** — decisão "nenhum por enquanto";
  hoje o sinal é o painel Saúde dos Dados (rota admin) + card de revisão na tela de votos.
- **`OCR_SPACE_API_KEY`** — OCR externo para PDFs escaneados (Etapa 10-B) fica inativo sem
  a chave; PDFs sem camada de texto caem em revisão com aviso. Configurar a env na Vercel
  quando quiser habilitar.

## Invariantes de operação (não quebrar)

- Commits com autor `Joao Nery <214216649+Joaodesouzanery@users.noreply.github.com>`
  (e-mail gmail bloqueia o deploy na Vercel). Nunca force-push em `main`.
- Migrations são aplicadas manualmente pelo usuário no SQL Editor (idempotentes).
- `upload/confirm` é o ÚNICO writer de votos; voto nominal nunca é rebaixado a inferido.
- `isResultadoPositivo` (src/lib/utils.ts) é a fonte única de "resultado favorável".
