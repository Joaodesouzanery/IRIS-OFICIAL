# Plano: correções D1-D8 (ANPD/ANVISA) — retomada

## Estado em disco (git status/diff, pasta "TESTE CLAUDE")
- ANPD (D6, D7) JÁ FEITO pelo run anterior: anpd.json alterado (CD04 processo 00261.004679/2025-00; CD07 com
  votos Miriam/Iagê ACOMPANHOU e Waldemar SEM VOTO, data 2026-03-30; CD23 com ata `-ata-1` lida, 4 votantes),
  `texto_anpd/cd-23-2026-ata.txt` criado, `scripts/anpd_baixar.py` e `anpd_parse.py` alterados,
  manifesto/inventário ANPD atualizados. Falta só: re-rodar anpd_parse para confirmar idempotência, rodar
  auditorias e conferir cegamente CD04/CD07/CD23; confirmar que a pendência CD23 saiu de `pendencias`.
- ANVISA (D1-D5, D8, chave CD386): NADA feito (anvisa.json/anvisa_cd.json/anvisa_final.json sem diff).
- ANAC/ANM/ANS... têm diffs de OUTRAS tarefas: não tocar.

## ANVISA — mudanças nos scripts (só anvisa_cd_parse.py, anvisa_parse.py, anvisa_unir.py)
D1 `anvisa_cd_parse.py` (tabela): layout real é `LEANDRO / SIM / PINHEIRO SAFATLE`. O laço de tokens exige
  nome seguido de token de nome, então ignora o Safatle. Trocar por: ao achar FIRST[tok], consumir
  tokens de nome E o primeiro valor (SIM/NÃO/...) mesmo no meio, depois continuar consumindo nomes restantes.
  Também `presentes`: excluir quem tem AUSENTE/FÉRIAS/AFASTADO e colocá-lo em `ausentes` (CD573 Thiago:
  a fonte diz AUSENTE; o erro é só a reunião listá-lo como presente).
  QA novo (chk em Q): "votos por extrato = linhas da tabela, incluindo nome quebrado": contar linhas de
  nome na tabela de forma independente (regex sobre `pdftotext -layout`: ocorrências de SIM|NÃO|AUSENTE|
  IMPEDIDO|ABSTENÇÃO|FÉRIAS|- na coluna VOTO entre "DIRETOR VOTO" e a decisão) e comparar com nº de votos
  gerados por extrato; listar divergências. Esperado 940/940 (hoje 935 "ok" por checar só faixa 3-5).
  PDF duplicado `-1` do CD1031: dedupe por sha/conteúdo já existe; após a correção o conteúdo igual cai no
  dedupe, conferir que a linha do Safatle (relator, SIM) aparece uma vez.
D2/D3 `anvisa_parse.py`: `imp`/`ausv` usam a janela `atual`, que só corta em "apreciado em CD". Em itens de
  "sessão reservada" a nota vem sem esse marcador (e o `[^.]{0,60}?` falha com "Diretor Substituto Marcelo
  Moreira declarou-se impedido na votação"). Ampliar: procurar as notas em TODO o `btxt` do item (exceto
  histórico "Decisões anteriores"), regex tolerante a `na votação`/`da votação`, "esteve ausente da/na
  votação", "ausentou-se", "impedid[oa]", "suspeit[oa]". Primeiro VARRER os 441 itens e listar toda nota
  de impedimento/ausência (script de varredura em scratchpad) e comparar com os rótulos atuais; corrigir
  todos, não só os 8 do relatório (ROP4 3.2.10.2; ROP5 3.1.4.1, 3.1.7.1, 3.1.1.1, 3.1.9.1; ROP6 3.4.1.2;
  ROP7 3.5.2.1; ROP1 4.2.2.1). Itens de vista (3.1.1.1, 3.1.9.1): impedimento tem precedência sobre
  "SEM VOTO AINDA". Em `anvisa_unir.py` garantir que item ligado a CD continua usando o extrato quando existir.
D5 ROP2 3.5.7.2: `proferiu` já é calculado mas não usado no ramo Vista; usar `proferiu` ∪ `votaram` →
  "VOTOU (antes da vista; posição só no voto escrito)" (igual ROP3 3.2.2.1). Verificar o texto da ata antes.
D8 ROP13 3.4.10.4: "concedeu vista à Diretora Daniela Marreco" ⇒ PEDIU VISTA. Causa: Daniela não consta
  em `pres` (cabeçalho) e o laço só cobre `pres`; `aus` recebe AUSENTE. Regra: quem pediu vista (vista_a)
  que está em `aus` vira PEDIU VISTA (nominal) e sai de AUSENTE nesse item; registrar nota no QA como exceção
  de presença (a Daniela votou no CD).
