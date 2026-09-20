/**
 * Orçamento do parse de PDF (Fase 28) — folha pura, sem import de DB nem de rota.
 *
 * ═══ Por que existe ═══
 * A regra de orçamento do projeto (CLAUDE.md, Fase 7) diz que nenhum passo pode receber uma FATIA
 * menor que a RESERVA interna que ele exige — senão ele roda, gasta o round-trip e devolve zero.
 * Até a Fase 27 o parse violava isso em silêncio: `RESERVA_POR_JOB_MS` era 9s e o teto do parser
 * era 25s. Um job era admitido com 9s de saldo para uma operação que podia custar 25s.
 *
 * Isso não doía enquanto o teto era decorativo — `pdf-parse` é SÍNCRONO e o `setTimeout` que o
 * cortava nunca disparava (o event loop ficava travado). A partir da Fase 28 o teto é REAL
 * (worker + `terminate()`), então a aritmética passa a valer e precisa fechar.
 *
 * ═══ Os números, e de onde saem ═══
 * `PARSE_MINIMO_MS = 7_000` é 35× o PIOR parse medido sobre as 16 fixtures oficiais (199 ms, a ata
 * da 32ª REP da ANM, 19 páginas; mediana ~15 ms). Abaixo desse piso, um corte deixa de significar
 * "o parser travou" e passa a significar "a rodada acabou" — e isso é caro, porque QUEIMA um dos
 * 3 ciclos de reprocesso de um PDF saudável.
 *
 * `CUSTO_FIXO_DO_JOB_MS = 6_000` é o que um job gasta FORA do parse: download do Storage, limpeza,
 * `probeLigatureDefects`, as três escritas (job→processing, documento, job→done) e o flush.
 *
 * Daí as duas desigualdades que fixam a reserva, e elas se cruzam num intervalo de 250 ms:
 *   piso : RESERVA ≥ CUSTO_FIXO + PARSE_MINIMO            = 13_000
 *   teto : 4 × RESERVA ≤ TETO_FATIA.extracao + MARGEM     = 53_000 → RESERVA ≤ 13_250
 * `RESERVA_POR_JOB_MS = 13_000` não é um número escolhido: é o único redondo que satisfaz as duas.
 * A invariante `tetoDoParse(agora + RESERVA_POR_JOB_MS) === PARSE_MINIMO_MS` é testada em etapa147.
 */

/** Teto absoluto de um parse, qualquer que seja o saldo. */
export const TETO_PARSE_MS = 25_000;

/** O que um job custa FORA do parse (download, limpeza, 3 escritas, flush). */
export const CUSTO_FIXO_DO_JOB_MS = 6_000;

/**
 * ═══ Fase 29 — o custo fixo, decomposto ═══
 * `CUSTO_FIXO_DO_JOB_MS` era um número só, e por isso o download não tinha teto próprio: ele era
 * baixado FORA da corrida contra o relógio (`pipeline.ts`), e o `restanteMs` do race era medido
 * ANTES dele. A aritmética do defeito:
 *
 *   t_A          : restanteMs = deadlineAt − t_A − 1.500
 *   t_A → t_A+D  : download, SEM teto
 *   dispara em   : deadlineAt + D − 1.500     ← a ultrapassagem É a duração do download
 *
 * Com D ilimitado, a ultrapassagem é ilimitada — e com 4 jobs em voo cada onda parte atrasada da
 * anterior, então o atraso ACUMULA ao longo da fatia em vez de se cancelar. Era isso que fazia a
 * rodada passar dos 90 s do cliente mesmo com o parser já capado.
 *
 * A soma continua sendo a mesma (identidade fixada em teste), então `RESERVA_POR_JOB_MS` não muda
 * e toda a tabela da etapa140 segue válida.
 */
export const TETO_DOWNLOAD_MIN_MS = 4_000;
/** Limpeza, `probeLigatureDefects`, as três escritas e o flush. */
export const CUSTO_DE_GRAVACAO_MS = 2_000;
/** Teto absoluto do download, quando a fatia é folgada. */
export const TETO_DOWNLOAD_MS = 8_000;

/** Piso do parse: abaixo disso o corte não mede o parser, mede a rodada. 35× o pior parse real. */
export const PARSE_MINIMO_MS = 7_000;

/** Reserva de partida de UM job. Ver a aritmética no cabeçalho. */
export const RESERVA_POR_JOB_MS = CUSTO_FIXO_DO_JOB_MS + PARSE_MINIMO_MS;

/**
 * O teto REAL deste parse: o menor entre o teto do parser e o que a fatia ainda permite.
 *
 * Sem `deadlineAt` (upload avulso, teste) vale o teto absoluto. Com ele, desconta o custo fixo que
 * o job ainda vai gastar DEPOIS do parse — senão o parse consome a fatia inteira e a gravação
 * morre sem registrar nada, que é o pior desfecho possível (nem sucesso nem erro no banco).
 *
 * Pode devolver ≤ 0: quem chama trata como "não cabe nesta rodada" e devolve o job para `pending`.
 */
export function tetoDoParse(deadlineAt: number | undefined, agora: number = Date.now()): number {
  if (deadlineAt === undefined) return TETO_PARSE_MS;
  return Math.min(TETO_PARSE_MS, deadlineAt - agora - CUSTO_FIXO_DO_JOB_MS);
}

/**
 * O teto deste DOWNLOAD: o menor entre o teto absoluto e o que sobra depois de reservar o parse
 * mínimo e a gravação. No piso de admissão de um job devolve exatamente `TETO_DOWNLOAD_MIN_MS` —
 * a mesma invariante que `tetoDoParse` tem, do outro lado da conta.
 *
 * Pode devolver ≤ 0: quem chama recusa o job e o devolve para `pending`, em vez de começar um
 * download que não tem como terminar dentro da fatia.
 */
export function tetoDoDownload(deadlineAt: number | undefined, agora: number = Date.now()): number {
  if (deadlineAt === undefined) return TETO_DOWNLOAD_MS;
  return Math.min(TETO_DOWNLOAD_MS, deadlineAt - agora - PARSE_MINIMO_MS - CUSTO_DE_GRAVACAO_MS);
}
