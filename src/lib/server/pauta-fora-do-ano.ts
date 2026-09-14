/**
 * Pauta de ano encerrado não entra na fila (Fase 27).
 *
 * Pauta é AGENDA: `ata-splitter.ts` proíbe materializar item de pauta ("nada foi decidido e
 * viraria voto fabricado"), e o confirm a arquiva como apoio. Baixar e extrair uma pauta de 2023
 * custa download, parse e fatia de extração para produzir exatamente nada.
 *
 * Medido no qa-fase26 ④: dos 10 documentos presos no parser, SETE eram pautas da ANM de 2023-2024
 * (52ª, 53ª, 54ª, 59ª, 61ª ROP, 26ª REP, 27ª ROP). Cada retentativa custava a rodada inteira.
 *
 * ⚠️ Só PAUTA. Ata, deliberação e voto de qualquer ano continuam entrando: são acervo, e o
 * acervo antigo já tem tratamento próprio (`fora_da_janela_de_mandatos`, Fase 20).
 */

/** O ano no título/URL, quando o item não tem `data_reuniao` (ex.: "52-ROP-26-07-2023-Pauta"). */
export function anoNoTexto(texto: string | null | undefined): number | null {
  const anos = [...String(texto ?? "").matchAll(/\b(20[0-4]\d)\b/g)].map((m) => Number(m[1]));
  return anos.length > 0 ? Math.max(...anos) : null;
}

export function pautaForaDoAno(
  item: { tipo?: string | null; data_reuniao?: string | null; titulo?: string | null; url_item?: string | null },
  anoCorrente: number,
): boolean {
  if (String(item.tipo ?? "") !== "pauta") return false;
  const anoDaData = item.data_reuniao ? Number(String(item.data_reuniao).slice(0, 4)) : null;
  if (anoDaData) return anoDaData < anoCorrente;
  // Sem data: o ano do título/URL decide. Sem ano nenhum, NÃO arquiva — na dúvida, processa.
  const ano = anoNoTexto(item.titulo) ?? anoNoTexto(item.url_item);
  return ano !== null && ano < anoCorrente;
}
