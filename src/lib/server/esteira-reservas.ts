/**
 * As RESERVAS de tempo de cada passo da esteira — uma fonte única (Fase 7).
 *
 * ═══ O bug que originou este arquivo ═══
 *
 * Cada sub-rota da esteira decide sozinha quanto saldo precisa para começar uma unidade de
 * trabalho ("não iniciar o que não cabe" — a regra do `time-budget.ts`). O orquestrador
 * (`/pipeline/run`) decidia, SEPARADAMENTE e por literais, quanto saldo exigir antes de chamar
 * cada uma, e que fatia entregar. Os dois números não conversavam, e em três passos o do
 * orquestrador era MENOR:
 *
 *   · coleta        — fatia de  8s  contra reserva interna de 25s → inseria ZERO itens por rodada;
 *   · auto-confirm  — gate  de 14s  contra reserva interna de 15s → devolvia `restantes` sem
 *                     confirmar nada;
 *   · confirm-lote  — gate  de 11s  contra reserva interna de 15s → idem.
 *
 * O sintoma em produção: "174 PDF(s) extraído(s) · **0 materializado(s)**". A rodada gastava o
 * round-trip de autenticação de cada sub-rota, recebia zero de volta, marcava `restantes = true` e
 * o cliente girava até o teto de 40 rodadas. Nada disso aparecia como erro — cada passo terminava
 * com sucesso, tendo feito nada.
 *
 * ═══ A regra ═══
 *
 * Uma reserva por passo, importada pelos DOIS lados. O orquestrador nunca pode chamar um passo com
 * gate ou fatia menores do que a reserva daquele passo — e há um teste tabular que falha se isso
 * voltar a acontecer, matando a CLASSE do bug e não só as três instâncias de hoje.
 *
 * Os números são o custo estimado de UMA unidade de trabalho no pior caso realista:
 * um download com timeout de 20s, um lote de confirmação, uma página de listagem.
 */

/** Reserva mínima para o passo fazer UMA unidade de trabalho útil. */
export const RESERVA = {
  /** Coleta leve: baixar uma listagem e inserir os itens novos. */
  coleta: 25_000,
  /** Enfileirar 1 PDF: fetch com timeout de 20s + gravação. */
  enqueue: 22_000,
  /** Processar um lote da fila de extração. */
  extracao: 20_000,
  /**
   * Soltar documentos presos (os três reapers), SEM extrair — Fase 10.
   * Cabem ~3 reparos: cada um são 2-3 round-trips. Um décimo do preço da extração, que é o ponto:
   * enquanto os dois foram o mesmo passo, os presos herdaram o preço do trabalho caro.
   */
  reaper: 6_000,
  /** Auto-confirm: um lote do gate conservador. */
  autoConfirm: 15_000,
  /** Confirm-lote: um sublote da política zero-toque. */
  confirmLote: 15_000,
  /** Candidatos a diretor: recompute + aprovar-lote. */
  candidatos: 8_000,
  /** Backfill de votos em deliberações já gravadas. */
  backfillVotos: 6_000,
  /** Dedup retroativo. */
  dedup: 5_000,
  /**
   * Re-derivação de datas (Fase 15): a janela dos implausíveis (32×1996) e a das nulas (74).
   * Hygiene barata — cabe ~1 linha (4s de reserva interna) + a varredura. Depois de drenado o
   * passivo, custa duas consultas e devolve zero.
   */
  redatar: 6_000,
  /** Cada métrica derivada (empresas, qualidade, mandatos, divergência). */
  derivada: 6_000,
  /** Reprocesso de documentos `failed` (extração que quebrou) — Fase 9. */
  reprocessarFalhados: 6_000,
  /**
   * Requeue de UM documento mal classificado: 3 round-trips (Fase 10).
   * Antes este passo exigia o gate de `enqueue` — 26s para um trabalho de 3s, o que o fazia ser
   * pulado em toda rodada apertada sem que ele tivesse qualquer chance de rodar.
   */
  reclassificacao: 4_000,
  /** Recuperação de ignorados: um lote. Antes usava o gate de `derivada`, que é outro passo. */
  recuperacao: 6_000,
} as const;

