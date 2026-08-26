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
  /** Cada métrica derivada (empresas, qualidade, mandatos, divergência). */
  derivada: 6_000,
} as const;

export type PassoEsteira = keyof typeof RESERVA;

/**
 * Folga entre o saldo do orquestrador e a fatia entregue à sub-rota: o `flush` da resposta e o
 * round-trip de autenticação acontecem FORA do orçamento da sub-rota.
 */
export const FOLGA_ORQUESTRADOR_MS = 4_000;

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
 */
export const TETO_ENQUEUE_POR_RODADA = 60;
