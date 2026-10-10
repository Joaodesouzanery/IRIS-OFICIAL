# Revisão cega e independente — votos ANM, ANTT, ARTESP (2026)

Data da revisão: 2026-10-09. Revisor: agente independente (não escreveu os parsers; **não leu** `scripts/*` nem o código dos parsers).
Nenhum arquivo do projeto foi editado; nada foi commitado. Artefatos de trabalho em
`/tmp/claude-0/-home-user-IRIS-OFICIAL/b552e84e-1331-5c1e-aae9-26b309e73eaa/scratchpad/` (amostras `*_amostra.json`, esperados congelados
`expected_*_CONGELADO.py`, comparadores `cmp_*.py`/`score_anm.py`, invariantes `inv2.py`).

## 1. Método (e limites de "cegueira")

- Semente **9001** (`random.seed(9001)`) em todos os sorteios.
- Fluxo por item: (1) ler a ata/PDF/OCR em `texto/`, `texto_antt/`, `texto_antt_ocr/`, `texto_artesp/`; (2) **escrever o esperado em arquivo** (`expected_anm.py`, `expected_antt.py`, `expected_antt2.py`, `expected_artesp.py`, copiados como `*_CONGELADO.py`) **antes** de abrir os campos relator/resultado/votos do JSON; (3) comparar.
- O que eu vi do JSON ANTES de escrever os esperados: só estrutura (chaves), distribuições agregadas (contagens por reunião/tipo/diretor/proveniência) e identificadores de item (reunião, nº, processo, `tipo_item` da ANM). Nenhum voto/relator/resultado de item específico.
- ANM: universo do sorteio = lista de itens do JSON (estratificado por reunião × `tipo_item`) — por isso o sorteio em si não detecta item omitido; a completude foi checada à parte (item 5). ANTT e ARTESP: sorteio feito sobre **inventário próprio** extraído das atas (regex minha), independente do JSON; contagens bateram (ANTT 305 = 305; ARTESP 741 distintos vs 743 do JSON, diferença explicada por renumeração documentada, ver FP-7).
- Depois de fechar os esperados abri `antt_*`/`artesp_conciliacao.json`, `Faltam na fonte` e `Painel` (para adjudicar divergências).
- Códigos de voto usados no esperado: A (favorável/acompanhou/relator), D (divergiu), V (pediu vista), S (sem voto: retirado/sobrestado), AUS, IMP, REV (ata não diz).

## 2. Amostras

| Agência | Itens | Como | Diretores (votos conferidos, fora AUSENTE) |
|---|---|---|---|
| ANM | **36** (REP31:2, REP32:10, REP33:3, REP34:1, ROP81:1, ROP82:2, ROP83:4, ROP84:2, ROP85:3, ROP86:2, ROP87:3, ROP88:3) | estratos reunião × tipo_item (Deliberação 18, Retirada 8, Vista 7, Aprov. ata 3) | Mauro 36, José Fernando 24, Luiz 20, Fábio 20, Tasso 16, Roger 16, Caio 12 (todos ≥5) |
| ANTT | **52** = 43 (sorteio: unan 21, vista 9, retirada 5, outro 6, maioria 2; RDE 16/ROD 26/REX 1) + 9 (2ª rodada dirigida: itens com voto-vista resolvido / PDF de voto) | inventário próprio; garantido Severino ≥7 e Marcelo ≥5 itens | Alex 49, Felipe 48, Guilherme 43, Lucas 43, Alessandro 35, Severino 7, Marcelo 5 (+30 ausências conferidas) |
| ARTESP | **41** (unan 32 → após dedupe, cancelada/retirada 8, ausências em 10 reuniões, 6 sessões S230, 16 ORD) | inventário próprio; ≥1 item de cada reunião com ausência | Fernanda 33, André 31, Raquel 31, Diego 27 ACOMPANHOU + 15 ausências conferidas |

## 3. Taxa de acerto

Critério: "bruto" = qualquer diferença contra o meu esperado; "ajustado" = após descartar falsos positivos (seção 6).

### 3.1 Por agência

