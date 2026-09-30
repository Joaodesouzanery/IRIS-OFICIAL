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
  /**
   * Fase 31, Bloco 4 — o PASSIVO de nomes com mojibake reparável. `medir()` varre o acervo inteiro
   * a cada rodada e recalcula do zero, então é retrato, não contagem do que a rodada fez. Somá-lo
   * daria "287 · 247 · 207 …" = 741 candidatos num acervo que tem 287 — e o número cai a cada
   * rodada, que é exatamente o sinal de que o reparo está funcionando.
   */
  "nomes_candidatos",
  /**
   * Fase 35 — quantos votos-artefato a regra ALCANÇARIA agora. É retrato: a rodada varre a
   * população inteira e recalcula. Somá-lo diria "51 · 44 · 38 …" num acervo que tem 38 — e o número
   * CAI conforme o reparo funciona, então somar inverteria a leitura do progresso. Já
   * `artefatos_apagados` é EVENTO (o que a rodada de fato apagou) e soma normalmente.
   */
  "artefatos_candidatos",
  /**
   * Fase 35 — POSIÇÃO da janela rotativa do `redatar`, não contagem. `divergente_bloco` é "em que
   * bloco a volta está" e `divergente_blocos` é "quantos blocos tem a volta". Somá-los produziria
   * "bloco 47 de 300" numa volta de 25 blocos: um número sem significado e com cara de informação,
   * que é o pior tipo de número numa tela de operação.
   */
  "divergente_bloco",
  "divergente_blocos",
  /**
   * ⚠️ TODAS AS MEDIDAS DO PLACAR SÃO RETRATO, e eu esqueci as oito novas.
   *
   * A rota `/admin/placar` recalcula do ACERVO INTEIRO a cada chamada — ela não conta o que a rodada
   * fez, ela fotografa o estado. As chaves da Fase 34 (`reunioes_completas`, `reunioes_no_ano`…) já
   * estavam aqui; as que a Fase 35 acrescentou não, e o efeito foi medido: três rodadas com o MESMO
   * retrato davam `cobertura_pct: 240`, `reunioes_completas_estrito: 120` (de 80 reuniões) e
   * `pares_esperados: 18000`. O banner exibiria "cobertura de voto: 240%".
   *
   * ⚠️ Um percentual somado é o caso mais claro de por que a natureza importa: ele não tem nem
   * significado aritmético — somar 80% com 80% não dá 160% de coisa nenhuma.
   */
  "reunioes_completas_estrito",
  "itens_no_ano",
  "pares_esperados",
  "pares_respondidos",
  "cobertura_pct",
  "diretores_com_voto_parcial",
  "faltando_contra_a_listagem",
  "completaveis_parciais",
  /**
   * ⚠️ Fase 36 (Bloco F) — a quebra por agência da cobertura, UMA CHAVE POR SIGLA.
   *
   * Ela existe nesta forma porque `agregarEtapas` descarta em silêncio tudo que não é número: objeto
   * e string se perdem igual, e foi assim que a quebra por agência desapareceu antes. As siglas
   * colegiadas são três e enumeráveis (`COLEGIADO_SIGLAS`), então as chaves também são.
   *
   * São RETRATO pelo mesmo motivo de `cobertura_pct`: somar percentual entre rodadas não significa
   * nada (80% + 80% não dá 160% de coisa alguma) — foi o `cobertura_pct: 240` da Fase 35b.
   */
  "cobertura_pct_anm",
  "cobertura_pct_antt",
  "cobertura_pct_artesp",
  /**
   * ⚠️ Fase 36 (B.0) — a certificação contra o gabarito é RETRATO: o placar recalcula as cinco atas
   * a cada chamada. Somada, ela diria "15 atas conferidas" em três rodadas de um gabarito de 5 — e
   * `batem` passaria `conferidas`, o que é aritmeticamente impossível e leria como sucesso.
   */
  "certificacao_atas_conferidas",
  "certificacao_atas_batem",
  "certificacao_divergencias",
  /**
   * Fase 33 — a FILA de diagnóstico é recalculada inteira a cada rodada (todo o estoque de motivos
   * mais as divergências da janela), então é retrato. Somá-la diria "candidatos: 1.400" num estoque
   * de 300, e ela é justamente o DENOMINADOR de `motivos_gravados` — um denominador inflado inverte
   * a leitura da fração.
   */
  "diagnosticos_candidatos",
  /**
   * ⚠️ Fase 34 — O PLACAR é retrato por definição: cada rodada o recalcula inteiro sobre o acervo.
   *
   * Somá-lo seria pior que em qualquer outra chave, e de um jeito que inverte a leitura: o alvo de
   * `reunioes_com_voto_faltando` é ZERO, então, somado, ele CRESCE enquanto o defeito existe e
   * continua crescendo depois — e `reunioes_completas` somado passaria o total. Um placar que sobe
   * quando melhora e sobe quando piora não mede nada.
   */
  "reunioes_completas",
  "reunioes_no_ano",
  "reunioes_com_voto_faltando",
  "reunioes_esperando_cadastro",
  "numeros_ausentes",
  "numeros_com_data_fora_do_ano",
  "numeros_duplicados",
  "placar_leitura_incompleta",
]);

