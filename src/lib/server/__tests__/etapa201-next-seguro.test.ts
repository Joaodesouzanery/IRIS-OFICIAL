/**
 * Etapa 201 (Fase 35, Bloco A.1) — o open redirect, e o filtro que eu ia escrever no lugar.
 *
 * ═══ O defeito ═══
 * `auth/callback/route.ts` e `login/page.tsx` liam `?next=` e redirecionavam SEM validar.
 * `new URL(next, base)` só usa a base quando `next` é relativo, então `?next=https://evil.com`
 * redirecionava para fora — server-side, em rota PÚBLICA, no fluxo de magic link e de recuperação de
 * senha.
 *
 * ═══ ⚠️ E o conserto que eu PROPUS estava furado ═══
 * A primeira proposta foi `next.startsWith("/") && !next.startsWith("//")`. O usuário testou e
 * derrubou: o parser de URL trata `\` como `/` e REMOVE tab/newline antes de resolver. Medido:
 *
 *   "/\\evil.com"   passa o filtro por prefixo  →  https://evil.com
 *   "/\t/evil.com"  passa o filtro por prefixo  →  https://evil.com
 *
 * Por isso este teste exerce as DUAS coisas: que os payloads são recusados, e — o que importa mais —
 * que a recusa vem de comparar ORIGEM RESOLVIDA, não de proibir formas. Uma lista de formas proibidas
 * é uma corrida que se perde; a origem é invariante.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";
import { sanitizeNext, DESTINO_PADRAO, ORIGEM_SINTETICA } from "../../next-seguro";

const RAIZ = join(__dirname, "../../../..");
const ler = (p: string) => readFileSync(join(RAIZ, p), "utf-8");
const semComentarios = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/\/\/[^\n]*/g, " ");

const ORIGEM = "https://iris.app";

describe("etapa201 · o que NÃO pode sair da origem", () => {
  /**
   * ⚠️ Os dois primeiros são os que o usuário mediu e que o filtro por prefixo aceitava. Os demais
   * cobrem as variantes vizinhas, para o conserto não valer só para os dois casos citados.
   */
  const PERIGOSOS = [
    "//evil.com",
    "/\\evil.com",
    "/\t/evil.com",
    "/\n/evil.com",
    "/\r/evil.com",
    "\\\\evil.com",
    "https://evil.com",
    "https://evil.com/phish",
    "http://evil.com",
    "//evil.com/dashboard/painel-regulatorio",
    "/\\/evil.com",
    "javascript:alert(1)",
    "data:text/html,<script>alert(1)</script>",
    "https://iris.app.evil.com/x",
  ];

  for (const payload of PERIGOSOS) {
    it(`recusa ${JSON.stringify(payload)} e cai no padrão`, () => {
      expect(sanitizeNext(payload, ORIGEM)).toBe(DESTINO_PADRAO);
    });
  }

  it("⚠️ e cada um deles ESCAPARIA do filtro por prefixo OU da ingenuidade do new URL", () => {
    // Esta expectativa existe para documentar o perigo, não para louvar o conserto: se algum dia
    // alguém trocar a função por um filtro de forma, este caso mostra o que volta a passar.
    const filtroPorPrefixo = (n: string) => n.startsWith("/") && !n.startsWith("//");
    const escapamPeloPrefixo = PERIGOSOS.filter((p) => {
      if (!filtroPorPrefixo(p)) return false;
      try {
        return new URL(p, ORIGEM).origin !== ORIGEM;
      } catch {
        return false;
      }
    });
    // Os dois que o usuário mediu, mais as variantes de barra invertida e CR.
    expect(escapamPeloPrefixo.length, "o filtro por prefixo deixaria estes passarem").toBeGreaterThanOrEqual(2);
    expect(escapamPeloPrefixo).toContain("/\\evil.com");
    expect(escapamPeloPrefixo).toContain("/\t/evil.com");
  });
});