| Agência | Itens 100% corretos (ajustado) | Observação |
|---|---|---|
| ANM | **28/36 = 77,8%** (30/36 = 83,3% se contarmos só erro de voto/campo, deixando 2 itens de rótulo à parte). **Só ROP81–88 (2026): 20/20 = 100%** | todos os erros do sorteio estão nas reuniões extraordinárias REP31–34 (2024/2025), que **não entram no xlsx** (que só tem 2026) |
| ANTT | **52/52 = 100%** (0 divergência real) | 1 divergência bruta é FP (ata com número de voto trocado; JSON está certo) |
| ARTESP | **41/41 = 100%** nos campos de voto/resultado | campo `unidade` (não é voto) tem defeito real — ver D-9 |

### 3.2 Por campo

| Campo | ANM (36) | ANTT (52) | ARTESP (41) |
|---|---|---|---|
| relator | 36/36 (100%) | 51/52 bruto (98,1%) → 52/52 ajustado | n/a (JSON não tem relator; derivado só no xlsx) |
| resultado | 35/36 (97,2%) — #53 REP32 | 52/52 | 41/41 |
| vencidos | 34/36 (94,4%) — REP31 3.1.1, REP32 4.4.1 | 52/52 (derivado dos rótulos DIVERGIU; ROD1025 1.3.3 Alex ✔) | n/a (só unanimidade) |
| pedinte de vista | 34/36 (94,4%) — REP32 3.3.1, REP33 3.4.1 | 52/52 (incl. vista resolvida/histórica) | n/a |
| impedidos | 36/36 (100%) (ROP83 2.7.2, ROP84 2.1.2 ✔) | n/a | n/a |
| ausentes | 8/10 (80%) — Luiz relator ausente em REP32 5.1.1/5.1.2 sem AUSENTE | 30/30 (inclui ausência parcial ROD1035 e "considerado ausente" RDE268) | 10/10 linhas AUSENTE corretas (+5 ausências em itens cancelados não geram linha) |
| voto de cada diretor | **128/144 bruto (88,9%); 132/144 ajustado (91,7%)** | **230/230 (100%)** | **132/132 (100%)** nas linhas existentes |

### 3.3 Por diretor (voto conferido; ajustado entre parênteses o bruto)

ANM: Mauro 34/36 (33), Tasso **11/16** (11), Roger 13/16 (12), Caio 10/12 (8), José Fernando 24/24, Luiz 20/20, Fábio 20/20.
ANTT: Alex 49/49, Felipe 48/48, Guilherme 43/43, Lucas 43/43, Alessandro 35/35, Severino 7/7, Marcelo 5/5.
ARTESP: Fernanda 33/33, André 31/31, Raquel 31/31, Diego 27/27 ACOMPANHOU nas linhas existentes (as 10 linhas AUSENTE existentes também corretas; 5 ausências em itens cancelados não geram linha — ver R-5).

A concentração de erros em Tasso/Roger/Caio na ANM é consequência de os 4 diretores das extraordinárias 2024-25 serem os envolvidos nos defeitos D-1 a D-4 abaixo.

## 4. Divergências REAIS (voto errado/campo errado × rótulo/forma)

### 4A. Voto errado ou campo de resultado/vencido/vista errado

