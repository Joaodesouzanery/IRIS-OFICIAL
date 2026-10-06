# Análise e melhorias — votos 2026 (ANM, ANTT, ARTESP)
Data: 06/10/2026 · Coleta independente (não usa o pipeline do IRIS) · Excel: `votos_2026.xlsx`

## O que foi entregue de fato
| Agência | Coletado | Deliberações | Votos (linhas diretor×deliberação) |
|---|---|---|---|
| ANM | ROP 85–88 (maio–agosto/2026) | 146 | 584 |
| ANTT | 64 reuniões deliberativas (57 com ata em texto) | 305 | 1.484 |
| ARTESP | **nada** — Imperva/Incapsula devolve página de desafio, mesmo com navegador headless | 0 | 0 |

Proveniência em cada voto: `nominal` (a ata cita o diretor: relator, vista, ausente, divergência), `inferido` (ata diz "por unanimidade" → todos os presentes acompanharam o relator), `REVISAR` (maioria/vista/ambíguo; a ata não nomina quem votou como).
**Limite honesto:** o parser não foi validado contra gabarito manual. Antes de confiar, amostrar ~10 deliberações por agência contra o PDF.

## "Como saber que são TODOS os documentos de 2026?"
Só dá para afirmar completude contra um **denominador independente**, e ele existe de formas diferentes por agência:
- **ANM**: o calendário oficial (PDF no site) marca 12 ROPs em 2026. Até hoje deveriam ter ocorrido 9 (jan–set). O site publica **4** atas (85ª–88ª). **Faltam 5**: 81ª–84ª (jan–abr) e 89ª (30/09). Não é possível afirmar se é lacuna do site ou publicação pendente — **só a ANM confirma**. Hoje a cobertura da ANM é ~44% das ROPs.
- **ANTT**: a numeração é uma sequência contínua, então buraco é verificável. Em 2026: Ordinárias 1024–1043, Extraordinárias 99–102, Eletrônicas 263–302 — **nenhum número faltando na listagem**. Mas 7 reuniões estão sem ata (RDE302, ROD1043, RDE301, ROD1042, RDE300, RDE299 são recentes; **RDE270 é lacuna antiga**) e 5 sem voto publicado. As 37 reuniões administrativas foram excluídas (não deliberam processos).
- **ARTESP**: sem denominador, pois não conseguimos nem listar.
- Regra geral: completude = (listadas na fonte) × (baixadas) × (com texto) × (com voto extraído), por agência e mês. Isso está na aba **Cobertura**. O site só garante o que publica.

## 1. Como saber que estamos quase acabando?
O próprio repo já define o critério (`docs/PENDENCIAS.md`, Fase 38): livro-razão ≥95% pronto e nenhuma reunião aberta por trabalho nosso; meta de parada ANM ≥80% e gabarito ≥4/5. Use isso, não a sensação. Observação: as Fases 36–39 gastaram esforço em **datas, mandatos e cadastro** (insumos), não em fechar o voto. Isso é sintoma de deriva: cada conserto abre outro. O dado de fora aqui mostra que o gargalo maior é **cobertura da fonte** (ANM 4/9, ARTESP 0), não só extração.

## 2. Estamos indo pelo caminho certo?
A direção (coleta → extração → voto por diretor) está certa. A execução está dispersa. Sugestão: **um funil único com 4 números por agência** — listadas → baixadas → com texto → votos nominais/inferidos — e só trabalhar no degrau mais baixo. Hoje o degrau mais baixo é **obter os documentos** (ANM atas 81–84/89; ARTESP inteira), não refinar parser.
Outro ponto: boa parte do "voto de cada diretor" é **inferida de unanimidade** (ANM 65%, ANTT 62%). Isso responde "quantas vezes o diretor X acompanhou" mas **não** prova divergência. Para ver o diretor X votando contra, só os casos de maioria/vista, que são poucos (ANTT: 1 maioria, 13 vistas) — o dado é pobre em divergência por natureza.

## 3. Como confiar nas ~1.000 deliberações da plataforma?
Não deu para auditar a produção: o Supabase conectado aqui só lista os projetos "TE AMAR", "NERY AGRO" e "CIRCLE NEW" — nenhum é o do IRIS, e não consultei nenhum no chute. Recomendações:
1. Comparar a plataforma com este Excel **por (agência, reunião, processo)**: o que existe só em um lado é o erro.
2. Amostra estratificada manual (~30 por agência) contra o PDF, com taxa de erro publicada.
3. Estender o harness `vote-certification` (16 PDFs/164 expectativas) a ANTT e ARTESP.
4. Mostrar na tela a proveniência (nominal/inferido) e a cobertura ao lado de cada métrica.

## 4. "0 PDFs extraídos, 0 materializados"
Não consegui diagnosticar em produção (ver item 3). Hipóteses, em ordem de probabilidade, a checar por SQL somente-leitura: (a) migration não aplicada — o código degrada em silêncio por desenho (`ensureReuniao`→null), então o contador mostra 0 sem erro; (b) o contador lê uma tabela diferente da que a coleta grava; (c) extração estourando o orçamento de 70 s por rodada; (d) PDFs sem camada de texto (aqui: 1 ata da ANM e 99 votos da ANTT eram imagem e exigem OCR — se o pipeline não faz OCR, vira 0 sem alarme). Sugestão: o placar nunca mostrar "0" sem dizer o motivo (migração ausente × nada a fazer × falha).

## 5. Objetivo final → número auditável
1. Coleta sem perda silenciosa → `listadas = baixadas + (faltantes nomeados)`.
2. Extração (relator, resultado, processo, interessado) → taxa de acerto da amostra manual.
3. Voto por diretor com proveniência → `nominal + inferido + REVISAR = total`, sem outros estados.
4. Métricas por diretor/agência/período → só exibir com cobertura ≥ limiar e com a nota de proveniência.

## Melhorias objetivas
- Tratar PDF-imagem com OCR (RapidOCR funcionou na ata da ANM; custo alto nos votos da ANTT, e a ata já traz o resultado).
- Ligaduras do PDF da ANTT perdem "ti" ("re rado", "subs tuto"): normalizar antes de casar regex.
- Mesmo diretor com grafias diferentes (Fernandez/Fernandes, Asfor/Asfor da Rocha Lima): canonizar por cadastro.
- ANM: o relator pelo cabeçalho de seção erra em itens de voto-vista; usar o texto da deliberação (corrigido aqui).
- ARTESP: pedir liberação ao órgão ou fazer download manual dos PDFs para `fonte/artesp/`.
- Pedir à ANM as atas 81–84 e 89, e à ANTT a ata da RDE270.
