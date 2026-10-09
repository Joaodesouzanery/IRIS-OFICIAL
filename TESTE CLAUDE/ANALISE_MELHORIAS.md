# Análise e melhorias — votos 2026 (ANM, ANTT, ARTESP)
Atualizada em 07/10/2026 · Coleta independente (não usa o pipeline do IRIS) · Planilha: `votos_2026.xlsx` · Conferência: `AMOSTRA.md` · Reprodução: `rodar_tudo.sh`

## Resultado
| Agência | Reuniões cobertas | Deliberações | Linhas de voto (diretor × deliberação) |
|---|---|---|---|
| ANM | ROP 81–88 (8 de 9 realizadas) | 349 votadas (+31 itens sem votação, ex.: aprovação de ata) | 1.396 |
| ANTT | 57 de 62 realizadas com ata + 4 itens da RDE270 só com voto de relator | 309 | 1.488 |
| ARTESP | 56 de 56 (atas) | 743 (704 votadas + 39 canceladas) | 2.848 |

Proveniência: **nominal** (a ata cita o diretor: relator, vista, ausência, retirada, divergência), **inferido** (ata diz "por unanimidade": presentes acompanharam), **REVISAR** (maioria sem nomes). Predomina o inferido (ARTESP 94%, ANTT 65%, ANM 72%): responde "quantas vezes o diretor acompanhou", mas **não prova** divergência — ela só aparece quando a ata a registra (ANM: 3 divergências nominais do Diretor-Geral e 9 vistas; ANTT: 14 vistas).

## "Temos todos os documentos de 2026?" — o que dá para afirmar
- **ANM:** calendário oficial = 9 ROPs até hoje; 8 com ata (81–88), numeração 59–88 sem buraco; falta só a **89ª** (30/09, só pauta). Sem reunião extraordinária em 2026.
- **ANTT:** 101 reuniões listadas = 37 administrativas (só pauta, fora do escopo) + 64 deliberativas; 62 já realizadas: **57 com ata**, **4 aguardando ata** (299ª, 300ª, 301ª, 1042ª) e **1 lacuna antiga** (270ª eletrônica, só votos de relator). Numeração sem buraco. 2 reuniões futuras (1043ª e 302ª).
- **ARTESP:** 56 reuniões em duas séries sem buraco (Ordinárias 1177ª–1214ª; Extraordinárias 230–247). Conciliei cada ata com os 708 PDFs de Deliberação: **a própria ARTESP erra na publicação** — ata da 236ª numera 303 como "282"; ata da 239ª repete "479" (a segunda é 480); a "ata" da 243ª é a da 244ª (reconstruí 539 e 540 pelos PDFs, via OCR); números **12, 76, 77, 80, 102, 103 não existem em nenhuma fonte**.
- Limite: o site só garante o que publica. Divergência contra a fonte só a própria agência resolve.

## O que ainda falta para ser "completo"
1. Atas pendentes: ANM 89ª; ANTT 299ª/300ª/301ª/1042ª e 270ª; ARTESP 243ª (publicada errada) e os 6 números sem registro. Repetir `rodar_tudo.sh` quando saírem (incremental).
2. Voto individual escrito: não existe em unanimidade; para ANTT, os PDFs de voto do relator (99 são imagem, não lidos) trazem só a proposta.
3. Auditoria da produção do IRIS: o Supabase conectado aqui não é o do IRIS (projetos "TE AMAR", "NERY AGRO", "CIRCLE NEW"). Cruzar com esta planilha por (agência, reunião, processo) quando houver acesso.
4. Validação: li todos os casos não unânimes (ANM 20, ANTT 24) e achei/corrigi 11 erros do parser (ver `AMOSTRA.md`), mas **não auditei item a item os unânimes** nem campos como interessado/assunto.

## Suas perguntas anteriores, atualizadas
1. **Quase acabando?** Pela fonte, sim para ANM/ANTT/ARTESP em 2026 até o que está publicado. Critério do repo (`docs/PENDENCIAS.md`): livro-razão ≥95% pronto e nenhuma reunião aberta por trabalho nosso — aqui, as pendências acima são todas externas, exceto a validação por amostra dos unânimes.
2. **Caminho certo?** Sim: funil único por agência (listadas → baixadas → com texto → votos) com checagens automáticas (aba **Qualidade**) trouxe a resposta em dias, onde as fases anteriores consertavam insumos (datas/mandatos).
3. **Confiar nas ~1.000 deliberações da plataforma?** Cruze com esta planilha (3.700+ deliberações lidas por fonte independente) e olhe divergências por (agência, reunião, processo).
4. **"0 PDFs extraídos":** hipóteses a checar por SQL somente-leitura: migration não aplicada; contador lê outra tabela; orçamento de 70 s; PDF-imagem sem OCR; e, na ARTESP, o **WAF do host dos PDFs** (`admin.cms.sp.gov.br` + `*.token.awswaf.com`) que bloqueia download de servidor sem navegador.