| # | Item | Campo | Fonte × JSON | Trecho da fonte | Causa provável no parser |
|---|---|---|---|---|---|
| D-1 | ANM REP31 3.1.1 (48405.851331/2013-15) | vencido; voto de Tasso, Roger, Caio, Guilherme | fonte: Roger **DIVERGIU** (seguiu o revisor Guilherme), Caio e Tasso acompanharam o relator × JSON: `dissidentes=[]` e os 4 em `REVISAR (maioria sem divergentes nomeados)` | "Aberta a deliberação, o Diretor Roger Cabral acompanhou o voto do Revisor 1 ... enquanto o Diretor Caio Seabra acompanhou o voto do Revisor 2, Tasso Mendonça que ... acompanhou o voto do Relator" | só reconhece "divergência apresentada por X"; não resolve a narrativa "acompanhou o voto do revisor N" |
| D-2 | ANM REP32 4.4.1 (48064.000356/2023-20) e REP32 1.2.1 (48401.810363/2018-05) | vencido (relator original vencido); votos de Mauro/Caio e dos demais | fonte: "aprovado por maioria ... com voto contrário do Diretor-Geral, relator original" (4.4.1) / "voto contrário do Diretor Caio Mario Seabra Filho, relator original" (1.2.1) × JSON: relator continua `RELATOR (voto proferido)`, `dissidentes=[]`, os demais 2 diretores `REVISAR` | idem | falta o padrão "voto contrário do X, relator original"; (o nome "Caio Mario" sem o 'Trivellato' também pode não casar) |
| D-3 | ANM REP32 #53 (48059.850528/2021-16) + 4.2.1, 4.5.1, 5.9.1, 5.10.1, 5.12.1, 5.13.1 (**7 itens**) | resultado + linhas de voto | fonte: "Item retirado de pauta pelo Diretor-Geral" (5 itens) / "pelo Diretor Revisor, com solicitação de prorrogação de prazo para voto vista" (2) × JSON: `resultado="SEM DELIBERACAO NO TEXTO"`, `tipo_item="Deliberação"`, **zero linhas de voto** | só "pelo relator"/"pelo revisor" (minúsculo) são reconhecidos como retirada | regex de retirada não cobre "pelo Diretor-Geral"/"pelo Diretor Revisor" |
| D-4 | ANM REP32 3.3.1 (27207.872093/1996-88), REP33 3.4.1 (27205.850006/1996-51), REP32 1.3.1 (27213.826299/1997-38) | pedinte de vista | fonte: vista de **Tasso** ("pedido de vistas ... pelo Diretor Tasso Mendonça Jr.") × JSON: `vista_por=[]`, Tasso `SEM VOTO AINDA` em vez de `PEDIU VISTA` | alias "Tasso Mendonça Jr." | alias do diretor não casa na frase do vista (com "Diretor-Geral" funciona: REP32 4.1.6, ROP84/85/86/88 ✔) |
| D-5 | ANM REP34 2.7.1 (27205.851966/1992-13) | pedinte de vista (excesso) | fonte: vista só de José Fernando × JSON `vista_por=['Tasso…','José Fernando…']` (Tasso é o relator e aparece como pedinte; a linha de voto, essa, está certa) | "Após voto favorável do Diretor Roger ..., sobrestada ... vistas ... pelo Diretor José Fernando" | captura nomes demais na frase |
| D-6 | ANM REP31 1.1.1 (48051.003300/2024-57) | linha de voto fantasma | fonte: "contou com a presença tão somente dos quatro diretores" (mandato de Guilherme Gomes terminou) × JSON tem linha `Guilherme Gomes ACOMPANHOU (inferido)` (5 votos num item unânime de 4 presentes); idem `REVISAR` de Guilherme em 3.1.1 | cabeçalho REP31 | "inferido" completa com o ex-diretor citado no texto |
| D-7 | **ANM 2026** ROP85 1.4.1 (48054.930255/2020-51) e ROP85 1.5.1 (27202.820791/1987-57) — achados por invariante, **fora da amostra** | voto de Mauro | fonte: "aprovado por maioria ... **com divergência apresentada pelo Revisor, Diretor-Geral**"; JSON tem `dissidentes=['Mauro…']` mas o voto está `REVISOR (voto proferido; ata cita o revisor)` (Papel "A revisar" no xlsx), não `DIVERGIU` | trecho acima | rótulo de revisor tem precedência sobre dissidente → viola "vencido nomeado ⇒ DIVERGIU" (afeta o xlsx: Painel mostra Mauro "Divergiu"=1; o correto, pela ata, é ≥3 em 2026) |
| D-8 | **ANM 2026** ROP86 1.1.1 (48406.963012/2008-76) — achado por leitura das 15 "maioria" | vencidos | fonte: voto de qualidade do DG; Fábio mudou para o revisor; **José (relator) e Luiz ficaram vencidos** × JSON `dissidentes=[]`; rótulos "RELATOR (voto vencido)" e "ACOMPANHOU o relator (… vencido)" (conteúdo certo, campo `dissidentes` vazio e nenhum DIVERGIU) | "aprovado por maioria dos diretores presentes com cômputo do voto de qualidade" | campo `dissidentes` só é preenchido pela frase "divergência apresentada" |
| D-9 | ARTESP (campo `unidade`, não é voto) — 739 itens comparáveis | unidade/área | **567 batem, 100 divergem, 72 vazios** (checagem sistemática contra o cabeçalho de unidade imediatamente anterior ao item). Casos verificados à mão: ORD1182 nº121-125 (ata: SUCOL; JSON: SUROD), ORD1177 nº26-29 (ata: SUROD/Presidência/SUMEF; JSON: SUADI), ORD1180 nº87-89 (SUROD; JSON SUMEF), ORD1183 nº133-134 (SUINV; JSON SUADI), ORD1213 (32 itens com SUPEP indevida), ORD1193 nº342 (DIR-RC; JSON SUROD) | cabeçalhos sem ponto final, com travessão "–", sem sigla ou com erro de grafia ("Superintendêcia") | reconhece cabeçalho de unidade só em formato estrito → fica a unidade anterior (herança obsoleta). Pode contaminar o relator derivado no xlsx (relator ARTESP é inferido da unidade/diretoria: 54 linhas "Relator/proponente") |

