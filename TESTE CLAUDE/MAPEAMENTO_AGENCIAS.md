# Mapeamento das agências reguladoras federais

> **Status real em 08/10/2026 (substitui as hipóteses da pesquisa inicial abaixo, que seguem como histórico):**
> | Agência | Estado | Votos | Limite |
> |---|---|---|---|
> | ANM, ANTT, ARTESP | feito | 1.527 / 1.529 / 2.816 | ANTT 99 PDFs de voto em imagem; ANM 5 REVISAR |
> | ANPD, ANVISA, ANP, ANTAQ | feito, QA + auditoria | 110 / 5.795 / 695 / 3.413 | unanimidade = voto inferido |
> | ANATEL | feito, varredura 100% + auditoria | 2.922 (67,5% nominal) | 9 relatores ex-conselheiros sem linha; CD215 sem placar |
> | ANEEL | feito, varredura 100% + auditoria | 5.023 (31,6% nominal) | atas PDF bloqueadas (Cloudflare): presença inferida; 20 vistas sem pedinte |
> | ANS | **parcial**: 281 itens, 1.260 votos (1.147 inferidos, 108 nominais, 5 REVISAR; blocões = 2.064 decisões individuais) | 17 atas oficiais lidas | atas 641–643 ainda não publicadas, 644ª em 09/10, extraordinárias 9–11 só por citação; relator inferido pela área em 192 itens; zero voto vencido/divergente nas atas |
> | ANA | **bloqueada pelo ambiente**: 12 reuniões inventariadas, 0 votos | — | PDFs em `arquivos.ana.gov.br` recusado pelo egress |
> | ANCINE, ANAC | não iniciadas | — | ANAC por último (captcha) |


Pesquisa de 08/10/2026 com WebSearch/WebFetch/curl pelo proxy com allowlist. **Verificado** = abri a página ou o PDF; **não verificado** = não consegui abrir (bloqueio, timeout ou captcha) e a informação vem de busca. Hoje o IRIS só coleta **notícias** destas agências; nenhuma tem ata, voto ou pauta coletados (ver `MONITORAMENTO.md`).

## Resumo e prioridade sugerida

| # | Agência | Colegiado / rito | Voto individual publicado? | Fonte aberta daqui? | Dificuldade |
|---|---|---|---|---|---|
| 1 | **ANPD** | Conselho Diretor; quase tudo por **Circuito Deliberativo** (29 em 2026); 9 reuniões marcadas, todas canceladas | **Sim**, nominal (ata com votos por diretor + PDF com o inteiro teor) | Sim | Baixa |
| 2 | **ANVISA** | Diretoria Colegiada; ROP 1–12/2026 e Circuitos | **Parcial/bom**: relator e votos escritos nominais; divergentes nomeados; unanimidade sem lista | Sim | Baixa |
| 3 | **ANP** | Diretoria Colegiada; ~23 reuniões ordinárias (1.175–1.197) + extraordinárias | **Sim** nos itens com divergência (texto da ata); unânime = "por unanimidade" | Sim | Baixa a média |
| 4 | ANTAQ | Diretoria; ROD ~602–620 + RED; acórdãos | Parcial: ata traz relator e quórum; posicionamento dos demais no SEI | Parcial | Média a alta |
| 5 | ANS | DICOL; ordinárias (634ª–644ª) e extraordinárias 1–8 | Não nominal (só decisão/unanimidade; "blocão" de centenas de processos) | Parcial | Média |
| 6 | ANEEL | Diretoria; 25 RPOs no calendário 2026 + circuitos | Provável (apuração nominal) mas **não verificado** | **Não** (hosts www2/aneel fora da allowlist) | Média |
| 7 | ANATEL | Conselho Diretor; reuniões ~950–955; Acórdãos | **Não verificado** | **Não** (hosts anatel fora da allowlist) | Média a alta |
| 8 | ANA | Diretoria Colegiada; ~956 reuniões numeradas; votos de relator em PDF | Parcial (voto do relator + resultado); nominal não confirmado | Parcial (listagens dinâmicas) | Alta |
| 9 | ANCINE | Diretoria Colegiada; reuniões 961–978; DDC | **Não nominal** (resultado + ressalvas) | Parcial (SEI bloqueado) | Alta |
| 10 | ANAC | Diretoria Colegiada; ~40 REDIR/ano (presencial + eletrônica) | Provável ("voto vencido do Diretor X") mas **não verificado** | **Não** (HTTP 429 + captcha) | Alta |

Ordem de ataque: **ANPD → ANVISA → ANP** (mesmo estilo de pipeline da ANM/ANTT), depois ANTAQ e ANS, e só então ANEEL/ANATEL/ANA/ANCINE/ANAC dependendo de liberação de host ou navegador real.

## Fichas

