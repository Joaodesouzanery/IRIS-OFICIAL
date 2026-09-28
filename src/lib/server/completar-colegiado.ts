/**
 * COMPLETAR COLEGIADO PARCIAL — o plano, e as recusas (Fase 35, Bloco G).
 *
 * ═══ A lacuna ═══
 * O materializador só visita deliberação com **ZERO** voto (`semVotoTotal`). Uma deliberação com 3 de
 * 5 está em `comVoto` e é pulada PARA SEMPRE. Consequência medida: o José Fernando voltou ao cadastro
 * pela migration da Fase 34 e tem **1 voto em todo 2026** — os votos dele nas 84ª/85ª/86ª nunca serão
 * refeitos pelo caminho existente. E `roster-divergente`, que mede exatamente isso, é **somente
 * leitura por construção** (o docblock dela diz: *"Não existe caminho de escrita aqui"*).
 *
 * Não é bug: é capacidade que não existe. E é a maior parte da distância entre a cobertura por
 * deliberação e 100%.
 *
 * ═══ Por que o PLANO é um módulo puro, e por que ele RECUSA ═══
 * Afirmar que alguém votou é a escrita mais cara desta esteira. A Fase 28 registrou o caso: uma
 * revisão adversarial pegou um erro de leitura ignorado que produzia **voto FABRICADO para o
 * colegiado inteiro**. Então a decisão "esta linha pode receber voto inferido?" não pode morar dentro
 * de um laço de 400 linhas onde ninguém a exercita caso a caso.
 *
 * As três recusas, e cada uma tem um caso real por trás:
 *
 *  (a) **fonte que não nomina + voto nominal existente** → é o VOTO ARTEFATO da Fase 34 (relator
 *      gravado como se fosse o colegiado). Completar em volta dele multiplicaria o artefato por
 *      cinco em vez de apagá-lo. Estas linhas pertencem ao reparo de artefato, não a este passo.
 *
 *  (b) **sinais de contestação** → houve divergência, e aí NÃO se infere: o desfecho não diz como
 *      cada um votou. É a mesma regra de `shouldInferVotesFromMandate`, e a Fase 21 a pagou caro
 *      lendo "não houve unanimidade" como consenso.
 *
 *  (c) **sem resultado** → sem desfecho não há o que inferir. A Fase 26 fixou que voto inferido SEGUE
 *      O DESFECHO; sem ele, inferir é inventar.
 *
 * ⚠️ E a escrita fica atrás de constante DESLIGADA no chamador. Este módulo só diz o que ACONTECERIA.
 */

import { capacidadeNominal } from "@/lib/server/colegiado-sources";

export type MotivoDeRecusa =
  /** Fonte não nomina ninguém e já existe voto nominal: é artefato, pertence ao reparo. */
  | "voto_artefato_pendente"
  /** Houve divergência declarada — o desfecho não diz como cada um votou. */
  | "contestado"
  /** Sem desfecho não há o que inferir. */
  | "sem_resultado"
  /** Ninguém com mandato na data: nada a completar (e nada a afirmar). */
  | "sem_roster";

export interface DeliberacaoParcial {
  id: string;
  sigla: string | null;
  tipo_documento: string | null;
  resultado: string | null;
  /** Sinais de divergência lidos do documento. */
  contestado: boolean;
  /** Ids com mandato vigente na data (já com afastamento aplicado pelo chamador). */
  roster: string[];
  /** Ids que JÁ têm linha em `votos` nesta deliberação. */
  jaResponderam: string[];
  /** Algum dos votos existentes é nominal? */
  temVotoNominal: boolean;
}

export interface ParPlanejado {
  deliberacao_id: string;
  diretor_id: string;
}

export interface PlanoDeCompletar {
  /** Pares que seriam criados se a regra estivesse ligada. */
  pares: ParPlanejado[];
  /** Por que cada deliberação recusada foi recusada. */
  recusas: { deliberacao_id: string; motivo: MotivoDeRecusa }[];
  /** Contagem por motivo — é o número que o usuário lê antes de decidir. */
  porMotivo: Record<string, number>;
}

/**
 * O que seria criado, e o que é recusado.
 *
 * ⚠️ Deliberação SEM falta nenhuma não entra em `pares` nem em `recusas`: ela está completa, e
 * contá-la como recusa inflaria o denominador do diagnóstico.
 */
export function planejarCompletar(itens: DeliberacaoParcial[]): PlanoDeCompletar {
  const pares: ParPlanejado[] = [];
  const recusas: { deliberacao_id: string; motivo: MotivoDeRecusa }[] = [];
  const porMotivo: Record<string, number> = {};
  const recusar = (id: string, motivo: MotivoDeRecusa) => {
    recusas.push({ deliberacao_id: id, motivo });
    porMotivo[motivo] = (porMotivo[motivo] ?? 0) + 1;
  };

  for (const d of itens) {
    const responderam = new Set(d.jaResponderam);
    const faltando = d.roster.filter((id) => !responderam.has(id));

    if (d.roster.length === 0) {
      // ⚠️ Só é recusa se houvesse algo a completar. Sem roster não há nem falta declarável.
      if (d.jaResponderam.length > 0) recusar(d.id, "sem_roster");
      continue;
    }
    if (faltando.length === 0) continue; // completa — nada a planejar, nada a recusar

    /**
     * (a) A recusa que vem PRIMEIRO, porque ela diz que a linha é de outro passo. Se a fonte não
     * nomina ninguém e ainda assim há voto nominal, o voto existente é artefato — e completar em
     * volta dele criaria quatro votos irmãos de um voto que não devia existir.
     */
    if (capacidadeNominal(d.sigla, d.tipo_documento) === "nenhum" && d.temVotoNominal) {
      recusar(d.id, "voto_artefato_pendente");
      continue;
    }
    if (d.contestado) {
      recusar(d.id, "contestado");
      continue;
    }
    if (!d.resultado) {
      recusar(d.id, "sem_resultado");
      continue;
    }
    for (const diretorId of faltando) pares.push({ deliberacao_id: d.id, diretor_id: diretorId });
  }

  return { pares, recusas, porMotivo };
}

/** Quantos pares por agência — para o número na tela ser acionável em vez de um total só. */
export function paresPorAgencia(
  plano: PlanoDeCompletar,
  siglaDe: (deliberacaoId: string) => string,
): Record<string, number> {
  const out: Record<string, number> = {};
  for (const p of plano.pares) {
    const sigla = siglaDe(p.deliberacao_id);
    out[sigla] = (out[sigla] ?? 0) + 1;
  }
  return out;
}