### 4B. Rótulo/forma (voto certo, descrição ou convenção discutível)

- **R-1 (ANM REP32 5.1.1, 5.1.2 e outros 16 itens de Luiz Paniago)**: Luiz estava **ausente por hospitalização** (ata REP32: votos "lidos pelo Diretor-Geral"), mas a linha de voto dele diz `RELATOR (voto de ex-diretor; fora da reunião e dos totais de 2026)`. Luiz é diretor **em exercício** em 2026 (ROP81–88). O rótulo "ex-diretor" está factualmente errado e não marca AUSENTE (invariante "ausente ⇒ AUSENTE").
- **R-2 (ANM)** variantes de nome fragmentam totais por pessoa: `Caio Mário Seabra Filho` × `…Trivellato Seabra Filho` (1 linha no xlsx), `José Fernando … Jr` (15 votos JSON, REP33/34), `Guilherme Gomes` × `Guilherme Santana Lopes Gomes`.
- **R-3 (ANTT)** 11 linhas `RELATOR (proposta; resultado sem ata)` (reuniões RDE270/299/300, ROD1042) entram no xlsx como `nominal` e na coluna "Conta nos totais"=Sim (xlsx 1.536 = JSON 1.525 + 11). Não são votos apurados; inflam "nominal" (468 em vez de 457). Está documentado (README: "11 votos citados na ata não publicados"), mas a classificação "nominal/Sim" é discutível.
- **R-4 (ANTT)** 8 itens em que o relator está **ausente no cabeçalho** (férias) mas a linha dele é `RELATOR (voto escrito; ausência declarada na ata)` (RDE297 Marcelo, RDE288 Felipe e Alessandro, RDE285 Lucas, RDE278 Guilherme…): a própria ata é incoerente (voto DMF-3/2026 de quem consta como ausente); o JSON registra isso no rótulo. Viola "ausente do cabeçalho ⇒ AUSENTE" por desenho; não é erro de parser.
- **R-5 (ARTESP)** 39 itens `CANCELADA (não votada)` **não têm nenhuma linha de voto** (nem para os presentes nem AUSENTE), enquanto os 2 `RETIRADO DE PAUTA` têm 4 linhas `SEM VOTO`. Inconsistência de convenção; viola "1 voto por diretor presente por item" e o Painel diz "1 por diretor em cada item" (704 de 743 itens têm votos).
- **R-6 (ANM)** itens sobrestados: o revisor que já deu voto escrito (Caio em REP32 3.3.1/4.1.6, Roger em REP33 3.4.1) fica `SEM VOTO AINDA`. É convenção (voto só vale após a vista); não contei como erro (FP).

## 5. Invariantes globais (JSON e xlsx `Votos`)