export type PassoEsteira = keyof typeof RESERVA;

/**
 * Folga entre o saldo do orquestrador e a fatia entregue à sub-rota: o `flush` da resposta e o
 * round-trip de autenticação acontecem FORA do orçamento da sub-rota.
 */
export const FOLGA_ORQUESTRADOR_MS = 4_000;

/**
 * A MARGEM DE PARTIDA — o terceiro lado da mesma classe de bug (Fase 16).
 *
 *   · Fase 7  — fatia MENOR que a reserva: o passo gastava o round-trip e devolvia zero;
 *   · Fase 10 — fatia SEM TETO: a cabeça comia a rodada e a cauda nunca alcançava o portão;
 *   · Fase 16 — fatia IGUAL à reserva: o plano enche o orçamento até a borda e `saldo − proteção`
 *     entrega ao passo EXATAMENTE a reserva. A sub-rota checa `hasBudget(deadline, RESERVA)`
 *     antes da primeira unidade — com milissegundos já gastos no auth/import, a checagem falha
 *     na primeira iteração: 0 confirmados, `restantes = true`, round-trip pago à toa. Medido:
 *     confirmLote recebia 15000 cravado na maioria das rodadas, e `restantes` nunca virava
 *     falso — a run só parava no teto de 25min do cliente.
 *
 * A margem entra nos TRÊS lugares que precisam concordar: o custo de planejar um passo
 * (soma e proteção), o piso de `podeRodar`, e o topo de `fatiaDoPasso`. O TETO_FATIA continua
 * sendo o teto de TRABALHO — a margem é entregue por cima dele.
 */
export const MARGEM_PARTIDA_MS = 3_000;

/** O custo REAL de um passo no plano: a reserva de trabalho + a partida (auth/import/flush). */
function custoDoPasso(passo: PassoEsteira): number {
  return RESERVA[passo] + MARGEM_PARTIDA_MS;
}

/**
 * Saldo que o orquestrador precisa ter para valer a pena CHAMAR o passo.
 *
 * Chamar com menos que isto não é "fazer um pouco": é gastar o round-trip e receber zero — foi
 * exatamente assim que a aprovação ficou inerte por semanas.
 */
export function gateDoPasso(passo: PassoEsteira): number {
  return RESERVA[passo] + FOLGA_ORQUESTRADOR_MS;
}

/**
 * TETO de fatia por passo: o MÁXIMO que um passo pode consumir numa rodada.
 *
 * ═══ O bug que originou este bloco (Fase 10) ═══
 *
 * A Fase 7 matou metade da classe: nenhum passo pode receber fatia MENOR que sua reserva. Faltava
 * a outra metade — **nenhum passo pode receber fatia SEM TETO**. `call()` calculava
 * `slice = msLeft − 4s` e `maxSliceMs` era OPCIONAL: 7 das 11 chamadas o omitiam, então os passos
 * da cabeça recebiam o SALDO INTEIRO da rodada e a cauda (extração, derivadas) nunca alcançava o
 * próprio portão. Produção mediu: **26 rodadas · 0 PDF extraído · 0 métrica**, com os 62
 * documentos presos em `queued` intactos — porque os três reapers moram DENTRO da extração.
 *
 * O teto é de duas unidades de trabalho: o bastante para o passo progredir de verdade numa
 * rodada, pouco o bastante para ele não ser o único a progredir.
 */
export const TETO_FATIA: Record<PassoEsteira, number> = {
  coleta: RESERVA.coleta,               // um crawl já é a unidade inteira
  enqueue: RESERVA.enqueue + 3_000,     // 1 download + folga de gravação
  extracao: RESERVA.extracao + 10_000,  // cabe mais de um documento quando sobra
  reaper: RESERVA.reaper * 2,
  autoConfirm: RESERVA.autoConfirm * 2,
  confirmLote: RESERVA.confirmLote * 2,
  candidatos: RESERVA.candidatos * 2,
  backfillVotos: RESERVA.backfillVotos * 2,
  dedup: RESERVA.dedup * 2,
  redatar: RESERVA.redatar * 2,
  derivada: RESERVA.derivada + 2_000,
  reprocessarFalhados: RESERVA.reprocessarFalhados + 2_000,
  reclassificacao: RESERVA.reclassificacao * 2,
  recuperacao: RESERVA.recuperacao + 2_000,
};

