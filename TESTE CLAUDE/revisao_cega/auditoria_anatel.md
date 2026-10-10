# Auditoria independente - votos ANATEL 2026 (anatel.json)

Método: amostra com seed fixa; para cada item li o texto fonte (texto_anatel/s229 = atas RCD, s8 = acórdãos, s187 = atas de Circuito Deliberativo) ANTES de ver o JSON; só então comparei. anatel_auditoria.json não foi aberto. Nenhum arquivo do projeto foi alterado. Scripts em scratchpad (sample.py, show.py, cdshow.py, js.py, glob_a/b/c.py).

## 1. Amostra (seed 20261008, random.Random, índices ordenados no array deliberacoes)
Sorteio sequencial, sem reposição: partes -> vista/retirada -> CD -> RCD.
- Partes (4 de 6 itens com len(partes)>1): 78 (RCD950 Ac.43), 319 (RCD956 Ac.194), 406 (CD65), 503 (CD162 Ac.177)
- Vista/Retirada (6 de 94; CD não tem nenhum): 79, 99, 112, 137, 157, 316
- Circuitos (15 de 241): 350 374 398 400 403 417 437 446 448 463 489 517 526 536 545
- RCD950-957 tipo Deliberação (20): 3 15 16 17 20 24 54 94 127 143 160 164 171 172 198 231 262 284 290 324
Total 45 itens / 227 linhas de voto. Complemento: varreduras globais independentes sobre todo o corpus (584 deliberações, 241 CDs, 261 acórdãos, 7 atas).

## 2. Taxa de acerto por campo (amostra de 45)
| Campo | Acertos | Obs |
|---|---|---|
| relator | 45/45 (100%) | inclui relator ex-conselheiro (Vicente) e relator por cabeçalho de seção |
| resultado/mérito (categoria) | 45/45 (100%) | |
| modo (unanimidade/maioria) | 39/40 (97,5%) | 40 itens com modo; erro: Ac.43 parte "e,f" é "unanimidade dos votantes" (Vicente não pôde se manifestar) e o JSON grava "unanimidade" |
| vencidos | 45/45 (100%) | 4 itens com vencidos, todos corretos |
| presentes/ausentes/impedidos | 45/45 (100%) | nenhum impedimento/abstenção existe nas fontes |
| voto individual (categoria) | 225/227 (99,1%) | ver D1, D2 |
| proveniência (nominal x inferido) | 225/227 (99,1%) | ver D3 |
Globais (corpus inteiro, parser meu): CD: relator 241/241 e 1202/1202 linhas de voto idênticas à ata (o "acompanha parcialmente" x3 foi mapeado a DIVERGIU); RCD (atas): relator 314/314; presentes/ausentes do cabeçalho de 7/7 atas = reunioes[]; acórdãos: lista "Participaram"/"Ausente" x linhas de voto 257/261 (4 restantes são falsos positivos, ver seção 5). Varredura de "vencid|diverg" em todos os itens x DIVERGIU/vencidos do JSON: 0 divergências reais.

## 3. Divergências reais (item | campo | fonte x JSON | causa provável)
D1. RCD951 item R13 (idx 97, proc. 53500.103468/2025-47) | voto de Carlos Baigorri
  - Fonte: "o Conselheiro Alexandre Reis Siqueira Freire e o Presidente Carlos Manuel Baigorri registraram voto acompanhando integralmente a Análise do Relator. Após, pediu vista o Conselheiro Edson Holanda."
  - JSON: Alexandre = VOTOU (antes da vista); Carlos = "SEM VOTO AINDA (vista pendente)".
  - Causa: parser da frase de vista pega só o primeiro sujeito de sujeito composto ("X e o Presidente Y registraram"). Único caso nos 66 itens Vista (varredura completa).
D2. Acórdão 43/2026 (RCD950 V3, idx 78) e Acórdão 131/2026 (RCD953 V9, idx 184) | voto_por_parte de Vicente Bandeira de Aquino Neto (+ modo da parte)
  - Fonte Ac.43: parte da obrigação de fazer (Voto 6/2025/OP): "unanimidade dos votantes, considerando que o ex-Conselheiro Vicente ... não pôde se manifestar, em decorrência do término do seu mandato". Ac.131 alíneas g-j: idem ("Nessa parte, o ex-Conselheiro Vicente ... não pôde se manifestar").
  - JSON: Vicente = "RELATOR (voto proferido)" em TODAS as partes, incl. "demais alíneas (e, f)" (Ac.43) e "alíneas g-j" (Ac.131); modo = "unanimidade".
  - Causa: voto_por_parte replica o voto do relator em todas as partes; não trata a ressalva "unanimidade dos votantes / não pôde se manifestar". Correto seria sem voto nessas 2 partes e modo "unanimidade dos votantes".
D3. Acórdão 194/2026 (RCD956 V25, idx 319) | proveniência de Carlos Baigorri e Alexandre Freire
  - Fonte: "Acompanharam a proposta do Relator o Conselheiro Alexandre ... nos termos do Voto nº 36/2026/AF ..., e o Presidente Carlos ..., que apresentou voto oral".
  - JSON: ambos ACOMPANHOU com proveniencia "inferido" (deveria ser "nominal"; valor do voto está certo).
  - Causa: o parser extrai a lista de vencidos mas não a lista "Acompanharam ... X e Y" como evidência nominal. Varredura global (frases com acompanh/voto oral/registrou x linhas inferido): só este caso.
