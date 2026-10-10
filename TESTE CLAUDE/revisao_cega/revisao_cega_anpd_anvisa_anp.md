# Revisão cega e independente — votos ANPD, ANVISA (ROP/REP + Circuitos Deliberativos) e ANP

Data da revisão: 09/10/2026. Nenhum arquivo do projeto foi editado, nenhum commit feito. Parsers não lidos.
Artefatos de trabalho (só no scratchpad): `exp_anpd.py`, `exp_anp.py`, `exp_anvisa.py` (esperado escrito ANTES de abrir relator/resultado/votos do JSON), `anp_amostra.json`, `anvisa_amostra.json`, `inv2.py`, `cdcheck.py`, `rop_scan.py`.

## 1. Método e semente
- Semente 9002 (`random.Random(9002)`), usada para ANP, ANVISA e para a amostra da aba "Faltam na fonte".
- Antes de escrever o esperado, só li do JSON as chaves de item (reunião, nº, tipo_item, processo, seção) e, para ANVISA, flags de existência (item tem IMPEDIDO / DIVERGIU / FÉRIAS) usados para garantir cobertura. Não li relator, resultado nem votos.
- ANPD: a população tem 29 itens (<30). Conferi os 29 (100%), cada um contra a ata (texto ou imagem do PDF, nos CD02/CD04 que são OCR) e, nos CD07/CD23, contra o PDF de votos.
- ANP: 35 itens (13 reuniões; 18 deliberações, 10 vistas, 8 retiradas; inclui majoria, relatora vencida, ausência de diretor, voto encaminhado por ausente, retomada da RD 1179). Itens entre 2 snapshots (REG-n / REG-nR) comparados na versão final.
- ANVISA: 40 itens = 25 ROP/REP (13 deliberações uma por reunião, 4 vistas, 3 retiradas, 3 com impedimento, 2 com divergência) + 15 extratos de CD (10 por quantis do nº do CD, 1 impedimento, 2 divergências, 1 férias, 1 aprovação de ata). Para cada item que a ata remetia a um CD, li também o extrato do CD (a fonte nominal).
- Cobertura por diretor: ≥23 votos conferidos para cada um dos 5 diretores da ANP, ≥35 na ANVISA, ≥27 na ANPD (limite de ≥5 cumprido com folga).

Além da amostra cega, rodei verificações independentes sobre o corpus inteiro (código meu, escrito sem ver os parsers): leitura própria das tabelas de votação dos 940 PDFs de extrato de CD da ANVISA; varredura de "declarou-se impedido" / "esteve ausente da votação" / "concedeu vista" nos 441 itens de ROP; pares (reunião, processo, relator) das 13 atas da ANP.

## 2. Taxa de acerto — amostra cega
"Acerto" = o JSON diz o que a fonte diz. Casos de forma (rótulo diferente, mesma informação) contam como acerto e estão em §5.

| Agência | Itens | Relator | Desfecho/modo | Vencidos | Ausentes | Impedidos | Pedinte de vista | Votos individuais |
|---|---|---|---|---|---|---|---|---|
| ANPD | 29 (todos) | 29/29 | 27/29 (CD07, CD23 "SEM ATA") | n/a (nenhum na fonte) | 11/12 (CD07) | n/a | n/a | 110/116 = 94,8% |
| ANVISA | 40 | 40/40 | 40/40 | 6/6 | 5/7 | 5/5 | 5/5 | 176/179 = 98,3% |
| ANP | 35 | 35/35 | 35/35 | 3/3 | 4/4 | n/a (nenhum no JSON) | 11/11 | 122/122 = 100% (2 casos só de rótulo) |

Decisão por partes: ANVISA REP1 4.1.2.1 (I/II/III) e CD581 (I/II) e ANP (22 + vários "[decisão composta]") ficam no texto da decisão com resultado agregado; nenhuma divergência. O JSON não tem campo estruturado "partes".

### Por diretor (votos conferidos na amostra cega)
- ANPD: Waldemar 27/29, Miriam 27/29, Lorena 29/29, Iagê 27/29 (as 6 faltas são CD07 e CD23).
- ANVISA: Safatle 35/35, Daniel 36/36, Daniela 36/36, Thiago 35/36, Marcelo 34/36.
- ANP: Artur 24/24, Symone 25/25, Daniel 23/23, Fernando 23/23, Pietro 27/27.

