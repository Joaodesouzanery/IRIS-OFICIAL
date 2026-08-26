/**
 * Concorrência limitada com orçamento de tempo (Fase 7).
 *
 * O enfileiramento baixava PDFs em SÉRIE, reservando 22s por item contra uma fatia de 25s: na
 * prática aproveitava ~12% da janela e enfileirava 1 a 3 PDFs por rodada, o que transformava uma
 * fila de centenas de itens em dezenas de rodadas de 50s. E o gargalo é REDE, não CPU — o processo
 * passava a janela inteira esperando resposta do portal, ocioso.
 *
 * Paralelismo aqui não aumenta o tempo de parede nem o risco de estourar o SIGKILL: ele usa a
 * espera que já existia. O que importa é (a) limitar a concorrência para não abusar do portal da
 * agência e (b) continuar honrando o orçamento — nenhuma unidade NOVA começa sem saldo, e a que
 * está em voo termina (cada fetch tem timeout próprio).
 */

import { hasBudget } from "@/lib/server/time-budget";

export interface OpcoesConcorrencia {
  /** Quantas unidades em voo ao mesmo tempo. */
  concorrencia: number;
  /** Instante-limite (epoch ms) do orçamento desta chamada. */
  deadlineAt?: number;
  /**
   * Saldo mínimo para INICIAR uma unidade nova. Pode ser uma função, para reserva ADAPTATIVA:
   * o pior caso fixo (o timeout de rede) é péssimo estimador quando as respostas reais levam
   * 1-3s — ele desperdiça a janela inteira sendo pessimista.
   */
  reservaMs: number | (() => number);
}

export interface ResultadoConcorrencia<T, R> {
  /** Uma entrada por item PROCESSADO, na ordem de conclusão. */
  concluidos: Array<{ item: T; valor: R }>;
  /** Itens que não chegaram a ser iniciados por falta de saldo. */
  naoIniciados: T[];
}

/**
 * Executa `tarefa` sobre `itens` com concorrência limitada, parando de INICIAR quando o orçamento
 * acaba. Nunca rejeita: um erro na tarefa é problema dela (que deve tratá-lo e devolver um valor).
 */
export async function mapComConcorrencia<T, R>(
  itens: readonly T[],
  { concorrencia, deadlineAt, reservaMs }: OpcoesConcorrencia,
  tarefa: (item: T) => Promise<R>,
): Promise<ResultadoConcorrencia<T, R>> {
  const limite = Math.max(1, Math.floor(concorrencia));
  const concluidos: Array<{ item: T; valor: R }> = [];
  const naoIniciados: T[] = [];
  const fila = [...itens];
  const emVoo = new Set<Promise<void>>();
  const reserva = () => (typeof reservaMs === "function" ? reservaMs() : reservaMs);

  while (fila.length > 0 || emVoo.size > 0) {
    while (fila.length > 0 && emVoo.size < limite) {
      if (!hasBudget(deadlineAt, reserva())) {
        // Sem saldo para começar: o resto fica para a próxima rodada (a fila é durável).
        naoIniciados.push(...fila.splice(0));
        break;
      }
      const item = fila.shift()!;
      const p: Promise<void> = tarefa(item)
        .then((valor) => { concluidos.push({ item, valor }); })
        .finally(() => { emVoo.delete(p); });
      emVoo.add(p);
    }
    if (emVoo.size > 0) await Promise.race(emVoo);
  }

  return { concluidos, naoIniciados };
}

/**
 * Reserva ADAPTATIVA: começa no pior caso e vai encolhendo conforme as respostas reais chegam.
 *
 * A reserva fixa de 22s (o timeout de rede) assumia que TODO download demoraria o máximo. Os
 * portais respondem em 1-3s no caso comum, então a janela era desperdiçada sendo pessimista. Aqui
 * a estimativa é `pior_observado × margem`, com piso — e nunca acima do pior caso original, para
 * não trocar desperdício por SIGKILL.
 */
export function criarReservaAdaptativa(piorCasoMs: number, pisoMs = 4_000, margem = 2.5) {
  let piorObservado = 0;
  return {
    /** Saldo mínimo para iniciar mais uma unidade. */
    reserva(): number {
      if (piorObservado === 0) return piorCasoMs; // sem amostra ainda: conservador
      return Math.min(piorCasoMs, Math.max(pisoMs, Math.round(piorObservado * margem)));
    },
    /** Registra a duração de uma unidade concluída. */
    registrar(duracaoMs: number): void {
      if (duracaoMs > piorObservado) piorObservado = duracaoMs;
    },
  };
}
