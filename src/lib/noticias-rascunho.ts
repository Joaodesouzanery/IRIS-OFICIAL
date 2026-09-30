/**
 * O RASCUNHO da tela de Notícias — o que sobrevive a sair da página.
 *
 * ═══ O problema ═══
 * A seleção de notícias, o cache delas e TODO o texto editado (corpo, título, imagem, posts, minuto)
 * viviam só em `useState`. Sair da tela e voltar perdia tudo — inclusive meia hora de edição. Só a
 * configuração do documento era salva, e mesmo assim por um botão.
 *
 * ═══ Três cuidados que o formato carrega ═══
 *
 *  1. **O cache é PODADO aos selecionados.** `selectedNewsCache` recebe TODA notícia de TODA página
 *     já carregada (o efeito da tela empurra o resultado de cada consulta para lá): persistir o cache
 *     inteiro cresceria sem limite até estourar a cota do `localStorage`, e o que quebra por cota
 *     quebra em silêncio. Só o que está selecionado precisa sobreviver — é ele que a tela não
 *     conseguiria reconstruir se o filtro mudasse.
 *
 *  2. **O conteúdo é CORTADO.** O corpo integral de uma notícia chega a dezenas de KB e a tela não
 *     usa mais que os primeiros milhares de caracteres (`NEWSLETTER_ARTICLE_TEXT_LIMITS` tem teto de
 *     3.000). Guardar o texto inteiro seria pagar cota por caractere que ninguém lê.
 *
 *  3. **O rascunho VENCE.** Um rascunho de semanas atrás reaparecendo sem aviso é pior que não ter
 *     rascunho: a pessoa monta a newsletter em cima de uma seleção que não lembra ter feito. Depois
 *     de `VALIDADE_DIAS` ele é descartado na leitura.
 *
 * ⚠️ O módulo é PURO. Quem toca em `localStorage` é a tela, com `try/catch` — a cota estoura, a aba
 * anônima recusa, e nenhum desses casos pode derrubar a página.
 */

export const RASCUNHO_KEY = "iris_noticias_rascunho";
export const RASCUNHO_VERSAO = 1;
/** Depois disto o rascunho é descartado em silêncio na leitura. */
export const VALIDADE_DIAS = 14;
/** Teto do corpo guardado por notícia — acima disso a tela já não usa. */
export const TETO_CONTEUDO = 4_000;
/** Teto de notícias no cache: a newsletter tem 3 por página e o minuto é curto. */
export const TETO_NOTICIAS = 30;

/**
 * A notícia guardada, do ponto de vista do rascunho: um OBJETO, sem exigir a forma de
 * `RegulatoryNews`.
 *
 * ⚠️ É de propósito que o tipo seja fraco aqui. O que sai do `localStorage` é JSON que alguém pode
 * ter editado à mão, e prometer `RegulatoryNews` na saída seria uma promessa que este módulo não
 * pode cumprir. O módulo só toca `conteudo`/`resumo` para cortar, e cada um deles é checado como
 * string antes de ser cortado.
 */
export type NoticiaNoRascunho = object;

export interface RascunhoDeNoticias {
  v: number;
  salvo_em: string;
  newsletterSelectedIds: string[];
  minutoSelectedIds: string[];
  cache: Record<string, NoticiaNoRascunho>;
  newsletterArticleTexts: Record<string, string>;
  newsletterArticleTitles: Record<string, string>;
  newsletterImagens: Record<string, string | null>;
  minutoTextos: string;
  socialPosts: unknown[];
}

export interface EstadoDaTela {
  newsletterSelectedIds: string[];
  minutoSelectedIds: string[];
  cache: Record<string, NoticiaNoRascunho>;
  newsletterArticleTexts: Record<string, string>;
  newsletterArticleTitles: Record<string, string>;
  newsletterImagens: Record<string, string | null>;
  minutoTextos: string;
  socialPosts: unknown[];
}

/** Há algo que valha guardar? Rascunho vazio só ocuparia espaço e confundiria a leitura. */
export function temAlgoParaGuardar(estado: EstadoDaTela): boolean {
  return (
    estado.newsletterSelectedIds.length > 0
    || estado.minutoSelectedIds.length > 0
    || estado.socialPosts.length > 0
    || estado.minutoTextos.trim().length > 0
  );
}