### ANPD
- Fonte: `gov.br/anpd/pt-br/assuntos/deliberacoes-do-conselho-diretor` (subpáginas `circuito-deliberativo`, `reunioes_deliberativas`, `avisos-de-reuniao`). PDFs `cd-NN-2026-{ata|votos}.pdf`; no gov.br o PDF só vem com sufixo `/@@download/file`.
- Formato: PDF textual do SEI, listagem HTML estática sem paginação. A ata é uma tabela (relator, "acompanha/não acompanha", "levar à reunião") com a lista de votos por diretor.
- Voto: nominal. Ex.: CD 33/2025 — relator Waldemar Ortunho Junior; votos de Miriam Wimmer, Lorena Coutinho e Iagê Miola; 3 acompanham.
- Volume 2026: cd-01 a cd-29 (08/10); 9 reuniões deliberativas, todas canceladas.
- Denominador: numeração `CD NN/AAAA` (lacuna detectável), avisos de reunião, nº do processo SEI. DOU não testado.
- Riscos: caminhos de PDF mudam (`-1`, pastas diferentes); PDFs de votos concatenam várias peças; resets intermitentes do proxy exigem retry.

### ANVISA
- Fonte: `gov.br/anvisa/pt-br/composicao/diretoria-colegiada/reunioes-da-diretoria/{pautas|atas|votos}/2026/...` (PDF via `@@display-file/file`).
- Formato: página HTML + PDF textual (SEI). Sem anti-bot. Paginação da listagem não verificada.
- Voto: ata cita relator, quem proferiu voto, divergência nominal ("vencidos o Diretor X e o Diretor Substituto Y"); voto escrito em PDF separado. Unânime: sem nomes.
- Volume 2026: ROP 1–12 (28/01 a 08/07) + Circuitos Deliberativos (ex.: CD 509/2026). ROP 9 tem 20 decisões, 3 por maioria.
- Denominador: numeração das ROP e dos votos (`nº/2026/SEI/DIREn`); calendário não localizado.
- Riscos: atas publicadas com 2 meses de atraso (ROP 9: 27/05 → 31/07); pautas republicadas (duplicidade); itens retirados, sigilosos e em vista; substituto atuando como diretor.

### ANP
- Fonte: `gov.br/anp/.../pautas-atas-e-calendario-de-reunioes-da-diretoria-colegiada/2026`; PDFs `ata-NNNN.pdf`, `ata-extraordinaria-NN.pdf`, `pauta-NNNN.pdf`.
- Formato: PDF textual, sem paginação nem anti-bot; ligaduras "ti" quebradas (mesmo problema da ANTT); nomes de arquivo irregulares (retificada, extrapauta).
- Voto: nominal nos itens divergentes (ex.: ata 1.178, 13/03/2026: relatora Symone Araújo, divergência de Pietro Mendes, voto antecipado de Fernando Moura); unânime = "por unanimidade". Ata lista presentes e ausentes.
- Volume 2026: atas 1.175–1.185 + extraordinárias 69–70; pautas até 1.192; calendário até 1.197 (18/12). Atas só após aprovação na reunião seguinte (1.186–1.191 sem ata ainda).
- Denominador: calendário na própria página com numeração sequencial.
- Riscos: sessão reservada; mudança regimental recente que tirou a sessão administrativa da transmissão (a verificar).

### ANTAQ
- Fonte: `gov.br/antaq/pt-br/acesso-a-informacao/institucional/reunioes-deliberativas/` (com barra final) e `.../atas-e-pautas-das-reunioes`; PDFs `AtaROD615.pdf`, `AtaRED33.pdf`; página "Resultado das reuniões virtuais" (HTML de 3 MB); calendários semestrais em PDF.
- Voto: ata traz relator, presentes e dispositivo do acórdão; posicionamento dos demais diretores provavelmente no SEI (`sei.antaq.gov.br`, não testado).
- Volume 2026: ROD 602 a 620 (~19, a 609 cancelada), RED 33; dezenas de acórdãos por ata (acórdãos 440–475 só na ata 615).
- Denominador: calendário semestral (Acórdão 351-2026), numeração de reuniões e de acórdãos.
- Riscos: calendário do 2º semestre em imagem; host histórico `sophia.antaq.gov.br` fora do ar; defasagem de ~2 reuniões; reuniões virtuais de 3 dias.

### ANS
- Fonte: notícias HTML pós-reunião (`.../assuntos/noticias-1/periodo-eleitoral/deliberacoes-da-641a-reuniao-da-diretoria-colegiada`) e extratos de ata em PDF; **não há índice oficial de atas de 2026 verificado**.
- Voto: só decisão ("item aprovado/referendado", "aprovada por unanimidade") e lista de presentes; voto por diretor só no vídeo.
- Volume 2026: ordinárias 634ª (13/03) a 641ª (07/08) e citada a 644ª; ≥ 8 extraordinárias. Na 641ª, "blocão" de 167 processos sem detalhe.
- Denominador: numeração das reuniões; sem calendário público.
- Riscos: slugs diferentes entre ordinárias e extraordinárias; PDFs que redirecionam para login; a pasta `periodo-eleitoral` indica estrutura instável. (O IRIS já removeu deliberações de ANS por classificação errada; qualquer retomada precisa de validação de sigla.)