## Otimizações recomendadas
- **Pipeline incremental único** (`rodar_tudo.sh`) agendado semanalmente; só baixa o que mudou (hash). Alerta quando uma reunião do calendário/numeração passa de N dias sem ata.
- **Conciliação como regra permanente:** ata × PDF de Deliberação (ARTESP) e ata × votos (ANTT) detectam erros da fonte; hoje achou 3 (282/303, 479/480, 243ª).
- **ARTESP:** coletor com Chromium comum + liberar `admin.cms.sp.gov.br` e `*.token.awswaf.com` no ambiente do deploy; remover caracteres invisíveis e rodapés de assinatura antes do parse.
- **OCR** só quando preciso (RapidOCR resolveu a ROP87 e as Deliberações 539/540).
- **Portar os 3 parsers para o IRIS (TS)** usando esta planilha como gabarito cruzado no harness `vote-certification`.
- **Painel de cobertura** (listadas → baixadas → com texto → votos) por agência, com motivo explícito em vez de "0".

## Atualização 07/10/2026 (parte 2)
**1. Unanimidade = um voto por diretor.** Sim, e agora está **verificado**: a aba *Qualidade* confirma que cada deliberação não cancelada tem 1 linha de voto por diretor presente/ausente (ANM 380/380, ANTT 305/305, ARTESP 704/704) e as abas *Matriz ANM/ANTT/ARTESP* mostram 1 linha por deliberação e 1 coluna por diretor (`*` = voto inferido da unanimidade).
**2. Itens "sem votação" da ANM — capturados.** Os 31 eram: 8 aprovações da ata anterior (agora `Aprovação de ata`, 1 voto por presente, inferido) e 23 retiradas de pauta (22 "retirado pelo relator/revisor" + 1 retirada em diligência proposta pelo Dir. José Fernando e acolhida pelos demais, ROP86). Coluna *Tipo de item* em todas as abas.
**3. Pendências da fonte.** Nova aba **Pendências da fonte** (gerada a cada rodada, com histórico em `pendencias_historico.json`): 21 itens hoje (ANM ROP89 aguardando ata e 3 ROPs futuras do calendário; ANTT 299ª/300ª/301ª/1042ª aguardando ata, 270ª lacuna antiga, 2 futuras; ARTESP 243ª publicada errada, 6 números sem registro, 2 números corrigidos, 1 título com typo). Quando a fonte publicar, rode `./rodar_tudo.sh` e o item passa a RESOLVIDA.
**4. Temas e microtemas.** Taxonomia em 3 níveis (**Modal → Tema → Subtema**) + `Microtema (IRIS)` e `Área (IRIS)` lidos do `classifier.ts`/`area-regulatoria.ts` do repo. Abas **Temas** e **Diretor × tema**. Validação em `AMOSTRA_TEMAS.md` (amostra nova: modal 94%, tema 94%).
- *Hidrovias*: 3 deliberações, todas da concessão **Acquavias SP (travessias)** na ARTESP; **nenhuma na ANM nem na ANTT** em 2026. *Aeroportos*: 14 na ARTESP (SUHAP = Superintendência **Hidroviária e Aeroportuária**).

## Fase 5 — presença da ANTT, checagens independentes e planilha em 9 abas

- **Erro corrigido (ANTT):** o parser perdia o 1º diretor após "dos Diretores" em 8 atas. Presença agora = cabeçalho ∪ relatorias, com ausência declarada prevalecendo. Votos ANTT: 1.484 → 1.529 (total 5.853: ANM 1.508, ANTT 1.529, ARTESP 2.816).
- **Checagem de presença não tautológica** (assinaturas/relatorias × presentes): ANTT 57/57, ANM 8/8, ARTESP 54/54.
- **Duplicidades removidas:** ANM 12 linhas, ARTESP 32.
- **Planilha reorganizada em 9 abas:** LEIA-ME, Painel, Votos, Deliberações, Matriz de votos, Diretores, Controle, Reuniões, Apoio (versão anterior de 16 abas mantida em `votos_2026_16abas_anterior.xlsx`).
- **Não feito (aba Controle):** B impedimento/"não votaria" (ANM), C ciclo da vista, D relatores ex-diretores (ANM, 11 itens), E proponente ARTESP (62 recuperáveis), H auditoria humana de 60 deliberações por agência. G (voto individual em unanimidade) é limite da fonte.

