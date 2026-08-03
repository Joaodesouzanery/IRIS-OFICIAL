/**
 * Checagens de CONSISTÊNCIA da extração (fechadores QA ago/2026) — funções PURAS (texto → aviso),
 * separadas do orquestrador (upload-analysis) para serem testáveis sem PDF. Cada aviso é de
 * QUALIDADE: rebaixa o status e bloqueia a auto-confirmação → o documento vai à REVISÃO humana.
 * Nenhuma DESTROI ou FABRICA voto — só sinaliza (princípio null-não-chuta).
 */

// Sinais fortes de voto CONTESTADO (não "divergênci" solto, que casa "sem divergência").
const RE_CONTESTADO = /\bpor\s+maioria\b|voto\s+de\s+qualidade|\bempate\b|\bvencid[oa]s?\b|prevaleceu|maioria\s+de\s+votos/i;

/**
 * "Unanimidade" DECLARADA + sinais de contestação SEM dissidente nomeado é contraditório: o pool
 * viraria "unânime favorável" falso. Retorna o aviso (→ revisão) ou null. NÃO purga — no ramo de
 * unanimidade a inferência de mandato desfaria o esvaziamento; o aviso é o mecanismo correto.
 */
export function avisoUnanimidadeContestada(text: string, unanimidade: boolean, contraCount: number): string | null {
  if (unanimidade && contraCount === 0 && RE_CONTESTADO.test(text)) {
    return "Sinais contraditórios: texto indica unanimidade E maioria/voto de qualidade/voto vencido sem dissidente nomeado — revisar direção antes de confirmar.";
  }
  return null;
}

/**
 * Item de ata que não parseou deixa de sumir em SILÊNCIO: se o texto tem bem mais rótulos
 * "Processo:" do que itens reconhecidos, algum item foi descartado. Retorna o aviso ou null.
 * Tolerância de 2 (rótulos em prosa / cabeçalho) para não gerar falso positivo.
 */
export function avisoAtaItensFaltando(text: string, itensParseados: number): string | null {
  const labels = (text.match(/Processo(?:\s*n[ºo°]?)?\s*:/gi) ?? []).length;
  if (labels >= itensParseados + 2) {
    return `Possível item de ata não reconhecido: ${labels} rótulos "Processo" no texto, mas ${itensParseados} item(ns) parseado(s) — revisar a divisão da ata.`;
  }
  return null;
}
