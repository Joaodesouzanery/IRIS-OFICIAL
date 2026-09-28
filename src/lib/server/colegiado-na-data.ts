/**
 * Quem estava no colegiado numa data (Fase 29) — folha pura, resolvida em memória.
 *
 * ═══ A pergunta que isto responde ═══
 * "Os diretores não deveriam ter a mesma quantidade de votos?" Não — e as causas são legítimas:
 * janela de mandato (quem tomou posse depois tem menos), ausência e impedimento, relatoria.
 *
 * O sintoma REAL é outro: na MESMA deliberação, uns diretores têm voto e outros não, sem ausência
 * registrada. Para enxergá-lo é preciso saber quantos deveriam estar lá naquele dia.
 *
 * ⚠️ Os filtros aqui são EXATAMENTE os de `getActiveDiretoresForVote` (`vote-inference.ts`), que é
 * o motor que cria os votos: agência da DELIBERAÇÃO, `fonte_dado <> 'automatico'`,
 * `review_status = 'aprovado'`, janela cobrindo a data, bordas INCLUSIVAS, um diretor conta uma
 * vez mesmo com dois mandatos. Usar um conjunto diferente produziria um selo que discorda do motor
 * — o pior desfecho possível numa ferramenta feita para dar confiança.
 *
 * `fonte_dado = 'automatico'` fica de fora porque é mandato FABRICADO a partir do próprio voto
 * inferido: contá-lo faria o roster se auto-ampliar e a plataforma afirmaria saber quem votava
 * justamente onde não sabe.
 *
 * ⚠️ E quando não há roster conhecido, o resultado NÃO é "0 de 0, completo". É
 * `roster_conhecido: false`. Reportar completude onde não se sabe nada é a mentira oposta, e é a
 * mesma que `janela-de-mandatos.ts` existe para evitar.
 */

export interface MandatoJanela {
  diretor_id: string;
  agencia_id: string;
  data_inicio: string | null;
  data_fim: string | null;
  /**
   * ⚠️ AFASTAMENTO — e ele NÃO é fim de mandato (Fase 35).
   *
   * O QA mostrou o Caio Mário (ANM) faltando nas 84ª, 85ª e 86ª, e a pauta da 34ª REP já o chama de
   * "Diretor afastado". Marcar `diretores.situacao = 'afastado'` era INERTE: nem este módulo nem
   * `getActiveDiretoresForVote` leem `situacao`, então ele continuava no colegiado esperado, continuava
   * em `faltando`, e as três reuniões da ANM não podiam fechar POR DEFINIÇÃO — o placar ficaria em 0/3
   * para sempre, com um ruído que nenhum trabalho de esteira resolveria.
   *
   * E fechar o mandato dele na data do afastamento seria gravar coisa FALSA: afastamento é suspensão
   * do exercício, o mandato continua. Por isso a janela é separada — o mandato segue vigente, e o
   * colegiado ESPERADO A VOTAR exclui quem estava afastado naquele dia.
   */
  afastado_desde?: string | null;
  /** Nulo com `afastado_desde` preenchido = afastamento ainda em curso. */
  afastado_ate?: string | null;
}

/** Estava afastado NA DATA? Bordas inclusivas, como a janela de mandato. */
export function afastadoNaData(m: MandatoJanela, data: string): boolean {
  if (!m.afastado_desde) return false;
  if (m.afastado_desde > data) return false;
  if (m.afastado_ate && m.afastado_ate < data) return false;
  return true;
}

export interface ComparacaoDoColegiado {
  esperado: number;
  presente: number;
  /** Ids de quem tinha mandato na data e não tem voto nesta deliberação. */
  faltando: string[];
  /** `false` = não sabemos quem estava lá. A tela NÃO pode dizer "completo" nesse caso. */
  roster_conhecido: boolean;
}

/** Os diretores com mandato vigente nesta agência, nesta data. Bordas inclusivas. */
export function colegiadoNaData(
  mandatos: MandatoJanela[],
  agenciaId: string | null,
  data: string | null,
): string[] {
  if (!agenciaId || !data) return [];
  const ids = new Set<string>();
  for (const m of mandatos) {
    if (m.agencia_id !== agenciaId) continue;
    if (!m.data_inicio || m.data_inicio > data) continue;
    // `data_fim` nulo = mandato EM CURSO. Tratá-lo como encerrado zeraria todo colegiado atual.
    if (m.data_fim && m.data_fim < data) continue;
    // ⚠️ Afastado na data não é esperado a votar — e não deixou de ter mandato. Ver `MandatoJanela`.
    if (afastadoNaData(m, data)) continue;
    ids.add(m.diretor_id);
  }
  return [...ids];
}

export function esperadoVsPresente(roster: string[], votantes: string[]): ComparacaoDoColegiado {
  if (roster.length === 0) {
    return { esperado: 0, presente: votantes.length, faltando: [], roster_conhecido: false };
  }
  const votou = new Set(votantes);
  return {
    esperado: roster.length,
    presente: roster.filter((id) => votou.has(id)).length,
    faltando: roster.filter((id) => !votou.has(id)),
    roster_conhecido: true,
  };
}
