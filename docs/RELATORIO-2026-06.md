# Relatório Mensal de Desenvolvimento — Junho/2026

**Projeto:** IRIS-Regulação
**Período:** 01/06/2026 → 30/06/2026
**Fonte:** histórico Git do repositório (registro autoritativo do que mudou em produção).

> **Sobre deploys:** cada push para `main` dispara **1 deploy automático no Vercel** (conta do João, onde o IRIS publica). Portanto a lista de commits abaixo é, na prática, a lista de deploys do mês. Os horários/URLs exatos de cada build só podem ser puxados conectando-se a conta do Vercel do João.

---

## 1. Números do mês

| Métrica | Valor |
|---|---|
| Commits / deploys | **38** |
| Dias com atividade | 10 — 05, 18, 19, 22, 23, 24, 25, 26, 29, 30 |
| Linhas adicionadas | **+52.929** |
| Linhas removidas | **−3.029** |
| Branches ativas | `main` (produção) + 3 de trabalho |

> ⚠️ Cerca de **37 mil** das inserções vêm de **um único commit de 25/06** (robustez dos parsers das 14 agências), que inclui **fixtures/assets de teste** — não representa 37 mil linhas de lógica nova.

### Branches
- `main` — produção (todos os deploys saem daqui).
- `feat/automacao-relatorios-newsletter` — trabalho não mergeado.
- `claude/fix-pdf-extraction-nMqxN` — trabalho não mergeado.
- `claude/blissful-franklin-sn229d` — trabalho não mergeado.

---

## 2. Linha do tempo por tema

### 🗓️ 05/06 — Módulo de Qualidade Regulatória + Newsletter (9 commits)
Criação e popularização do módulo de **Qualidade Regulatória** e sua exibição no menu; correções da **Newsletter** (edição multipágina, textos dos artigos, logo e imagens). Vários *fixes* de build para deploy limpo no Next 15.
_Volume: ≈ +6,7k linhas._

### 🗓️ 18–19/06 — Redesign de Notícias + nova aba Votos dos Diretores (11 commits)
Redesign visual (estilo "Palantir/Cortex") do módulo de **Notícias** (feed full-width, tipografia, thumbnails, ações inline); **nova aba Votos dos Diretores** com filtro 2026, API de *drilldown* e painel por diretor; *backfill* 2026 de votos; conexão monitoramento → votos; resiliência da coleta ARTESP.
_Volume: ≈ +3,3k linhas._

### 🗓️ 22–26/06 — Rodadas de robustez + observabilidade (7 commits)
Reorganização de **Deliberações** e correção dos votos; 3 "rodadas" de segurança, visibilidade de votos cross-módulo e completude de extração; **painel Saúde dos Dados** (observabilidade da esteira); robustez dos parsers de notícias/imagens das **14 agências**; **throttle por host** (corrige rate-limit do gov.br); ampliação do logo na Newsletter.
_Volume: ≈ +39k linhas (inflado por fixtures)._

### 🗓️ 29–30/06 — Votos fiéis + Cobertura de Documentos + Parser (6 commits)
- **Votos fiéis à realidade** (`ce46a23`): inferência conservadora, exibição honesta (nominal vs inferido).
- **Cobertura de Documentos P0/P1/P2** (`e47163d`, `addce3e`, `4fd28a6`): painel de verificação do scraper; paginação ANM/ARTESP + fallback headless + retry; rastreabilidade coleta → regulatório → deliberação.
- **Etapa 2 — otimização do parser** (`977309b`): auditoria adversarial com 26 correções (resultado pelo dispositivo da decisão, votos, especificidades ANTT).
_Volume: ≈ +1,5k linhas._

---

## 3. Lista completa de commits (deploys)

