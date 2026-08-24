# Metodologia das métricas — IRIS Regulação

Este documento existe porque um número sem denominador declarado não é informação: é opinião com
aparência de dado. Aqui está, para cada métrica, **sobre o que ela é calculada** e **o que ela não
consegue medir**.

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