| Invariante | ANM | ANTT | ARTESP |
|---|---|---|---|
| 1 voto/diretor/item sem duplicata | OK (0 duplicados) | OK | OK |
| presente do cabeçalho tem linha de voto | **7 itens sem linha** (os 7 de D-3, todos REP32) ; xlsx: 377 itens × 4 diretores = 1.508 linhas, perfeito | OK (0) | **39 itens sem linha** (R-5); 704×4 = 2.816 linhas |
| relator ⊆ presentes | 39 violações, todas explicáveis (relator original que saiu: Caio 8, Guilherme 5, Roger 4, Carlos Cordeiro 2, Tasso 1; Luiz ausente 18 em REP32) | 15 violações explicáveis (relator ausente/sucedido: ROD1040/RDE296 DG ausente, ROD1041 Alessandro "então relator" etc.) | n/a |
| vencido nomeado ⇒ DIVERGIU | **FALHA: 2 itens 2026** (D-7); só 2 linhas DIVERGIU em todo o JSON (REP34 3.5.1, ROP84 3.12.1) | OK (1 DIVERGIU: Alex ROD1025 1.3.3) | n/a |
| unânime ⇒ nenhum DIVERGIU | OK | OK | OK |
| maioria ⇒ ≥1 DIVERGIU entre presentes | 13/15 itens sem; reclassificados: 5 reais (REP31 3.1.1, REP32 1.2.1, 4.4.1, ROP85 1.4.1/1.5.1) + ROP86 1.1.1 (D-8); 4 legítimos (dissenso só de ex-membros: ROP83 2.3.1, 2.4.1, 2.7.1, ROP85 2.1.1); 3 `REVISAR` legítimos (ata não narra) | RDE268 `REVISAR` legítimo | n/a |
| ausente do cabeçalho ⇒ AUSENTE | OK (0) | 8 exceções = R-4; ausência parcial (ROD1035: Guilherme AUSENTE a partir do 1.2.1; RDE268 Severino "considerado ausente") **correta** | OK (0); ORD1206 (Constituição lista Diego mas "Ausência Justificada: Diego" + assinaturas sem Diego) tratada corretamente como AUSENTE |
| ex-membros fora dos totais | OK no xlsx: 19 linhas `Não (ex-diretor, voto em reunião anterior)`, 1.508 `Sim` | OK (Severino/Alessandro/Marcelo = substitutos presentes contam; ex-relator sem linha) | n/a |
| datas 2026 | JSON tem 406 votos fora de 2026 (REP31 2024: 10; REP32–34 2025: 396); **xlsx só 2026** (1.527 linhas = JSON 2026) | OK | OK |
| proveniência válida | {nominal, inferido, n/a, REVISAR} OK; REVISAR 13 no JSON (8 em REP31–34) → 5 no xlsx = Painel "5" | OK; REVISAR 2 = Painel | OK |
| totais xlsx = JSON | 1.527 linhas = JSON 2026; 1.508 "Sim" = Painel 1.508; por diretor Painel = xlsx | 1.536 = 1.525 + 11 (R-3); Painel 1.536/316 itens (305+11) | 2.816 = 2.816; Painel 743 itens |

## 6. Falsos positivos descartados (divergência bruta que NÃO é erro)

- FP-1 ANTT ROD1041 50500.074884/2020-28 (Ferrogrão): a ata escreve "Voto DLA - 56/2026" (relator Lucas, segundo a ata); o JSON diz relator Guilherme "Voto DG 44/2026". O PDF OCR `ROD1041__voto_Voto_DG_44-2026` ("RELATORIA: Diretoria Geral", processo 50500.074884/2020-28) confirma que o JSON está certo; o próprio xlsx já lista "Erro da fonte: ata cita Voto DLA 56/2026 de outro processo". Meu esperado (da ata) estava errado.
- FP-2 ANTT ROD1027 50505.015809/2025-90 e ROD1025 50500.176692/2024-89: o JSON atribui relator Lucas (ata não nomeia o relator original; os PDFs `Voto_DLA_16-2026` e `Voto_DLA_117-2025` confirmam). Não é divergência.
- FP-3 ANM ROP83 2.7.2 Mauro `REVISAR`: a ata diz que o DG "apresentou divergência" ao relator original e que o voto do revisor venceu, mas não narra o voto dele; o próprio xlsx lista como "LIMITE DA FONTE". Meu esperado (A) era mais forte que a ata. Idem ROP84 2.3.1 (Mauro, Fábio) e ROP86 2.1.1 (Mauro, José).
- FP-4 ANM revisor com voto escrito em item sobrestado = `SEM VOTO AINDA` (R-6).
- FP-5 Linhas de ex-diretor em itens 2026 (Guilherme, Caio, Roger, Carlos, Tasso, Severino) "fora dos totais" — desenho documentado; no xlsx saem com `Não`.
- FP-6 `maioria` sem DIVERGIU quando os dissidentes são ex-membros (ROP83 2.3.1, 2.4.1, 2.7.1; ROP85 2.1.1).
- FP-7 ARTESP numeração: ata nº282 → JSON 303 (S230_236); ata repete 479 → JSON 479/480 (S230_239); ata 541 → PDFs 539/540 (S230_243, ata publicada é a da 244ª, via OCR). A renumeração a partir dos PDFs de Deliberação está documentada em `artesp_conciliacao.json`; **não verifiquei os PDFs**.
- FP-8 ANTT ROD1035/RDE268 `REVISAR`/ausências parciais: corretos conforme a ata.
- FP-9 ARTESP itens `CANCELADA` sem linhas: tratado como convenção em R-5, não como voto errado.