/**
 * A ORDEM em que os passos disputam o orçamento da rodada — a mesma do orquestrador.
 * Drenar antes de ingerir; a cauda por último porque é ela que consolida.
 */
export const ORDEM_DOS_PASSOS: readonly PassoEsteira[] = [
  "autoConfirm", "confirmLote", "candidatos", "backfillVotos",
  "coleta", "reclassificacao", "enqueue",
  // O reaper vem ANTES da extração de propósito: o documento que ele solta volta para a fila
  // `pending` e ainda pode ser extraído na MESMA rodada.
  // `redatar` vem depois do dedup (datas certas antes de consolidar reuniões/derivadas) e fica
  // FORA da cauda de propósito: a cauda é o mínimo vital (32s) e um passo de hygiene não pode
  // encarecê-la — ele gira com a cabeça, como dedup e recuperação.
  "reaper", "extracao", "dedup", "redatar", "recuperacao", "reprocessarFalhados", "derivada",
] as const;

/**
 * A CAUDA: os passos pelos quais a rodada existe.
 *
 * `reaper` solta documento preso (custa ~2s e destrava o que já foi baixado), `extracao`
 * materializa documento novo, `derivada` propaga o resultado para Empresas, Qualidade, Mandatos e
 * divergência. Sem eles a rodada gasta tempo e não muda nada que alguém veja.
 */
export const PASSOS_CAUDA: readonly PassoEsteira[] = ["reaper", "extracao", "derivada"] as const;

/**
 * PLANEJAR a rodada: quais passos ela vai TENTAR, e quanto cada um pode gastar.
 *
 * ═══ Por que planejar, e não só limitar ═══
 *
 * A soma das reservas dos doze passos é ~128s contra um orçamento de 50s. **Nenhum teto de fatia
 * faz caber** — no máximo reduz o desperdício. E a primeira tentativa de conserto (reservar a
 * cauda e deixar a cabeça dividir o resto) INVERTE o bug: simulando com os números reais, o
 * `auto-confirm` toma os 24s que sobram e o `confirm-lote` — que é quem materializa — nunca roda.
 * Trocar a inanição da cauda pela inanição da cabeça não é conserto.
 *
 * O que resolve é aceitar que uma rodada não faz tudo, e garantir que ninguém fique de fora
 * SEMPRE:
 *  · a CAUDA entra em toda rodada (é o mínimo para a rodada significar alguma coisa);
 *  · a CABEÇA gira — o ponto de partida anda com o número da rodada, então em rodadas
 *    consecutivas cada passo é o primeiro a escolher, e nenhum é eternamente o último.
 *
 * A `protecao` devolvida é o que cada passo NÃO pode tocar: a soma das reservas dos passos
 * planejados DEPOIS dele. É isso que impede o primeiro escolhido de comer os seguintes.
 */
