# Revisão cega e independente — ANTAQ, ANATEL, ANEEL (votos 2026)

Data: 2026-10-09. Semente de sorteio: `random.Random(9003)`. Python `python3 -I`. Nenhum arquivo do projeto foi editado e não houve commit.
Scripts, esperados e saídas ficam em `.../scratchpad/rv/` (`*_exp.py`, `*_cmp.py`, `pop_*.py`, `inv.py`, `xl.py`).

## 1. Método e o que NÃO é cego

- Não abri `scripts/` (parsers). Li README.md.
- Fonte usada: ANTAQ `texto_antaq/ROD*`; ANATEL `texto_anatel/s187_*` (atas de circuito), `s229_*` (atas de reunião); ANEEL `fonte/aneel/pautas_atas.csv` (a fonte primária: `texto_aneel/RPO*.txt` é derivado dele).
- Para cada item sorteado li a fonte e escrevi o esperado (relator, presentes, vencidos, ausentes, impedidos, pedinte de vista, voto de cada diretor) em arquivo `*_exp.py` ou `*_cmp.py` antes de abrir o voto daquele item no JSON.
- Limites da cegueira, que declaro:
  - Antes de sortear vi o vocabulário agregado de rótulos de voto, contadores e as chaves do JSON, e o primeiro registro de cada JSON. Não vi votos por item.
  - Na ANATEL, o item RCD950 proc. 53500.052227/2019-84 teve o JSON aberto (campo `sem_voto`) por acidente logo depois de eu ter escrito a expectativa no chat. A expectativa não mudou.
  - O sorteio ANATEL de circuitos teve 2 etapas (20 CDs, depois +4 para cobrir Suzana Rodrigues). Sorteio estratificado à mão por reunião e tipo.
- Além da amostra, rodei verificações de população com parsers meus (independentes), por regex sobre a fonte. São menos confiáveis que a leitura item a item: servem para achar discrepâncias, não para atestar semântica.
- Não verifiquei: vídeos, PDFs de ata bloqueados (ANEEL), SEI/ANATEL fechado, nem a semântica do campo `resultado` além de ~12 itens por spot-check.

## 2. Amostras

| Agência | Itens lidos (amostra) | Células de voto conferidas | Estratos cobertos |
|---|---|---|---|
| ANTAQ | 39 acórdãos (ROD602 a ROD618, 15 reuniões) + 5 retirados de pauta + 5 vistas reabertas | 197 | vencidos (inclui relator vencido e redator/revisor), impedimento (Florambel), afastamento legal (Caio), "votou em 05/02 + vencida" (Flávia, ex-diretora), reaberturas de vista, quórum sem 7.2 |
| ANATEL | 48 itens: 24 circuitos (CD12 a CD243) + 24 itens de ata (RCD950 a RCD956) | 239 | não-acompanha, presidente ausente (licença/férias), substituto relator, Suzana/Cristiana/Nilo, vista, retirada, prorrogação, retomada de vista, maioria com vencidos, ex-conselheiro Vicente como relator |
| ANEEL | 53 itens (RPO/RPC/RPE, 20/01 a 06/10) | 92 explícitas (+ demais presumidas) | maioria/vencidos, suspeição/impedimento, ausente com voto consignado, pedido de vista, voto-vista, retirada, vazio, prorrogação de vista, relatores ex-diretores (Tili, Danna), Ludimila, Sandoval (DG), RPE |

## 3. Taxa de acerto (amostra)

"Real" = divergência com erro do JSON. Todas as discrepâncias brutas abaixo foram analisadas: nenhuma é erro inequívoco do JSON.

### Por agência e campo

