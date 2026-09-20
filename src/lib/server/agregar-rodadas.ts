/**
 * Como as etapas de VÁRIAS rodadas viram um número só (Fase 28).
 *
 * ═══ O defeito ═══
 * A tela somava CEGAMENTE todo valor numérico de toda etapa de todas as rodadas — até 300 delas:
 *
 *     for (const etapa of Object.values(ultimas))
 *       for (const [k, v] of Object.entries(etapa))
 *         if (typeof v === "number") totais[k] = (totais[k] ?? 0) + v;
 *
 * Somar EVENTO está certo: 10 votos em 3 rodadas são 10 votos. Somar RETRATO não: o materializador
 * recalcula `fora_da_janela` do zero a cada rodada, sobre a mesma população, e a tela somava três
 * medições da mesma coisa. Foi assim que o banner exibiu "74 sem evidência · 72 anteriores ao 1º
 * mandato": não eram deliberações distintas, eram ocorrências recontadas. `pendentes_direcao` tem
 * o mesmo formato — é um número que só cai, e estava sendo somado.
 *
 * ═══ As três naturezas ═══
 * · EVENTO  — trabalho feito NESTA rodada. Soma. É o default: chave nova e desconhecida continua
 *             se comportando como hoje, que é o que não quebra nada por omissão.
 * · ESTOQUE — retrato do banco, recalculado inteiro a cada rodada. Vale o ÚLTIMO valor visto.
 * · PARCIAL — contado só sobre o que o laço alcançou. Soma, mas só significa alguma coisa ao lado
 *             de `examinados`; a tela é obrigada a mostrar o denominador junto.
 */

export type NaturezaDaChave = "evento" | "estoque" | "parcial";

/**
 * Retratos do banco. Somar qualquer um destes é somar a mesma coisa N vezes.
 *
 * ⚠️ Ao acrescentar aqui, pergunte: "a rodada seguinte recalcula isto do zero, sobre a mesma
 * população?". Se sim, é estoque. Se conta o que ESTA rodada fez, é evento e NÃO entra.
 */
export const CHAVES_DE_ESTOQUE: ReadonlySet<string> = new Set([
  "fora_da_janela",
  "fora_da_janela_anterior_ao_1o_mandato",
  "fora_da_janela_sem_data_de_reuniao",
  "fora_de_escopo",
  "pendentes",
  "sem_voto",
  "finais_analisadas",
  "pendentes_direcao",
]);

/** Contados só sobre o lote que a rodada examinou — somáveis, mas nunca sem `examinados`. */
export const CHAVES_PARCIAIS: ReadonlySet<string> = new Set([
  "sem_evidencia",
  "roster_nao_conferivel",
]);

export function naturezaDaChave(chave: string): NaturezaDaChave {
  if (CHAVES_DE_ESTOQUE.has(chave)) return "estoque";
  if (CHAVES_PARCIAIS.has(chave)) return "parcial";
  return "evento";
}

/**
 * Agrega as etapas de UMA rodada sobre os totais acumulados. Mutação in-place, como o laço que
 * substitui — a tela chama isto dentro do laço de rodadas.
 */
export function agregarEtapas(
  totais: Record<string, number>,
  etapas: Record<string, Record<string, unknown>>,
): Record<string, number> {
  for (const etapa of Object.values(etapas ?? {})) {
    for (const [chave, valor] of Object.entries(etapa ?? {})) {
      if (typeof valor !== "number") continue;
      if (naturezaDaChave(chave) === "estoque") totais[chave] = valor;
      else totais[chave] = (totais[chave] ?? 0) + valor;
    }
  }
  return totais;
}