/**
 * Contados só sobre o lote que a rodada examinou — somáveis, mas NUNCA sem dizer que repetem.
 *
 * ⚠️ Fase 31 — as cinco últimas entraram porque estavam no default "evento" por OMISSÃO, e não
 * por decisão. Elas são medidas sobre a JANELA ROTATIVA
 * (`materializar-faltantes/route.ts:294`: `janelaRotativa(semVoto.length, LOTE, Date.now()/60_000)`),
 * que gira com o relógio — o MESMO item é reexaminado em rodadas diferentes da mesma run, e cada
 * reexame reincrementa. Suas irmãs do mesmo laço (`sem_evidencia`, `roster_nao_conferivel`) já
 * estavam aqui: irmãos do mesmo laço com naturezas diferentes era incoerência gritante.
 *
 * ⚠️ E `examinados` é o DENOMINADOR — ele repete pelo mesmo motivo, então rotular as outras sem
 * rotular ele seria consertar a fração pela metade.
 */
export const CHAVES_PARCIAIS: ReadonlySet<string> = new Set([
  "sem_evidencia",
  "roster_nao_conferivel",
  /**
   * Fase 36 — contado no MESMO laço e sobre a MESMA janela rotativa de `roster_nao_conferivel`, do
   * qual é uma parcela. Natureza diferente do irmão faria os dois crescerem em ritmos distintos na
   * mesma linha do banner.
   */
  "bloqueados_por_cadastro_incompleto",
  "votos_a_menos",
  "itens_que_mudariam",
  "regex_divergente",
  "regex_falso_positivo",
  "examinados",
  // Fase 31, Bloco 3 — medido sobre a mesma janela rotativa, logo repete entre rodadas.
  "roster_mudaria_com_presentes_do_pai",
  /**
   * Fase 33 — contado sobre a FATIA da fila que a rodada alcançou, e a frente da fila é estável
   * entre rodadas (prioridade fixa), então o mesmo id é redispensado toda vez. Soma, mas só ao lado
   * de `diagnosticos_candidatos`.
   */
  "diagnosticos_ja_iguais",
  /**
   * Fase 35 — a Janela C do `redatar` examina 120 linhas por chamada, escolhidas por janela
   * ROTATIVA sobre toda deliberação com data. Numa run longa a volta pode repassar pelo mesmo bloco,
   * então o mesmo id é remedido. Soma, mas com o rótulo de parcial — e sempre acompanhada de
   * `divergente_bloco`/`divergente_blocos`, que dizem quanto da volta já foi.
   */
  "divergentes_medidas",
  /**
   * Fase 35 — contado no MESMO laço de 120 linhas da janela rotativa que `divergentes_medidas`, e
   * portanto com a mesma repetição entre rodadas. Deixá-lo como evento enquanto o irmão é parcial
   * faria os dois números da mesma linha de banner crescerem em ritmos diferentes.
   */
  "divergente_sem_texto",
]);

/**
 * Agrega UM par chave/valor sobre um acumulador, respeitando a natureza.
 *
 * ⚠️ Fase 31 — extraída de `agregarEtapas` para `registrarRodada` usar a MESMA regra. Ela somava
 * cegamente no banco (`esteira-run.ts:250-256`), então existiam DUAS agregações incompatíveis do
 * mesmo dado: a tela respeitava estoque/parcial/evento e `esteira_runs.contadores` não — e esses
 * contadores SÃO lidos (`pipeline/run/route.ts` e `/pipeline/status`).
 */
export function acumularChave(acc: Record<string, number>, chave: string, valor: number): void {
  if (naturezaDaChave(chave) === "estoque") acc[chave] = valor;
  else acc[chave] = (acc[chave] ?? 0) + valor;
}

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
      acumularChave(totais, chave, valor);
    }
  }
  return totais;
}
