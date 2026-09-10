# Metodologia das métricas — IRIS Regulação

Este documento existe porque um número sem denominador declarado não é informação: é opinião com
aparência de dado. Aqui está, para cada métrica, **sobre o que ela é calculada** e **o que ela não
consegue medir**.

---

## 0. Votos por diretor — VOTOS EFETIVOS (vigência: 01/09/2026)

**Mudança de definição, datada.** Até 31/08/2026, "votos por diretor" era `COUNT(*)` de `votos` —
e linhas `Ausente`/`Abstencao` contavam +1. A partir de **01/09/2026**, o número principal do
widget e do ranking é **votos efetivos = Favoravel + Desfavoravel**; ausências e abstenções
aparecem à parte, e `pct_favor` usa o denominador efetivo. Relatórios que comparem meses
atravessando essa data devem declarar qual definição usam — os números da tela CAÍRAM na
virada, e isso é correção, não perda de dados (as linhas continuam no banco).

**O limite que nenhuma correção resolve.** A fonte da ARTESP **nunca nomina voto** (0 nominais;
toda linha é inferida do roster de mandato/presença). Diferença de contagem entre diretores da
ARTESP mede **janela de mandato** — quem tomou posse antes acumula mais deliberações — e não
comportamento de voto. Comparações de comportamento na ARTESP só fazem sentido sobre a MESMA
janela; o instrumento para isso é o bloco ① de `docs/auditoria-votos-cobertura.sql`
(votos/oportunidades + decomposição por proveniência).

---

## 0.0 Contestação lê o DISPOSITIVO e reconhece divergência (vigência: 08/09/2026)

**Mudança de definição, datada.** Até 07/09/2026, "esta decisão foi contestada?" — o sinal que
decide se o colegiado inteiro recebe voto inferido — era medido por `RE_CONTESTADO` sobre
fundamento + assunto + decisão, **sem ler `resumo_pleito`** (onde o dispositivo do item de ata
é gravado). A partir de **08/09/2026**, vale `RE_CONTESTADO_AMPLO` sobre decisão + dispositivo.

**O que a medição mostrou (etapa124, 342 itens reais):** o predicado antigo tinha erro nos dois
sentidos — marcava "Taxa Anual por Hectare **vencida**" como contestação (10 itens unânimes
ficavam SEM voto) e não via "com **divergência** parcial ao voto do relator" (2 itens recebiam
consenso fabricado). Na virada, em produção: **−4 votos em 2 itens**, 2 itens com divergência
que a regra antiga não via, 0 itens de "taxa vencida" (o acervo de produção não tinha o caso).
Os números da tela caíram em 4; é correção, não perda.

**09/09/2026 — o aviso deixa de bloquear o auto-confirm.** 85 deliberações da ARTESP estavam
em "Revisar" por `[AVISO·C06_DECIDIDO_SEM_VOTO]` ("normal em órgão que não nomina voto"): o
nível era *aviso* na origem, mas o gate re-derivava severidade por texto. Agora `[AVISO·]`/`[INFO·]`
passam e só `[BLOQUEANTE·]` e as prosas de qualidade seguram. Efeito: essas deliberações passam a
confirmar e a receber **voto inferido** (o único tipo que a ARTESP produz); o número de votos da
ARTESP **sobe** na virada. É liberação de represa, não mudança de definição.

**09/09/2026 — ausência ROTULADA é nominal.** Os 59 votos `is_nominal` da ARTESP não são votos
individuais: são as 56 linhas `Ausente`/`Impedido` lidas do rótulo "Ausência Justificada: Nome -
Cargo - Afastamento em Férias" (é lido do documento, logo nominal) mais correções humanas. A
fonte da ARTESP continua sem nominar voto de MÉRITO; ela nomina quem faltou. As 48 ausências de
André Isper Rodrigues Barnabé (sessões de 25 e 31/03/2026) são reais.

**O card "Total de deliberações" do módulo Mandatos** passa, na mesma data, a usar o predicado
canônico (`isFinalDecisionRecord`) em vez de uma aproximação SQL que contava filho de ata sem
`resultado`. O valor antigo segue na resposta como `total_aproximado`, só para referência.

