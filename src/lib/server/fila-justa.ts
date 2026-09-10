/**
 * A fila de enfileiramento é JUSTA por agência e por tipo (Fase 26).
 *
 * ═══ O que segurava a ANM ═══
 * A janela de candidatos era UMA: 60 itens `novo` por `data_reuniao desc`, sem agência. Os 92
 * itens frescos da ANTT (votos de agosto/setembro) e as 73 pautas da própria ANM ocupavam a
 * página antes das 3 atas da ANM — que ficaram "detectadas e nunca baixadas" por semanas. E
 * pauta tinha a mesma prioridade que ata: baixava, extraía e era arquivada como apoio, gastando
 * a fatia de quem decide.
 *
 * ═══ A regra ═══
 * Uma lista por agência (cada uma ordenada por data desc), reordenada por PRIORIDADE DE TIPO —
 * o que gera decisão antes do que é agenda — e intercalada em round-robin: a agência com menos
 * itens não espera a que tem mais. Pura, determinística, testada.
 */

export const PRIORIDADE_DE_TIPO: Record<string, number> = {
  ata: 0, deliberacao: 0, voto: 0,
  reuniao: 1, documento: 2, pauta: 3,
};

export function prioridade(tipo: string | null | undefined): number {
  return PRIORIDADE_DE_TIPO[String(tipo ?? "")] ?? 2;
}

/** Ordena UMA lista: tipo decisório primeiro; dentro do tipo, preserva a ordem recebida (data desc). */
export function ordenarPorPrioridade<T extends { tipo?: string | null }>(itens: T[]): T[] {
  return itens.map((it, i) => ({ it, i })).sort((a, b) => prioridade(a.it.tipo) - prioridade(b.it.tipo) || a.i - b.i).map((x) => x.it);
}

/** Intercala N listas em round-robin, cada uma já na sua ordem. */
export function intercalar<T>(listas: T[][]): T[] {
  const out: T[] = [];
  const max = Math.max(0, ...listas.map((l) => l.length));
  for (let i = 0; i < max; i++) for (const l of listas) if (i < l.length) out.push(l[i]);
  return out;
}

/** A janela justa: por agência, prioridade de tipo, round-robin. */
export function filaJusta<T extends { tipo?: string | null; agencia_id?: string | null }>(itens: T[]): T[] {
  const porAgencia = new Map<string, T[]>();
  for (const it of itens) {
    const k = String(it.agencia_id ?? "?");
    porAgencia.set(k, [...(porAgencia.get(k) ?? []), it]);
  }
  return intercalar([...porAgencia.values()].map(ordenarPorPrioridade));
}