### ANEEL
- Fonte: `gov.br/aneel/pt-br/reunioes-publicas` (`/pautas-e-atas`, `/calendario`) que aponta para `www2.aneel.gov.br` (listagem de atas, aplicação `ata_diretoria`) e playlist no YouTube.
- Voto: rito prevê apuração nominal em ordem inversa de antiguidade; **ata não aberta**; atas são rascunho até a assinatura.
- Volume 2026: calendário oficial com 25 RPOs (jan–dez, quinzenal) + Circuitos Deliberativos Públicos; pauta de uma RPO chegou a 57 processos.
- Denominador: calendário oficial, numeração de RPO, NUP dos processos.
- Bloqueio: `www2.aneel.gov.br`, `www.aneel.gov.br`, `reuniaodiretoria.aneel.gov.br` e YouTube fora da allowlist. **Liberar estes hosts** para continuar.

### ANATEL
- Fonte provável: `anatel.gov.br/institucional/conselho-diretor/76-reunioes/conselho-diretor`; anexos do SEI em `sistemas.anatel.gov.br/anexar-api/...`; legislação em `informacoes.anatel.gov.br`.
- Voto: não verificado; decisões saem como Acórdão.
- Volume 2026: reuniões nº 950 (12/02) a 955 (02/07) (estimativa por 3 pontos).
- Denominador: numeração das reuniões e dos Acórdãos.
- Bloqueio: `www.anatel.gov.br`, `informacoes.anatel.gov.br`, `sistemas.anatel.gov.br` fora da allowlist.

### ANA
- Fonte: `gov.br/ana/pt-br/acesso-a-informacao/institucional/reuniao-deliberativa` (+ `atas-das-reunioes-deliberativas`, `calendario-...`, `pautas-...`). Listagens vieram vazias (provável JavaScript/Volto; precisa de navegador headless).
- Voto: voto do relator publicado como PDF numerado (`Voto nº 12/2026/DIREC`); despacho de resultado ("aprovou por unanimidade"); votação nominal não confirmada.
- Volume 2026: reuniões numeradas (956ª em 28/07/2026); 20–25/ano (estimativa).
- Denominador: página de calendário 2026 (conteúdo não visto), numeração, DOU.
- Bloqueio: `ana.gov.br/www2`, `participacao-social.ana.gov.br`. (O IRIS já limpou deliberações de ANA classificadas por engano.)

### ANCINE
- Fonte: `gov.br/ancine/pt-br/assuntos/diretoria-colegiada/reunioes_deliberativas` mostra só a última (977ª, 06/10/2026) e a próxima (978ª); pauta e ata ficam no SEI (`sei.ancine.gov.br`, **bloqueado**); arquivo 2018–2020 estático.
- Voto: não nominal; ata lista presentes e "matéria aprovada – DDC n.º X"; só ressalvas/divergências aparecem no texto (ex.: ressalva do Diretor Paulo Alcoforado na DDC 536-E/722-E).
- Volume 2026: reuniões 961 (01/04) a 977 (06/10), 978 marcada; circuitos não vistos.
- Denominador: numeração corrida das reuniões e das DDC; calendário não encontrado.
- Para continuar: liberar `sei.ancine.gov.br`; o resultado esperado é "unânime ou com ressalva".

### ANAC
- Fonte: `gov.br/anac/pt-br/acesso-a-informacao/institucional/reunioes-da-diretoria/{reunioes-deliberativas|reunioes-deliberativas-eletronicas}/AAAA/arquivos-Na-redir-del.../ata-...pdf` (padrão visto em busca, não aberto).
- Bloqueio: **HTTP 429 + captcha** em todo o domínio gov.br/anac. Exige navegador real; não recomendo contornar captcha sem decisão explícita.
- Voto: atas costumam registrar relator e "voto vencido do Diretor X" (não verificado em 2026).
- Volume: ~40 reuniões/ano (30 só até setembro de 2025), mais eletrônicas que presenciais.

## Lacunas comuns
- **DOU** não foi testado como denominador em nenhuma agência (`in.gov.br` fora da allowlist).
- Nenhuma contagem completa de deliberações 2026 foi feita; os volumes acima são estimativas ou leitura de índices.
- Hosts a liberar para fechar o mapeamento: `www2.aneel.gov.br`, `www.aneel.gov.br`, `reuniaodiretoria.aneel.gov.br`, `www.anatel.gov.br`, `informacoes.anatel.gov.br`, `sistemas.anatel.gov.br`, `sei.ancine.gov.br`, `sei.antaq.gov.br`, `sophia.antaq.gov.br`, `in.gov.br`, `www.youtube.com`.
- Vídeos (YouTube) são a única fonte de voto individual onde a ata só diz "por unanimidade"; não foram avaliados.
