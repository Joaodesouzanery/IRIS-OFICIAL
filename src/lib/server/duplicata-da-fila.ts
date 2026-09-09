/**
 * O que fazer com um documento marcado `is_duplicate` na fila de auto-confirm (Fase 23).
 *
 * ═══ O beco sem saída, medido ═══
 * 36 deliberações da ARTESP em "Revisar" por "possível duplicata". A marca vem do ramo de
 * `upload-analysis` que deduplica contra a PRÓPRIA fila: dois PDFs irmãos da mesma matéria, ambos
 * em `review_pending`, marcam-se mutuamente. O `confirm-lote` só arquiva duplicata EXATA (hash
 * igual a um doc CONFIRMADO); o `canAutoConfirm` recusa qualquer `is_duplicate`; e nenhum dos
 * dois irmãos confirma nunca — então nenhum vira o "original" do outro. Laço eterno.
 *
 * ═══ A regra ═══
 *  · há gêmeo CONFIRMADO (mesmo hash, ou mesma chave semântica) → `arquivar`, com o link;
 *  · só há irmãos PENDENTES → o PRIMEIRO da dupla (menor id, determinístico) é `liberar`: segue
 *    para o gate normal como se não fosse duplicata; os outros `esperar` — na próxima rodada o
 *    primeiro já está confirmado e eles caem no primeiro caso;
 *  · sem gêmeo nenhum (marca órfã de análise antiga) → `liberar`.
 */

export type DesfechoDeDuplicata =
  | { acao: "arquivar"; motivo: "duplicata_exata" | "duplicata_semantica"; original_id: string; original_deliberacao_id: string | null }
  | { acao: "liberar" }
  | { acao: "esperar"; irmao_id: string };

export interface GemeoConfirmado { id: string; deliberacao_id: string | null; file_hash: string | null }

export function decidirDuplicata(input: {
  doc: { id: string; file_hash: string | null };
  gemeosConfirmados: GemeoConfirmado[];
  irmaosPendentesIds: string[];
}): DesfechoDeDuplicata {
  const confirmados = input.gemeosConfirmados.filter((g) => g.id !== input.doc.id);
  if (confirmados.length > 0) {
    const exato = input.doc.file_hash ? confirmados.find((g) => g.file_hash === input.doc.file_hash) : undefined;
    const g = exato ?? confirmados[0];
    return {
      acao: "arquivar",
      motivo: exato ? "duplicata_exata" : "duplicata_semantica",
      original_id: g.id,
      original_deliberacao_id: g.deliberacao_id ?? null,
    };
  }
  const irmaos = input.irmaosPendentesIds.filter((id) => id !== input.doc.id).sort();
  if (irmaos.length === 0) return { acao: "liberar" };
  const primeiro = [input.doc.id, ...irmaos].sort()[0];
  return primeiro === input.doc.id ? { acao: "liberar" } : { acao: "esperar", irmao_id: primeiro };
}