| Data | Hash | Assunto | +/− |
|---|---|---|---|
| 30/06 | `eeccf40` | chore: remove teste diagnóstico temporário da auditoria | +0/−19 |
| 30/06 | `977309b` | Etapa 2: otimização do parser de documentos (auditoria adversarial) | +560/−153 |
| 29/06 | `4fd28a6` | Cobertura de docs P2: rastreabilidade + dedup de fila | +96/−6 |
| 29/06 | `addce3e` | Cobertura de docs P1: paginação ANM/ARTESP, headless, tetos ANTT, retry | +235/−28 |
| 29/06 | `e47163d` | Cobertura de Documentos (P0): instrumento de verificação do scraper | +214/−0 |
| 29/06 | `ce46a23` | Votos dos diretores: extração fiel à realidade | +418/−70 |
| 26/06 | `0926e12` | Aumenta o logo IRIS no cabeçalho da Newsletter (~4x maior) | +5/−3 |
| 26/06 | `e914e05` | Throttle por host na coleta de notícias (corrige rate-limit do gov.br) | +7/−1 |
| 26/06 | `d030cf8` | Corrige links de notícias do ANAC/ARTESP e fotos das fontes Volto | +132/−20 |
| 25/06 | `211f3a4` | Robustece parsers de notícias/imagens (14 agências) + tira Saúde dos Dados do menu | +37.088/−842 |
| 24/06 | `c399ec9` | Adiciona painel Saúde dos Dados (observabilidade da esteira de votos) | +531/−0 |
| 23/06 | `aabaa31` | Rodada 3: segurança, visibilidade de votos cross-módulo, completude da extração | +1.279/−67 |
| 23/06 | `79fa02c` | Rodada 2: integra dados novos, fecha ciclo de votos, empresas e qualidade | +1.374/−60 |
| 22/06 | `0f06807` | Reorganiza Deliberações, corrige votos dos diretores e endurece o scraping | +850/−205 |
| 22/06 | `d617b11` | chore: republica main com identidade de commit válida no Vercel | — |
| 19/06 | `c204134` | Melhora newsletter (logo/texto) e resiliência da coleta ARTESP | +1.102/−40 |
| 19/06 | `b8c706c` | fix(newsletter): subtítulo fixo 'Regulação em Destaque' | +2/−10 |
| 19/06 | `a96cd7a` | fix(newsletter): imagem principal maior e texto nunca cortado | +10/−2 |
| 19/06 | `2491ec4` | Corrige notícias ARTESP, conecta monitoramento→votos, fecha ciclo de Qualidade | +279/−5 |
| 18/06 | `2a50a9c` | feat: reforço scraper, UI Notícias, precisão Deliberações/Qualidade | +156/−35 |
| 18/06 | `4437847` | feat(notícias): thumbnails maiores, ações inline, Documento em 2 colunas | +94/−101 |
| 18/06 | `ec02dca` | feat(notícias): feed full-width estilo Cortex + hero sans-serif | +90/−11 |
| 18/06 | `f6ef307` | fix(notícias): troca Playfair Display por Inter nos títulos | +15/−10 |
| 18/06 | `dabc76b` | feat: redesign Palantir em Notícias, backfill 2026 de Votos, revisão do Prêmio | +726/−258 |
| 18/06 | `9d68b80` | fix(deliberações): escapa aspas em JSX para corrigir build do Vercel | +1/−1 |
| 18/06 | `aa0ecd5` | feat(deliberações): filtro 2026, API de drilldown e painel por diretor | +196/−10 |
| 18/06 | `ecb6a88` | feat: redesign de Notícias e nova aba de Votos dos Diretores | +712/−115 |
| 05/06 | `5fd44b1` | Melhora logo e imagens das notícias oficiais | +76/−16 |
| 05/06 | `91da6d8` | Corrige logo e edição multipágina da newsletter | +16/−7 |
| 05/06 | `fe05215` | Permite editar textos da newsletter | +161/−13 |
| 05/06 | `1f5fba9` | Corrige texto dos artigos da newsletter | +76/−17 |
| 05/06 | `0045e9c` | Aumenta texto das notícias na newsletter | +19/−14 |
| 05/06 | `cc5b581` | Corrige módulo de notícias e newsletter | +3.165/−385 |
| 05/06 | `d16f531` | Prepara deploy limpo da qualidade regulatória | +901/−522 |
| 05/06 | `f2b46da` | Corrige build do deploy em Next 15 | +1/−1 |
| 05/06 | `01838a2` | Exibir qualidade regulatória no menu | +6/−1 |
| 05/06 | `6f42897` | Popula módulo de qualidade regulatória | +2.317/−0 |

