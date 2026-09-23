/**
 * POR QUE esta deliberação não recebeu voto inferido (Fase 31).
 *
 * ═══ A pergunta que motivou o módulo ═══
 * A certificação da `etapa163` mediu 17 votos que o gabarito manual prevê e o pipeline não produz,
 * em 3 atas — todos por uma linha só, `shouldInferVotesFromMandate:111`:
 *
 *     return hasDivergence || ((isUnanimous || decisaoSemContestacao) && !hasNominalNames);
 *
 * O `!hasNominalNames` desliga a inferência para o COLEGIADO INTEIRO quando a ata nomeia um único
 * diretor — inclusive num item que o próprio documento declara unânime (81ª ROP, item 2.2.1).
 *
 * Antes de mexer numa função que governa todo documento da base, três perguntas precisam de
 * resposta MEDIDA, não de palpite: quantos itens estão nesse caso; se o nome que bloqueia é mesmo
 * de um votante ou às vezes de um terceiro (a regra teria razão de ser); e se o efeito se
 * concentra numa agência. Este módulo é a metade pura dessa medição.
 *
 * ═══ ⚠️ A trava contra o defeito que este repo já pagou duas vezes ═══
 * Um classificador que REIMPLEMENTA o predicado vira uma segunda verdade — e foi assim que a chave
 * semântica ganhou duas implementações divergentes e `RE_CONTESTADO` ganhou outras duas. Aqui a
 * equivalência é provada por teste: `motivoSemInferencia(x) === "inferiria"` tem de valer
 * exatamente quando `shouldInferVotesFromMandate(x) === true`, sobre o produto cartesiano das
 * entradas. Divergir reprova.
 */

import { isFinalVoteDocument, matchIds, type DiretorVoteRecord } from "@/lib/server/vote-inference";

export type MotivoSemInferencia =
  /** A inferência LIGA. Se mesmo assim não há voto, a causa é outra (roster, escrita, lote). */
  | "inferiria"
  | "nao_e_documento_final"
  | "sem_resultado_ou_retirado"
  | "sem_data_de_reuniao"
  /** Nem unânime, nem "decisão sem contestação medida". Mexer em `!hasNominalNames` NÃO muda isto. */
  | "sem_unanimidade_e_com_contestacao"
  /** ⚠️ O caso da Fase 31: seria inferível, e um nome que casa com o cadastro o impede. */
  | "bloqueado_por_nome_de_diretor";

export interface EntradaDaInferencia {
  resultado: string | null;
  tipo_documento: string | null;
  import_counts_as_final?: boolean | null;
  unanimidadeDetectada?: boolean | null;
  nomes?: string[];
  nomesContra?: string[];
  nomesAbstencao?: string[];
  dataReuniao?: string | null;
  diretoresList?: DiretorVoteRecord[];
  sinaisContestacao?: boolean;
}

/**
 * O motivo, na MESMA ordem de guardas de `shouldInferVotesFromMandate`.
 *
 * ⚠️ A ordem entre os dois últimos não é estética e decide o número que o usuário vai ler:
 * `sem_unanimidade_e_com_contestacao` vem ANTES de `bloqueado_por_nome_de_diretor` porque remover
 * o `!hasNominalNames` não muda nada num item contestado. Assim o balde
 * `bloqueado_por_nome_de_diretor` é EXATAMENTE o conjunto que o conserto destravaria — nem um item
 * a mais. Invertida, a ordem inflaria o "ganho" do conserto com itens que ele não alcança.
 */
export function motivoSemInferencia(input: EntradaDaInferencia): MotivoSemInferencia {
  if (!isFinalVoteDocument(input as never)) return "nao_e_documento_final";
  if (!input.resultado || input.resultado === "Retirado de Pauta") return "sem_resultado_ou_retirado";
  if (!input.dataReuniao) return "sem_data_de_reuniao";

  const isUnanimous = Boolean(input.unanimidadeDetectada) || input.resultado === "Aprovado por Unanimidade";
  const hasDivergence = Boolean(input.nomesContra?.length) || Boolean(input.nomesAbstencao?.length);
  if (hasDivergence) return "inferiria";

  const decisaoSemContestacao = input.sinaisContestacao === false;
  if (!(isUnanimous || decisaoSemContestacao)) return "sem_unanimidade_e_com_contestacao";

  const hasNominalNames = input.diretoresList
    ? matchIds(input.nomes ?? [], input.diretoresList).size > 0
    : Boolean(input.nomes?.length);
  return hasNominalNames ? "bloqueado_por_nome_de_diretor" : "inferiria";
}

/** Quem, exatamente, bloqueou — para a pergunta "o nome citado é votante ou terceiro?". */
export interface NomeQueBloqueia {
  nome_no_documento: string;
  /** `null` = o nome NÃO casou com o cadastro, e portanto não bloqueia nada. */
  diretor_casado: string | null;
}

/**
 * Para um item bloqueado, quais nomes casaram com o cadastro e com quem.
 *
 * ⚠️ É esta lista que responde se a regra tinha razão de ser. Note que `hasNominalNames` só conta
 * nome que CASA com o cadastro de diretores (`matchIds` exige `!needsReview`): advogado,
 * interessado e signatário de rodapé não casam, então a regra JÁ distingue papel por desenho — foi
 * exatamente isso que ela foi criada para fazer (os signatários do rodapé da ARTESP desligavam a
 * inferência e deixavam 35 finais sem voto). O que sobra para medir é o caso em que um nome casou
 * com o diretor ERRADO, ou casou sem ser votante daquele item.
 */
export function nomesQueBloqueiam(
  nomes: string[],
  diretoresList: DiretorVoteRecord[],
): NomeQueBloqueia[] {
  const casados = matchIds(nomes, diretoresList);
  const porId = new Map(diretoresList.map((d) => [d.id, d.nome]));
  return nomes.map((nome) => {
    // Um nome de cada vez, para saber QUAL deles casou — `matchIds` devolve só o conjunto.
    const so = matchIds([nome], diretoresList);
    const id = [...so].find((i) => casados.has(i));
    return { nome_no_documento: nome, diretor_casado: id ? porId.get(id) ?? id : null };
  });
}