### Verificação ampliada (fora da amostra cega, mesma metodologia independente)
- ANVISA, 940 extratos de CD: relator 940/940; modo (unanimidade/maioria) 939/940; votos 4.663/4.667 (99,91%). Os 4 que falham são 3 itens: voto SIM de Safatle ausente (D1).
- ANVISA, atas ROP (441 itens), varredura de notas textuais: 8 itens com rótulo errado de impedimento/ausência (D2, D3). 43/47 itens "Vista" com pedinte igual à ata (3 não localizados pelo meu extrator; 1 exceção conhecida, D8).
- ANP: 122 pares (reunião, processo, relator) da ata: 122/122 no JSON, nada a mais, nada a menos. Mais 4 itens por maioria conferidos à parte (RD1178 REG-1, RD1179 REG-14, RD1181 ADM-1, RD1182 REG-RSV-1): todos corretos, inclusive o voto de Pietro "acompanhou na RD 1.181".

Estimativa realista de erro: ANP ≈ 0 na amostra; ANVISA CD ≈ 0,1% dos votos; ANVISA ROP ≈ 8 itens/441 com rótulo de presença/impedimento errado (≈ 1,8% dos itens), mais famílias semânticas (D4); ANPD tem lacunas estruturais em 2 de 29 circuitos.

## 3. Divergências REAIS (voto/dado errado ou perdido)

| # | Agência / item | Campo | Fonte × JSON | Trecho da fonte | Causa provável |
|---|---|---|---|---|---|
| D1 | ANVISA CD 323/2026, CD 573/2026, CD 1031/2026 (e PDF duplicado `-1`) | voto de Leandro Safatle | fonte: SIM (CD573 e CD1031: é o relator); JSON: sem linha de voto | tabela com nome quebrado: `LEANDRO` / `PINHEIRO SAFATLE` com o `SIM` entre as linhas | parser de tabela não casa nome em 2 linhas quando o voto fica no meio. Em CD573 e CD1031 o item fica sem voto do relator; em CD573 Thiago aparece AUSENTE mas a reunião lista Thiago em presentes e ausentes=[]. O QA do projeto ("votos por extrato = diretores listados na tabela, 935/935 OK") não detecta |
| D2 | ANVISA ROP4 3.2.10.2, ROP5 3.1.4.1, ROP5 3.1.7.1 | voto de Marcelo | fonte: IMPEDIDO; JSON: ACOMPANHOU (inferido) | "O Diretor Substituto Marcelo Moreira declarou-se impedido na votação por ter participado do julgamento…" | nota depois de "O item foi apreciado em sessão reservada" ignorada; voto de impedido contado como "acompanhou". Também ROP5 3.1.1.1 e 3.1.9.1 (itens de vista): impedimento perdido, JSON "SEM VOTO AINDA (vista pendente)" |
| D3 | ANVISA ROP6 3.4.1.2 e ROP7 3.5.2.1 (Daniel), ROP1 4.2.2.1 (Thiago) | voto | fonte: ausente da votação; JSON: ACOMPANHOU (inferido) | "Registre-se que o Diretor Daniel Pereira esteve ausente da votação" | mesma causa de D2 (os 5 itens são "sessão reservada"). Em ROP5 2.8 (sessão pública) o parser acerta |
| D4 | ANVISA ROP5 4.1.2.1, ROP6 3.4.1.1, ROP9 3.4.3.1 (ata-only, relator vencido) | semântica ACOMPANHOU/DIVERGIU | JSON rotula a maioria vencedora como ACOMPANHOU (inferido) e, em ROP5 4.1.2.1, a diretora vencida como "DIVERGIU (vencido)"; nos extratos de CD (ROP1 3.2.2.5, ROP7 3.5.2.3, CD813 etc.) quem votou NÃO contra o relator é DIVERGIU | ROP6 3.4.1.1: "Safatle, Daniel Pereira e Daniela acompanharam o voto do Diretor Substituto Marcelo… vencido o Diretor Relator" | duas convenções diferentes (relativa ao relator no extrato; relativa à maioria na ata). Afeta contagem de "divergiu" por diretor (~10 votos); em ROP6 3.4.1.1 a ata nomeia quem seguiu Marcelo, mas a proveniência ficou "inferido" |
| D5 | ANVISA ROP2 3.5.7.2 | voto de Thiago | fonte: proferiu o Voto nº 43/2026 antes da vista; JSON: SEM VOTO AINDA | "O Diretor Thiago Campos proferiu o Voto nº 43/2026/SEI/DIRE5/Anvisa" | em ROP3 3.2.2.1 o JSON acerta "VOTOU (antes da vista)"; aqui perdeu. Posição do voto não é citada, então o próprio dado é ambíguo (severidade baixa) |
| D6 | ANPD CD07 e CD23 | votos dos demais diretores e resultado | fonte (PDF de votos, local): CD07 Miriam e Iagê "Acompanho a Relatoria" (Waldemar não vota; ata assinada pela presidente substituta); CD23 Iagê, Miriam e Waldemar "Acompanho". JSON: só o relator ("RELATOR (proposta; resultado sem ata)"), resultado "SEM ATA", 5 votos ausentes | PDFs `cd-07-2026-votos.pdf` e `cd-23-2026-votos.pdf` trazem a marcação X por diretor | decisão de só ler a ata. A informação está nos PDFs que o projeto já baixou. Em `curl` de hoje, a página oficial lista `cd-23-2026-ata-1.pdf` (HTTP 200, ata 31/08, total 4, 3 acompanham). A aba "Faltam na fonte" diz que a ata do CD23 não foi publicada, e o downloader não casou o sufixo `-ata-1`. Não sei se a ata foi publicada depois de 08/10 ou se já estava lá; CD07 continua só com PDF de votos |
| D7 | ANPD CD04 | processo | fonte (imagem/OCR): 00261.004679/2025-00; JSON: "" (xlsx: célula vazia) | OCR trouxe "Pr0cess0 n²" | regex não tolera OCR; é o único dos 29 com processo vazio |
| D8 | ANVISA ROP13 3.4.10.4 | pedinte de vista | fonte: concedeu vista à Diretora Daniela Marreco (item apreciado no CD 734); JSON: Daniela "AUSENTE (não consta entre os presentes)" | "…concedeu vista à Diretora Daniela Marreco" | Daniela ausente da ROP13 mas votou no CD; já registrado pelo próprio QA como EXCEÇÃO |