## Fase 7 — dupla 1 (ANPD + ANVISA), dashboard e paridade HTML = planilha

- **Planilha com 5 agências:** 8.140 votos (ANM 1.508, ANTT 1.529, ARTESP 2.816, ANVISA 2.177, ANPD 110). `build_xlsx.py` agora lê qualquer `<sigla>.json` (reuniões, deliberações, votos, qualidade, cobertura, pendências, não-feito, diretores).
- **ANPD:** 29 circuitos deliberativos (cd-01 a cd-29, sem buraco); ata lida em 27 (2 por OCR); cd-07 e cd-23 só têm o PDF de votos (pendência da fonte, entram só com o voto do relator). Votos 100% nominais (a ata lista cada votante); nenhum circuito teve "não acompanha" nem foi levado à reunião. Auditoria independente dos 29: votos 29/29; os erros achados (processo do cabeçalho em cd-01..06, interessado OCR) foram corrigidos.
- **ANVISA:** 13 atas (ROP 1–10, 12, 13 e REP 1); 441 itens com desfecho (310 deliberações, 50 vistas, 81 retiradas/adiamentos); 2.177 votos (inferido ~59%). Checagens independentes: retirados do cabeçalho × corpo 59/59; "decidiu" 310/310; presença por citação 13/13. Pendências: ROP14–18 sem ata; ROP11 não aparece em nenhuma fonte; vista concedida a diretora ausente (ROP13 3.4.10.4). Auditoria independente de 40 itens: 35 corretos antes das correções (letras espaçadas em "Processos:", impedimento e "ausente da votação" não detectados), corrigidos e reprocessados.
- **Temas:** modais novos fixos por setor ("Saúde e vigilância sanitária", "Proteção de dados pessoais") com temas próprios (`taxonomia.SETOR`); ANVISA usa a seção da ata e a gerência (GGFIS, GGPAF…) como subtema.
- **Dashboard (`votos_2026.html`):** 9 visões iguais às 9 abas, gráfico de blocos mensal, perfil por diretor (modal › tema, microtema, mapa de calor), seletor de agência, tema escuro/claro. `build_html.py` relê o HTML gravado e compara linhas, células e somas com o xlsx; falha se divergir.
- **Fora do escopo desta dupla:** votos já dados antes da vista (ANVISA), decisões compostas, votos escritos e circuitos deliberativos da ANVISA.

## Fase 8 — QA de completude (ANPD e ANVISA) e circuitos deliberativos da ANVISA

- **Achado:** a ANVISA decide a maior parte das matérias por Circuito Deliberativo (CD). Só com as atas das ROP/REP havia 2.177 votos; os 935 extratos de CD de 2026 (tabela nominal de votos por diretor) elevaram para **5.795 votos em 1.166 itens** (441 de ROP + 725 CDs avulsos). Itens de ROP decididos por CD (210) usam a tabela nominal do extrato; o extrato não é contado de novo.
- **Paginação:** a listagem do site mostra 25 por vez (940 extratos, 698 votos escritos). A API do próprio site devolve tudo com `b_size` grande e confere com `items_total` (940 = 940).
- **Total da planilha:** 11.758 votos, 5 agências + 2 de apoio de controle. ANVISA 5.795 · ANPD 110 · ANM 1.508 · ANTT 1.529 · ARTESP 2.816.
- **QA:** `scripts/qa_completude.py --online` reconcilia listagem ao vivo × manifesto × JSON × planilha (0 falhas); relatório em `QA_COMPLETUDE.md`.
- **Auditorias independentes:** ANPD 29 circuitos; ANVISA atas (40 itens) e extratos de CD (50 + 60, com os casos que haviam falhado); correções aplicadas: tabela de votos por tokens (rodapé, quebra de página, `SIM*`, nome em ordem diferente), rótulo "Processos/Processo SEI/alvo de revisão", decisão só do item atual (nunca "Decisões anteriores"), "NÃO CONHECER/AUTORIZAR" preservado. Última reauditoria: 60/60 extratos e 299/299 votos; 13/15 itens de ROP, e os 2 erros (negação perdida no resultado) foram corrigidos depois.
- **Pendências da fonte (ANVISA):** ROP 14–18 sem ata; ROP 11 sem registro; 123 números de CD sem extrato (42 têm só o voto escrito do relator); 32 CDs citados nas atas sem extrato; 3 extratos com ano errado no cabeçalho (usada a data da assinatura). **ANPD:** circuitos 7 e 23 sem ata; as 9 reuniões deliberativas de 2026 constam como canceladas.
- **Não feito:** votos escritos (PDFs de voto) não lidos além do que o extrato mostra; resultado "DECIDIU" genérico quando a decisão tem I/II/III; voto individual nas ROP com unanimidade continua inferido (501 linhas) onde não houve CD.

