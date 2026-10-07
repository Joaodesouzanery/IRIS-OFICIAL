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