export function planejarRodada(
  rodada: number,
  orcamentoMs: number,
): { passos: ReadonlySet<PassoEsteira>; protecao: Readonly<Record<string, number>> } {
  const cabeca = ORDEM_DOS_PASSOS.filter((p) => !PASSOS_CAUDA.includes(p));
  // Giro determinístico: rodada N começa a oferecer a partir do N-ésimo passo da cabeça.
  const inicio = cabeca.length > 0 ? ((rodada % cabeca.length) + cabeca.length) % cabeca.length : 0;
  const girada = [...cabeca.slice(inicio), ...cabeca.slice(0, inicio)];

  // ⚠️ A cauda NÃO pode ser semeada em toda rodada. Simulado com os números reais: num orçamento
  // de 50s a cauda custa 26s, e `coleta` (reserva de 25s) então nunca caberia — a esteira drenaria
  // o que já tem e jamais ingeriria nada novo. Trocar a inanição da cauda pela da ingestão seria o
  // mesmo erro de novo. Por isso o privilégio ALTERNA: em rodadas pares a cauda escolhe primeiro;
  // em ímpares ela disputa na vez dela, e a cabeça cara (coleta, enfileiramento) alcança o próprio
  // portão. A cauda segue rodando na maioria das rodadas, e nenhum passo fica de fora sempre.
  const semeiaCauda = rodada % 2 === 0;
  const ofertados: PassoEsteira[] = semeiaCauda
    ? [...PASSOS_CAUDA, ...girada]
    : [...girada, ...PASSOS_CAUDA];

  const escolhidos = new Set<PassoEsteira>();
  let soma = 0;
  for (const p of ofertados) {
    // Fase 16 — o plano soma o CUSTO (reserva + margem de partida), não a reserva nua. Somar a
    // reserva nua era o que enchia o orçamento até a borda e entregava fatia == reserva.
    if (soma + custoDoPasso(p) > orcamentoMs) continue;
    escolhidos.add(p);
    soma += custoDoPasso(p);
  }

  // A proteção segue a ordem REAL de execução, não a ordem do giro — e protege o CUSTO de cada
  // passo seguinte, senão o último planejado nasceria de novo com fatia == reserva.
  const protecao: Record<string, number> = {};
  const naOrdem = ORDEM_DOS_PASSOS.filter((p) => escolhidos.has(p));
  for (let i = 0; i < naOrdem.length; i++) {
    protecao[naOrdem[i]] = naOrdem.slice(i + 1).reduce((acc, p) => acc + custoDoPasso(p), 0);
  }
  return { passos: escolhidos, protecao };
}

/**
 * A fatia que um passo recebe: limitada pelo teto dele E pelo que os passos seguintes do PLANO
 * ainda precisam. Devolve 0 quando não sobra — e aí o passo não deve rodar (ver `podeRodar`).
 */
export function fatiaDoPasso(passo: PassoEsteira, saldoMs: number, protecaoMs = 0): number {
  // O topo é TETO (trabalho) + MARGEM (partida): o passo recebe o custo de começar POR CIMA do
  // teto de trabalho, e a primeira checagem interna `hasBudget(deadline, RESERVA)` passa.
  return Math.max(0, Math.min(TETO_FATIA[passo] + MARGEM_PARTIDA_MS, saldoMs - protecaoMs));
}

/**
 * O passo tem fatia para UMA unidade de trabalho útil?
 *
 * Portão e fatia saem da MESMA função — foi a divergência entre os dois cálculos que produziu as
 * duas metades do bug (Fase 7: gate < reserva; Fase 10: fatia sem teto).
 */
export function podeRodar(passo: PassoEsteira, saldoMs: number, protecaoMs = 0): boolean {
  return fatiaDoPasso(passo, saldoMs, protecaoMs) >= custoDoPasso(passo);
}

/**
 * TETO de documentos novos que uma rodada pode puxar para dentro.
 *
 * Antes da Fase 7 este número não precisava existir: a rodada enfileirava 1 a 3 PDFs porque o
 * orçamento a estrangulava. Com o download em paralelo o estrangulamento sumiu — e o mesmo laço
 * poderia trazer centenas de documentos por rodada, agora também sob um cron diário, sem ninguém
 * olhando. Um erro sistemático (classificador novo, portal que troca de layout, agência que
 * republica o acervo) deixaria de ser uma rodada ruim e viraria centenas de documentos mal
 * processados antes de alguém abrir a tela.
 *
 * O teto é de VAZÃO, não de capacidade: o que não couber continua na fila durável e entra na
 * rodada seguinte. Ele existe para que o volume de escrita por rodada seja previsível e para que
 * uma rodada ruim seja barata de desfazer.
 *
 * Fase 9 — 60 → 120. Com o ZIP ligado, um único item da ARTESP pode render até 58 documentos, e um
 * teto de 60 fazia o item mal caber: qualquer coisa já enfileirada na rodada o empurrava para
 * fora, ele voltava, re-baixava o ZIP inteiro e adiava de novo. Não é afrouxamento — o freio real
 * continua sendo o orçamento (cabem ~88 gravações em 50s); o teto volta a ser o que ele diz ser,
 * um limite de segurança contra erro sistemático, em vez de o estrangulador da vazão.
 */
export const TETO_ENQUEUE_POR_RODADA = 120;