Contagem por diretor das divergências D1–D5 e D8 (votos afetados): Safatle 3 (D1), Marcelo 5 (D2) + 1 (D4 ROP5 4.1.2.1 e ROP9 3.4.3.1 contam como ACOMPANHOU), Daniel 2 (D3) + D4, Thiago 1 (D3) + 1 (D5), Daniela 1 (D8) + D4. ANPD (D6): Waldemar 2, Miriam 2, Iagê 2 (CD07: Waldemar ausente inferido).

## 4. Invariantes globais (JSON e xlsx, aba Votos)
O multiset (reunião, processo, deliberação, diretor, voto, proveniência) do xlsx é idêntico ao JSON para ANVISA (5.795) e ANP (695); ANPD (110) idêntico exceto CD04, em que o processo vem `None` no xlsx e `""` no JSON (4 votos e 1 deliberação; mesma causa de D7). Totais: Votos 6.600 = 110+5.795+695; Deliberações 1.334 = 29+1.166+139; Reuniões 29/738/13. A aba Painel por diretor soma coerente quando "VOTOU (antes da vista)" é contado à parte; não reproduzi exatamente as colunas do Painel.

| Invariante | ANPD | ANVISA | ANP |
|---|---|---|---|
| 1 voto por diretor presente por item | OK | OK, exceto CD386 (nº 386 usado em 2 processos distintos, 2 PDFs diferentes; chave `CD 386/2026` não é única, 5 votos "duplicados" na chave) | OK |
| relator ⊆ presentes | 2 sem ata (CD07/CD23) | 9: 7 itens de retirada com Daniel relator na ROP9, 2 com Marcelo na ROP8 (retiradas) + CD573 (D1) | OK |
| relator com voto RELATOR* em deliberação | OK | 2 falhas = CD573 e CD1031 (D1) | OK (28 linhas de retirada/vista com "SEM VOTO" são o esperado) |
| vencido nomeado ⇒ DIVERGIU | OK | 9 sinalizados: 4 são D4; 5 são convenção (vencido mas acompanhou o relator derrotado, ex. ROP1 3.5.3.6 Daniel, ROP10 3.4.2.1 Marcelo) | OK |
| unânime ⇒ nenhum DIVERGIU | OK | OK | OK |
| ausente do cabeçalho ⇒ AUSENTE | 11 com rótulo "SEM VOTO (não votou no circuito)" (informação correta, rótulo diferente) | 42 com ACOMPANHOU, todas de ROP9/ROP13 e vindas do extrato de CD (voto dado no circuito, não na reunião): sem erro | 9 de RD1178 (Fernando ausente que enviou voto ao Diretor-Geral, conforme a ata): correto |
| datas em 2026 | OK | OK; datas das 13 ROP/REP iguais à ata; 634 datas de CD iguais ao extrato | OK; RD1179 tem 12 itens em 02/04 (retomada) contra reunião 27/03: correto |
| proveniência válida | só `nominal`; 100% nominal embora a posição individual venha de "Acompanha=3/Não=0" da ata (arguável) | `nominal`/`inferido`; inferido nunca em voto diferente de ACOMPANHOU/SEM VOTO; 5 itens "inferido" em decisão por maioria (família D4 + ROP12 2.11) | idem |
| totais xlsx = JSON | OK (exceto None/"" no CD04) | OK | OK |