## Fase 9 — votos que dependiam de vista/impedimento, aba "Faltam na fonte", dupla 2 (ANP + ANTAQ)

- **Aba `Faltam na fonte` (10ª aba, todas as agências):** 279 linhas, cada uma com documento esperado, como sabemos que existe, URL da página-fonte, situação, votos afetados e como resolver. `qa_completude.py` exige que todo pendente do JSON esteja na aba, com URL.
- **Correções que afetam votos:** votos dados antes de uma vista (ANVISA, ANP, ANTAQ) viram "VOTOU (antes da vista)" nominal; ciclo da vista ligado ao desfecho do mesmo processo (colunas `Status do processo`, `Desfecho final`, `Voto final`); impedimentos como estado próprio; 11 linhas de ex-diretores relatores da ANM fora dos totais de 2026; 54 votos de proponente na ARTESP (procedência diretoria/Presidência).
- **ANP:** 13 atas (RD 1.175–1.185, RDE 69–70), 139 itens, 695 votos (47% nominais). Auditoria independente: 49 itens únicos, 245 votos, 0 erros. Pendências: 7 reuniões sem ata (a ANP só publica após aprovar na reunião seguinte) e 6 futuras.
- **ANTAQ:** 16 atas ROD (602–608, 610–618), 682 itens (553 acórdãos), 3.413 votos (43% nominais, vindos de Declarações de Voto no SEI e do item 7.2 de cada acórdão). As atas de 2026 estão no acervo Sophia (só abre com Chromium); gov.br tem só 2. Pendências: ROD619/620 sem ata, 8 números de acórdão que a própria ata pula, votos dos demais diretores no SEI onde não abre. Auditoria independente: identidade/presença 100%; resultado tinha 9 de 40 incompletos (omitia o mérito), corrigido e reauditado em 5 amostras de 40 (97,5–100%).
- **Total:** 15.877 linhas de voto em 7 agências (ANM 1.519 · ANTT 1.529 · ARTESP 2.816 · ANVISA 5.795 · ANPD 110 · ANP 695 · ANTAQ 3.413; as 11 linhas de ex-diretores não entram nos totais de 2026).

## Fase 10 — dupla 3 (ANATEL + ANEEL)
- **ANATEL:** 584 deliberações, 2.922 votos (10 reuniões do Conselho + 241 circuitos; fonte SEI Publicações). Auditoria independente (45 itens): voto 99,1%; corrigidos vista com sujeito composto e relator em sede de vista (15 votos); abertos (PARCIAL): Ac.43/131 (parte decidida por "unanimidade dos votantes"), Ac.194 (proveniência), CD215 ("acompanha parcialmente"), atas/prorrogações com modo inferido.
- **ANEEL:** 1.001 itens, 5.023 votos (41 reuniões: 20 RPO, 17 RPC, 4 RPE) lidos do texto de decisão nos Dados Abertos; atas em PDF bloqueadas (Cloudflare) → presença do colegiado inferida, 68% dos votos inferidos. Auditoria independente (50 itens): voto 98%; 9 achados corrigidos (vencidos que acompanharam o relator, divergência parcial em vistas, partes perdidas, ex-diretores, voto-vista condutor); reauditoria semente 31416: 100% (204/204 linhas). Sem solução: pedinte de vista em 20 itens, 7 textos truncados, 12 SEM VOTO REGISTRADO.
- Rótulos novos tratados no build: "VOTOU (antes da vista)" (coluna própria), "NÃO PARTICIPOU", "SEM VOTO REGISTRADO" (a revisar); ex-conselheiros/ex-diretores fora dos totais (aba Votos).

