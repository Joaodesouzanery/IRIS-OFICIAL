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
