/**
 * Etapa 187 (Fase 32) — SEC-15: a auditoria de autorização vira TESTE.
 *
 * ═══ Por que este arquivo existe ═══
 * A superfície de autorização deste projeto nunca teve teste. Medido antes de escrever:
 *
 *   · `src/middleware.ts` tinha ZERO testes — nenhum import, nenhuma execução;
 *   · dos 7 arquivos que citavam `request-guards`, TODOS faziam `vi.mock` para **desligar** o
 *     guard e poder testar a regra de negócio. **Nenhum verificava que o guard NEGA.**
 *
 * `docs/PENDENCIAS.md` registra isso como **SEC-15**, deferido duas vezes. O custo do deferimento
 * apareceu: a rota `admin/cobertura-documentos` ficou meses sendo a única das 15 sob `/api/v1/admin/`
 * sem `requireAdmin`, com um comentário afirmando que estava protegida. Ninguém notou porque nada
 * olhava.
 *
 * ═══ A ideia central: SUPERFÍCIE DECLARADA ═══
 * O ponto não é "tudo tem de ser admin" — o usuário decidiu que **quem ele cria no Supabase vê o
 * acervo inteiro**, e isso é legítimo: são atos públicos de agentes públicos, e o acesso é concedido
 * a dedo no painel.
 *
 * O ponto é que a superfície **não pode crescer sem ninguém ver**. Cada rota está declarada abaixo
 * como `admin` ou `viewer`. Rota nova que não esteja na lista **reprova**. Rota que mude de lado
 * sem a lista mudar junto **reprova**. A decisão pode ser ampla; o que ela não pode é ser acidental.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { readFileSync, readdirSync, statSync } from "fs";
import { join } from "path";
import { NextRequest } from "next/server";

const RAIZ = join(__dirname, "../../../..");
const ler = (p: string) => readFileSync(join(RAIZ, p), "utf-8");
const semComentarios = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/\/\/[^\n]*/g, " ");