| Campo | ANTAQ | ANATEL | ANEEL |
|---|---|---|---|
| Relator | 39/39 (100%) | 48/48 (100%) | 53/53 (100%) |
| Conjunto de votantes (1 linha por diretor) | 38/39 | 43/48 | n/a (presença inferida, só nomeados conferidos) |
| Vencidos nomeados | 10/10 | 8/8 itens de ata + circuitos | 100% dos nomeados na amostra |
| Ausente / impedido / não participou | 12/12 | todos | todos |
| Pedinte de vista | 22/22 linhas (censo independente: 12 pedidos novos + 10 renovações) | 48/48 (população) | 44/44 (população) |
| Retirada de pauta (sem voto) | 5/5 | 28/28 (população) | 7/7 |
| Voto por célula (bruto) | 194/197 = 98,5% | 236/239 = 98,7% | 87/92 = 94,6% |
| Voto por célula (descontando falsos positivos meus) | 197/197 | 238/239 | 92/92 |
| Modo (maioria sse há vencidos) | 39/39 | consistente | consistente |

### Por diretor (células conferidas, bruto)

- ANTAQ: Frederico Dias 39/39; Lima Filho 39/39; Alber Vasconcelos 36/39 (3 falsos positivos, ver 4.1); Caio Farias 38/38; Cristina Castro 28/28; Flávia Takafashi (ex) 8/8; Alexandre Florambel 6/6.
- ANATEL: Baigorri 48/48; Alexandre Freire 47/48; Edson Holanda 48/48; Octavio Pieranti 47/48; Nilo Pasquali 33/33; Cristiana Quinalia 5/6; Suzana Rodrigues 6/6; Vicente Bandeira (ex) 2/2 na grade esperada + as 3 outras linhas dele conferidas depois (RCD950 relator, RCD953 relator com "sem voto" nas alíneas g a j, RCD956 relator): 5 de 5 linhas totais dele corretas.
- ANEEL: Fernando Mosna 17/17; Gentil Sá Júnior 17/20 (3 falsos positivos); Agnes Costa 15/15; Willamy Frota 19/19; Sandoval Feitosa 9/9; Ludimila Silva 7/9 (2 falsos positivos); Ricardo Tili (ex) 2/2; Daniel Danna (ex) 1/1.
- Lacuna de cobertura (meta de >=5 votos por diretor): não atingida para Ricardo Tili (2), Daniel Danna (1 na amostra) e Vicente Bandeira (5 linhas existentes no total, 5 conferidas). Para Tili e Danna o JSON só tem 2 e 6 linhas no total, e conferi todas as menções na fonte (ver 5).

### Verificação de população (parsers independentes)

- ANTAQ: 553 acórdãos 2026 na fonte, 553 no JSON, 0 faltando em qualquer sentido; relator 553/553; vencidos 19/19; impedidos 6/6; não participou 30/30; todos os presentes do 7.1 têm linha de voto (553/553). Acórdãos de 2025 (ROD600/601, 69) corretamente fora.
- ANATEL circuitos: 241/241 CDs; 1.202 votos de bloco conferidos; relator 241/241; 2 "discordâncias" (CD162 Octavio, CD177 Alexandre) são falsos positivos meus: a fonte diz "Acompanha parcialmente" e nomeia vencido num item específico.
- ANATEL atas: 314 itens; pedinte de vista 48/48; retirada 28/28 sem voto; vencidos nomeados 8/8.
- ANEEL: 1.049/1.049 itens do CSV (exceto a pauta futura RPC18) presentes no JSON; relator e data iguais em todos; 54 vencidos nomeados, 54 "estava ausente", 44 "pediu vista", 17 impedimento/suspeição, 10 "não participou" sem nenhuma discordância.

## 4. Divergências

### 4.1 Falsos positivos (a expectativa é que estava imprecisa)