D4. Relator em itens "sede de vista" | voto do relator (14 itens; na amostra: 316 RCD956 V22, Edson Holanda)
  - Fonte: item de vista; Relator = Edson (Análise já apresentada na sessão em que a vista foi concedida); a ata só narra o voto-vista de Alexandre e o novo pedido de vista de Carlos. Nada diz que o relator "não votou".
  - JSON: Edson = "SEM VOTO AINDA (vista pendente)"; nos itens de relatoria com vista o relator recebe "RELATOR (voto proferido; vista concedida)" (27 casos). Critério inconsistente.
  - Causa: fallback do parser quando a frase "Apresentada pelo Relator" não aparece (nos itens V aparece o vistor). Gravidade baixa/média (convenção), mas distorce contagem de votos de relator.
D5 (fora da amostra, achado da varredura). CD215 / Acórdão 236 (Regimento Interno, idx 554) | Carlos Baigorri e modo
  - Fonte: Carlos "acompanhou a proposta do Relator e propôs alterações, tendo votado vencido em relação a essas alterações"; a ata registra "Acompanha parcialmente". Nem ata nem acórdão dizem "por maioria".
  - JSON: Carlos = DIVERGIU, vencido; modo "maioria". Só Edson está plenamente vencido. Decisão: marcar Carlos como "acompanhou com ressalva"; modo "maioria" é inferência, não dito na fonte.
  - Causa: mapeamento de "Acompanha parcialmente" -> DIVERGIU (3 casos: CD162 Octavio e CD177 Alexandre estão certos porque há ponto excepcionado da unanimidade; CD215 é o duvidoso).
D6 (baixa, convenção). 7 aprovações de ata (item 0) e itens "prorrogação do prazo de relatoria": ata diz só "aprovada sem restrições"/"aprovou, por unanimidade a prorrogação"; JSON atribui modo "unanimidade" e ACOMPANHOU inferido a todos os presentes, e "RELATOR (voto proferido)" ao relator numa prorrogação (ato procedural sem voto). Inferência razoável; só registrar.

## 4. Verificações pedidas
(1) ACOMPANHOU inferido onde a fonte nomeia divergente: NENHUM caso. Varredura de todas as frases com vencid/diverg em ata+acórdão+ata de CD, por item, comparada a DIVERGIU/vencidos/voto_por_parte do JSON: coincidência total. (Único adjacente: D5.)
(2) Presentes sem linha de voto: 0 em 584 deliberações (reunioes.presentes x votos). reunioes.presentes/ausentes conferem com o cabeçalho das 7 atas RCD. Linhas "extras" (diretor não presente): só as 5 do Vicente, legítimas.
(3) Vicente (5 votos): todos têm base na fonte, mas nenhum foi proferido na reunião registrada (mandato encerrado; ele é "ex-Conselheiro").
  - RCD950 Ac.43: relator (Análise 64/2025/VA); vota nas alíneas a-d; NÃO nas partes e,f (D2).
  - RCD951 Ac.65 e Ac.66: ACOMPANHOU o Relator Alexandre; ata/acórdão: "ex-Conselheiro Vicente..., que havia registrado seu posicionamento na Reunião nº 947, de 13/10/2025" (voto da RCD947, atribuído à deliberação da RCD951). Correto, mas a data do voto é a de 947.
  - RCD953 Ac.131: relator; vota nas alíneas a-f; NÃO em g-j (D2).
  - RCD956 Ac.194: relator, Análise 104/2025/VA; vota a (unânime) e b (maioria de 3). Correto.
  Vicente é relator em 17 itens; nos 12 sem acórdão/voto (diligências, retiradas, vistas) não há linha dele, coerente.
(4) Os 2 "SEM VOTO art. 5º §2º": CORRETOS. Cristiana Quinalia em Ac.43 e Nilo Pasquali em Ac.131; ambos literais ("não proferiu voto ... nos termos do § 2º do art. 5º do Regimento Interno da Anatel, por suceder o ex-Conselheiro Vicente ..., Relator"). Não aparece terceiro caso no texto.

## 5. Falsos positivos descartados
- CD144: "relator = None" no meu parser (layout diferente da ata); JSON (Carlos) está correto.
- Ac.62/69/70 (CD55, CD58, CD59): acórdão sem linha "Ausente" mas JSON marca Nilo AUSENTE; a ata do CD diz "Conselheiro em missão oficial internacional". Correto.
- CD47: acórdão sem "Participaram"; ata de CD tem 5 votos; ok (placeholders "xxx" na ata fonte, voto de Alexandre ainda assim "Acompanha").
- 8 itens (Ac.43, 65, 66, 194, CD162, CD177, CD215, CD223) apontados pela varredura de vencid/diverg só porque a frase "Participaram..." entrou no mesmo trecho; conferidos à mão, vencidos corretos.
- RCD950 R61-R75: meu parser acusou relator Holanda; é seção "CONSELHEIRA SUBSTITUTA CRISTIANA..." - JSON correto.
- CD65 (406) e CD162 (503): Octavio "Acompanha parcialmente/Não acompanha" -> DIVERGIU, com voto_por_parte discriminado (a: DIVERGIU, b: ACOMPANHOU etc.) - fiel à fonte.
- Ac.43 (78) Carlos/Edson DIVERGIU e Octavio/Alexandre ACOMPANHOU: confere com "maioria de três votos".
- 112: Alexandre "PEDIU VISTA" numa prorrogação de vista: é o vistor original; aceitável. Relator Cristiana sem linha: não estava na reunião.
- 79: retirada a pedido de Edson (não-relator, Relator = Alexandre) e relator Alexandre sem tratamento especial - correto.
- Modo "unanimidade" nas 5 RCD que não usam a palavra: derivado de "aprovada sem restrições"/votos; só D6.
- Limite: ~961 linhas (32,9%) inferidas nas reuniões não são verificáveis na fonte (ata/acórdão só dão resultado + vencidos); só confiro coerência com "unanimidade"/vencidos, que é total.
