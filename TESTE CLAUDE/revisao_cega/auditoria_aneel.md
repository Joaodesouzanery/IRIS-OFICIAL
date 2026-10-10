# Auditoria independente dos votos ANEEL 2026 (aneel.json)

Data: 2026-10-08. Projeto não editado. Fonte usada: `fonte/aneel/pautas_atas.csv` (coluna `TxtDecisaoJulgamento`, `NomDiretorRelator`, `DscResultadoJulgamento`). Não usei `aneel_auditoria.json`. Li `scripts/aneel_parse.py` somente DEPOIS de comparar, para formular a causa provável.
Scripts de apoio (scratchpad): `sorteio.py`, `esperado.py` (extração manual feita ANTES de olhar o JSON dos 50 itens), `comp.py`, `div.py`, `miss*.py`, `aus.py`, `imp.py`, `partes.py`, `modo.py`, `camp.py`, `lead.py`.

## 1. Sorteio (seed 2718, `random.Random(2718)`, candidatos ordenados por (tipo, nº reunião, ordem))
Estratos definidos só pelo CSV: C = resultado "Pedido de Vista*" (62 candidatos); D = Retirado/Destacado (80); E = texto com impedi/suspei/não participou/ausente/vencid (95, não-vista e não-retirado); B = decisão composta, "(i)" e "(ii)" no texto (263); A = Deliberado, "por unanimidade", sem "(i)", sem keyword (392). Ordem de extração: C, D, E, B, A (sem sobreposição).

- C (5): RPE4-2, RPC1-7, RPO5-8, RPO4-9, RPO18-4
- D (5): RPO6-12, RPC7-12, RPC16-15, RPC1-3, RPO12-1
- E (5): RPO5-4, RPO2-7, RPC15-15, RPO2-4, RPC13-23
- B (10): RPC1-16, RPC15-1, RPC10-7, RPO13-24, RPC13-2, RPC8-2, RPO11-14, RPC7-10, RPO4-13, RPO6-11
- A (25): RPO1-25, RPO4-8, RPC17-3, RPC9-20, RPC3-12, RPO8-27, RPC17-24, RPC5-17, RPC17-17, RPC3-9, RPO6-19, RPO12-18, RPO16-22, RPC2-4, RPO16-38, RPC11-4, RPO1-10, RPO19-11, RPC9-6, RPC17-39, RPC17-42, RPC16-24, RPC16-12, RPO2-3, RPO5-14

Nota: "DIVERGIU" nunca aparece no texto da ata. O estrato E usou "vencido/impedido/suspeição/ausente".

## 2. Resultado da amostra (50 itens, 251 linhas de voto)

| Campo | Aplicável | Correto | Taxa |
|---|---|---|---|
| relator | 50 | 50 | 100% |
| resultado / situação | 50 | 49 | 98% (RPO5-8) |
| modo (unanimidade/maioria) | 42 itens com decisão | 41 | 97,6% (RPO5-8) |
| vencidos nomeados | 5 itens | 5 | 100% |
| impedidos/suspeitos | 1 item (RPC13-23), 0 falso positivo nos 49 outros | 1 | 100% |
| ausentes (quem) | 2 (RPE4-2) | 2 | 100% |
| ausente com voto consignado | 1 (RPE4-2 Willamy) | 0 | 0% (n=1) |
| quem pediu vista | 3 identificáveis no texto (+RPO5-8 não identificável na fonte) | 3 | 100% |
| nº de partes (composta/simples) | 40 | 40 | 100% |
| modo por parte / vencidos por parte (RPO5-4, RPO2-7) | 2 | 2 | 100% |
| voto por diretor (linhas) | 251 | 246 | 98,0% |
| ... linhas "nominal" | 96 | 91 | 94,8% |
| ... linhas "inferido" | 155 | 155 | 100% pela regra, mas não verificável (a ata não diz) |