## 7. "Faltam na fonte" — URLs

Aba tem 54 linhas das 3 agências (ANTT 30, ANM 13, ARTESP 11), mas só **18 URLs distintas** (impossível chegar a 20 distintas). Testei as 18 com `curl -I` e `curl -L` (GET):

| Agência | Nº URLs | HEAD | GET |
|---|---|---|---|
| ANM (listagem de atas ROP) | 1 | **403** | 200 (269.555 B) |
| ANTT (listagem + 15 páginas de reunião `…/content/id/…`) | 16 | 200 | 200 (138–225 kB) |
| ARTESP (`/transparencia/reunioes-diretoria`) | 1 | 200 | 200 (só 1.164 B — shell/SPA, conteúdo dinâmico não verificável por curl) |

Todas respondem 200 (GET); nenhuma 404/5xx. Observação: são páginas de listagem, então "200" não prova que o documento esperado esteja ausente. Verifiquei por conteúdo 1 caso: RDE271 (50505.067257/2025-03, "voto escrito citado na ata e não publicado"): a ata cita **Voto DAB 4/2026** e a página oficial lista Votos DAB 001/002/003/005, **sem o 004** ✔ (a pendência é real). Os outros itens da aba não foram verificados por conteúdo. Para a ANM, o link da aba é o índice de atas, mas a pendência é "ata diz maioria sem nomear" (não é arquivo faltante).

## 8. O que NÃO foi verificado (honestidade)

- Votos "inferidos" por unanimidade (≈ 66% ANM, 62% ANTT, 92% ARTESP): só vídeo provaria; não é checável por ata.
- PDFs de voto OCR da ANTT: conferi o conteúdo só dos 3 casos acima (DG 44, DLA 16, DLA 117); não revi os 87 OCR. Cruzamentos `cruzamento_voto_pdf` não auditados.
- ARTESP S230_243 / DELIB_539–540 (ata errada, lida por OCR) e a renumeração 282→303: não verifiquei contra os PDFs de `fonte/artesp`.
- ANM: sorteio saiu do próprio JSON (não detecta omissão); completude conferida só por contagem de "PROCESSO Nº" (JSON ≥ ata em todas as reuniões; nenhum item da ata ausente).
- Abas `Deliberações`, `Matriz de votos`, `Diretores`, `Reuniões`, `Controle` e o HTML: só conferi `Votos`, `Painel` e `Faltam na fonte`.
- Estratos: com 36–52 itens por agência, a amostra de itens com dissenso é pequena; por isso D-7/D-8 (erros em 2026) saíram de invariantes e leitura das 15 "maioria", **não** do sorteio (o sorteio 2026 ANM acertou 20/20). Os intervalos de confiança são largos; não extrapolar as taxas para toda a população.
- Não li os parsers, então "causa provável" é inferência a partir do padrão de erro, não de leitura de código.

## 9. Resumo executivo

- **ANTT**: 52 itens / 230 votos / 30 ausências conferidos, **0 erro real**. É a agência mais confiável da amostra; riscos residuais: R-3, R-4 e OCR não auditado.
- **ARTESP**: 41 itens, votos e resultado 100% corretos (todos unânimes por desenho); risco real no campo **`unidade`** (~13,5% errado + ~10% vazio) e convenção de itens cancelados sem linhas.
- **ANM**: 2026 (ROP81–88) acertou 20/20 no sorteio, mas há ≥3 itens 2026 com divergência não capturada (D-7: ROP85 1.4.1 e 1.5.1; D-8: ROP86 1.1.1) → Painel subconta DIVERGIU do Mauro. Reuniões extraordinárias 2024/2025 (REP31–34, fora do xlsx) têm 5 classes de defeito (D-1…D-6) e o rótulo "ex-diretor" errado para Luiz Paniago (R-1).
