/**
 * Etapa 202 (Fase 35, Bloco A.3) — o laço infinito de `/api/v1/auth/me`.
 *
 * ═══ O ciclo, e a peça da lib que o fechava ═══
 * O `useEffect` do `/login` tinha `sessaoInvalida` nas DEPENDÊNCIAS, e o ramo do listener não tinha a
 * guarda `!sessaoInvalida` que o ramo irmão (`getSession().then`) tinha quatro linhas acima.
 *
 * A peça que fechava o ciclo está no `@supabase/auth-js` instalado: `onAuthStateChange` faz
 * `_emitInitialSession(id)` para CADA subscriber novo — ou seja, re-assinar reemite `INITIAL_SESSION`
 * com a sessão do cookie. Com cookie presente e token recusado pelo servidor:
 *
 *   INITIAL_SESSION → zera a flag → entrar() → 401 → liga a flag → o efeito RE-EXECUTA (a flag está
 *   nas dependências) → unsubscribe + subscribe → NOVO INITIAL_SESSION → … sem fim
 *
 * Cada volta é um `GET /api/v1/auth/me`, e cada um desses faz `getUser(token)` no servidor: um
 * round-trip ao Supabase por iteração, em rota sem rate limit. Auto-DoS; na tela, travamento.
 *
 * ⚠️ E havia um segundo defeito no mesmo efeito, no caminho FELIZ: `getSession().then` e o
 * `INITIAL_SESSION` do listener chamavam `entrar()` EM PARALELO em toda visita. Dois `/auth/me`, dois
 * `router.replace`, e no primeiro login do owner dois POST concorrentes em `bootstrap-owner` — cuja
 * corrida no `upsertAdminUser` (SELECT-depois-INSERT) falha em SILÊNCIO, porque o resultado é
 * ignorado por desenho.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";

const RAIZ = join(__dirname, "../../../..");
const ler = (p: string) => readFileSync(join(RAIZ, p), "utf-8");
const semComentarios = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/\/\/[^\n]*/g, " ");

const LOGIN = semComentarios(ler("src/app/login/page.tsx"));

/** O corpo do `useEffect` que assina o `onAuthStateChange`, e o array de dependências dele. */
function efeitoDaAssinatura(): { corpo: string; deps: string[] } {
  const i = LOGIN.indexOf("onAuthStateChange");
  expect(i, "o efeito que assina o onAuthStateChange desapareceu").toBeGreaterThan(-1);
  const inicioEfeito = LOGIN.lastIndexOf("useEffect(", i);
  expect(inicioEfeito, "o onAuthStateChange saiu de dentro de um useEffect").toBeGreaterThan(-1);

  /**
   * ⚠️ O fecho é `}, [deps]);`, NÃO `});` — a primeira versão desta função procurava `});` e caía
   * num fecho de outra função mais abaixo, devolvendo dependências vazias. A busca agora é pelo
   * PADRÃO do fecho com array, a partir do `unsubscribe` do cleanup.
   */
  const daLimpeza = LOGIN.indexOf("unsubscribe", i);
  expect(daLimpeza, "o cleanup do listener sumiu — vazamento de subscriber").toBeGreaterThan(-1);
  const resto = LOGIN.slice(daLimpeza);
  const fecho = resto.match(/\}\s*,\s*\[([^\]]*)\]\s*\)/);
  expect(fecho, "não achei o array de dependências do efeito").not.toBeNull();

  const corpo = LOGIN.slice(inicioEfeito, daLimpeza + (fecho?.index ?? 0));
  const deps = (fecho?.[1] ?? "")
    .split(",")
    .map((d) => d.trim())
    .filter(Boolean);
  return { corpo, deps };
}

describe("etapa202 · ⚠️ o efeito não pode RE-EXECUTAR por causa da própria flag", () => {
  it("`sessaoInvalida` NÃO está nas dependências — era ela que fechava o ciclo", () => {
    const { deps } = efeitoDaAssinatura();
    expect(deps, "o efeito perdeu o array de dependências").not.toEqual([]);
    expect(deps, "`sessaoInvalida` voltou às dependências — o laço volta com ela").not.toContain(
      "sessaoInvalida",
    );
  });

  it("e o valor é lido por `ref` dentro do callback, que é o que dispensa a dependência", () => {
    const { corpo } = efeitoDaAssinatura();
    expect(corpo, "o listener parou de consultar a flag — o 401 volta a se repetir").toMatch(
      /sessaoInvalidaRef\.current/,
    );
  });

  it("⚠️ o listener SAI quando a sessão já foi recusada — a guarda que faltava neste ramo", () => {
    const { corpo } = efeitoDaAssinatura();
    // A propriedade: existe uma saída ANTES de `entrar`, condicionada à flag.
    const posGuarda = corpo.indexOf("sessaoInvalidaRef.current");
    const posEntrar = corpo.indexOf("entrar(");
    expect(posGuarda, "a guarda sumiu").toBeGreaterThan(-1);
    expect(posEntrar, "o efeito parou de chamar entrar()").toBeGreaterThan(-1);
    expect(posGuarda, "a guarda precisa vir ANTES de entrar()").toBeLessThan(posEntrar);
  });
});