## Fase 11 — recheck de votos, registro único de agências e dupla 4 (ANS + ANA)
- **Recheck 100%:** ANATEL (73 linhas corrigidas: ex-conselheiro sem voto em partes "unanimidade dos votantes", CD215, 47 relatores procedurais, 12 proveniências, 7 atas sem modo) e ANEEL (7 itens com erro real: 5 divergências antes da vista, 1 voto subsistente, 3 itens com partes perdidas; exceção manual `VISTA_DIV_MANUAL` trocada por regra textual; rótulos "DIVERGIU (sem maioria)"). Reauditorias: ANATEL 399/400 campos, ANEEL 60/60 votos (semente 778). Textos truncados da ANEEL: 8 (corrige "7" da fase 10).
- **`scripts/agencias.py`:** registro único (JSON, URL, ex-membros fora dos totais, DIVERGE aceitos); QA genérico por agência; regressão idêntica antes de ANS/ANA.
- **ANS:** 85 itens e 195 votos (189 inferidos, 5 REVISAR, 1 nominal); fonte oficial de atas restrita; relator inferido da área proponente (inferência nossa). Auditoria 100% após correção (rodada 1: 93,6%).
- **ANA:** inventário (12 reuniões 949ª–960ª, 29 pendências com URL) e 0 votos: `arquivos.ana.gov.br` recusado pelo egress do ambiente.
- Desbloqueios que trariam votos: `arquivos.ana.gov.br` (ANA); `www.ans.gov.br` e `componentes-portal.ans.gov.br` (ANS atas).
- **ANS refeita com atas oficiais:** 17 atas lidas (17/17/17), 281 itens, 1.260 votos (1.147 inferidos); auditoria 44 itens 100% e varredura 8.459/8.459; limites: nenhuma ata usa 'relator' (inferido pela área em 192 itens), nenhum voto vencido nas atas, 641–643 sem ata publicada.
- **ANCINE:** 32 reuniões (24 deliberativas + 8 circuitos), 1.838 deliberações, 7.000 votos; DDC 1.819×1.819×1.819; 2.281 documentos com sha256; varredura 28.459/28.459 e auditoria 44/44; bug real corrigido (RD961 item 1 herdava votos de outra DDC); 79 REVISAR ('tomou conhecimento' sem modo declarado).
- **ANA refeita** com 23 PDFs: 61 itens, 244 votos. **ANAC:** pipeline entregue, 0 votos — índices e calendário 2026 em hosts bloqueados no egress (3 pendências com URL); aguardando liberação ou PDFs.
- **Conferência geral (xlsx final):** 32.334 linhas de voto; 0 duplicados (agência, reunião, processo, item, diretor); 0 datas fora de 2026; proveniências válidas (nominal 12.193, inferido 19.850, n/a 190, REVISAR 101); 42 linhas de ex-membros fora dos totais; 549 linhas em 'Faltam na fonte', todas com URL.

## Fase 13 — ANEEL: reteste dos hosts e CSV de 09/10/2026
- **Reteste (09/10/2026, hosts liberados no egress):** `www2.aneel.gov.br` (ata_diretoria/ata.cfm, noticias_area idAreaNoticia=425), `www.aneel.gov.br`, `biblioteca.aneel.gov.br`, `sei.aneel.gov.br` respondem **HTTP 403 com `cf-mitigated: challenge`** ("Just a moment…", Turnstile) em curl (UA de navegador, 2 tentativas) e em Chromium headless e headed/xvfb (sessão única); `reuniaodiretoria.aneel.gov.br` segue com *Connection reset by peer* (curl 35 / ERR_CONNECTION_RESET). Desafio **não contornado**. As páginas do gov.br só apontam para `ata.cfm` (mesmo bloqueio). Nenhuma ata em PDF obtida.
- **Dados Abertos (CKAN) reconsultados:** CSV de 09/10 (16.272 linhas; era 16.238): **RPO20 (06/10) agora com decisão** (48 itens, ata prévia) e **RPC18 (13/10, circuito ainda não realizado)** só com pauta (34 itens); 20 itens de 2026 com campos alterados na fonte (ordem do nº de processo em 17 itens, tipo de ato em 2, ponto final do assunto em 3).
- **Parser:** RPO20 entra (48 deliberações, 245 votos); wording de reunião futura corrigido (RPC18 não é "realizada"); QA (a2)/(b) ignoram pauta de reunião futura; 3 correções de rotulagem achadas na auditoria (RPO20-11 e RPO20-12, ver `aneel_auditoria.json`). Varredura nova: `scripts/aneel_varredura3.py`.
- **ANAC (hosts APEX liberados):** 41 reuniões listadas=baixadas=lidas, 95 itens, 411 votos; presença inferida (atas no `sei.anac.gov.br`, bloqueado); 85 pendências com URL. **ANATEL/ANA/ANS reconsultadas em 09/10:** nenhum documento novo, votos inalterados.
- **ANTT (rodada de completude):** 87 PDFs de voto (não 99) lidos por OCR (RapidOCR); voto do relator só traz a proposta dele; votos vista/declaração converteram 24 votos inferidos em nominais (13 itens pós-vista), ROD1025 reclassificada por maioria (Alex Azevedo DIVERGIU); 26 pendências com URL. **ANEEL:** RPO20 (+245 votos). **Total da planilha:** 32.950 votos / 7.360 deliberações / 653 linhas em Faltam na fonte (todas com URL).