Itens 100% limpos: 45/50 (90%). Itens com divergência real: RPE4-2, RPO5-8, RPO18-4, RPO5-4, RPC15-15. Os 25 simples, os 10 compostos e os 5 retirados/destacados bateram em todos os campos.

## 3. Divergências reais na amostra (item, campo, fonte x JSON, trecho, causa provável)

| # | Item | Campo | Fonte | JSON | Causa provável (`scripts/aneel_parse.py`) |
|---|---|---|---|---|---|
| 1 | RPE4-2 | voto Willamy | "O Diretor Willamy ... estava ausente ..., tendo consignado seu voto no sentido de acompanhar o voto da Diretora-Relatora, nos termos do art. 50, § 3º" | `AUSENTE (não participou da votação)` | No ramo `col == 'Pedido de Vista'` o rótulo de ausente é string fixa (~l.383) e ignora `c['ausentes'][d]` (tipo "acompanhou o relator"). Os ramos Deliberado (`voto_parte`) acrescentam "; acompanhou o relator". Inconsistência entre ramos. |
| 2 | RPO5-8 | resultado, modo, voto Sandoval | "A Diretoria, por maioria, decidiu, ouvida a Procuradoria, declarar a insubsistência do voto ... do então Diretor-Relator Daniel Cardoso Danna ... Para este ponto, o Diretor-Geral Sandoval votou no sentido de tornar insubsistente apenas o item ... Outorga ... Decididas as preliminares, o processo foi retirado de pauta" | `RETIRADO DE PAUTA (após pedido de vista)`, `partes=[]`, todos `SEM VOTO (retirado de pauta)` (inclusive Sandoval) | Ramo retirada de pauta (`col in ('Retirado da Pauta','Pedido de Vista + Retirado de Pauta')`) não lê a decisão preliminar "A Diretoria, por maioria, decidiu" nem a posição nominal de Sandoval. "após pedido de vista" vem só da coluna do CSV (o texto não nomeia pedinte). |
| 3 | RPO18-4 | voto Ludimila | "A Diretora Ludimila Lima da Silva apresentou divergência especificamente quanto à vedação da utilização ... da marca e logotipo" | `VOTOU (antes da vista)` (igual a quem acompanhou o relator) | Ramo `Pedido de Vista`: todo líder/seguidor de `c['camps']` vira `VOTOU (antes da vista)`; divergência (2º campo) não é distinguida. Mesmo problema em RPO14-7 (Willamy), RPO15-4 (Fernando, voto-vista), RPO16-16 e RPO16-17 (Agnes). |
| 4 | RPO5-4 | voto Gentil | "O Diretor-Relator Fernando, acompanhado pelo Diretor Gentil, votou no sentido de ... dar provimento" e "vencidos o Diretor-Relator ... e o Diretor Gentil" | `DIVERGIU` | `voto_parte` dá `DIVERGIU` a todo `d in pt['vencidos']` que não é o relator. Gentil acompanhou o relator e perdeu: a direção está invertida. |
| 5 | RPC15-15 | voto Gentil | "A Diretora-Relatora Agnes, acompanhada pelo Diretor Gentil, votou no sentido de conhecer e negar provimento" (vencidos: Agnes e Gentil) | `DIVERGIU` | Mesma causa do #4. |

## 4. Divergências reais fora da amostra (achadas nas varreduras globais)

