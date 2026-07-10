# PENDÊNCIAS E OPERAÇÃO — IRIS-Regulação

Ações manuais recorrentes, datas sensíveis e itens adiados por decisão de produto.
Atualize este arquivo quando resolver ou adiar algo (última revisão: Etapa 21, jul/2026).

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

No plano grátis, a conferência humana semanal é:

1. Abrir **Dashboard → Deliberações → Votos dos Diretores** e clicar **"Rodar tudo"** (faz
   coleta→processa→auto-confirma em loop→recalcula/mescla numa tacada).
2. Card **"Revisão humana"**: o que sobrar aparece aqui com o motivo (sem direção do voto /
   confiança baixa / relator ambíguo) — clicar "Revisar →" e ajustar no Upload (exceção).
3. Conferir "Métricas por diretor" (lidos vs inferidos) e "Completude 2026"; **"Gerar
   relatório"** para o PDF imprimível por diretor.
4. Na tela **Notícias**: "Coletar Notícias" + "Recuperar imagens" se houver cards sem foto.

## Ações manuais recorrentes

| Ação | Quando | Onde |
|---|---|---|
| Reprocessar votos ignorados (dry-run → aplicar) | Após deploy que amplia o parser; legado | Votos dos Diretores → card Revisão humana |
| Recalcular matches (backfill retroativo) | Após cadastrar/corrigir diretores; após ingestão grande | Votos dos Diretores |
| Mesclar deliberações duplicadas | Quando o painel de duplicatas apontar pares | Votos dos Diretores / rota admin dedup |
| Aplicar migrations | A cada nova migration em `supabase/migrations/` | Supabase SQL Editor (manual, pelo usuário) |
| Revisar documentos `review_pending` | Quando o card "Revisão humana" > 0 | Dashboard → Upload |
| Re-coletar notícias (imagens) | Após deploy que melhora o scraper de imagem | POST `/api/v1/noticias/coletar` (ou aguardar cron) — re-resolve imagem/limpa resumo lixo |

## Migrations pendentes de aplicação manual (SQL Editor)

- **`20260709120000_mandatos_rede_votos.sql`** (Etapa 19) — cria mandato para diretores que
  têm voto mas não têm mandato (religa a inferência). Idempotente e forward-only.

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