---

## 0.0.2 O voto inferido acompanha o colegiado (vigência: 10/09/2026)

**Mudança de definição, datada.** Até 09/09/2026 todo voto **inferido** por mandato era gravado
como "Favorável", independentemente do resultado. Num item **Indeferido** o sistema afirmava que o
diretor "foi favorável ao pedido que o colegiado negou" — e o marcava divergente. Medido em
produção (bloco ④ do `qa-fase25.sql`): 700 votos na ARTESP, 72 na ANM, 10 na ANTT; "% Favorável"
era 100% para todo diretor sem voto nominal. A partir de **10/09/2026**: inferir significa
"acompanhou o colegiado" — Indeferido → Desfavorável ao pleito; Aprovado/Deferido → Favorável;
Retirado de Pauta ou sem resultado → **nenhum voto inferido**; o inferido é não-divergente por
construção. Votos lidos e correções humanas não mudam. Efeito esperado: % Favorável ARTESP 100 →
73,1; ANM 100 → 78,9; ANTT 100 → 98,9. É correção de significado, não perda de dado.

## 0.0.1 A tela de Completude lia 1.000 linhas (10/09/2026)

**Defeito de instrumento, datado.** Até 09/09/2026 a rota `completude-2026` (e `saude-dados`,
`governanca-agencias` e o "estrito" do Mandatos) lia `deliberacoes` e `votos` com `.limit(40000)`
e `.limit(80000)` **sem paginar** — e o PostgREST devolve no máximo ~1.000 linhas por chamada.
Com 3.859 votos e mais de 1.000 deliberações, a tela via 1.000 de cada, chamava de "voto órfão"
todo voto cuja deliberação ficou fora da fatia (537, num banco onde órfão é impossível: a FK é
`ON DELETE CASCADE`) e **subcontava todas as colunas da tabela "Completude 2026"**. A partir de
**10/09/2026** as leituras que agregam usam `.range()` até esgotar; os totais **sobem** para o
valor real, e "órfãos" só é publicado quando a leitura foi completa (truncou → "não medido").

## 0.1 O QUINTO estado, e a conta do "Total de deliberações" (04/09/2026)

**A pergunta que este bloco responde:** por que o banco tem ~1028 linhas em `deliberacoes` e o
Dashboard mostra 692?

A diferença **não é filtro de ano nem de agência** — a tela não manda nenhum dos dois. É
inteiramente o predicado de **deliberação FINAL** (`isFinalDecisionRecord`). O card do Dashboard
agora publica a conta inteira, e a rota devolve `total_linhas` e `descartados` por motivo:

| Motivo do descarte | O que é |
|---|---|
| `tipo_nao_final` | `pauta`, `voto_individual`, `documento_apoio` — não são decisão |
| `ata_envelope` | a ATA em si; quem decide são os ITENS dela (`documento_pai_id` preenchido) |
| `sem_resultado_extraido` | **o quinto estado** — o item existe, tem pai, e nenhum resultado foi extraído |
| `outro` | tipo fora da lista conhecida |

**O quinto estado é o que faltava ser declarado.** A seção 1 abaixo lista quatro estados
(`decidido`, `admissibilidade`, `retirado`, `sem_resultado`), mas o `sem_resultado` de lá vive
DENTRO do total (é linha final sem desfecho). O caso descrito aqui é diferente: o item **nem
entra** no total, porque o predicado exige `documento_pai_id && resultado`. Ele sumia em
silêncio; agora tem nome e contagem.

**Reuniões únicas** passaram a ser contadas por `agência + data + número` (a mesma chave natural
da tabela `reunioes`), e não mais por `DISTINCT data_reuniao` global — que colapsava duas
agências reunidas no mesmo dia em uma só, e perdia a extraordinária quando ela caía na data da
ordinária.

**"Auto-classificadas"** deixou de dizer "por IA": não há LLM na esteira de extração. O número
mede o que foi classificado **sem revisão manual**, por regex e parsers determinísticos.

