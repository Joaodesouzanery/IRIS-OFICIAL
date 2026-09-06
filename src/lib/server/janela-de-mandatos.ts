/**
 * A JANELA DE MANDATOS CONHECIDOS — o que separa "não sabemos" de "não existe" (Fase 20).
 *
 * ═══ O problema que ele resolve ═══
 * O mandato ANM verificado mais antigo começa em **05/12/2022**, e a fonte nova da agência é
 * justamente o ACERVO ANTIGO. Sem esta distinção, toda deliberação anterior a essa data cai no
 * mesmo balde de `roster_nao_conferivel` — o balde que significa "vá consertar o cadastro".
 *
 * Só que não há o que consertar: a plataforma simplesmente não tem registro de quem eram os
 * diretores em 2019. Misturar as duas coisas produz um instrumento que manda o operador procurar
 * um defeito inexistente — e, pior, faz PARECER que a cobertura piorou quando o acervo entra.
 * Escalar a coleta da ANM sem isto DERRUBA a métrica de votação, punindo a plataforma por ingerir
 * mais história.
 *
 * ═══ O que a marcação NÃO faz ═══
 * Não descarta o documento. Ele é ingerido e conta em cobertura, microtemas e histórico — o que
 * ele não faz é entrar no denominador de VOTAÇÃO, porque ali a resposta honesta não é "sem voto",
 * é "fora do período em que sabemos quem votava".
 */

/** Uma janela de mandatos conhecida para uma agência. `fim` nulo = mandato em curso. */
export interface JanelaDeMandato {
  data_inicio: string | null;
  data_fim?: string | null;
}

export type MotivoForaDaJanela = "anterior_ao_primeiro_mandato" | "sem_data_de_reuniao";

/**
 * A data mais antiga para a qual a plataforma sabe quem estava no colegiado.
 * `null` quando não há nenhuma janela — e aí NÃO se pode afirmar nada sobre período.
 */
export function inicioDaJanelaConhecida(janelas: JanelaDeMandato[]): string | null {
  const inicios = janelas
    .map((j) => j.data_inicio)
    .filter((d): d is string => typeof d === "string" && d.length >= 10)
    .sort();
  return inicios[0] ?? null;
}

/**
 * A deliberação está fora do período em que sabemos quem votava? `null` = está DENTRO.
 *
 * ⚠️ Duas recusas deliberadas:
 *  · **sem janela nenhuma** → devolve `null` (dentro). Uma agência sem mandato cadastrado não
 *    pode ter TODO o seu acervo declarado "fora da janela": isso transformaria ausência de
 *    cadastro em afirmação sobre o período, que é a mentira oposta à que este arquivo evita.
 *  · **data posterior ao último mandato** → também `null`. Mandato em curso tem `data_fim` nulo,
 *    e tratar o futuro como fora da janela esconderia deliberação recente, que é o dado que mais
 *    importa. O buraco de cobertura recente tem de aparecer como buraco.
 */
export function foraDaJanelaDeMandatos(input: {
  dataReuniao: string | null | undefined;
  janelas: JanelaDeMandato[];
}): MotivoForaDaJanela | null {
  const inicio = inicioDaJanelaConhecida(input.janelas);
  if (!inicio) return null;
  if (!input.dataReuniao) return "sem_data_de_reuniao";
  return input.dataReuniao < inicio ? "anterior_ao_primeiro_mandato" : null;
}