---

## 4. Arquivos mais alterados no mês (top 15)

| Alterações | Arquivo |
|---|---|
| 13 | `src/lib/newsletter-document.ts` |
| 9 | `src/lib/server/news-collector.ts` |
| 9 | `src/app/dashboard/noticias/page.tsx` |
| 7 | `src/app/dashboard/deliberacoes/votos-diretores/page.tsx` |
| 6 | `src/types/index.ts` |
| 6 | `src/lib/server/upload-analysis.ts` |
| 6 | `src/lib/server/antt-2026-collector.ts` |
| 5 | `src/app/globals.css` |
| 5 | `src/app/api/v1/upload/confirm/route.ts` |
| 4 | `src/lib/server/vote-inference.ts` |
| 4 | `src/lib/server/resilient-fetch.ts` |
| 4 | `src/lib/server/nlp-extractor.ts` |
| 4 | `src/lib/server/monitoring.ts` |
| 4 | `src/lib/server/monitoring-runner.ts` |
| 4 | `src/components/layout/Sidebar.tsx` |

Os arquivos mais tocados refletem os focos do mês: **Newsletter/Notícias** (coleta e apresentação) e o **pipeline de Votos/Deliberações** (extração, monitoramento, confirmação).

---

## 5. Nota de identidade de commits e deploys

As 4 identidades de autor contam a história dos deploys de junho:

| Identidade | Commits | Papel |
|---|---|---|
| `214216649+Joaodesouzanery@users.noreply.github.com` | 13 | E-mail *noreply* do GitHub — **o único que o Vercel aceita** para publicar. |
| `codex@openai.com` | 10 | Commits de ferramenta de IA (início de junho). |
| `noreply@anthropic.com` | 10 | Commits de ferramenta de IA. |
| `joaodesouzanery@gmail.com` | 5 | E-mail que **bloqueava o deploy no Vercel** (19–23/06) — causa dos "deploys que não apareciam". |

**Commits de infraestrutura de deploy** no mês (não são feature, são conserto de publicação):
`d617b11` (republica com identidade válida), `55e44f9` (redispara build que não acionou), `9d68b80` e `f2b46da` (corrigem o build do Vercel). A partir de **24/06** todos os commits passaram a usar o e-mail *noreply* → deploys consistentes.

---

## 6. Resumo executivo

Junho consolidou três frentes do IRIS:

1. **Notícias & Newsletter** — redesign visual e robustez de coleta/imagens das 14 agências.
2. **Votos dos Diretores & Deliberações** — nova aba, filtro 2026, drilldown por diretor, extração fiel (nominal vs inferido) e o painel **Saúde dos Dados**.
3. **Esteira de documentos** — verificação (**Cobertura de Documentos**), captura ampliada (paginação/headless/retry), rastreabilidade e otimização do parser via auditoria adversarial.

O principal aprendizado operacional do mês foi a **regra de identidade de commit** para o Vercel (usar sempre o e-mail *noreply* do GitHub), que destravou a cadeia de deploys.

> _Continuidade (início de julho):_ a **Etapa 3** (limpeza de candidatos-lixo, parser estruturado da ARTESP com 216 documentos, sinalização de duplicatas) foi entregue em **01/07** (`f587a42`) — fora da janela de junho, registrada aqui apenas para contexto.

---

_Relatório gerado a partir do histórico Git em 01/07/2026._
