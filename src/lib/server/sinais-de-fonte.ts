/**
 * Os sinais de que uma FONTE parou de entregar (Fase 18).
 *
 * ═══ Por que um módulo, e por que puro ═══
 * A primeira versão desta regra (Fase 17) morava dentro do laço do crawl e comparava a run atual
 * com a IMEDIATAMENTE anterior, exigindo queda de metade. Produção mostrou os dois cegamentos:
 * a ANM caiu 141 → 104 (−26%) sem alarme, e a ANTT ficou em 0 → 0, que nenhum limiar percentual
 * pega — comparar zero com zero nunca acusa nada, e é assim que uma fonte morta fica invisível a
 * partir da SEGUNDA rodada.
 *
 * Aqui a regra é pura e testável por comportamento: entra medição, sai sinal.
 */

/** Fonte que sempre trouxe pouco não vira alarme diário. */
export const MIN_ITENS_PARA_ALARME = 5;

/** Queda relativa que já merece um olhar. Era 50% (metade); 141 → 104 passava batido. */
export const QUEDA_RELEVANTE = 0.25;

/** Zeros consecutivos que caracterizam uma fonte MUDA (e não uma oscilação). */
export const ZEROS_PARA_MUDEZ = 3;

export type SinalDeFonte = "queda_de_volume" | "fonte_muda";

export interface MedicaoDeFonte {
  /** Maior `itens_encontrados` entre as últimas runs `ok` comparáveis. */
  baseline: number;
  /** Itens encontrados nesta run. */
  atuais: number;
  /** Runs consecutivas com zero itens, incluindo esta. */
  zerosSeguidos: number;
  /** Gatilho desta run e o das runs do baseline — a chave de COMPARABILIDADE. */
  gatilho?: string;
  gatilhoBaseline?: string;
  /** Informativos: NÃO decidem nada sozinhos (ver a nota sobre comparabilidade). */
  truncada?: boolean;
  truncadaBaseline?: boolean;
}

/**
 * COMPARABILIDADE, não completude — a distinção que fecha um ponto cego real.
 *
 * A regra intuitiva seria "não alarmar em run truncada". Ela criaria um cegamento pior que o
 * problema: em produção quase toda run da esteira é truncada por orçamento, então nenhuma
 * comparação seria "justa" e o alarme nunca dispararia. Duas runs truncadas do MESMO gatilho são
 * perfeitamente comparáveis entre si — ambas mediram a fonte com a mesma régua.
 *
 * O que NÃO se compara é run da esteira (fatia de ~28s) com run do botão manual (70s): aí
 * `itens_encontrados` mede o ORÇAMENTO tanto quanto a fonte, e a diferença não diz nada sobre o
 * portal. Por isso o discriminante é o `trigger_type`, não o `truncated`.
 */
function comparavel(m: MedicaoDeFonte): boolean {
  if (!m.gatilho || !m.gatilhoBaseline) return true;
  return m.gatilho === m.gatilhoBaseline;
}

export function avaliarSinaisDeFonte(m: MedicaoDeFonte): SinalDeFonte | null {
  if (m.baseline < MIN_ITENS_PARA_ALARME) return null;

  // MUDEZ primeiro: é o sinal mais grave, e o único que não depende de comparar volumes —
  // zero é zero com qualquer orçamento, então ele atravessa gatilhos diferentes.
  if (m.atuais === 0 && m.zerosSeguidos >= ZEROS_PARA_MUDEZ) return "fonte_muda";

  if (!comparavel(m)) return null;
  if (m.atuais <= m.baseline * (1 - QUEDA_RELEVANTE)) return "queda_de_volume";
  return null;
}

/** O texto que o usuário lê no Dashboard — o alarme só serve se disser o que fazer com ele. */
export function textoDoSinal(sinal: SinalDeFonte, nome: string, m: MedicaoDeFonte): string {
  if (sinal === "fonte_muda") {
    return `${nome}: a fonte já trouxe ${m.baseline} item(ns) e está em ZERO há ${m.zerosSeguidos} `
      + "verificações — layout novo, bloqueio ou página movida.";
  }
  return `${nome}: a listagem trouxe ${m.atuais} item(ns) contra ${m.baseline} nas verificações `
    + "recentes — a fonte pode ter encolhido ou o parser deixou de casar.";
}
