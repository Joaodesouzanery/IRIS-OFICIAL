# TESTE CLAUDE — votos de diretores de agências reguladoras, 2026

Coleta **independente** (não usa o pipeline do IRIS) dos votos individuais dos diretores em 2026, com proveniência por voto
(`nominal` = a fonte nomeia · `inferido` = "por unanimidade" vira 1 voto ACOMPANHOU por presente · `REVISAR` = indeterminado, com motivo).

**Entregáveis:** `votos_2026.xlsx` (10 abas), `votos_2026.html` (dashboard offline idêntico à planilha; paridade checada no build),
Artifact publicado a partir de `votos_2026_artifact.html` (gitignored). Documentos: `ANALISE_MELHORIAS.md` (fases e decisões),
`MAPEAMENTO_AGENCIAS.md` (status por agência), `QA_COMPLETUDE.md` (reconciliação), `MONITORAMENTO.md` (desenho, não implantado).

## Agências (status em 08/10/2026)
| Agência | Estado | Observação |
|---|---|---|
| ANM, ANTT, ARTESP | feito | atas em PDF; ANTT: 99 PDFs de voto em imagem não lidos; ANM: 5 linhas REVISAR |
| ANPD, ANVISA, ANP, ANTAQ | feito + QA + auditoria | ANVISA inclui Circuitos Deliberativos |
| ANATEL, ANEEL | feito + varredura 100% + auditoria | ANEEL: atas em PDF bloqueadas (Cloudflare) → presença inferida, ~68% dos votos inferidos |
| ANA | feito + varredura + auditoria | 61 itens, 244 votos (68% inferidos); atas só dizem 'por unanimidade' |
| ANS | **parcial**: 281 itens/1.260 votos (91% inferidos) | atas 641–643 não publicadas; relator inferido pela área |
| ANCINE | feito + varredura 100% + auditoria | 1.838 deliberações, 7.000 votos (97% inferidos); só circuitos têm votação nominal |
| ANAC | **parcial**: 41 reuniões, 95 itens, 411 votos (318 inferidos) | atas/votos/certidões em `sei.anac.gov.br`/`pergamum.anac.gov.br` bloqueados no egress; presença inferida |

## Como funciona
- `scripts/agencias.py` é o **registro único** das agências com pipeline próprio (arquivo JSON, URL da fonte, regra de ex-membros fora dos totais).
  Agência nova = uma linha lá + `SETOR[...]` em `scripts/taxonomia.py` + `scripts/<sg>_rodar.sh` chamado em `rodar_tudo.sh`. Arquivo JSON ausente = agência ignorada.
- Cada agência tem `scripts/<sg>_baixar/parse/auditoria`, `<sg>.json` (reunioes, deliberacoes, votos, qualidade, cobertura, pendencias, nao_feito, diretores, colegiado), `manifesto_<sg>.json` (sha256) e `<sg>_inventario.json`.
- `scripts/build_xlsx.py` consolida tudo; `scripts/temas.py` classifica modal/tema/subtema; `scripts/build_html.py` gera o dashboard e falha se divergir do xlsx;
  `scripts/qa_completude.py [--online]` reconcilia listagem oficial × manifesto × JSON × planilha (sai com erro se algo divergir sem pendência explicada).

## Reproduzir / atualizar (incremental)
`./rodar_tudo.sh` (cada agência baixa só o que falta; a fonte publica → o voto entra). Chromium/Playwright em `/opt/node-tools` para ANTAQ, ANATEL, ARTESP, ANEEL.
`fonte/` e `texto_*/` não são versionados em parte (peso); os hashes estão nos manifestos.

## Abas da planilha
LEIA-ME · Painel · Votos · Deliberações · Matriz de votos · Diretores · **Faltam na fonte** (todo documento/dado que a fonte não publicou ou bloqueou, com URL e votos afetados) · Controle (cobertura, qualidade, FEITO/PARCIAL/LIMITE) · Reuniões · Apoio.

## Limites conhecidos
Voto individual em decisões unânimes é **inferido** (só vídeo mostraria cada voto; fora de escopo); votos escritos em PDF imagem (ANTT) não lidos; presença da ANEEL inferida; ANA sem PDFs no ambiente. Tudo isso aparece na aba Controle e em `nao_feito` de cada JSON.