1. RPO7-7, voto Sandoval: "O Diretor-Geral Sandoval apresentou voto divergente, o qual restou vencido, especificamente no que se refere a determinação ... plano de intervenção administrativa". JSON: `ACOMPANHOU todas as partes` (inferido). Faltou tratar "restou vencido" fora da frase de decisão. A decisão é "por unanimidade" e Parcialmente Deliberado.
2. RPC5-6, voto Sandoval, parte II: "Para este ponto, o Diretor-Relator Gentil, acompanhado pelo Diretor-Geral Sandoval, votou no sentido de deferir"; a parte II foi indeferida por maioria (só Gentil nomeado como vencido). JSON: Sandoval `ACOMPANHOU (por exclusão)`; deveria ser vencido na parte II. É o único caso desse padrão no ano (varredura `camp.py`).
3. Partes perdidas na divisão do texto (4 itens):
   - RPC7-16: "(ii) encaminhar os autos ... SCE" some, e o resultado fica sem ENCAMINHADO. Causa: o divisor de frases corta em "Sr. Fábio" (abreviação).
   - RPO14-4: o marcador digitado "(iiii)" na fonte derruba a parte (4 partes no JSON, 5 no texto). A parte perdida é "estabelecer que os valores ... sejam habilitados no processo de recuperação judicial".
   - RPO7-7: faltam "(iii) reconhecer que não houve a regularização estrutural..." (sem hífen separador antes) e a numeração desloca. São 5 partes contra 6 no texto.
   - RPO18-6: faltam (vii), (viii) e (ix). A parte (vi) tem ponto final interno ("... CTG. O referido desconto ...") e as frases seguintes não começam com "A Diretoria". São 6 partes contra 9.
   Por isso o QA "(c) partes x âncoras 865/865 OK" do projeto é circular. Minha contagem independente de marcadores deu 861/865 (4 reais; os outros 10 sinais eram falsos positivos meus).
4. Linhas de ex-diretor ausentes, embora o texto diga que votaram (voto subsistente):
   - RPO1-6: falta Ludimila ("Tili e Ludimila proferiram votos subsistentes").
   - RPO10-2: falta Daniel Danna.
   - RPO17-16: falta Fernando ("proferiu voto subsistente na 13ª RPO de 2026"). Existe só a linha de Ludimila NÃO PARTICIPOU.
   Causa: ex-diretor só entra se for relator, vencido, líder, pedinte, impedido ou ausente. "Votou subsistente e não é relator" não entra.
5. Nota inadequada nas linhas de ex-diretor: o sufixo "[ex-diretor; voto proferido em reunião anterior e subsistente]" é colado em todas as 15 linhas. Em RPO5-8 o texto decide a INSUBSISTÊNCIA do voto de Danna. Em RPO7-8 o voto-vista propõe declarar insubsistentes os votos anteriores, e a própria linha diz "sem voto proferido na ata". Contradição interna.
6. Voto-vista vencedor em decisão unânime: RPO7-7, RPO7-12 e RPO16-8 ("por unanimidade, acompanhando o voto-vista do Diretor Gentil"). O relator ficou como `RELATOR (voto proferido)` e Gentil como `ACOMPANHOU` nominal. A autoria do voto condutor está invertida. Também ocorre em RPC8-9 e RPC11-6 (voto-vista de Gentil prevalece e Gentil fica ACOMPANHOU), em contraste com RPO2-4 e RPO5-4 (líder vira DIVERGIU). Critério inconsistente (por design em `voto_parte`), impacto baixo.

## 5. Falsos positivos (parecem divergência, mas não são)

