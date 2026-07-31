import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { NextRequest, NextResponse } from "next/server";
import { isConfiguredAdminEmail, parseConfiguredAdminEmails } from "@/lib/server/admin-emails";

const WRITE_METHODS = new Set(["POST", "PATCH", "PUT", "DELETE"]);
const PUBLIC_APP_PREFIXES = ["/login", "/setup-owner", "/auth/callback", "/_next", "/favicon", "/robots.txt", "/sitemap.xml"];

// Comparação de tempo constante para o Bearer de cron. Edge-safe (sem node:crypto):
// só o tamanho vaza (aceitável), o conteúdo é comparado sem short-circuit.
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export async function middleware(req: NextRequest) {
  const pathname = req.nextUrl.pathname;

  if (pathname.startsWith("/api/v1/")) {
    return handleApiRequest(req);
  }

  if (isPublicAppPath(pathname)) {
    return NextResponse.next();
  }

  return requireAuthenticatedApp(req);
}

export const config = {
  matcher: ["/((?!.*\\..*).*)", "/api/v1/:path*"],
};

async function handleApiRequest(req: NextRequest) {
  const pathname = req.nextUrl.pathname;
  if (req.method === "OPTIONS") return NextResponse.next();
  if (pathname === "/api/v1/system/status") return NextResponse.next();
  if (pathname.startsWith("/api/v1/auth/")) return NextResponse.next();
  // Proxy de imagem PÚBLICO (GET): um <img> num e-mail enviado NÃO manda Bearer — sem esta
  // isenção a imagem de notícia dá 401 e quebra para o destinatário. A rota já restringe a
  // hosts gov.br/sp.gov.br/senado (allowlist) + cap 8MB + SSRF-guard, então serve só imagens
  // JÁ públicas de órgãos oficiais (sem dado sensível). Ver iris-security-lgpd.
  if (pathname === "/api/v1/noticias/imagem" && req.method === "GET") return NextResponse.next();

  const isDemoRequest =
    req.headers.get("x-iris-demo") === "1" ||
    req.nextUrl.searchParams.get("demo") === "1";

  if (pathname === "/api/v1/upload/preview" && req.method === "POST" && isDemoRequest) {
    return NextResponse.next();
  }

  if (isDemoRequest && WRITE_METHODS.has(req.method)) {
    return NextResponse.json(
      { error: "Modo DEMO e somente leitura. Desligue o DEMO para gravar dados reais." },
      { status: 403 },
    );
  }

  // Só métodos não-GET (escrita) passam direto — o guard da rota autentica.
  // `?demo=1`/`x-iris-demo` NÃO pula mais a auth de GET: a flag é controlada pelo
  // cliente e deixava rotas que não checam demo vazarem dados reais sem token. O
  // usuário demo logado envia o Bearer normalmente e a rota devolve dados sintéticos
  // pelo próprio check `isDemoRequest`; o modo demo real (sem Supabase) cai no
  // bypass de `!supabaseUrl` abaixo.
  if (req.method !== "GET") return NextResponse.next();

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!supabaseUrl || !anonKey) return NextResponse.next();

  const cronSecret = process.env.CRON_SECRET;
  const authHeader = req.headers.get("authorization");
  const token = authHeader?.startsWith("Bearer ") ? authHeader.slice("Bearer ".length).trim() : "";
  if (cronSecret && token && timingSafeEqual(token, cronSecret)) return NextResponse.next();

  if (!token) {
    return NextResponse.json({ error: "Login obrigatório para consultar dados reais" }, { status: 401 });
  }

  const user = await getSupabaseUser(supabaseUrl, anonKey, token);
  if (!user?.id || !user.email) {
    return NextResponse.json({ error: "Sessão inválida" }, { status: 401 });
  }

  if (isConfiguredAdminEmail(user.email) || isAppMetadataAdmin(user)) return NextResponse.next();

  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!serviceRoleKey) {
    return NextResponse.json({ error: "SUPABASE_SERVICE_ROLE_KEY não configurada" }, { status: 503 });
  }

  const isAdmin = await checkAdminUser(supabaseUrl, serviceRoleKey, user.id);
  if (!isAdmin) {
    return NextResponse.json({ error: "Usuário sem permissão administrativa" }, { status: 403 });
  }

  return NextResponse.next();
}