/** Monta o rascunho: poda o cache aos selecionados, corta o corpo e carimba a hora. */
export function montarRascunho(estado: EstadoDaTela, agora: Date): RascunhoDeNoticias {
  const selecionados = new Set([...estado.newsletterSelectedIds, ...estado.minutoSelectedIds]);
  const cache: Record<string, NoticiaNoRascunho> = {};
  let guardadas = 0;
  for (const id of selecionados) {
    if (guardadas >= TETO_NOTICIAS) break;
    const noticia = estado.cache[id];
    if (!noticia) continue;
    const podada: Record<string, unknown> = { ...(noticia as Record<string, unknown>) };
    for (const campo of ["conteudo", "resumo"]) {
      const valor = podada[campo];
      if (typeof valor === "string" && valor.length > TETO_CONTEUDO) {
        podada[campo] = valor.slice(0, TETO_CONTEUDO);
      }
    }
    cache[id] = podada;
    guardadas += 1;
  }

  /** Só o override de quem continua selecionado — texto de notícia solta é lixo que cresce. */
  const sob = <T,>(mapa: Record<string, T>): Record<string, T> =>
    Object.fromEntries(Object.entries(mapa).filter(([id]) => selecionados.has(id)));

  return {
    v: RASCUNHO_VERSAO,
    salvo_em: agora.toISOString(),
    newsletterSelectedIds: estado.newsletterSelectedIds,
    minutoSelectedIds: estado.minutoSelectedIds,
    cache,
    newsletterArticleTexts: sob(estado.newsletterArticleTexts),
    newsletterArticleTitles: sob(estado.newsletterArticleTitles),
    newsletterImagens: sob(estado.newsletterImagens),
    minutoTextos: estado.minutoTextos,
    socialPosts: estado.socialPosts,
  };
}

/**
 * Lê o rascunho guardado, ou `null`.
 *
 * ⚠️ Devolve `null` — e não um rascunho parcial — em QUALQUER dúvida: JSON inválido, versão
 * diferente, vencido, ou formato que não bate. Restaurar meia estrutura é pior que não restaurar:
 * a tela abriria com seleção sem cache, e a pessoa veria notícias em branco sem saber por quê.
 */
export function lerRascunho(cru: string | null | undefined, agora: Date): RascunhoDeNoticias | null {
  if (!cru) return null;
  let dado: unknown;
  try {
    dado = JSON.parse(cru);
  } catch {
    return null;
  }
  if (!dado || typeof dado !== "object" || Array.isArray(dado)) return null;
  const r = dado as Partial<RascunhoDeNoticias>;
  if (r.v !== RASCUNHO_VERSAO) return null;

  const salvoEm = Date.parse(String(r.salvo_em ?? ""));
  if (!Number.isFinite(salvoEm)) return null;
  const dias = (agora.getTime() - salvoEm) / 86_400_000;
  // Rascunho do FUTURO também é descartado: relógio torto é dúvida, e dúvida devolve null.
  if (dias < 0 || dias > VALIDADE_DIAS) return null;

  const lista = (v: unknown): string[] =>
    Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
  const mapa = <T,>(v: unknown): Record<string, T> =>
    v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, T>) : {};

  return {
    v: RASCUNHO_VERSAO,
    salvo_em: String(r.salvo_em),
    newsletterSelectedIds: lista(r.newsletterSelectedIds),
    minutoSelectedIds: lista(r.minutoSelectedIds),
    cache: mapa<NoticiaNoRascunho>(r.cache),
    newsletterArticleTexts: mapa<string>(r.newsletterArticleTexts),
    newsletterArticleTitles: mapa<string>(r.newsletterArticleTitles),
    newsletterImagens: mapa<string | null>(r.newsletterImagens),
    minutoTextos: typeof r.minutoTextos === "string" ? r.minutoTextos : "",
    socialPosts: Array.isArray(r.socialPosts) ? r.socialPosts : [],
  };
}