const METODOS_DE_ESCRITA = ["POST", "PUT", "PATCH", "DELETE"] as const;
const GUARDS = /(requireAdminOrCron|requireAdmin|requireCron)\s*\(/;

interface Rota {
  rota: string;
  caminho: string;
  metodos: Set<string>;
  /** Guard POR HANDLER — direto ou por delegação a quem tem. */
  guardDe: (metodo: string) => boolean;
}

/**
 * ⚠️ POR HANDLER, não por arquivo — e este foi o furo que deixou a Fase 35 achar um GET aberto.
 *
 * A versão anterior media a presença de guard no arquivo INTEIRO. Num `route.ts` com `GET` + `POST`
 * onde só o POST guardava, o GET contava como guardado. Foram **25 arquivos** nessa condição, e um
 * deles era `antt/2026/collect`, cujo GET dispara scraping headless de até 80 reuniões com
 * parâmetros do cliente — exatamente o "DoS de compute anônimo" que o POST do mesmo arquivo diz ter
 * fechado. A promessa deste teste ("a superfície não pode crescer sem ninguém ver") não valia para
 * nenhum GET que compartilhasse arquivo com um handler guardado.
 */
/**
 * ⚠️ POR HANDLER, não por arquivo — e este foi o furo que deixou a Fase 35 achar um GET aberto.
 *
 * A versão anterior media a presença de guard no arquivo INTEIRO. Num `route.ts` com `GET` + `POST`
 * onde só o POST guardava, o GET contava como guardado. Eram **25 arquivos** nessa condição, e um
 * deles era `antt/2026/collect`, cujo GET dispara scraping headless de até 80 reuniões com
 * parâmetros do cliente — exatamente o "DoS de compute anônimo" que o POST do mesmo arquivo diz ter
 * fechado. A promessa deste teste ("a superfície não pode crescer sem ninguém ver") não valia para
 * nenhum GET que compartilhasse arquivo com um handler guardado.
 *
 * ═══ Por que ALCANÇABILIDADE e não "tem guard no corpo" ═══
 * Oito handlers DELEGAM em vez de guardar: `PUT → PATCH`, `POST → GET`, `GET → run(req)`. Exigir o
 * guard no corpo reprovaria os oito; uma lista de "delegações confiáveis" escrita à mão diria
 * "confie". Isto faz o meio: monta o corpo de cada função do arquivo, marca quem chama guard, e
 * PROPAGA por ponto fixo por quem chama quem. Assim a cadeia de dois saltos de `noticias/coletar`
 * (`POST → collectSafely → collect`, com o guard só no último) resolve, e a afirmação segue sendo
 * conferida no código em vez de declarada.
 *
 * ⚠️ E a regex de declaração EXIGE a seta nas funções de `const`. Sem isso, `const body = (await
 * req.json())` de `upload/auto-confirm` era lido como declaração de função e cortava a fatia do POST
 * no meio — o `return run(req, body)` caía na fatia de "body" e o POST aparecia como desguardado.
 */
const DECLARACAO_DE_FUNCAO =
  /(?:function\s+(\w+)\s*\(|const\s+(\w+)\s*=\s*(?:async\s*)?(?:\([^)]*\)|\w+)\s*=>)/g;
const DELEGACAO = /(?:return|await|=)\s+(\w+)\s*\(/g;

/** Nomes de funções do arquivo que ALCANÇAM um guard — direto ou por delegação, a qualquer profundidade. */
function funcoesQueAlcancamGuard(fonte: string): Set<string> {
  const marcas = [...fonte.matchAll(DECLARACAO_DE_FUNCAO)].map((m) => ({
    nome: m[1] ?? m[2],
    inicio: m.index ?? 0,
  }));
  const corpos = new Map<string, string>();
  marcas.forEach((m, i) => {
    const fim = i + 1 < marcas.length ? marcas[i + 1].inicio : fonte.length;
    corpos.set(m.nome, fonte.slice(m.inicio, fim));
  });

  const alcanca = new Set<string>();
  for (const [nome, corpo] of corpos) if (GUARDS.test(corpo)) alcanca.add(nome);

  // Ponto fixo. Só liga `false → true`, então termina mesmo com recursão mútua.
  let mudou = true;
  while (mudou) {
    mudou = false;
    for (const [nome, corpo] of corpos) {
      if (alcanca.has(nome)) continue;
      const chamados = [...corpo.matchAll(DELEGACAO)].map((m) => m[1]);
      if (chamados.some((c) => c !== nome && alcanca.has(c))) {
        alcanca.add(nome);
        mudou = true;
      }
    }
  }
  return alcanca;
}

/** Varre `src/app/api` e devolve toda `route.ts` com seus métodos e o guard de CADA handler. */
function varrerRotas(): Rota[] {
  const achadas: Rota[] = [];
  const andar = (dir: string) => {
    for (const nome of readdirSync(join(RAIZ, dir))) {
      const rel = `${dir}/${nome}`;
      if (statSync(join(RAIZ, rel)).isDirectory()) { andar(rel); continue; }
      if (nome !== "route.ts") continue;
      const fonte = semComentarios(ler(rel));
      // Os métodos vêm dos EXPORTS — uma função interna chamada `GET` não é rota.
      const metodos = new Set(
        [...fonte.matchAll(/export async function (GET|POST|PUT|PATCH|DELETE)\b/g)].map((m) => m[1]),
      );
      const alcanca = funcoesQueAlcancamGuard(fonte);
      achadas.push({
        rota: "/" + rel.slice("src/app/".length, -"/route.ts".length),
        caminho: rel,
        metodos,
        guardDe: (metodo: string) => alcanca.has(metodo),
      });
    }
  };
  andar("src/app/api");
  return achadas;
}

const ROTAS = varrerRotas();

/**
 * ⚠️ As ÚNICAS rotas de escrita sem guard no arquivo — cada uma com o motivo.
 *
 * Acrescentar aqui é uma decisão de segurança, e o motivo fica escrito ao lado. Uma rota de escrita
 * nova que não tenha guard e não esteja aqui **reprova**.
 */
const ESCRITA_SEM_GUARD_JUSTIFICADA: Record<string, string> = {
  "/api/v1/auth/bootstrap-owner":
    "Exige sessão válida (getAuthenticatedUser) E e-mail na allowlist IRIS_OWNER_EMAIL/ADMIN_EMAILS — 403 fora dela. É o gate que impede auto-promoção a owner.",
  "/api/v1/auth/setup-owner":
    "Fase 32: 404 sem IRIS_SETUP_ENABLED=1. Além disso: IRIS_SETUP_TOKEN em tempo constante, allowlist de e-mail e 409 se já houver admin.",
  "/api/v1/sync":
    "Morta em produção: começa com `if (!isDemo()) return 403`. Só existe para o modo demo sem Supabase.",
};

/**
 * ⚠️ A SUPERFÍCIE DE LEITURA DECLARADA — as rotas GET que QUALQUER sessão válida lê.
 *
 * Decisão do usuário (Fase 32): "quem tiver o acesso, que eu mesmo crio no Supabase, poderá ver
 * tudo, por enquanto". Esta lista é o registro dessa decisão — não a sua ausência.
 *
 * Tudo que NÃO está aqui e tem GET **precisa** de `requireAdmin`. É assim que `/api/v1/admin/*`
 * fica coeso: as 15 rotas de diagnóstico de esteira são de quem OPERA.
 */
const GET_LEGIVEL_POR_VIEWER: string[] = [
  "/api/v1/alertas",
  "/api/v1/antt/2026/documentos",
  "/api/v1/antt/2026/documentos/[id]/download",
  "/api/v1/associados/documentos/[id]/html",
  "/api/v1/auth/me",
  "/api/v1/dashboard/diretores/overview",
  "/api/v1/dashboard/governanca-agencias",
  "/api/v1/dashboard/microtemas",
  "/api/v1/dashboard/microtemas/evolution",
  "/api/v1/dashboard/overview",
  "/api/v1/dashboard/reunioes/calendar",
  "/api/v1/dashboard/reunioes/stats",
  "/api/v1/deliberacoes/export",
  "/api/v1/diretores",
  "/api/v1/diretores/[id]",
  "/api/v1/diretores/candidatos",
  "/api/v1/empresas",
  "/api/v1/empresas/[id]",
  "/api/v1/mandatos",
  "/api/v1/mandatos/analytics",
  "/api/v1/mandatos/stats",
  "/api/v1/monitoramento/alertas",
  "/api/v1/monitoramento/runs",
  "/api/v1/noticias",
  "/api/v1/noticias/health",
  "/api/v1/noticias/imagem",
  "/api/v1/qualidade-regulatoria/agencias",
  "/api/v1/qualidade-regulatoria/coletas/status",
  "/api/v1/qualidade-regulatoria/criterios",
  "/api/v1/qualidade-regulatoria/dashboard",
  "/api/v1/qualidade-regulatoria/premio",
  "/api/v1/qualidade-regulatoria/relatorios/ranking",
  "/api/v1/relatorios/votos-diretores",
  "/api/v1/reunioes",
  "/api/v1/reunioes/detalhe",
  "/api/v1/sync",
  "/api/v1/system/status",
  "/api/v1/upload/jobs/[jobId]",
  "/api/v1/upload/jobs/[jobId]/stream",
  "/api/v1/votacao/consenso-timeline",
  "/api/v1/votacao/distribution",
  "/api/v1/votacao/fidelidade",
  "/api/v1/votacao/matrix",
  /**
   * ⚠️ AS 16 QUE A VARREDURA POR HANDLER REVELOU (Fase 35). Elas sempre foram legíveis por
   * qualquer sessão — o que faltava era estarem DECLARADAS: o `temGuard` por arquivo as escondia,
   * porque cada uma divide `route.ts` com um POST/PATCH guardado. Conferi que os três `schedule`
   * só LEEM (nenhum insert/update/upsert/delete no corpo do GET), senão viewer-legível estaria
   * errado para elas.
   */
  "/api/v1/agencias",
  "/api/v1/agencias/[id]",
  "/api/v1/agencias/[id]/diretores",
  "/api/v1/agencias/[id]/lista-triplice",
  "/api/v1/associados",
  "/api/v1/associados/documentos",
  "/api/v1/associados/documentos/schedule",
  "/api/v1/boletim/schedule",
  "/api/v1/deliberacoes",
  "/api/v1/deliberacoes/[id]",
  "/api/v1/empresas/associados",
  "/api/v1/fontes",
  "/api/v1/monitoramento/sites",
  "/api/v1/noticias/newsletter/schedule",
  "/api/v1/qualidade-regulatoria/avaliacoes",
  "/api/v1/qualidade-regulatoria/evidencias",
  "/api/v1/votacao/sectors",];

describe("etapa187 · ⚠️ toda rota de ESCRITA alcança um guard", () => {
  const comEscrita = ROTAS.filter((r) => METODOS_DE_ESCRITA.some((m) => r.metodos.has(m)));

  it("a varredura acha as rotas de escrita (o teste não pode passar por não achar nada)", () => {
    // Guarda contra o pior modo de falso verde: a varredura quebrar e o teste "passar" vazio.
    expect(ROTAS.length).toBeGreaterThan(100);
    expect(comEscrita.length).toBeGreaterThan(50);
  });

  it("⚠️ nenhuma rota de escrita sem guard fora da lista justificada", () => {
    const semGuard = comEscrita
      .filter((r) => METODOS_DE_ESCRITA.some((m) => r.metodos.has(m) && !r.guardDe(m)))
      .map((r) => r.rota)
      .sort();
    const justificadas = Object.keys(ESCRITA_SEM_GUARD_JUSTIFICADA).sort();
    expect(semGuard, "rota de ESCRITA sem guard e sem justificativa — adicione o guard, não a exceção")
      .toEqual(justificadas);
  });

  it("cada exceção tem motivo ESCRITO — exceção sem porquê vira exceção esquecida", () => {
    for (const [rota, motivo] of Object.entries(ESCRITA_SEM_GUARD_JUSTIFICADA)) {
      expect(motivo.length, `a exceção ${rota} não explica por quê`).toBeGreaterThan(60);
    }
  });

  it("⚠️ e as três exceções DE FATO se defendem — a justificativa é conferida no código", () => {
    // Justificativa que ninguém confere é prosa. Cada uma é verificada contra o arquivo.
    expect(semComentarios(ler("src/app/api/v1/auth/bootstrap-owner/route.ts")))
      .toMatch(/isConfiguredAdminEmail\(userResult\.email\)/);
    expect(semComentarios(ler("src/app/api/v1/auth/setup-owner/route.ts")))
      .toMatch(/if \(!setupOwnerAberto\(\)\)/);
    expect(semComentarios(ler("src/app/api/v1/sync/route.ts"))).toMatch(/isDemo\(\)/);
  });
});

describe("etapa187 · ⚠️ a superfície de LEITURA é declarada, e não pode crescer sozinha", () => {
  const comGet = ROTAS.filter((r) => r.metodos.has("GET"));

  it("toda rota GET está classificada — nova rota fora da lista reprova", () => {
    const viewerReal = comGet.filter((r) => !r.guardDe("GET")).map((r) => r.rota).sort();
    const declarado = [...GET_LEGIVEL_POR_VIEWER].sort();
    expect(
      viewerReal,
      "a superfície de leitura mudou. Se foi de propósito, atualize GET_LEGIVEL_POR_VIEWER; " +
        "se não foi, a rota precisa de requireAdmin.",
    ).toEqual(declarado);
  });

  it("⚠️ TODA rota sob /api/v1/admin/ exige admin — sem exceção", () => {
    /**
     * Era aqui que estava o furo: `admin/cobertura-documentos` era a ÚNICA das 15 sem
     * `requireAdmin`, com um comentário afirmando que o middleware a protegia — afirmação falsa
     * desde ago/2026, quando o middleware passou a liberar GET para qualquer sessão.
     */
    const adminSemGuard = ROTAS
      .filter((r) => r.rota.startsWith("/api/v1/admin/") && [...r.metodos].some((m) => !r.guardDe(m)))
      .map((r) => r.rota);
    expect(adminSemGuard, "rota sob /api/v1/admin/ sem guard").toEqual([]);
  });

  it("e as rotas de /admin/ com GET são muitas — a regra acima não passa por vazio", () => {
    const adminComGet = ROTAS.filter((r) => r.rota.startsWith("/api/v1/admin/") && r.metodos.has("GET"));
    expect(adminComGet.length).toBeGreaterThanOrEqual(15);
  });
});

describe("etapa187 · ⚠️ os guards NEGAM — e isto nunca foi testado", () => {
  const envOriginal = { ...process.env };
  beforeEach(() => { vi.resetModules(); });
  afterEach(() => { process.env = { ...envOriginal }; });

  const req = (url = "http://localhost/api/v1/x", headers: Record<string, string> = {}) =>
    new NextRequest(new URL(url), { headers });

  it("`timingSafeEqualStr` iguala o igual e recusa o diferente, inclusive de tamanhos diversos", async () => {
    const { timingSafeEqualStr } = await import("@/lib/server/request-guards");
    expect(timingSafeEqualStr("segredo-longo", "segredo-longo")).toBe(true);
    expect(timingSafeEqualStr("segredo-longo", "segredo-longa")).toBe(false);
    expect(timingSafeEqualStr("abc", "abcd")).toBe(false);
    expect(timingSafeEqualStr("", "")).toBe(true);
  });

  it("⚠️ `requireCron` distingue 503 (sem segredo) de 401 (token errado)", async () => {
    const { requireCron } = await import("@/lib/server/request-guards");
    delete process.env.CRON_SECRET;
    expect((await requireCron(req()))?.status, "sem CRON_SECRET deveria ser 503").toBe(503);

    process.env.CRON_SECRET = "segredo-de-teste-bem-longo";
    expect((await requireCron(req()))?.status, "sem token deveria ser 401").toBe(401);
    expect((await requireCron(req("http://localhost/x", { authorization: "Bearer errado" })))?.status).toBe(401);
    expect(
      await requireCron(req("http://localhost/x", { authorization: "Bearer segredo-de-teste-bem-longo" })),
      "token certo deveria PASSAR (null)",
    ).toBeNull();
  });

  it("⚠️ `requireAdmin` recusa em modo DEMO — escrita não acontece sem Supabase", async () => {
    delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    const { requireAdmin } = await import("@/lib/server/request-guards");
    expect((await requireAdmin(req()))?.status).toBe(403);
  });

  it("⚠️ `requireAdmin` recusa requisição marcada como DEMO pelo cliente", async () => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://exemplo.supabase.co";
    process.env.SUPABASE_SERVICE_ROLE_KEY = "chave";
    const { requireAdmin } = await import("@/lib/server/request-guards");
    // As DUAS formas: header e query param. O cliente controla ambas.
    expect((await requireAdmin(req("http://localhost/x", { "x-iris-demo": "1" })))?.status).toBe(403);
    expect((await requireAdmin(req("http://localhost/x?demo=1")))?.status).toBe(403);
  });

  it("⚠️ `requireAdmin` recusa quem não manda Bearer", async () => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://exemplo.supabase.co";
    process.env.SUPABASE_SERVICE_ROLE_KEY = "chave";
    const { requireAdmin } = await import("@/lib/server/request-guards");
    expect((await requireAdmin(req()))?.status).toBe(401);
  });

  it("`isConfiguredAdminEmail` é allowlist FECHADA: sem env configurada, ninguém é admin", async () => {
    delete process.env.IRIS_OWNER_EMAIL;
    delete process.env.ADMIN_EMAILS;
    const { isConfiguredAdminEmail, hasConfiguredAdminEmail } = await import("@/lib/server/admin-emails");
    // ⚠️ Fail-closed: lista vazia não pode significar "todo mundo".
    expect(hasConfiguredAdminEmail()).toBe(false);
    expect(isConfiguredAdminEmail("qualquer@um.com")).toBe(false);

    process.env.IRIS_OWNER_EMAIL = "Dono@Exemplo.com";
    const m = await import("@/lib/server/admin-emails");
    expect(m.isConfiguredAdminEmail("dono@exemplo.com"), "a comparação ignora caixa").toBe(true);
    expect(m.isConfiguredAdminEmail("outro@exemplo.com")).toBe(false);
  });

  it("`isAppMetadataAdmin` aceita owner/admin e recusa viewer e vazio", async () => {
    const { isAppMetadataAdmin } = await import("@/lib/server/request-guards");
    const u = (meta: Record<string, unknown>) => ({ id: "1", email: "a@b.c", app_metadata: meta });
    expect(isAppMetadataAdmin(u({ iris_role: "owner" }))).toBe(true);
    expect(isAppMetadataAdmin(u({ iris_role: "admin" }))).toBe(true);
    expect(isAppMetadataAdmin(u({ iris_owner: true }))).toBe(true);
    expect(isAppMetadataAdmin(u({ iris_role: "viewer" })), "viewer NÃO é admin").toBe(false);
    expect(isAppMetadataAdmin(u({}))).toBe(false);
    expect(isAppMetadataAdmin({ id: "1", email: "a@b.c" })).toBe(false);
  });
});