D4 convenção DIVERGIU (ROP5 4.1.2.1, ROP6 3.4.1.1, ROP9 3.4.3.1): regra do CD = quem votou contra o relator
  é DIVERGIU. Em maioria com relator vencido: se a ata nomeia quem seguiu o relator vencido ⇒ esses
  ACOMPANHOU, os demais da maioria vencedora ⇒ DIVERGIU (nominal, não inferido). ROP6 3.4.1.1: a ata nomeia
  "Safatle, Daniel Pereira e Daniela acompanharam o voto do Marcelo… vencido o Relator" ⇒ nominal. Se o texto
  não permitir (ROP5 4.1.2.1, ROP9 3.4.3.1: ler a ata), manter e documentar em `nao_feito` do anvisa_parse.py.
  Atenção: "RELATOR (voto vencido)" já existe; não mudar sem ler cada item.
Chave CD 386/2026 duplicada (2 processos): em anvisa_cd_parse.py a `deliberacao` fica "CD 386/2026" para os
  dois. Tornar única incluindo o processo (ex.: `CD 386/2026 (proc. final)` ou `CD 386/2026 — <processo>`)
  SÓ quando houver colisão de nº de CD com processos distintos; a chave do build (reunião+processo+deliberação)
  já é única, mas conferir que `anvisa_unir.py` (cdv indexado por (reuniao, processo)) e o dashboard não
  quebram; checar o 'Votos duplicados' do QA e o buracos de CD.

## Reprocessamento (só ANPD/ANVISA, sem rodar_tudo.sh)
```
export PATH...; cd "TESTE CLAUDE"
python3 -I scripts/anpd_baixar.py ...  (só se faltar arquivo)   # já baixado
python3 -I scripts/anpd_parse.py manifesto_anpd.json anpd.json
python3 -I scripts/anvisa_cd_parse.py manifesto_anvisa_cd.json anvisa_cd.json
python3 -I scripts/anvisa_parse.py manifesto_anvisa.json anvisa.json
python3 -I scripts/anvisa_unir.py anvisa.json anvisa_cd.json anvisa_final.json
```
Antes: copiar anpd.json/anvisa*.json para o scratchpad (baseline do "antes"). Contar votos por rótulo ×
proveniência antes/depois (baseline atual: ANPD 116 = ACOMP 75/RELATOR 29/SEM VOTO 12 já pós-correção D6/D7;
o "antes" ANPD vem de `git show HEAD:...anpd.json` = 110 votos; ANVISA 5795: ACOMPANHOU nominal 3492/
inferido 371, RELATOR 1085, SEM VOTO 368, AUSENTE 155, SEM VOTO AINDA 95, DIVERGIU 75, IMPEDIDO 51,
PEDIU VISTA 51, VOTOU 33, AUSENTE DA VOTAÇÃO 13, SEM VOTO REGISTRADO 6).

## Verificação
1. Rodar as auditorias/varreduras existentes de ANVISA/ANPD (QA embutido dos parsers; `scripts/qa_completude.py`
   só para LEITURA se for o caso, sem editar) e o diff dos JSONs: só devem mudar itens-alvo.
2. Conferência cega dos itens alterados: escrever o esperado (do texto da ata/PDF) num arquivo do scratchpad
   ANTES de abrir o JSON; depois comparar. Itens: CD323, CD573, CD1031, ROP4 3.2.10.2, ROP5 3.1.4.1/3.1.7.1/
   3.1.1.1/3.1.9.1, ROP6 3.4.1.2/3.4.1.1, ROP7 3.5.2.1, ROP1 4.2.2.1, ROP2 3.5.7.2, ROP13 3.4.10.4, ROP5 4.1.2.1,
   ROP9 3.4.3.1, ANPD CD04/CD07/CD23, CD386 (2 processos).
3. Invariantes: 1 voto por diretor/item, chave única, relator com voto RELATOR, xlsx não regenerado (build_xlsx
   fora do escopo).

## Proibido / limites
Não editar build_xlsx.py, temas.py, taxonomia.py, qa_completude.py, agencias.py, rodar_tudo.sh, README,
MAPEAMENTO, dashboard. Sem commit. `python3 -I`.

## Resposta final
Antes×depois por agência (votos por rótulo/proveniência) + o que ficou sem solução (candidatos: D4 em
ROP5 4.1.2.1/ROP9 3.4.3.1 se a ata não nomear; D5 posição do voto ambígua; 3 vistas não localizadas).
