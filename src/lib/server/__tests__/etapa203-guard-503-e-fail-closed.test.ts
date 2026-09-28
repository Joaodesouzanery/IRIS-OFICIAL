/**
 * Etapa 203 (Fase 35, Bloco A.6) — três defeitos pequenos da autenticação, todos do tipo
 * "o sistema diz a coisa errada sobre si mesmo".
 *
 * ① `requireAdmin` devolvia **403 "sem permissão"** quando a CONSULTA a `admin_users` falhava. Era
 *    fail-closed (ninguém entrava), mas mentia: um admin legítimo que não está na allowlist de env
 *    lia "você não tem permissão" num blip de banco, e ia procurar o problema no cadastro dele.
 *    Agora é **503**, que é o que "não sei" quer dizer em HTTP.
 *
 * ② O `catch` do mesmo guard devolvia `error.message` CRU ao cliente — e
 *    `createSupabaseServerClient()` lança nomeando variáveis de ambiente do deploy.
 *
 * ③ `use-viewer` fazia `data ? Boolean(data.is_admin) : true` — fail-OPEN. Qualquer falha de
 *    `/auth/me` fazia a UI tratar viewer como admin e oferecer ações que iam dar 403.
 *
 * ⚠️ Os dois primeiros são exercidos por COMPORTAMENTO (guard chamado de verdade, com o client
 * mockado), não por texto. Foi o modo de falha que mais me custou nesta fase: expectativa que casa a
 * linha em vez de medir a propriedade passa a canonizar a linha, inclusive quando ela está errada.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { NextRequest } from "next/server";
import { readFileSync } from "fs";
import { join } from "path";

const RAIZ = join(__dirname, "../../../..");
const ler = (p: string) => readFileSync(join(RAIZ, p), "utf-8");
/**
 * ⚠️ SEM COMENTÁRIOS antes de varrer. A primeira versão destas expectativas reprovou por achar o
 * código ANTIGO dentro do docblock que o explica — o mesmo tropeço da `etapa194`. Um scanner de
 * fonte que lê comentários mede a prosa, não o programa.
 */
const semComentarios = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/\/\/[^\n]*/g, " ");

const USUARIO = { id: "u-1", email: "naoadmin@exemplo.org", app_metadata: {} };

/** Client falso: `auth.getUser` devolve um usuário válido; `admin_users` devolve o que o teste pedir. */
function clientFalso(respostaDoAdminUsers: { data: unknown; error: unknown }) {
  const cadeia: Record<string, unknown> = {};
  cadeia.select = () => cadeia;
  cadeia.eq = () => cadeia;
  cadeia.maybeSingle = async () => respostaDoAdminUsers;
  return {
    auth: { getUser: async () => ({ data: { user: USUARIO }, error: null }) },
    from: () => cadeia,
  };
}

const req = (headers: Record<string, string> = { authorization: "Bearer token-valido" }) =>
  new NextRequest(new URL("http://localhost/api/v1/admin/x"), { headers });

describe("etapa203 · ⚠️ erro de banco é 503, não 403", () => {
  const envOriginal = { ...process.env };
  beforeEach(() => {
    vi.resetModules();
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://exemplo.supabase.co";
    process.env.SUPABASE_SERVICE_ROLE_KEY = "chave-de-teste";
    // Allowlist VAZIA de propósito: é o caminho que consulta `admin_users`.
    delete process.env.IRIS_OWNER_EMAIL;
    delete process.env.ADMIN_EMAILS;
  });
  afterEach(() => {
    process.env = { ...envOriginal };
    vi.doUnmock("@/lib/supabase/server");
  });

  it("consulta a `admin_users` que FALHA devolve 503 (e não afirma falta de permissão)", async () => {
    vi.doMock("@/lib/supabase/server", () => ({
      createSupabaseServerClient: () =>
        clientFalso({ data: null, error: { message: "connection terminated unexpectedly" } }),
    }));
    const { requireAdmin } = await import("@/lib/server/request-guards");
    const resposta = await requireAdmin(req());
    expect(resposta?.status, "erro transitório de banco virou 403 outra vez").toBe(503);
    const corpo = (await resposta?.json()) as { error?: string };
    expect(corpo.error ?? "", "a mensagem do 503 não pode afirmar falta de permissão")
      .not.toMatch(/sem permissão/i);
  });

  it("⚠️ e continua FAIL-CLOSED: 503 é recusa, nunca `null`", async () => {
    vi.doMock("@/lib/supabase/server", () => ({
      createSupabaseServerClient: () => clientFalso({ data: null, error: { message: "timeout" } }),
    }));
    const { requireAdmin } = await import("@/lib/server/request-guards");
    const resposta = await requireAdmin(req());
    expect(resposta, "erro de banco NUNCA pode liberar a rota").not.toBeNull();
  });

  it("consulta que FUNCIONA e não acha admin continua 403 — a distinção é o ponto", async () => {
    vi.doMock("@/lib/supabase/server", () => ({
      createSupabaseServerClient: () => clientFalso({ data: null, error: null }),
    }));
    const { requireAdmin } = await import("@/lib/server/request-guards");
    const resposta = await requireAdmin(req());
    expect(resposta?.status).toBe(403);
  });

  it("e quem É admin na tabela passa (o 503 não fechou a porta de quem tem direito)", async () => {
    vi.doMock("@/lib/supabase/server", () => ({
      createSupabaseServerClient: () =>
        clientFalso({ data: { id: "a-1", active: true, role: "admin" }, error: null }),
    }));
    const { requireAdmin } = await import("@/lib/server/request-guards");
    expect(await requireAdmin(req())).toBeNull();
  });
});

