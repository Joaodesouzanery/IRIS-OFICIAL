/**
 * O carimbo `auto_skip` que ficou VELHO (Fase 24).
 *
 * ═══ A trava de sentido único ═══
 * O auto-confirm grava em `campos_detectados.auto_skip` o motivo de pular um documento e, nas
 * rodadas seguintes, só olha documentos SEM carimbo (perf: o backlog inelegível não é reavaliado
 * toda rodada). O efeito colateral, medido no qa-fase23: 68 documentos carimbados
 * "[AVISO·C06…]" e 31 "possível duplicata" pelo build ANTIGO nunca foram reavaliados depois que
 * o gate mudou (Fase 23). Nada limpava o carimbo exceto o requeue completo.
 *
 * ═══ Dois desfechos, por motivo ═══
 *  · `reavaliar` — o gate mudou, o documento não: basta apagar o carimbo e o gate atual decide.
 *  · `reanalisar` — a EXTRAÇÃO/classificação mudou (pauta reconhecida pelo texto, predicado de
 *    contestação corrigido, cadastro reinserido): o documento volta à fila para nova análise.
 *    Guardado por `metadata.reanalises` (o requeue zera `campos_detectados`, não `metadata`):
 *    o mesmo motivo só reanalisa UMA vez — se voltar, é revisão humana de verdade.
 *
 * Cada entrada diz qual commit a tornou obsoleta. Motivo fora da lista continua carimbado.
 */

export type DesfechoDoCarimbo = "reavaliar" | "reanalisar" | null;

const REAVALIAR: RegExp[] = [
  /^warning de qualidade: \[(?:AVISO|INFO)·/,   // Fase 23 c2 — aviso não bloqueia mais
  /^possível duplicata$/,                          // Fase 23 c3 — duplicata da fila tem saída
];

const REANALISAR: RegExp[] = [
  /^warning de qualidade: Sinais contraditórios/, // Fase 24 c2 — predicado sem "vencido" solto
  /^warning de qualidade: Voto proferido em sessão anterior/, // Fase 24 c2 — cadastro reinserido
  /^não conta como final$/,                        // Fase 19 — pauta reconhecida pelo TEXTO; ata sem itens ganhou motivo próprio
];

export function desfechoDoCarimbo(motivo: string | null | undefined): DesfechoDoCarimbo {
  const m = (motivo ?? "").trim();
  if (!m) return null;
  if (REAVALIAR.some((re) => re.test(m))) return "reavaliar";
  if (REANALISAR.some((re) => re.test(m))) return "reanalisar";
  return null;
}
