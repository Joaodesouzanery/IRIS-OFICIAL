/**
 * A FILA DE GRAVAÇÃO DO DIAGNÓSTICO — e a inanição por prefixo que ela conserta.
 *
 * ═══ O defeito, medido em produção (Fase 33) ═══
 * O bloco ⑧ do `docs/qa-fase31.sql` procura `raw_extraction ? 'roster_divergente'` e vinha VAZIO.
 * A consulta de controle (`raw_extraction ? 'motivo_sem_voto'`) devolveu **7**, não zero: a gravação
 * acontecia, escrevia meia dúzia e parava. Duas causas somadas, nenhuma delas "escrita quebrada":
 *
 *  1. **A reserva era a errada.** O laço de gravação exigia `RESERVA_POR_ITEM_MS` (8s), que é o
 *     custo de PROCESSAR um item — ler o PDF do Storage, casar nomes, montar votos. Um `UPDATE` de
 *     uma linha custa ~200ms. Com a fatia de 9 a 15s que o passo `backfillVotos` recebe, exigir 8s
 *     de folga significava que, se o laço principal tivesse consumido a fatia, a gravação escrevia
 *     ZERO por construção.
 *  2. **A ORDEM era a errada**, e esta é a parte que a reserva sozinha não resolveria. A fila saía
 *     na ordem de inserção do `Map` de motivos, que é a ordem em que eles são descobertos — e ela
 *     põe na frente exatamente o que menos importa: `fora_de_escopo`, `sem_data` e
 *     `fora_da_janela_de_mandatos` são atribuídos ANTES do lote da rodada (centenas de linhas), e
 *     `materializavel_nao_processado` é atribuído no fim sobre todo o resto do estoque. A
 *     divergência de roster, que **só a esteira sabe calcular**, ficava no fim. A fila nunca
 *     chegava ao fim.
 *
 * ⚠️ E por que a decisão mora AQUI, e não no laço da rota: a propriedade que importa é
 * *"com orçamento para N escritas e uma divergência no meio de 300 postergáveis, a divergência é
 * escrita"*. Dentro da rota isso só se afirmaria por regex sobre o fonte — e foram expectativas
 * desse tipo, em `etapa172` e `etapa180`, que congelaram o defeito por uma fase inteira. Num módulo
 * próprio a propriedade se MEDE.
 */

/**
 * Reserva por ESCRITA de diagnóstico. Tem de ser estritamente menor que a reserva por item do
 * processamento — é o invariante que `etapa172` trava numericamente.
 */
export const RESERVA_POR_ESCRITA_MS = 400;

/**
 * Motivos que NÃO precisam da esteira para existir, e por isso vão ao FIM da fila:
 *  · `fora_de_escopo`, `sem_data`, `fora_da_janela_de_mandatos` — o SQL deriva os três de COLUNA
 *    (`agencia_id`, `data_reuniao`) mais a tabela de mandatos. Carimbar é conveniência.
 *  · `materializavel_nao_processado` — é EFÊMERO: diz apenas que a janela rotativa desta rodada não
 *    alcançou a linha, e na rodada seguinte muda. É também a maior população.
 * O que sobra (`roster_desconhecido` e os motivos calculados por `motivoSemVoto`, que dependem de
 * ler o documento) é o que a gravação tem de entregar primeiro.
 */
export const MOTIVOS_POSTERGAVEIS: ReadonlySet<string> = new Set([
  "fora_de_escopo",
  "sem_data",
  "fora_da_janela_de_mandatos",
  "materializavel_nao_processado",
]);

export type PatchDeDiagnostico = Record<string, unknown>;

/** 0 = só a esteira calcula · 1 = exige ler o documento · 2 = derivável de coluna ou efêmero. */
export function prioridadeDoPatch(patch: PatchDeDiagnostico): 0 | 1 | 2 {
  if ("roster_divergente" in patch) return 0;
  const motivo = patch.motivo_sem_voto;
  return typeof motivo === "string" && MOTIVOS_POSTERGAVEIS.has(motivo) ? 2 : 1;
}

/**
 * Igualdade de valor jsonb, com as chaves ordenadas dos DOIS lados.
 *
 * ⚠️ `JSON.stringify` direto não serve: o Postgres normaliza a ordem das chaves do `jsonb`, então o
 * `roster_divergente` que volta do banco pode ter as três chaves em ordem diferente da do objeto
 * recém-montado. Sem canonizar, o skip nunca acertaria e toda rodada reescreveria os mesmos bytes.
 */
export function mesmoValorJson(a: unknown, b: unknown): boolean {
  const canon = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(canon);
    if (v && typeof v === "object") {
      const o = v as Record<string, unknown>;
      return Object.fromEntries(Object.keys(o).sort().map((k) => [k, canon(o[k])]));
    }
    return v;
  };
  return JSON.stringify(canon(a)) === JSON.stringify(canon(b));
}

/** O patch já está gravado com o MESMO valor? Então a escrita é puro custo, sem progresso. */
export function patchJaAplicado(base: PatchDeDiagnostico | undefined, patch: PatchDeDiagnostico): boolean {
  if (!base) return false; // sem o jsonb atual em mão não se decide nada — quem chama recusa a escrita
  return Object.entries(patch).every(([k, v]) => mesmoValorJson(base[k], v));
}

/**
 * Ordena a fila por prioridade e corta no que o orçamento paga.
 *
 * ⚠️ A ordenação é ESTÁVEL (`Array.prototype.sort` o é desde ES2019), então dentro de uma mesma
 * prioridade a ordem de descoberta é preservada — trocar isso por uma ordem instável faria a frente
 * da fila variar entre rodadas e o skip perderia sentido.
 *
 * `restantes` é o que sobrou de fora: sem ele a esteira concluiria que fechou a volta.
 */
export function planejarGravacaoDeDiagnostico(
  patches: Iterable<readonly [string, PatchDeDiagnostico]>,
  msDisponiveis: number,
  reservaPorEscritaMs: number = RESERVA_POR_ESCRITA_MS,
): { daRodada: Array<readonly [string, PatchDeDiagnostico]>; restantes: boolean } {
  const fila = [...patches].sort((a, b) => prioridadeDoPatch(a[1]) - prioridadeDoPatch(b[1]));
  const cabem = Math.max(0, Math.floor(msDisponiveis / reservaPorEscritaMs));
  const daRodada = fila.slice(0, cabem);
  return { daRodada, restantes: daRodada.length < fila.length };
}
