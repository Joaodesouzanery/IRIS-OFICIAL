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

/**
 * A ESCRITA, desligada.
 *
 * ⚠️ Mora AQUI, e não na rota, por uma razão mecânica: `export const` com nome não reservado em um
 * `route.ts` do App Router **quebra o `next build`** — e o `tsc --noEmit` passa, então só o build
 * pega. Placar e materializador já importam este módulo.
 *
 * Ligar isto afirma que cinco pessoas votaram a partir de um documento que nomeia zero. É a escrita
 * mais cara da esteira, e ela só liga depois de o número medido bater com o que o usuário conferir.
 */
export const COMPLETAR_PARCIAL = false;

export type MotivoDeRecusa =
  /** Fonte não nomina ninguém e já existe voto nominal: é artefato, pertence ao reparo. */
  | "voto_artefato_pendente"
  /** Houve divergência declarada — o desfecho não diz como cada um votou. */
  | "contestado"
  /** Sem desfecho não há o que inferir. */
  | "sem_resultado"
  /** Ninguém com mandato na data: nada a completar (e nada a afirmar). */
  | "sem_roster"
  /**
   * Voto nominal de DIREÇÃO numa fonte que não nomina, e que o reparo de artefato NÃO alcança
   * (ele exige item de ata com exatamente um voto). Ninguém vai consertar sozinho: precisa de olho
   * humano. Antes isto era achatado em `voto_artefato_pendente`, prometendo um reparo que não viria.
   */
  | "nominal_inconsistente";

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
  /**
   * Algum voto existente é nominal e de DIREÇÃO (favorável/contrário/…)?
   *
   * ⚠️ A distinção não é cosmética. `Ausente` e `Impedido` nominais são leitura legítima de uma ata
   * da ARTESP (a fonte diz quem faltou sem dizer quem votou como) e NÃO são artefato: recusar por
   * causa deles deixaria a deliberação parcial para sempre. Era o defeito da recusa (a).
   */
  temVotoNominalDeDirecao: boolean;
  /** É item de ata (tem documento pai)? O reparo de artefato só alcança quem tem pai. */
  temPai: boolean;
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
    if (capacidadeNominal(d.sigla, d.tipo_documento) === "nenhum" && d.temVotoNominalDeDirecao) {
      /**
       * ⚠️ A recusa tem de casar com o que o reparo REALMENTE alcança. `votoNominalImpossivel`
       * (`voto-artefato.ts`) exige item de ata **com exatamente um voto**; esta recusa exigia só
       * "tem nominal", e era mais larga que o reparo que ela invocava. O que caísse na diferença
       * ficava parado esperando um passo que nunca ia visitá-lo.
       */
      recusar(d.id, d.temPai && d.jaResponderam.length === 1 ? "voto_artefato_pendente" : "nominal_inconsistente");
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

/**
 * SÓ quem falta. É o filtro mais importante da escrita, e o motivo é do `postgrest`.
 *
 * ⚠️ O upsert usa a UNIÃO das colunas do lote com `defaultToNull`: uma coluna ausente em qualquer
 * linha do lote vira **NULL na linha existente**. Reenviar quem já respondeu portanto não é
 * inofensivo — apaga `motivo_nao_voto` de um `Ausente` lido do documento e o transforma em ausência
 * sem motivo. Este filtro é a diferença entre completar e DANIFICAR.
 */
export function apenasQuemFalta<T extends { diretor_id: string }>(
  linhas: readonly T[],
  jaResponderam: Iterable<string>,
): T[] {
  const responderam = new Set(jaResponderam);
  return linhas.filter((l) => !responderam.has(l.diretor_id));
}

/**
 * O PORTÃO POR ITEM: só recebe voto quem o DOCUMENTO nomeia como presente.
 *
 * ═══ Por que não é o gabarito ═══
 * O gabarito certificado cobre 79ª/81ª/83ª e 1.024ª/264ª. Os primeiros alvos desta escrita são a
 * **84ª e a 86ª** (José Fernando com 1 voto em 56 itens, Luiz com 1 em 37) — que gabarito nenhum
 * confere. Um portão que consulta um gabarito vazio é um portão aberto.
 *
 * ═══ Por que os presentes ═══
 * A Fase 20 mediu o preço de inferir pelo MANDATO: na 79ª ROP o preâmbulo nomeia Roger e Tasso, e o
 * roster de mandato devolve Caio Mário no lugar deles — voto gravado no nome ERRADO, que se propaga
 * por todas as métricas parecendo legítimo. O preâmbulo é a única evidência POR ITEM de quem estava
 * na sala, e é ela que autoriza.
 *
 * ⚠️ Documento sem preâmbulo casado barra TODOS: é o lado seguro. Voto ausente se vê; voto errado
 * não.
 */
export function paresAutorizadosPeloDocumento(input: {
  faltando: readonly string[];
  presentesNoDocumento: readonly string[];
}): { autorizados: string[]; barrados: string[] } {
  if (input.presentesNoDocumento.length === 0) {
    return { autorizados: [], barrados: [...input.faltando] };
  }
  const presentes = new Set(input.presentesNoDocumento);
  return {
    autorizados: input.faltando.filter((id) => presentes.has(id)),
    barrados: input.faltando.filter((id) => !presentes.has(id)),
  };
}
