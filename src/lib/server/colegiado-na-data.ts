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
