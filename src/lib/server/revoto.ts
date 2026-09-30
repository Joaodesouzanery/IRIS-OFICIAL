/**
 * B.4 (Fase 36) — O REVOTO: refazer o voto de uma deliberação cujo COLEGIADO não bate com a data.
 *
 * ═══ Por que ele existe ═══
 * Trocar a `data_reuniao` troca o colegiado: `getActiveDiretoresForVote` filtra por janela de
 * mandato, então uma deliberação que estava em 2024 e voltou para 2026 tem voto gravado no nome de
 * quem não estava lá. Corrigir a data sem refazer o voto não conserta o dado — muda o rótulo e deixa
 * o conteúdo errado, o que é PIOR, porque passa a parecer certo.
 *
 * ═══ ⚠️ UMA CORREÇÃO DO QUE EU MESMO PROPUS NO PLANO ═══
 * O plano dizia: marcador `{data_redatada_de, data_redatada_em}` em `raw_extraction`, gravado por quem
 * troca a data e consumido pelo revoto. **Um sinal DERIVADO é melhor, e por dois motivos medidos:**
 *
 *  1. O marcador exigiria MESCLAR um jsonb pesado em CINCO lugares (as Janelas A, B, C, D e a
 *     reconciliação de filhos), e mesclar exige ter o valor atual em mãos — a Janela C lê o universo
 *     inteiro de deliberações com data, onde `raw_extraction` é justamente o payload que ela evita
 *     carregar. O custo cairia no lugar mais caro da rota.
 *  2. **Linha nunca carimbada nunca seria revotada.** As ~200 já propagadas em fases anteriores não
 *     têm marcador nenhum: ficariam com data certa e votos do colegiado errado, invisíveis para
 *     sempre — exatamente o defeito que o marcador existia para evitar.
 *
 * O sinal derivado é a própria condição que interessa: **existe voto de quem NÃO está no roster da
 * data atual**. É estoque por construção (não depende de a rodada ter feito algo), não pode
 * dessincronizar de nada, e alcança as linhas antigas.
 *
 * ═══ As guardas, e cada uma tem um cenário concreto ═══
 *
 *  1. ⚠️ **ROSTER VAZIO É RECUSA, NUNCA APAGAMENTO.** `getActiveDiretoresForVote` devolve `[]` em
 *     QUALQUER erro de leitura (é o desenho dela: sem saber o roster, não se afirma voto). Sem esta
 *     guarda, uma falha transitória do banco viraria apagamento em massa — com rastro de aparência
 *     perfeita, porque o rastro registraria fielmente o que saiu e nada sobre o motivo real.
 *
 *  2. ⚠️ **NOMINAL nunca é apagado, e nominal FORA do roster é notícia sobre o ROSTER.** Se o
 *     documento NOMEIA alguém votando e o nosso cadastro diz que essa pessoa não tinha mandato, o
 *     suspeito é o cadastro, não o documento. Apagar ali destruiria a evidência que corrige o
 *     mandato. Estas linhas saem em `roster_suspeito`, para uma pessoa olhar.
 *
 *  3. ⚠️ A nominalidade se lê por `isVotoNominal`, nunca por `is_nominal` cru: um voto
 *     `revisao_humana` com `is_nominal=false` seria lido como inferido e apagado.
 *
 *  4. ⚠️ **Sobrando um nominal, a deliberação continua em `comVoto` e o materializador NUNCA a
 *     refaz.** Então o revoto reporta `faltando` separadamente — é o mesmo desenho do reparo de
 *     artefato, que tira a linha de `comVoto` para o laço principal alcançá-la.
 *
 * ⚠️ E o módulo é PURO. A decisão "esta linha pode perder o voto?" não pode morar dentro de um laço
 * de 400 linhas onde ninguém a exercita caso a caso — a Fase 28 pegou, numa revisão adversarial, um
 * erro de leitura ignorado que produzia voto FABRICADO para o colegiado inteiro.
 */

import { isVotoNominal } from "@/lib/votos-nominal";

/**
 * A ESCRITA, desligada.
 *
 * ⚠️ Ligar isto APAGA voto. O usuário foi explícito nas duas direções: "a medição tem de bater com o
 * gabarito antes de eu ligar" e "não apague os votos antigos sem rastro; guarde quem tinha o voto
 * antes e quando foi trocado". O portão do acendimento é a SIMULAÇÃO
 * (`simularColegiadoNaDataCerta`) reproduzindo o gabarito — nunca "o banco bate com o gabarito antes
 * do revoto", que seria circular: é o revoto que faz bater.
 */
export const REVOTO_LIGADO = false;

export interface VotoParaRevoto {
  diretor_id: string;
  is_nominal: boolean | null;
  proveniencia: string | null;
  tipo_voto: string | null;
  motivo_nao_voto: string | null;
}

export type RecusaDeRevoto =
  /** Roster vazio: pode ser erro de leitura. Recusa, nunca apagamento. */
  | "roster_vazio"
  /** Nenhum voto fora do roster e ninguém faltando: a linha já é coerente com a data. */
  | "nada_a_fazer";