1. ANTAQ ROD605 Acórdãos 138/139/140, Alber Vasconcelos: eu esperava REDATOR, JSON tem "REVISOR (voto proferido)". A fonte diz "razões expostas pelo Revisor" e "3.1 Revisor" (só o 133 tem "3.1 Redator", e o JSON o trata). O JSON está certo.
2. ANTAQ ROD607 Acórdão 191: o JSON traz linha AUSENTE para Caio Farias (preâmbulo: "Ausente o Diretor Caio Farias, em razão de afastamento legal"). Era omissão minha.
3. ANEEL RPO5-4 e RPC15-15, Gentil: eu esperava DIVERGIU; JSON "ACOMPANHOU (voto vencido: acompanhou o relator, que restou vencido)". É exatamente a convenção do invariante.
4. ANEEL RPO18-4 (Gentil) e RPC17-27 (Ludimila): JSON "VOTOU (antes da vista)" onde eu esperava ACOMPANHOU. Equivalente (acompanharam o relator antes da vista).
5. ANEEL RPO2-9, Ludimila: JSON "DIVERGIU (divergência vencedora)", eu esperava "VOTOU". Equivalente (voto-vista vencedor de ex-voto subsistente).
6. ANATEL RCD950, itens 53500.052227/2019-84 e 53500.047732/2024-74 (RCD956): JSON inclui linha do relator Vicente (ex-conselheiro), que omiti. Correto.
7. ANATEL RCD950, 53500.002521/2025-93 e 53500.000608/2020-11: JSON inclui linha da conselheira substituta Cristiana (presente) como ACOMPANHOU/SEM VOTO. Omissão minha (ver risco em 5.4).
8. ANATEL RCD955 proc. 53524.001165/2019-74 ("prorrogação do prazo de vista"): JSON dá PEDIU VISTA a Alexandre e ACOMPANHOU a Octavio (relator); eu esperava ACOMPANHOU e RELATOR. Ambíguo; o JSON é defensável.

### 4.2 Pontos de atenção (não confirmados como erro; decisão do dono)

1. **ANATEL RCD956, 5 itens de vista (V2, V17 a V20; ex.: proc. 53560.005581/2020-49) com relatora Cristiana Quinalia**: nenhuma linha de voto para ela. Ela não está na lista de presentes de RCD956 (substituta). O invariante "relator contido em presentes" e "relator tem linha" falha nesses 5 itens (e, no total, 24 itens ANATEL sem linha do relator e 34 com relator fora dos presentes; 17 são Vicente ex-conselheiro, 10 Cristiana, 5 Alexandre ausente em missão, 2 Nilo ausente em férias: todos explicáveis por desenho, mas o invariante não vale literalmente). Em itens "Vista" o relator poderia ter linha "RELATOR (sem voto)".
2. **ANEEL RPO7-7**: resultado "por unanimidade" e linha DIVERGIU do Diretor-Geral num ponto específico. A fonte (CSV) tem esta contradição ("por unanimidade ... O Diretor-Geral apresentou voto divergente, o qual restou vencido, especificamente ..."). O JSON reflete a fonte, mas o invariante "unânime implica nenhum DIVERGIU" falha em 1 item.
3. **ANEEL RPC18 (13/10/2026)**: 19 das 34 linhas da pauta futura trazem texto de decisão no CSV (ex.: "A Diretoria, por maioria, acompanhando o voto divergente do Diretor Willamy..."). O JSON exclui a reunião (`obs` explica: "Ainda NÃO realizada"). Escolha defensável; vale registrar que o texto parece vir de carry-over/ata prévia e não é resultado de 13/10.
4. **ANATEL, itens com relator Vicente e substituto**: em 5 deliberações o JSON marca Cristiana/Nilo como ACOMPANHOU (inferido) sem a ata dizer nada; em outras 2 a ata diz que o substituto não votou (art. 5º, § 2º do RI) e o JSON registra assim. Risco de inferência errada nos 5 casos silenciosos.
5. **ANTAQ, campo `resultado` com perda**: Acórdão 429 (ROD614) tem `resultado` "CONHECIDO — POR MAIORIA (vencido: ...)", omitindo "manter a medida cautelar". Só observei este caso em ~12 `resultado` lidos; não é auditoria sistemática.
6. Presença ANEEL é inferida (declarado). A composição por reunião muda ao longo do ano (Ludimila entra, Fernando sai a partir do RPC17/RPO17); consistente com os textos, mas não verificável sem a ata.

### 4.3 Defeito real (menor)

- Aba "Faltam na fonte": 3 células ANATEL da coluna "URL da fonte" têm duas URLs concatenadas ("<url> | pauta: <url>"), p.ex. a pesquisa de `id_serie=229`. `curl` devolve HTTP 000 (URL inválida). As demais 59 URLs distintas (ANTAQ/ANATEL/ANEEL) são válidas.

## 5. Invariantes globais (JSON e xlsx, aba Votos)