describe("etapa203 · ⚠️ o 500 não nomeia variáveis de ambiente", () => {
  const envOriginal = { ...process.env };
  beforeEach(() => {
    vi.resetModules();
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://exemplo.supabase.co";
    process.env.SUPABASE_SERVICE_ROLE_KEY = "chave-de-teste";
    delete process.env.IRIS_OWNER_EMAIL;
    delete process.env.ADMIN_EMAILS;
  });
  afterEach(() => {
    process.env = { ...envOriginal };
    vi.doUnmock("@/lib/supabase/server");
  });

  it("a mensagem da exceção fica no servidor; ao cliente vai o genérico", async () => {
    const MENSAGEM_REAL =
      "NEXT_PUBLIC_SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY são obrigatórios no servidor";
    vi.doMock("@/lib/supabase/server", () => ({
      createSupabaseServerClient: () => {
        throw new Error(MENSAGEM_REAL);
      },
    }));
    const erroSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const { requireAdmin } = await import("@/lib/server/request-guards");
    const resposta = await requireAdmin(req());

    expect(resposta?.status).toBe(500);
    const corpo = JSON.stringify(await resposta?.json());
    expect(corpo, "o nome da env vazou para o cliente").not.toMatch(/SUPABASE_SERVICE_ROLE_KEY/);
    expect(corpo, "o nome da env vazou para o cliente").not.toMatch(/NEXT_PUBLIC_SUPABASE_URL/);
    // E o detalhe NÃO foi engolido — ele existe, no log do servidor.
    expect(erroSpy, "o detalhe precisa continuar registrado no servidor").toHaveBeenCalled();
    erroSpy.mockRestore();
  });
});

describe("etapa203 · `use-viewer` é FAIL-CLOSED quando há Supabase", () => {
  const FONTE = semComentarios(ler("src/lib/use-viewer.ts"));

  it("o fail-open ficou condicionado à AUSÊNCIA de Supabase, não a qualquer falha", () => {
    expect(FONTE, "voltou o fail-open incondicional — viewer vira admin em qualquer blip")
      .not.toMatch(/data \? Boolean\(data\.is_admin\) : true/);
    expect(FONTE).toMatch(/const semSupabase =/);
    expect(FONTE).toMatch(/data \? Boolean\(data\.is_admin\) : semSupabase/);
  });

  it("e `semSupabase` olha as DUAS variáveis públicas — uma só não caracteriza o caso", () => {
    const i = FONTE.indexOf("const semSupabase =");
    const trecho = FONTE.slice(i, i + 220);
    expect(trecho).toMatch(/NEXT_PUBLIC_SUPABASE_URL/);
    expect(trecho).toMatch(/NEXT_PUBLIC_SUPABASE_ANON_KEY/);
  });
});

describe("etapa203 · o `signIn` que parava sem dizer nada", () => {
  const LOGIN = semComentarios(ler("src/app/login/page.tsx"));

  it("há um `else` para o caso «autenticou e não veio sessão»", () => {
    const i = LOGIN.indexOf("if (data.session?.access_token)");
    expect(i, "o ramo da sessão do signIn desapareceu").toBeGreaterThan(-1);
    const trecho = LOGIN.slice(i, i + 500);
    expect(trecho, "sem `else`, clicar em Entrar não produz reação nenhuma").toMatch(/\}\s*else\s*\{/);
    expect(trecho, "o `else` precisa DIZER algo ao usuário").toMatch(/setMessage\(/);
  });
});