describe("etapa202 · ⚠️ `entrar()` uma vez por visita, não duas", () => {
  it("o efeito chama `entrar(` exatamente UMA vez", () => {
    const { corpo } = efeitoDaAssinatura();
    const chamadas = (corpo.match(/entrar\(/g) ?? []).length;
    expect(chamadas, "duas chamadas = dois /auth/me e dois bootstrap-owner concorrentes").toBe(1);
  });

  it("o `getSession()` redundante saiu — o INITIAL_SESSION já cobre o caso", () => {
    expect(LOGIN, "`getSession()` voltou ao login: com o listener, ele duplica a entrada")
      .not.toMatch(/auth\.getSession\(\)/);
  });
});

describe("etapa202 · o `ref` não pode dessincronizar do estado", () => {
  it("TODA escrita da flag passa pelo escritor único", () => {
    /**
     * ⚠️ É a propriedade que sustenta a leitura por `ref`. Um `ref` escrito em alguns lugares e
     * esquecido em outros é pior que a dependência que ele substituiu: a guarda passaria a decidir
     * por um valor velho. Por isso a contagem, e não um `toMatch` de existência — foi a lição da
     * `etapa197`.
     */
    const direto = (LOGIN.match(/setSessaoInvalida\(/g) ?? []).length;
    // Um único uso legítimo: dentro de `marcarSessaoInvalida`.
    expect(direto, "há escrita direta de setSessaoInvalida fora do escritor único").toBe(1);
    const dentroDoEscritor = LOGIN.slice(
      LOGIN.indexOf("marcarSessaoInvalida = useCallback"),
      LOGIN.indexOf("marcarSessaoInvalida = useCallback") + 200,
    );
    expect(dentroDoEscritor).toMatch(/sessaoInvalidaRef\.current = valor/);
    expect(dentroDoEscritor).toMatch(/setSessaoInvalida\(valor\)/);
  });

  it("o escritor é ESTÁVEL — senão ele mesmo reintroduz a re-execução", () => {
    const i = LOGIN.indexOf("marcarSessaoInvalida = useCallback");
    const trecho = LOGIN.slice(i, i + 260);
    expect(trecho, "o useCallback do escritor ganhou dependências e deixou de ser estável")
      .toMatch(/\}\s*,\s*\[\s*\]\s*\)/);
  });

  it("e `entrar` continua estável, para o efeito assinar uma vez", () => {
    // `entrar` entra nas dependências do efeito; se ele mudar a cada render, o laço volta por outro
    // caminho. As três dependências dele são estáveis (memo, router, callback vazio).
    const i = LOGIN.indexOf("router.replace(next)");
    const trecho = LOGIN.slice(i, i + 200);
    expect(trecho).toMatch(/\[next, router, marcarSessaoInvalida\]/);
    expect(LOGIN, "`next` voltou a ser recalculado a cada render").toMatch(
      /const next = useMemo\(/,
    );
  });
});

describe("etapa202 · ⚠️ a premissa do diagnóstico, conferida na LIB INSTALADA", () => {
  /**
   * Se um upgrade do `@supabase/auth-js` parar de reemitir `INITIAL_SESSION` por subscriber, o
   * mecanismo descrito acima muda — e o comentário do `login/page.tsx` passa a mentir. Esta
   * expectativa é o que torna o diagnóstico falsificável em vez de folclore.
   */
  it("`onAuthStateChange` reemite a sessão inicial para CADA subscriber novo", () => {
    const GOTRUE = ler("node_modules/@supabase/auth-js/dist/main/GoTrueClient.js");
    const i = GOTRUE.indexOf("onAuthStateChange(callback)");
    expect(i, "a assinatura de onAuthStateChange mudou — revise o diagnóstico do laço").toBeGreaterThan(-1);
    expect(GOTRUE.slice(i, i + 900)).toMatch(/_emitInitialSession\(id\)/);
  });

  it("e a sessão emitida vem do armazenamento, que é o cookie — por isso o token recusado volta", () => {
    const GOTRUE = ler("node_modules/@supabase/auth-js/dist/main/GoTrueClient.js");
    const i = GOTRUE.indexOf("async _emitInitialSession(id)");
    expect(i).toBeGreaterThan(-1);
    expect(GOTRUE.slice(i, i + 500)).toMatch(/_useSession/);
    expect(GOTRUE.slice(i, i + 700)).toMatch(/callback\('INITIAL_SESSION', session\)/);
  });
});