- RPC1-7 Gentil `VOTOU (antes da vista)`: ele apresentou voto-vista em reunião anterior. O texto não diz que divergiu do relator (graus diferentes de provimento parcial). OK.
- RPO4-9: Willamy `DIVERGIU` embora a divergência dele tenha vencido. O rótulo significa "divergiu do relator" (ver §6 sobre ambiguidade). Fernando "por exclusão" é inferência declarada. O relator da coluna (Agnes) difere do "Diretor-Relator do voto-vista" (Gentil): é o relator original, correto.
- RPO6-3 e RPO9-4: "Relator do voto-vista" difere da coluna. Correto manter a coluna.
- RPC10-14 e RPO17-8: "votos divergentes com fundamentação diversa ... acompanhando a decisão". O parser marcou como ressalva, sem divergir do resultado. Correto.
- RPO4-43, RPO4-7, RPC9-3, RPO5-28 e RPO2-9: meu regex de modo/vencidos discordou, mas o JSON está certo. A causa era meu regex (marcador por parte, frase partida).
- Falsos positivos do meu varredor de partes: RPO12-12 e RPC13-8 (enumeradores dentro de "nova redação" entre aspas), RPO4-5 (fonte digita "(ii)" no primeiro item), RPO9-8, RPO10-4 ("ii)" sem abre-parêntese) e RPO2-9/RPC1-2/RPO4-9 (marcadores da narrativa).
- RPO17-11 e RPO17-16: o JSON tem NÃO PARTICIPOU para Ludimila. Meu regex inicial acusou Fernando por engano.
- RPO14-3 e RPO15-9: a coluna diz "Retirado da Pauta", mas o texto diz suspensão por falta de 3 votos. O JSON reclassificou como Não Deliberado e anotou em `obs`. Correto.
- RPO7-8: relator da coluna é Danna (ex-diretor), enquanto o texto cita "Diretor-Relator do voto-vista Fernando". O JSON mantém Danna como relator, conforme a coluna. É coerente com a fonte (a redistribuição só aparece no texto).

## 6. Confere (1): os 55 DIVERGIU e os 16 IMPEDIDO contra o texto

