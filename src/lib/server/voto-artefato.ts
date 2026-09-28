/**
 * O VOTO QUE A FONTE NÃO PODIA TER PRODUZIDO (Fase 34, Bloco 3).
 *
 * ═══ O caso, medido em nove reuniões da ANTT ═══
 * RDE 271, 272, 273, 274, 276, Extraordinária 99 e RD 1.028, 1.029, 1.030 (mar–abr/2026) têm, em
 * cada item de ata, **um voto só** — e ele é do RELATOR, gravado como `is_nominal`.
 *
 * ⚠️ Isso é impossível pela própria declaração do projeto: `CAPACIDADE_NOMINAL['ANTT|ata']` é
 * `"nenhum"` — *"a ata da ANTT registra a decisão do colegiado, nunca o voto de cada um"*. Uma fonte
 * que não nomina ninguém não pode ter produzido um voto nominal. O voto não é leitura: é ARTEFATO,
 * do defeito que o `a4cd15f` consertou (a esteira perdia `documento_antt_tipo`, o relator virava
 * votante, e o voto nominal bloqueava a inferência dos outros quatro).
 *
 * ═══ Por que um módulo, e por que este predicado e não outro ═══
 * A alternativa óbvia seria reconhecer o passivo por `raw_extraction.documento_antt_tipo` ausente.
 * **Não serve**: é justamente o campo que faltava, então ele está nulo tanto nas linhas defeituosas
 * quanto em qualquer documento de agência que não seja a ANTT. Usá-lo confundiria as duas
 * populações.
 *
 * A CAPACIDADE é o predicado certo porque é uma afirmação sobre a FONTE, não sobre o que a esteira
 * gravou: se o instrumento não nomina, nenhum voto nominal vindo dele é leitura, hoje ou em 2019.
 *
 * ⚠️ E o predicado é ESTREITO de propósito. Exige UM voto. Com dois ou mais, o padrão deixa de ser
 * "o relator virou o colegiado" e pode ser qualquer outra coisa — e apagar voto por hipótese larga
 * é o modo de falha mais caro que existe aqui.
 */

import { capacidadeNominal } from "@/lib/server/colegiado-sources";

export interface VotoExistente {
  diretor_id: string;
  is_nominal: boolean;
}

export interface DeliberacaoParaAnalise {
  /** Sigla da agência da deliberação. */
  sigla: string | null;
  /** `tipo_documento` da linha — o instrumento. */
  tipo_documento: string | null;
  /** Item de ata tem pai; a ata-mãe não. Só o ITEM tem voto a conferir. */
  tem_pai: boolean;
  votos: VotoExistente[];
}

/**
 * O único voto desta deliberação é um artefato, que a fonte não poderia ter produzido?
 *
 * Todas as condições são necessárias:
 *  · a fonte NÃO nomina (`capacidadeNominal === "nenhum"`);
 *  · é item de ata (tem pai) — a mãe não tem voto a conferir;
 *  · há exatamente UM voto;
 *  · e ele é `is_nominal` — um voto inferido é leitura legítima do colegiado, não artefato.
 */
export function votoNominalImpossivel(d: DeliberacaoParaAnalise): boolean {
  // ⚠️ Não há guard próprio para `sigla` nula: `capacidadeNominal(null, …)` já devolve "parcial", de
  // propósito ("desconhecido: não afirma limite que não medimos"), e a linha seguinte recusa. Um
  // `if (!d.sigla) return false` aqui seria código morto — uma mutação que o apagava sobreviveu a
  // todos os testes, que é como código morto se anuncia.
  if (capacidadeNominal(d.sigla, d.tipo_documento) !== "nenhum") return false;
  if (!d.tem_pai) return false;
  if (d.votos.length !== 1) return false;
  return d.votos[0].is_nominal === true;
}

export interface RastroDeVotoApagado {
  deliberacao_id: string;
  diretor_id: string;
  is_nominal: boolean;
  motivo: string;
}

/**
 * O rastro de um voto removido, no formato que vai para `votos_retroativos_audit.detalhe`.
 *
 * ⚠️ A tabela de auditoria NÃO tem `deliberacao_id`, `voto_id` nem valor anterior — ela é agregada
 * por lote (`deliberacoes_afetadas`, `votos_criados`). O usuário exigiu poder explicar, depois, por
 * que um relatório antigo e um novo divergem, e para isso o rastro precisa ser POR LINHA. Ele vai no
 * `detalhe` jsonb, que já existe: assim nada depende de migration, e o deploy continua seguro antes
 * dela — que é a regra deste repositório.
 */
export function rastroDoApagamento(
  deliberacaoId: string,
  votos: VotoExistente[],
  sigla: string,
): RastroDeVotoApagado[] {
  return votos.map((v) => ({
    deliberacao_id: deliberacaoId,
    diretor_id: v.diretor_id,
    is_nominal: v.is_nominal,
    motivo: `fonte ${sigla}|ata nao nomina voto (CAPACIDADE_NOMINAL='nenhum')`,
  }));
}