async function requireAuthenticatedApp(req: NextRequest) {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !anonKey || !serviceRoleKey) {
    return redirectToLogin(req, "config");
  }

  let response = NextResponse.next({ request: { headers: req.headers } });
  const supabase = createServerClient(supabaseUrl, anonKey, {
    cookies: {
      getAll() {
        return req.cookies.getAll();
      },
      setAll(cookiesToSet: Array<{ name: string; value: string; options?: CookieOptions }>) {
        cookiesToSet.forEach(({ name, value }) => req.cookies.set(name, value));
        response = NextResponse.next({ request: { headers: req.headers } });
        cookiesToSet.forEach(({ name, value, options }) => {
          response.cookies.set(name, value, options);
        });
      },
    },
  });

  const { data, error } = await supabase.auth.getUser();
  const user = data.user;
  if (error || !user?.id || !user.email) {
    return redirectToLogin(req);
  }

  const configuredEmails = parseConfiguredAdminEmails();
  if (configuredEmails.size > 0 && !configuredEmails.has(user.email.toLowerCase())) {
    return redirectToLogin(req, "forbidden");
  }

  if (configuredEmails.size === 0) {
    const adminCount = await countActiveAdmins(supabaseUrl, serviceRoleKey);
    if (adminCount === 0) return response;
  }

  const isAdmin = await checkAdminUser(supabaseUrl, serviceRoleKey, user.id);
  if (!isAdmin && !isConfiguredAdminEmail(user.email) && !isAppMetadataAdmin(user)) {
    return redirectToLogin(req, "forbidden");
  }

  return response;
}

function isPublicAppPath(pathname: string): boolean {
  return PUBLIC_APP_PREFIXES.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`));
}

function redirectToLogin(req: NextRequest, reason?: string) {
  const url = req.nextUrl.clone();
  const next = `${url.pathname}${url.search}`;
  url.pathname = "/login";
  url.search = "";
  url.searchParams.set("next", next);
  if (reason) url.searchParams.set("reason", reason);
  return NextResponse.redirect(url);
}

async function getSupabaseUser(
  supabaseUrl: string,
  anonKey: string,
  token: string,
): Promise<{ id: string; email?: string; app_metadata?: Record<string, unknown> } | null> {
  try {
    const response = await fetch(`${supabaseUrl}/auth/v1/user`, {
      headers: {
        apikey: anonKey,
        authorization: `Bearer ${token}`,
      },
    });
    if (!response.ok) return null;
    return (await response.json()) as { id: string; email?: string; app_metadata?: Record<string, unknown> };
  } catch {
    return null;
  }
}

function isAppMetadataAdmin(user: { app_metadata?: Record<string, unknown> }): boolean {
  const role = user.app_metadata?.iris_role;
  const owner = user.app_metadata?.iris_owner;
  return role === "owner" || role === "admin" || owner === true;
}

async function checkAdminUser(
  supabaseUrl: string,
  serviceRoleKey: string,
  userId: string,
): Promise<boolean> {
  try {
    const params = new URLSearchParams({
      select: "id,role",
      user_id: `eq.${userId}`,
      active: "eq.true",
      limit: "1",
    });
    const response = await fetch(`${supabaseUrl}/rest/v1/admin_users?${params}`, {
      headers: {
        apikey: serviceRoleKey,
        authorization: `Bearer ${serviceRoleKey}`,
      },
    });
    if (!response.ok) return false;
    const rows = (await response.json()) as Array<{ role?: string }>;
    return rows.some((row) => row.role === "owner" || row.role === "admin");
  } catch {
    return false;
  }
}

async function countActiveAdmins(supabaseUrl: string, serviceRoleKey: string): Promise<number> {
  try {
    const params = new URLSearchParams({
      select: "id",
      active: "eq.true",
    });
    const response = await fetch(`${supabaseUrl}/rest/v1/admin_users?${params}`, {
      method: "HEAD",
      headers: {
        apikey: serviceRoleKey,
        authorization: `Bearer ${serviceRoleKey}`,
        prefer: "count=exact",
      },
    });
    const range = response.headers.get("content-range");
    const count = range?.split("/").at(1);
    return count ? Number(count) : 1;
  } catch {
    return 1;
  }
}