---

## 1. Os quatro estados de uma deliberação

O campo `resultado` carrega, historicamente, duas coisas diferentes no mesmo lugar: o **desfecho**
("Deferido", "Indeferido") e o **andamento** ("Retirado de Pauta"). Separar os dois é o que permite
dizer qual pergunta cada número responde.

| Estado | O que significa | Entra na taxa de deferimento? |
|---|---|---|
| `decidido` | Houve juízo de **mérito** | **Sim** — é o denominador |
| `admissibilidade` | O colegiado **não conheceu** (intempestividade, ilegitimidade) | **Não**, nos dois lados |
| `retirado` | Saiu de pauta, sobrestado, pedido de vista | Não |
| `sem_resultado` | Nada foi extraído | Não |

**Por que admissibilidade sai dos dois lados.** "Não conhecer do recurso por intempestividade" não
julga o pedido — julga se ele podia ser apreciado. Somado ao balde negativo, a taxa de deferimento
passa a medir *prazo processual* junto com *jurisprudência*. Só na 83ª Reunião Ordinária Pública da
ANM são 10 itens nessa situação.

**Modo duplo.** As respostas de API publicam `total_deliberacoes` (o **pautado**, inalterado) e
`total_decidido` (o denominador de mérito) lado a lado. Trocar o significado do campo antigo em
silêncio mudaria todo painel sem ninguém perceber — pior que o defeito original.

### O caso do "Parcialmente Deferido"

Ele está no vocabulário de `resultado`, mas **não** na lista de resultados positivos. Antes, isso o
fazia evaporar dos dois numeradores enquanto permanecia no denominador. Hoje ele é `decidido` (foi
julgado, entra no divisor) e **não** é contado como deferimento cheio. Os dois fatos convivem — e é
exatamente por isso que denominador e numerador precisam ser conceitos separados.

---

## 2. Consenso: só onde houve voto

O código calculava consenso com `!votos.some(v => v.is_divergente)`. Em JavaScript, `some()` sobre um
array **vazio** devolve `false` — então `!false` é `true`, e **toda deliberação sem voto extraído era
contada como consensual**. "Consenso de 100%" podia significar, literalmente, "ninguém votou".

Hoje o denominador do consenso é `total_com_voto`: deliberações com **pelo menos um voto
registrado**. Um item sem voto não é consensual nem divergente — é **desconhecido**, e sai da conta.

Onde a base é vazia, a taxa não é `100%` nem `0%`: é `—`.

---

## 3. Proveniência do voto

`is_nominal` continua existindo, mas um booleano não distingue quatro origens muito diferentes:

| Proveniência | O que é |
|---|---|
| `revisao_humana` | Uma pessoa leu o documento e corrigiu na tela. **O dado de maior qualidade do sistema.** |
| `nominal` | Lido do documento pela extração |
| `inferido_unanimidade` | Deduzido de "aprovado por unanimidade" + roster |
| `inferido_decisao` | Deduzido da direção da decisão |

**Por que isso importa mais do que parece.** Voto inferido é, **por construção**, não-divergente:
ele é fabricado a partir da decisão que prevaleceu. Medir "convergência" sobre ele é tautologia, não
medida. Uma taxa de consenso de ~100% sobre base majoritariamente inferida não diz nada sobre o
colegiado — diz que a extração não leu votos naquele documento.

Por isso **métricas de comportamento usam apenas `nominal` e `revisao_humana`**. Matriz de votos e
consenso agregado seguem usando tudo, com a cobertura nominal declarada ao lado.

---

## 4. Capacidade nominal: o limite é da FONTE, não do sistema

Nem todo instrumento publica o voto de cada diretor. Isso é propriedade do **documento**, não da
agência — a distinção importa:

