/**
 * `sanitizeNext` — para onde o login pode mandar o usuário depois de entrar.
 *
 * ═══ Por que NÃO dá para validar por prefixo ═══
 * O caminho óbvio é `next.startsWith("/") && !next.startsWith("//")`. Ele é TEATRO, e a medição
 * (Fase 35, no Node do projeto) mostra por quê — o parser de URL trata `\` como `/` e REMOVE tab e
 * newline antes de resolver, então dois payloads passam pelo filtro e escapam da origem:
 *
 *   next                 filtro por prefixo   origem resultante
 *   "/dashboard/x"       passa                https://iris.app     ok
 *   "//evil.com"         barra                https://evil.com     ok
 *   "/\\evil.com"        PASSA                https://evil.com     <== bypass
 *   "/\t/evil.com"       PASSA                https://evil.com     <== bypass
 *
 * Por isso a validação é por RESOLUÇÃO: resolve a URL contra a origem do site, exige que a origem
 * resultante seja a MESMA, e reconstrói o destino a partir de `pathname + search + hash` — nunca do
 * texto cru que chegou. Assim qualquer variante futura de encoding (mais barras, mais espaços de
 * controle, esquema exótico) morre na comparação de origem, e não numa lista de formas proibidas que
 * alguém teria de manter para sempre.
 *
 * ⚠️ Esquema não-http (`javascript:`, `data:`) resolve com origem `"null"`, que nunca casa com a
 * origem do site — logo cai no padrão pelo MESMO caminho, sem precisar de regra própria.
 *
 * ═══ Onde isso morde ═══
 * `/auth/callback` é rota PÚBLICA e server-side, no fluxo de magic link e de recuperação de senha:
 * `NextResponse.redirect(new URL(next, origin))` com `next` absoluto redireciona para fora, porque
 * `new URL(next, base)` só usa a base quando `next` é relativo. Um link de recuperação de senha que
 * termina no site de um atacante é a forma mais explorável deste defeito.
 */

/** Destino de quem entra sem pedir um caminho específico. */
export const DESTINO_PADRAO = "/dashboard/painel-regulatorio";

/**
 * Devolve um caminho RELATIVO seguro para redirecionar, ou `padrao` quando o pedido não resolve
 * dentro da própria origem.
 *
 * @param next   o valor cru do query string (pode ser nulo, vazio, absoluto ou malformado)
 * @param origin a origem do site (`window.location.origin` no cliente, `requestUrl.origin` no server)
 */
export function sanitizeNext(
  next: string | null | undefined,
  origin: string,
  padrao: string = DESTINO_PADRAO,
): string {
  if (typeof next !== "string" || next.trim() === "") return padrao;

  // A origem também é normalizada: "https://iris.app/" e "https://iris.app" têm de comparar igual.
  let base: URL;
  try {
    base = new URL(origin);
  } catch {
    return padrao;
  }

  let alvo: URL;
  try {
    alvo = new URL(next, base);
  } catch {
    return padrao;
  }

  if (alvo.origin !== base.origin) return padrao;

  /**
   * ⚠️ CHECAR A ORIGEM DA ENTRADA NÃO BASTA — e esta foi a segunda vez que eu errei aqui.
   *
   * `?next=https://iris.app//evil.com` tem a NOSSA origem (o host é `iris.app`), então passa na
   * comparação acima. Mas o `pathname` dele é `//evil.com`, e era isso que esta função devolvia. O
   * consumidor então faz `router.replace("//evil.com")` / `new URL("//evil.com", origin)` — e `//host`
   * é PROTOCOLO-RELATIVO: resolve para `https://evil.com`. Medido:
   *
   *   next                              devolvia      consumidor resolvia para
   *   "https://iris.app//evil.com"      "//evil.com"  https://evil.com    <== bypass
   *   "https://iris.app//evil.com/x"    "//evil.com/x" https://evil.com   <== bypass
   *
   * Duas defesas, e a segunda é a que fecha a CLASSE:
   *
   *  (1) colapsar as barras iniciais — um caminho interno nunca precisa de duas;
   *  (2) RE-VALIDAR O QUE SE DEVOLVE, resolvendo o resultado contra a base outra vez. Validar só a
   *      entrada deixa passar tudo que a própria transformação for capaz de produzir; validar a saída
   *      é a única forma de afirmar algo sobre ela. Se eu tivesse feito isto na primeira vez, o
   *      `//evil.com` teria morrido sem eu precisar imaginá-lo.
   */
  const caminho = `${alvo.pathname}${alvo.search}${alvo.hash}`.replace(/^[/\\]+/, "/");
  if (!caminho.startsWith("/")) return padrao;

  let conferido: URL;
  try {
    conferido = new URL(caminho, base);
  } catch {
    return padrao;
  }
  if (conferido.origin !== base.origin) return padrao;

  return caminho;
}

/**
 * Base sintética para a renderização no servidor de um componente cliente.
 *
 * ⚠️ Ela é usada como base E como alvo da comparação, então CAMINHO RELATIVO valida igual no
 * servidor e no navegador — que é o caso real (o `?next=` do middleware é sempre relativo). Só URL
 * absoluta divergiria, e para pior: no servidor ela cai no padrão. Preferir o lado seguro aqui é de
 * graça, porque `next` não entra em nada renderizado — só no destino do `router.replace`.
 */
export const ORIGEM_SINTETICA = "https://origem.invalida";

/** `window.location.origin` quando há navegador; a base sintética na renderização do servidor. */
export function origemDoNavegador(): string {
  return typeof window === "undefined" ? ORIGEM_SINTETICA : window.location.origin;
}
