/**
 * Janela ROTATIVA de varredura (Fase 28) — folha pura.
 *
 * ═══ O problema que ela resolve, e por que `slice(0, K)` não resolveria ═══
 * O materializador de votos lia as primeiras ~1.000 deliberações por `id` (`.limit(4000)`, que o
 * PostgREST corta em ~1.000) e só DEPOIS filtrava "sem voto", em JS. Materializar uma deliberação
 * não liberava vaga: a linha continuava ocupando seu lugar nas 1.000. Deliberação com `id` além da
 * milésima NUNCA era materializada, em run nenhuma. Não é rótulo errado na tela — é voto que não
 * existe.
 *
 * Paginar a leitura (`lerTudo`) resolve metade: o universo passa a ser completo. A outra metade é
 * que o LAÇO não alcança o universo, porque ele quebra por orçamento e a rodada seguinte recomeça
 * do princípio. Com `slice(0, K)`, os itens que SEMPRE falham (roster não conferível, sem evidência
 * de voto) se acumulam na cabeça da lista e o laço passa a remoer os mesmos fracassos para sempre —
 * universo maior, laço que não o alcança, e a aparência de progresso sem progresso.
 *
 * A janela anda: a rodada de cada minuto pega um bloco diferente, e `ceil(total/tamanho)` minutos
 * cobrem tudo. Determinística DENTRO do minuto, então uma retentativa cai na mesma janela e não
 * embaralha o resultado.
 */

export interface JanelaRotativa {
  inicio: number;
  fim: number;
  /** Quantos blocos existem — quantos minutos até a varredura fechar uma volta. */
  blocos: number;
  /** Qual bloco esta janela é (0-based), para publicar junto do número e não virar mistério. */
  bloco: number;
}

/**
 * @param total     quantos itens pendentes existem no estoque
 * @param tamanho   quantos cabem numa rodada
 * @param minuto    `Math.floor(Date.now() / 60_000)` — quem chama passa, para a função ser pura
 */
export function janelaRotativa(total: number, tamanho: number, minuto: number): JanelaRotativa {
  if (total <= 0 || tamanho <= 0) return { inicio: 0, fim: 0, blocos: 0, bloco: 0 };
  const blocos = Math.ceil(total / tamanho);
  // `minuto` pode ser negativo em teste; o módulo do JS preserva o sinal, e um índice negativo
  // faria `slice` contar do fim — silenciosamente, sempre a mesma janela.
  const bloco = ((minuto % blocos) + blocos) % blocos;
  const inicio = bloco * tamanho;
  return { inicio, fim: Math.min(inicio + tamanho, total), blocos, bloco };
}