| Órgão | Instrumento | Nomina voto? | Cobertura |
|---|---|---|---|
| ANM | ata (ROP/REP) | Só em dissenso, vista, impedimento ou empate | ~7% dos itens |
| ANTT | ata (RD/RDE) | **Nunca** — "a Diretoria Colegiada, por unanimidade, anuiu" | 0% |
| ANTT | **documento de Voto** (DG/DFQ/DLA/DAB) | **Sim, por construção** | 1 por documento |
| ARTESP | deliberação / ata | **Nunca** — "aprovação dos presentes por unanimidade" | 0% |

Quando um diretor da ANTT ou da ARTESP aparece sem base nominal, a tela diz *"a ata deste órgão não
nomina voto"* — e **não** "base insuficiente". A primeira frase descreve um limite da fonte; a
segunda sugere falha do sistema. Um booleano por agência rotularia os documentos de Voto da ANTT
como "não publica voto individual" **enquanto a esteira os processa**.

---

## 5. Denominador do DIRETOR ≠ denominador do colegiado

Um voto `Ausente` cobre situações distintas: ausência física, impedimento, suspeição, vista. Antes,
todas caíam no balde de **abstenção** e contavam no denominador do diretor.

O efeito era perverso: **impedimento é conduta de integridade** — o diretor se declara impedido e se
retira da votação. E isso derrubava o percentual dele. Quanto mais um diretor se declarava impedido,
pior ele parecia.

Hoje:
- o item continua contando para o **colegiado** (a deliberação existiu e foi decidida);
- o não-voto sai do denominador **do diretor** (`motivo_nao_voto`);
- **participação** (esteve na sessão) e **comportamento** (como votou) são números separados.

### Por que exibimos com `n` em vez de suprimir

A alternativa seria esconder diretores com base pequena. Medimos: na ANM são 35 votos nominais entre
6 diretores, mediana 6 — e o **único** diretor abaixo de um corte de `n < 5` é justamente o mais
impedido do corpus. Como o impedimento tira voto do denominador dele, **um corte por base mínima
suprime primeiro quem mais se declara impedido**. Isso é viés sistemático punindo integridade, não
prudência estatística.

Decisão: o perfil **sempre aparece**, com a base ao lado ("base: 4 votos lidos"). Só o **ranking**
("quem mais diverge") exige mínimo — porque ranking com base minúscula é que engana.

### Risk Score

Não é renderizado sem base nominal. Metade dele vem de `pct_divergente`, que sobre voto inferido é
sempre zero. O resultado era um veredito público — "Risco Baixo — 0/100" — sobre um agente público,
calculado a partir de dados que o sistema nunca leu. **Ausência de dado não é atestado de bom
comportamento.**

---

## 6. O que estes números ainda NÃO medem

- **Peso da matéria.** Um voto sobre reequilíbrio bilionário conta igual a um sobre requerimento
  administrativo.
- **Conteúdo do voto.** Medimos direção (favorável/contrário), não fundamentação nem qualidade.
- **Voto em autos.** Voto proferido em sessão anterior é marcado (`voto_em_autos`) e sai da série
  temporal do diretor, mas continua compondo a maioria da deliberação. É o tratamento correto e
  também um limite: a data em que ele foi efetivamente proferido nem sempre está no documento.
- **Cobertura da coleta.** Toda taxa é sobre o que foi coletado e extraído — não sobre o universo de
  atos da agência.

---

## 7. Onde cada número é calculado

| Conceito | Fonte única |
|---|---|
| Estado da deliberação | `decisionStatus()` — `src/lib/server/regulatory-documents.ts` |
| Denominador de mérito | `isDecidedOnMerits()` — idem |
| Consenso com base | `isConsensual()` — idem (devolve `null` sem base) |
| Resultado positivo | `isResultadoPositivo()` — `src/lib/utils.ts` |
| Capacidade nominal | `capacidadeNominal()` — `src/lib/server/colegiado-sources.ts` |
| Proveniência do voto | `rowFor()` — `src/lib/server/vote-inference.ts` |

Toda mudança de semântica deve começar por uma destas funções — nunca por uma cópia local. As
duplicações que ainda existem estão registradas em [PENDENCIAS.md](./PENDENCIAS.md).
