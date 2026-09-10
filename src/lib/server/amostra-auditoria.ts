/**
 * A amostra de auditoria — "os documentos estão certos?" vira uma pergunta com resposta (Fase 26).
 *
 * Certificação (46 expectativas em PDFs reais) e cobertura ao vivo dizem que a EXTRAÇÃO e a
 * COLETA funcionam nas fixtures e nos sites. O que nenhuma das duas diz é se a deliberação que
 * está no banco hoje bate com o PDF de onde veio. A resposta honesta é conferir ALGUMAS ao acaso
 * contra o original — foi o que pegou os erros desta série. Aqui isso vira rotina de um clique.
 *
 * Determinístico por dia (seed = data + agência): a mesma amostra durante o dia, outra amanhã;
 * `seed` explícito para "outra amostra".
 */

/** PRNG pequeno e determinístico (mulberry32). */
export function prng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function seedDe(texto: string): number {
  let h = 2166136261;
  for (const ch of texto) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619); }
  return h >>> 0;
}

/** `n` elementos ao acaso, sem repetição, reproduzíveis pelo seed. */
export function amostrar<T>(itens: T[], n: number, seed: number): T[] {
  const r = prng(seed);
  const copia = [...itens];
  for (let i = copia.length - 1; i > 0; i--) {
    const j = Math.floor(r() * (i + 1));
    [copia[i], copia[j]] = [copia[j], copia[i]];
  }
  return copia.slice(0, Math.max(0, Math.min(n, copia.length)));
}