IMPEDIDO: 16/16 batem com o texto, sem omissões (varredura independente do texto também deu exatamente 16). São 11 suspeições de Fernando (RPO7-29, RPC6-5, RPO9-12, RPC7-8, RPC7-9, RPC7-15, RPO10-5, RPO10-28, RPO13-5, RPC13-23, RPO16-50), 1 impedimento de Gentil (RPO7-9) e 4 impedimentos de Ludimila (RPC14-8, RPC14-17, RPO17-14, RPO18-16). NÃO PARTICIPOU: 8/8 (art. 54). AUSENTE: 52/52 têm frase "ausente" no texto. Nenhum ausente do texto ficou sem linha. Única perda de tipo: RPE4-2 Willamy (#1).

DIVERGIU (55 linhas exatas): todas têm suporte no texto como posição contrária ao relator ou à maioria. Não há DIVERGIU sem base. Composição:
- 30 dissidentes vencidos (relator venceu).
- 10 líderes e seguidores de divergência vencedora (RPO2-4 W, RPO2-9 L, RPO5-4 W, RPO5-7 F, RPO6-4 G, RPO8-7 G, RPO10-4 G, RPO13-13 F, RPC15-15 L, RPC15-16 L).
- 12 de "sem maioria" (RPC9-8, RPO12-3, RPO12-15, RPO13-8, RPO14-3, RPO14-19, RPO15-9). RPO12-3, RPO14-3 e RPO15-9 herdam posições pelo mesmo `NumProcesso` e pela frase "permanecendo válidos os votos".
- 1 em vista/prorrogação (RPO4-9 Willamy).
- 2 com direção invertida: RPO5-4 Gentil e RPC15-15 Gentil (#4 e #5). Estes dois são os únicos DIVERGIU incorretos: 53/55 = 96,4% corretos em substância.

Problema de semântica: `DIVERGIU` cobre três coisas diferentes (perdeu contra o relator; divergiu do relator e ganhou; ficou com o relator e perdeu). Quem consome o campo não distingue vencido de divergente.

Falsos negativos de DIVERGIU achados: RPO7-7 Sandoval, RPC5-6 Sandoval (parte II) e 5 linhas de vista com divergência rotulada VOTOU (RPO14-7 W, RPO15-4 F, RPO16-16 A, RPO16-17 A, RPO18-4 L).

## 7. Confere (2): os 12 "SEM VOTO REGISTRADO / REVISAR"

12/12 são realmente indeterminados pela fonte. São 8 itens, todos "ausência de 3 votos convergentes" (8 itens no CSV, nenhum a mais).
- RPC9-8 Fernando, RPO12-3 Fernando (herdado): o texto nomeia S+G (relator) e A+W. Fernando não aparece.
- RPO12-15 Sandoval e Fernando: o texto nomeia G+A e W (voto-vista).
- RPO13-8 Agnes, RPO14-3 Agnes e RPO15-9 Agnes (os dois últimos herdados de RPO13-8): o texto nomeia G+S e F+W.
- RPO14-19 Sandoval e Agnes: o texto nomeia W+F e G.
- RPO12-7 Sandoval, Willamy e Fernando: o texto está TRUNCADO em 4.000 caracteres (len=4000) e só aparecem A+G. É indeterminação por limite da fonte, não silêncio do texto. Pode ser resolvida com a ata completa (já está nas pendências).
Nenhum REVISAR é determinável por dedução lógica. Não há regra "maioria sem vencido" disparada.

## 8. Confere (3): linhas de ex-diretores (15 linhas)

Base no texto da decisão (6): RPO1-6 Tili (relator, voto subsistente), RPO2-9 Tili e Ludimila (voto-vista), RPO5-8 Danna ("então Diretor-Relator"), RPO10-2 Ludimila (relatora, voto subsistente), RPO17-11 Fernando (relator, voto subsistente).
Base apenas na coluna de relator (texto silencioso) (9): RPO4-43, RPC4-25, RPO7-8, RPO11-11 (texto truncado) de Danna; RPO5-25 de Ludimila; RPO19-25, RPC17-1, RPC17-6 e RPC17-46 de Fernando. São legítimas (item de vista/retirada/prorrogação cujo relator é ex-diretor), mas "voto subsistente" é só rótulo.
Faltam 3 linhas que o texto exige (§4 item 4).
Colegiado: o texto sustenta a troca. Fernando é relator ou votante até a RPO16 (11/08). Ludimila aparece como ex-diretora (voto subsistente) até maio e como membro votante (impedimento, divergência, relatora) desde o RPC14 (18/08). Fernando após 18/08 só aparece como ex-diretor (6 itens). Nenhuma contradição. A presença nominal por reunião continua INFERIDA (nenhum texto lista presentes).

## 9. Confere (4): pendências completas?

Cobertas corretamente nas pendências: RPO20 só com pauta (48 itens); as 8 truncadas (RPO3-8, RPO7-13, RPO10-4, RPO11-11, RPO12-7, RPO13-4, RPC11-6, RPO16-2, idênticas às 8 que achei com len=4000); os 8 itens REVISAR; o buraco RPO12-17; a data da RPO17 (24 x 25/08); o colegiado inferido; as atas em PDF bloqueadas.
Faltam na lista:
1. Os 4 itens com partes perdidas (RPC7-16, RPO7-7, RPO14-4, RPO18-6).
2. Os 3 votos subsistentes de ex-diretor sem linha (RPO1-6, RPO10-2, RPO17-16).
3. As divergências não capturadas (RPO7-7 Sandoval, RPC5-6 Sandoval, vistas RPO14-7, RPO15-4, RPO16-16, RPO16-17, RPO18-4).
4. Os 20 itens "Pedido de Vista + Retirado de Pauta/Prorrogação" sem pedinte no texto (o QA só afirma 42/42 para o "Pedido de Vista" puro).
5. As 7 truncadas que NÃO são REVISAR (RPO3-8, RPO7-13, RPO10-4, RPO11-11, RPO13-4, RPC11-6, RPO16-2): impedimentos e ausências no fim do texto, onde o corte atinge, podem ter ficado de fora, e o JSON registra ACOMPANHOU inferido para quem a cauda perdida poderia nomear. Os votos delas são "inferidos" sem sinal de risco por linha.
6. O QA com 40 itens da própria auditoria (95% votos) é compatível com o que achei (98%), mas só no nível item/linha. Não mede a perda de partes.
