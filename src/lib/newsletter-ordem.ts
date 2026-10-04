/**
 * A ORDEM das notícias na Newsletter — e por que trocá-la é trocar a POSIÇÃO no layout.
 *
 * A Newsletter é paginada de 3 em 3: índice 0 de cada página é a "Principal esquerda", 1 e 2 são
 * as "Laterais" (`newsletterArticlePositionLabel`). A ordem de `newsletterSelectedIds` É o layout:
 * mover uma notícia uma posição acima pode promovê-la a principal, ou levá-la para a página
 * anterior. Tudo o que é editado por notícia (texto, título, imagem, justificar) é chave por `id`,
 * então VIAJA com ela — nada se perde ao mover.
 *
 * ⚠️ O que muda com a posição é o LIMITE do texto: a principal comporta mais que a lateral. O texto
 * editado não é cortado no estado (mover de volta o restaura inteiro); o corte acontece só no
 * documento gerado, e a tela avisa quando o texto excede o espaço da posição nova.
 */

/**
 * Move `id` uma posição na direção `delta` (-1 = sobe, +1 = desce), saltando ids INVISÍVEIS.
 *
 * ⚠️ Por que saltar invisíveis: `newsletterSelectedIds` pode conter um id cuja notícia ainda não
 * está no cache (a tela a filtra). Trocar com ele seria um clique que não muda nada na tela —
 * a lista exibida ficaria igual. A troca é com o vizinho VISÍVEL mais próximo, e os invisíveis
 * ficam exatamente onde estavam.
 *
 * Devolve o MESMO array quando não há para onde mover (topo, fundo, id ausente) — assim o
 * `setState` não dispara re-render nem marca a edição como alterada à toa.
 */
export function moverNaOrdem(
  ids: readonly string[],
  id: string,
  delta: -1 | 1,
  visivel: (id: string) => boolean = () => true,
): readonly string[] {
  const i = ids.indexOf(id);
  if (i < 0) return ids;
  let j = i + delta;
  while (j >= 0 && j < ids.length && !visivel(ids[j])) j += delta;
  if (j < 0 || j >= ids.length) return ids;
  const out = [...ids];
  out[i] = ids[j];
  out[j] = ids[i];
  return out;
}