| Invariante | ANTAQ | ANATEL | ANEEL |
|---|---|---|---|
| Diretor com mais de 1 voto no item | 0 | 0 | 0 |
| Presente da reunião sem linha de voto | 0 | 0 | 0 |
| Linha de voto de quem não é presente nem ausente | 3 (Flávia votou em 05/02, ex-diretora, documentado no 7.2) | 5 (Vicente, ex-conselheiro) | 20 (ex-diretores Tili/Danna, Fernando e Ludimila quando fora da composição) |
| Relator fora dos presentes | 3 (idem) | 34 (ver 4.2.1) | 18 (relatores ex-diretores) |
| Vencido nomeado sem DIVERGIU ou "(voto vencido...)" | 0 | 0 | 0 |
| Unânime com DIVERGIU | 0 | 0 | 1 (RPO7-7, ver 4.2.2) |
| Datas fora de 2026 (reunião, deliberação, voto) | 0 | 0 | 0 |
| Data do voto diferente da data da deliberação | 0 | 0 | 0 |
| Proveniência fora de {nominal, inferido, REVISAR} | 0 | 0 | 0 |
| Linhas REVISAR | 0 | 0 | 12 (todas "SEM VOTO REGISTRADO (deliberação suspensa)", Não Deliberado) |
| xlsx Votos = JSON votos (multiset reunião, processo, diretor, voto, proveniência) | 3.413 = 3.413, diferença 0 | 2.922 = 2.922, diferença 0 | 5.268 = 5.268, diferença 0 |
| xlsx Deliberações = JSON | 682 = 682 | 584 = 584 | 1.049 = 1.049 |
| xlsx Reuniões = JSON | 16 = 16 | 251 = 251 | 42 = 42 |
| Duplicatas (reunião, processo, item, diretor) no xlsx | 0 | 0 | 0 |

Não conferi o conteúdo da aba "Matriz de votos" nem os totais agregados do Painel.

## 6. Aba "Faltam na fonte": 20 URLs de amostra (seed 9003)

Havia só 60 URLs distintas para as 3 agências, então sorteei 8 ANTAQ, 7 ANATEL, 5 ANEEL (todas as 5 distintas). `curl -L` com User-Agent de navegador, pelo proxy do ambiente:

- HTTP 200 (11): gov.br/antaq atas-e-pautas; 6 URLs `sei.anatel.gov.br/.../publicacao_visualizar` ou `publicacao_pesquisar`; gov.br/aneel diretoria, pautas-e-atas, participação social, calendário. São páginas de listagem/índice: confirmam que a URL existe, não que o documento listado como "não publicado" esteja de fato ausente.
- HTTP 403 com página "Just a moment..." de Cloudflare (8): 7 URLs `sophia.antaq.gov.br/Terminal/acervo/detalhe/*` (41618, 41912, 42887, 42871, 42869, 42867, 42863) e `www2.aneel.gov.br/aplicacoes_liferay/noticias_area/?idAreaNoticia=425`. Coerente com "Bloqueado pela fonte" do README.
- HTTP 000 (1): célula com duas URLs concatenadas (ver 4.3).
- Não confirmei, para nenhuma, que o documento específico "faltante" continua ausente na fonte.

## 7. Conclusão honesta

- Não encontrei erro inequívoco de relator, de vencido, de pedinte de vista, de ausência ou de impedimento nas três agências, nem em amostra nem em população (para ANTAQ e ANEEL e para circuitos/atas ANATEL com os parsers independentes que escrevi).
- Os totais xlsx = JSON batem exatamente.
- Os pontos que merecem decisão do dono: 4.2.1 (relatora substituta sem linha de voto), 4.2.4 (inferência de substituto em itens de Vicente), 4.2.3 (texto de decisão na pauta futura da ANEEL), 4.3 (URLs concatenadas).
- Cobertura menor que a meta: Tili, Danna e Vicente têm poucas linhas no JSON; todas conferidas, mas não chegam a 5 votos "independentes" cada.
- Voto individual "ACOMPANHOU" inferido por unanimidade (ANEEL ~68%, ANATEL ~32%) não é verificável sem vídeo/ata nominal: a revisão confirma consistência com o texto, não o voto real.