describe("etapa187 · ⚠️ o middleware — que também nunca teve teste", () => {
  const MW = semComentarios(ler("src/middleware.ts"));

  it("a lista de caminhos públicos é EXATAMENTE a declarada", () => {
    /**
     * ⚠️ Esta é a expectativa que a landing page vai forçar a atualizar — de propósito. Abrir `/`
     * ao público é uma mudança de superfície, e tem de passar por aqui em vez de entrar de carona.
     */
    const bloco = MW.slice(MW.indexOf("PUBLIC_APP_PREFIXES"), MW.indexOf("]", MW.indexOf("PUBLIC_APP_PREFIXES")));
    const prefixos = [...bloco.matchAll(/"([^"]+)"/g)].map((m) => m[1]);
    expect(prefixos).toEqual(["/login", "/setup-owner", "/auth/callback", "/_next", "/favicon", "/robots.txt", "/sitemap.xml"]);
  });

  it("⚠️ `?demo=1` NÃO pula a autenticação de GET — o buraco fechado em jul/2026", () => {
    /**
     * A versão antiga deixava `x-iris-demo`/`?demo=1` pular a auth de GET, e rotas que não checam
     * demo devolviam DADOS REAIS sem token. O conserto foi mover o bypass para depois da checagem.
     * Se alguém "otimizar" isso de volta, este teste cai.
     */
    const iDemo = MW.indexOf("const isDemoRequest =");
    const iGet = MW.indexOf('if (req.method !== "GET") return NextResponse.next();');
    const iToken = MW.indexOf("if (!token) {");
    expect(iDemo).toBeGreaterThan(-1);
    expect(iGet).toBeGreaterThan(iDemo);
    expect(iToken, "a exigência de token tem de vir DEPOIS do desvio de escrita").toBeGreaterThan(iGet);
    expect(MW, "voltou o bypass de demo antes da checagem de token")
      .not.toMatch(/if \(isDemoRequest\) return NextResponse\.next\(\);/);
  });

  it("escrita em modo DEMO é barrada no middleware, antes de chegar na rota", () => {
    expect(MW).toMatch(/if \(isDemoRequest && WRITE_METHODS\.has\(req\.method\)\)/);
  });

  it("⚠️ páginas não-públicas exigem sessão, e a falha REDIRECIONA (fail-closed)", () => {
    expect(MW).toMatch(/if \(isPublicAppPath\(pathname\)\) \{\s*return NextResponse\.next\(\);\s*\}/);
    expect(MW).toMatch(/return requireAuthenticatedApp\(req\);/);
    // Sem env completa, redireciona em vez de deixar passar.
    expect(MW).toMatch(/if \(!supabaseUrl \|\| !anonKey \|\| !serviceRoleKey\) \{\s*return redirectToLogin\(req, "config"\);/);
    expect(MW).toMatch(/if \(error \|\| !user\?\.id \|\| !user\.email\) \{\s*return redirectToLogin\(req\);/);
  });

  it("o Bearer de cron é comparado em tempo constante, sem short-circuit", () => {
    expect(MW).toMatch(/diff \|= a\.charCodeAt\(i\) \^ b\.charCodeAt\(i\)/);
    expect(MW).toMatch(/timingSafeEqual\(token, cronSecret\)/);
  });
});

describe("etapa187 · ⚠️ o viewer CONSEGUE entrar — a regressão que travava o produto", () => {
  const LOGIN = semComentarios(ler("src/app/login/page.tsx"));

  it("o portão do login é `/auth/me`, NÃO o bootstrap de owner", () => {
    /**
     * O bug: o único caminho para o dashboard era um POST bem-sucedido em `bootstrap-owner`, que
     * responde 403 para todo e-mail fora da allowlist — por desenho. O viewer autenticava e ficava
     * preso, com um único botão ("Usar outro e-mail").
     */
    expect(LOGIN).toMatch(/await fetch\("\/api\/v1\/auth\/me", \{ headers: auth \}\)/);
    expect(LOGIN, "o redirect voltou a depender do bootstrap")
      .not.toMatch(/bootstrap-owner[\s\S]{0,200}?if \(res\.ok\) \{\s*router\.replace/);
  });

  it("⚠️ o bootstrap é BEST-EFFORT e só quando não há admin nenhum", () => {
    expect(LOGIN).toMatch(/if \(perfil\?\.can_bootstrap_owner\) \{/);
    expect(LOGIN).toMatch(/fetch\("\/api\/v1\/auth\/bootstrap-owner", \{ method: "POST", headers: auth \}\)\.catch\(\(\) => null\)/);
  });

  it("⚠️ o redirect acontece para admin E para viewer — sem ramo de permissão", () => {
    const i = LOGIN.indexOf("const entrar = useCallback");
    const bloco = LOGIN.slice(i, LOGIN.indexOf("[next, router]", i));
    expect(bloco).toMatch(/router\.replace\(next\);/);
    expect(bloco, "voltou a barrar por não ser admin").not.toMatch(/is_admin[\s\S]{0,80}?return;/);
  });

  it("negar passou a significar SESSÃO INVÁLIDA, e 5xx não pede para tentar de novo", () => {
    expect(LOGIN).toMatch(/const problemaDeServidor = !me \|\| me\.status >= 500;/);
    /**
     * ⚠️ INDIFERENTE AO NOME DO ESCRITOR (Fase 35). A expectativa exigia `setSessaoInvalida(...)`
     * literal, e o conserto do laço infinito passou as escritas por `marcarSessaoInvalida` (que
     * mantém o `ref` em sincronia). A propriedade é o ARGUMENTO — a flag vem da negação do problema
     * de servidor, para 5xx não pedir login de novo —, não o nome de quem a escreve.
     */
    expect(LOGIN).toMatch(/(?:set|marcar)SessaoInvalida\(!problemaDeServidor\)/);
  });

  it("⚠️ o link público para /setup-owner saiu do login", () => {
    expect(LOGIN, "o link voltou — e a rota nasce 404, então ele seria um beco")
      .not.toMatch(/href="\/setup-owner"/);
  });
});

describe("etapa187 · ⚠️ /setup-owner nasce FECHADA", () => {
  it("o interruptor é explícito e o padrão é desligado", () => {
    const S = semComentarios(ler("src/lib/server/setup-aberto.ts"));
    expect(S).toMatch(/process\.env\.IRIS_SETUP_ENABLED\?\.trim\(\) === "1"/);
  });

  it("a ROTA responde 404 antes de ler o corpo — e é a rota que protege, não a tela", () => {
    const R = semComentarios(ler("src/app/api/v1/auth/setup-owner/route.ts"));
    const iGate = R.indexOf("if (!setupOwnerAberto())");
    const iBody = R.indexOf("await req.json()");
    expect(iGate).toBeGreaterThan(-1);
    expect(iGate, "o gate tem de vir ANTES de processar o corpo").toBeLessThan(iBody);
    expect(R).toMatch(/\{ status: 404 \}/);
  });

  it("e a PÁGINA também some, para não prometer o que o servidor recusa", () => {
    expect(semComentarios(ler("src/app/setup-owner/layout.tsx")))
      .toMatch(/if \(!setupOwnerAberto\(\)\) notFound\(\);/);
  });

  it("⚠️ as defesas de dentro CONTINUAM — o interruptor é camada a mais, não substituta", () => {
    const R = semComentarios(ler("src/app/api/v1/auth/setup-owner/route.ts"));
    expect(R).toMatch(/timingSafeEqualStr\(setupToken, requiredToken\)/);
    expect(R).toMatch(/await adminUsersCount\(\)\) > 0/);
    expect(R).toMatch(/isConfiguredAdminEmail\(email\)/);
  });
});