## 5. Falsos positivos e diferenças de forma (não são voto errado)
- Minha própria expectativa errada: ANP RD1175 item 18, Symone. Pensei ausente por saída antecipada; item 18 foi apreciado em conjunto com o 11 (registro da ata) antes da saída. O JSON está certo.
- ANP RD1180 REG-1: Artur "acompanhou parcialmente" Fernando; JSON "DIVERGIU (acompanhou o voto divergente)": perde o "parcialmente". Daniel idem em rótulo. Mesma informação relativa ao relator.
- ANP RD1185 REG-PUB-3: relator Daniel "leu o relatório, não proferiu": JSON "RELATOR (vista concedida; sem voto proferido na ata)".
- ANP RD1178: Fernando ausente com votos entregues ao Diretor-Geral; JSON o trata como votante (ACOMPANHOU/DIVERGIU) com proveniência inferido em 5 linhas. Coerente com a ata; só o rótulo "inferido" poderia ser nominal.
- ANVISA REP1 4.1.2.1 e ROP8 2.1: Marcelo (substituto, não presente) não tem linha de voto; já um titular ausente (Daniel, ROP9) recebe linha AUSENTE. Tratamento diferente entre substituto e titular; não é erro de voto.
- ANVISA CD620 (ata da ROP8): extrato lista só 4 diretores; JSON só 4 linhas.
- ANVISA ROP1 3.4.3.1 (CD49): resultado "SEM MODO NA ATA" porque o `decisao_texto` ficou truncado em "…decidiu, por"; a fonte diz "por unanimidade" (os votos estão certos).
- ANPD CD07: data JSON 26/03 (assinatura do relator); o circuito se encerrou em 30/03 pelas assinaturas dos demais. Sem ata, sem data oficial de fim.
- Registros das duas versões (REG-n e REG-nR) em ANP RD1179: desenho, mostra retirada e retomada.

## 6. Aba "Faltam na fonte" e URLs
As 178 linhas das três agências usam só 4 URLs distintas (páginas de listagem), não 20: ANVISA extratos de CD, ANVISA atas, ANP pautas/atas, ANPD circuitos. As 4 deram HTTP 200 (curl com User-Agent de navegador). Complemento: 16 URLs de documentos dos manifestos (6 ANPD, 6 ANVISA CD, 4 ANP) também deram 200; os links gov.br sem `/@@display-file/file` devolvem HTML de embrulho, não o PDF (normal).
Conteúdo conferido na página viva: ANP lista atas só até 1185 + extras 69/70, e pautas até 1192 (igual ao que a aba diz sobre RD1186–1191 sem ata e RD1192 futura). ANPD: ver D6 (contradição no CD23). ANVISA: a listagem é paginada por JavaScript e não consegui confirmar um a um os "CD sem extrato publicado" (923, 881, 879, 365, 1038, 1041, 358 e demais) — não verificado.

## 7. O que NÃO verifiquei
- Os 671 PDFs de voto escrito dos CDs ANVISA e a posição individual dentro de votos escritos; os PDFs de votos ANPD de CD que não sejam CD07/CD23 (as atas já dão 0 "não acompanha").
- ANVISA: as 441 deliberações de ROP além dos 25 itens da amostra cega e das varreduras por padrão de texto (impedimento, ausência da votação, vista, relator vencido). ANP: todos os itens além dos 35 + 4 por maioria + relatores; unanimidade item a item não foi recontada.
- Abas Matriz de votos, Diretores, Controle, Apoio e a reprodução exata do Painel; o HTML/Artifact.
- Ausência temporária de Symone (ANP RD1179, 15 min às 10h15): a ata não diz em qual item; não consegui avaliar.
- A estratificação por "sessão reservada" não estava no meu desenho de amostra; D2/D3 só apareceram na varredura dirigida e nenhum dos 25 itens ROP sorteados caiu nessa classe. Uma amostra cega só nos itens sorteados teria dado ANVISA ROP ≈ 100% e escondido essa classe de erro.