export interface DecisaoDeRevoto {
  /** Votos INFERIDOS de quem não está no roster da data atual — foram feitos para outra data. */
  apagar: string[];
  /** Nominais FORA do roster: evidência de que o MANDATO está errado, não o voto. */
  roster_suspeito: string[];
  /** Nominais dentro do roster: ficam, e mantêm a linha em `comVoto`. */
  preservados: string[];
  /** Quem do roster não terá voto depois do apagamento. */
  faltando: string[];
  recusa: RecusaDeRevoto | null;
}

/**
 * O que fazer com uma deliberação cujo voto pode não pertencer ao colegiado da data.
 *
 * ⚠️ Voto inferido DENTRO do roster não é apagado. Ele pode ter sido criado para outra data, mas a
 * pessoa está no colegiado da data atual de todo modo: apagar e recriar daria a MESMA linha, e um
 * apagamento que não muda nada só gasta rastro e risco.
 */
export function decidirRevoto(input: {
  /** Ids do roster na data ATUAL da deliberação — o que `getActiveDiretoresForVote` devolve. */
  roster: readonly string[];
  votos: readonly VotoParaRevoto[];
}): DecisaoDeRevoto {
  if (input.roster.length === 0) {
    /**
     * ⚠️ AQUI. `[]` não significa "ninguém tinha mandato"; significa, com a mesma probabilidade, "a
     * leitura falhou". Apagar sobre essa ambiguidade é o modo de falha mais caro deste arquivo.
     */
    return { apagar: [], roster_suspeito: [], preservados: [], faltando: [], recusa: "roster_vazio" };
  }

  const noRoster = new Set(input.roster);
  const apagar: string[] = [];
  const rosterSuspeito: string[] = [];
  const preservados: string[] = [];
  for (const v of input.votos) {
    const nominal = isVotoNominal(v);
    if (noRoster.has(v.diretor_id)) {
      if (nominal) preservados.push(v.diretor_id);
      // Inferido DENTRO do roster: a pessoa está no colegiado da data atual — nada a fazer.
      continue;
    }
    if (nominal) rosterSuspeito.push(v.diretor_id);
    else apagar.push(v.diretor_id);
  }

  const comVoto = new Set([...preservados, ...input.votos
    .filter((v) => noRoster.has(v.diretor_id))
    .map((v) => v.diretor_id)]);
  const faltando = input.roster.filter((id) => !comVoto.has(id));

  if (apagar.length === 0 && faltando.length === 0 && rosterSuspeito.length === 0) {
    return { apagar: [], roster_suspeito: [], preservados, faltando: [], recusa: "nada_a_fazer" };
  }
  return { apagar, roster_suspeito: rosterSuspeito, preservados, faltando, recusa: null };
}

export interface RastroDeRevoto {
  deliberacao_id: string;
  diretor_id: string;
  is_nominal: boolean;
  tipo_voto: string | null;
  motivo_nao_voto: string | null;
  /** A data que a deliberação tem HOJE — a que o voto deveria respeitar e não respeitava. */
  data_da_deliberacao: string | null;
  /** Quando o revoto rodou. */
  revotado_em: string;
  motivo: string;
}

/**
 * O rastro POR LINHA, no formato que vai para `votos_retroativos_audit.detalhe`.
 *
 * ⚠️ A tabela é agregada por lote (`deliberacoes_afetadas`, `votos_criados`) — não tem
 * `deliberacao_id`, `voto_id` nem valor anterior. O usuário exigiu poder explicar depois por que um
 * relatório antigo e um novo divergem, e isso só cabe no `detalhe` jsonb. Assim nada depende de
 * migration, e o deploy continua seguro antes dela.
 *
 * ⚠️ O que este rastro NÃO tem, e é honesto dizer: a data ANTERIOR da deliberação. A linha de `votos`
 * não guarda a data para a qual foi construída, e o sinal aqui é derivado (voto fora do roster), não
 * um marcador que registrasse a troca. O que se guarda é QUEM tinha o voto, QUAL era, e QUANDO foi
 * removido — o suficiente para explicar uma divergência entre dois relatórios.
 */
export function rastroDoRevoto(input: {
  deliberacaoId: string;
  votos: readonly VotoParaRevoto[];
  apagar: readonly string[];
  dataDaDeliberacao: string | null;
  agora: string;
}): RastroDeRevoto[] {
  const vaiSair = new Set(input.apagar);
  return input.votos
    .filter((v) => vaiSair.has(v.diretor_id))
    .map((v) => ({
      deliberacao_id: input.deliberacaoId,
      diretor_id: v.diretor_id,
      is_nominal: isVotoNominal(v),
      tipo_voto: v.tipo_voto,
      motivo_nao_voto: v.motivo_nao_voto,
      data_da_deliberacao: input.dataDaDeliberacao,
      revotado_em: input.agora,
      motivo: "voto inferido de quem nao esta no roster da data da deliberacao",
    }));
}
