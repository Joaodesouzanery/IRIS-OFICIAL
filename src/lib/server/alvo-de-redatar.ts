/**
 * O `?alvo=` do `redatar` — escolher QUEM é examinado primeiro, sem afrouxar nada.
 *
 * ═══ O problema que isto resolve ═══
 * A Janela C examina `LOTE_DIVERGENTE` (120) linhas por chamada, escolhidas por janela ROTATIVA sobre
 * toda deliberação com data — milhares de linhas. E o passo é sorteado poucas vezes por run: o QA de
 * produção mediu `tentou_redatar: 4` em 18 rodadas, ou seja ~480 linhas examinadas de milhares.
 *
 * A correção funciona; ela é LENTA. E eu li a lentidão como "pronto": o commit `924e523` afirmou que
 * dez reuniões voltariam para 2026 quando só parte delas tinha sido examinada. O usuário conferiu uma
 * por uma e mostrou que três da ANM seguem erradas — e que a 80ª já estava certa.
 *
 * Com alvo, a afirmação passa a ser verificável numa rodada. É o mesmo desenho que o recálculo de
 * direção ganhou na Fase 27 (`?direcao=1` → seleção pelo alvo).
 *
 * ⚠️ O ALVO NÃO É UM ATALHO DE CRITÉRIO. A linha alvejada passa exatamente pelas mesmas checagens
 * (âncora plausível, recorte de agência certificada, texto presente). Este módulo só decide a ORDEM.
 * Confundir as duas coisas transformaria uma ferramenta de diagnóstico numa porta para escrever data
 * sem evidência, que é a escrita mais cara que existe nesta esteira.
 */

/** Só dígitos, e no máximo 5 — número de reunião não passa disso, e o resto é entrada inválida. */
const MAX_DIGITOS_DO_NUMERO = 5;

/**
 * Lê `?alvo=81,82,1.035` e devolve os números normalizados (só dígitos).
 *
 * ⚠️ Normaliza os DOIS lados, porque `numero_reuniao` convive em dois formatos no banco ("1.024" e
 * "1024") — comparar texto cru perderia metade das linhas em silêncio.
 */
export function lerAlvos(cru: string | null | undefined): Set<string> {
  return new Set(
    String(cru ?? "")
      .split(",")
      .map((n) => n.replace(/\D/g, ""))
      .filter((n) => n.length > 0 && n.length <= MAX_DIGITOS_DO_NUMERO),
  );
}

/** Normaliza o número de uma linha para comparar com o alvo. */
export function numeroNormalizado(valor: unknown): string {
  return String(valor ?? "").replace(/\D/g, "");
}

export interface JanelaDoLote {
  inicio: number;
  fim: number;
}

export interface LoteEscolhido<T> {
  lote: T[];
  /** Quantas linhas casaram o alvo. Zero com alvo pedido significa "o alvo não existe no universo". */
  encontrados: number;
}

/**
 * Monta a fatia da rodada: as linhas do alvo primeiro, o bloco rotativo completando até o teto.
 *
 * ⚠️ O alvo NÃO desliga o trabalho de fundo, e isso é deliberado. Se o alvo fosse a fatia inteira,
 * uma chamada com alvo pararia o avanço da volta; e um alvo que não casa nada faria a rodada examinar
 * ZERO linhas — o formato de zero que este projeto passou fases aprendendo a não aceitar. Com o bloco
 * completando, alvo inexistente degrada para o comportamento normal.
 */
export function loteComAlvo<T>(
  plausiveis: T[],
  alvos: Set<string>,
  janela: JanelaDoLote,
  teto: number,
  numeroDe: (item: T) => unknown,
  idDe: (item: T) => unknown,
): LoteEscolhido<T> {
  if (alvos.size === 0) {
    return { lote: plausiveis.slice(janela.inicio, janela.fim), encontrados: 0 };
  }
  const doAlvo = plausiveis.filter((d) => alvos.has(numeroNormalizado(numeroDe(d))));
  const idsDoAlvo = new Set(doAlvo.map((d) => String(idDe(d))));
  const doBloco = plausiveis
    .slice(janela.inicio, janela.fim)
    .filter((d) => !idsDoAlvo.has(String(idDe(d))));
  return { lote: [...doAlvo, ...doBloco].slice(0, teto), encontrados: doAlvo.length };
}