describe("etapa201 · o que PODE, e continua funcionando", () => {
  it("caminho relativo comum passa intacto", () => {
    expect(sanitizeNext("/dashboard/painel-regulatorio", ORIGEM)).toBe("/dashboard/painel-regulatorio");
    expect(sanitizeNext("/dashboard/deliberacoes/votos-diretores", ORIGEM)).toBe(
      "/dashboard/deliberacoes/votos-diretores",
    );
  });

  it("query e hash sobrevivem — senão o deep-link do painel quebra", () => {
    expect(sanitizeNext("/dashboard/agencias?sigla=ANTT", ORIGEM)).toBe("/dashboard/agencias?sigla=ANTT");
    expect(sanitizeNext("/dashboard/x?a=1&b=2#topo", ORIGEM)).toBe("/dashboard/x?a=1&b=2#topo");
  });

  it("URL ABSOLUTA da própria origem é aceita — e volta relativa", () => {
    expect(sanitizeNext("https://iris.app/dashboard/x?q=1", ORIGEM)).toBe("/dashboard/x?q=1");
  });

  /**
   * ⚠️ CORREÇÃO DE UMA EXPECTATIVA MINHA. Eu havia listado isto como payload perigoso. Não é: em
   * `https://evil.com@iris.app/x` o `evil.com` é USERINFO, e o host real é `iris.app` — a origem
   * resolvida é a nossa. Devolver `/x` é o comportamento certo, e de quebra a reconstrução JOGA FORA
   * o userinfo que fazia a URL parecer de outro site. Foi a validação por resolução que acertou onde
   * a minha leitura errou; um filtro por forma teria "acertado" recusando, por engano.
   */
  it("userinfo NÃO é host: `https://evil.com@iris.app/x` resolve na nossa origem e vale", () => {
    expect(sanitizeNext("https://evil.com@iris.app/x", ORIGEM)).toBe("/x");
  });

  it("origem com barra final compara igual — normalização dos dois lados", () => {
    expect(sanitizeNext("/dashboard/x", "https://iris.app/")).toBe("/dashboard/x");
  });

  it("ausente, vazio ou só espaço cai no padrão", () => {
    expect(sanitizeNext(null, ORIGEM)).toBe(DESTINO_PADRAO);
    expect(sanitizeNext(undefined, ORIGEM)).toBe(DESTINO_PADRAO);
    expect(sanitizeNext("", ORIGEM)).toBe(DESTINO_PADRAO);
    expect(sanitizeNext("   ", ORIGEM)).toBe(DESTINO_PADRAO);
  });

  it("origem inválida não explode — cai no padrão", () => {
    expect(sanitizeNext("/dashboard/x", "não-é-url")).toBe(DESTINO_PADRAO);
  });

  it("aceita padrão próprio, para quem redireciona para outro lugar", () => {
    expect(sanitizeNext("//evil.com", ORIGEM, "/login")).toBe("/login");
  });
});

describe("etapa201 · a base sintética da renderização no servidor", () => {
  it("caminho relativo valida IGUAL no servidor e no navegador — é o caso real do `?next=`", () => {
    expect(sanitizeNext("/dashboard/x", ORIGEM_SINTETICA)).toBe("/dashboard/x");
    expect(sanitizeNext("/dashboard/x?a=1#b", ORIGEM_SINTETICA)).toBe("/dashboard/x?a=1#b");
  });

  it("e os payloads perigosos continuam recusados sob ela", () => {
    expect(sanitizeNext("//evil.com", ORIGEM_SINTETICA)).toBe(DESTINO_PADRAO);
    expect(sanitizeNext("/\\evil.com", ORIGEM_SINTETICA)).toBe(DESTINO_PADRAO);
    expect(sanitizeNext("/\t/evil.com", ORIGEM_SINTETICA)).toBe(DESTINO_PADRAO);
  });
});

describe("etapa201 · a validação é por RESOLUÇÃO, não por forma", () => {
  it("nenhuma comparação de prefixo decide o veredito", () => {
    const FONTE = semComentarios(ler("src/lib/next-seguro.ts"));
    expect(FONTE, "voltou a decidir por startsWith — o bypass da barra invertida volta com ele")
      .not.toMatch(/startsWith\(\s*["']\/\/["']\s*\)/);
    // O que DEVE existir: comparação de origem resolvida.
    expect(FONTE).toMatch(/alvo\.origin !== base\.origin/);
    // E o destino é RECONSTRUÍDO, nunca o texto cru devolvido.
    expect(FONTE).toMatch(/\$\{alvo\.pathname\}\$\{alvo\.search\}\$\{alvo\.hash\}/);
    expect(FONTE, "devolver o `next` cru anula a reconstrução").not.toMatch(/return next\b/);
  });
});

describe("etapa201 · os dois pontos de uso passaram a validar", () => {
  it("`auth/callback` redireciona pelo caminho saneado, não pelo query cru", () => {
    const CALLBACK = semComentarios(ler("src/app/auth/callback/route.ts"));
    expect(CALLBACK).toMatch(/sanitizeNext\(/);
    /**
     * ⚠️ A propriedade é "nenhum `next` cru chega ao redirect", não "existe uma chamada".
     * Contar ocorrências é o que impede o caso em que alguém acrescenta um segundo redirect e só o
     * primeiro está saneado — foi essa a lição da `etapa197`.
     */
    const redirects = (CALLBACK.match(/NextResponse\.redirect\(/g) ?? []).length;
    const crus = (CALLBACK.match(/NextResponse\.redirect\(\s*new URL\(\s*next\b/g) ?? []).length;
    expect(redirects, "a rota deveria ter ao menos um redirect").toBeGreaterThanOrEqual(1);
    expect(crus, "um redirect voltou a usar o `next` cru").toBe(0);
  });

  it("o `login` sanea ANTES de guardar o destino — os dois usos herdam um só valor", () => {
    const LOGIN = semComentarios(ler("src/app/login/page.tsx"));
    expect(LOGIN).toMatch(/sanitizeNext\(/);
    // `router.replace(next)` aparece em dois lugares (efeito e botão). Os dois só são seguros se
    // `next` JÁ for o valor saneado — por isso a checagem é na origem do valor, não em cada uso.
    expect(LOGIN, "o destino voltou a sair cru do query string")
      .not.toMatch(/const next = searchParams\.get\("next"\) \?\? /);
    const replaces = (LOGIN.match(/router\.replace\(next\)/g) ?? []).length;
    expect(replaces, "os usos de router.replace(next) mudaram — reveja se todos usam o saneado")
      .toBeGreaterThanOrEqual(1);
  });
});
