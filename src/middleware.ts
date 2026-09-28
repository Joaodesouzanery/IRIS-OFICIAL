import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { NextRequest, NextResponse } from "next/server";

const WRITE_METHODS = new Set(["POST", "PATCH", "PUT", "DELETE"]);
const PUBLIC_APP_PREFIXES = ["/login", "/setup-owner", "/auth/callback", "/_next", "/favicon", "/robots.txt", "/sitemap.xml"];

/**
 * Caminhos públicos por IGUALDADE EXATA — Fase 32 (landing page).
 *
 * ⚠️ `/` NÃO pode entrar em `PUBLIC_APP_PREFIXES`, e a razão é o próprio helper: ele testa
 * `pathname === prefix || pathname.startsWith(`${prefix}/`)`. Com `prefix = "/"`, o segundo ramo
 * vira `startsWith("//")`, que hoje não casa com nada — mas é uma armadilha esperando alguém
 * normalizar o helper e abrir o app inteiro de uma vez. Um conjunto de igualdade exata não tem
 * como se generalizar por acidente.
 *
 * `/dashboard` continua fora daqui e continua exigindo sessão — é o que o `etapa188` cobra.
 *
 * ⚠️ `/opengraph-image` está aqui porque o `matcher` do middleware é `/((?!.*\..*).*)`: ele ignora
 * caminhos COM ponto (por isso `/brand/logo.png` passa direto), e a imagem gerada pelo `next/og`
 * não tem extensão no caminho — o Next a serve em `/opengraph-image?<hash>`. Sem esta entrada, o
 * middleware devolvia **307 para /login**, e WhatsApp, LinkedIn e Twitter, que buscam a imagem sem
 * sessão, não mostrariam prévia nenhuma. Descoberto servindo o build e medindo, não por leitura.
 */
const PUBLIC_APP_EXACT = new Set(["/", "/opengraph-image"]);

/**
 * ⚠️ AS ROTAS DE EXPORTAÇÃO QUE O NAVEGADOR ABRE — lista FECHADA, e o motivo de ela existir.
 *
 * `handleApiRequest` exige header `Authorization: Bearer` em todo GET de API. Mas navegação do
 * navegador — clique em `<a href>`, `window.location.href`, "Salvar link como" — **nunca manda
 * header**: manda cookie. Resultado medido: TODO download por link devolvia
 * `{"error":"Login obrigatório para consultar dados reais"}` na cara de quem estava logado.
 *
 * São OITO pontos de uso, não um. Quatro deles são os botões HTML/PDF/Word/DOCX da edição salva na
 * tela de Notícias; os outros são o export de Deliberações, o documento de associado e os dois
 * relatórios de Qualidade (que dividem um caminho, com `?format=csv`).
 * `docs/PENDENCIAS.md:670` registrava só o primeiro.
 *
 * ⚠️ POR QUE LISTA FECHADA, e não cookie para todo GET. Aceitar cookie torna o GET acionável por
 * navegação vinda de outro site. Para leitura isso é inócuo — MENOS quando um GET tem efeito:
 * o GET de `antt/2026/collect` fazia scraping headless de até 80 reuniões sem guard nenhum (fechado
 * no commit anterior). Uma lista fechada é o que impede que o próximo GET com efeito herde esta
 * permissão por acidente. Conferi as sete rotas: todas só declaram GET e nenhuma tem
 * insert/update/upsert/delete.
 *
 * Rota nova de exportação que queira cookie precisa ENTRAR aqui explicitamente.
 */
const EXPORTACAO_POR_NAVEGACAO: ReadonlyArray<RegExp> = [
  /^\/api\/v1\/newsletter\/edicoes\/[^/]+\/(?:html|pdf|word|docx)$/,
  /^\/api\/v1\/deliberacoes\/export$/,
  /^\/api\/v1\/associados\/documentos\/[^/]+\/html$/,
  /^\/api\/v1\/qualidade-regulatoria\/relatorios\/ranking$/,
];

function ehExportacaoPorNavegacao(pathname: string): boolean {
  return EXPORTACAO_POR_NAVEGACAO.some((padrao) => padrao.test(pathname));
}

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
    // Sem header: só as rotas de exportação podem se autenticar pelo COOKIE da sessão.
    if (ehExportacaoPorNavegacao(pathname)) return autenticarPorCookie(req, supabaseUrl, anonKey);
    return NextResponse.json({ error: "Login obrigatório para consultar dados reais" }, { status: 401 });
  }

  const user = await getSupabaseUser(supabaseUrl, anonKey, token);
  if (!user?.id || !user.email) {
    return NextResponse.json({ error: "Sessão inválida" }, { status: 401 });
  }

  // VIEWER (ago/2026): GET é leitura — qualquer usuário AUTENTICADO no Supabase Auth
  // consulta (viewer = não-admin: só visualiza). As ESCRITAS continuam admin-only nos
  // guards das rotas (requireAdmin → 403 para viewer). Pré-requisito operacional:
  // signup público DESLIGADO no Supabase (só o admin cria usuários) — docs/PENDENCIAS.md.
  return NextResponse.next();
}

/**
 * Valida a sessão pelo COOKIE para uma rota de exportação, e devolve a resposta com os cookies
 * eventualmente RENOVADOS por `getUser()` — é o mesmo padrão de `requireAuthenticatedApp`, e é por
 * isso que `response` é reatribuído dentro do `setAll`.
 *
 * ⚠️ Devolve JSON 401 e não redireciona para `/login`. Quem chega aqui sem sessão é navegação
 * anônima a um endpoint de API; mandar para o login faria o `?next=` apontar para um caminho de API,
 * e o destino depois do login seria um download em vez de uma tela. O caso que este código existe
 * para resolver é o do usuário JÁ logado, cujo clique não carregava header.
 */
async function autenticarPorCookie(req: NextRequest, supabaseUrl: string, anonKey: string) {
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
    return NextResponse.json({ error: "Login obrigatório para exportar" }, { status: 401 });
  }
  return response;
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

  // VIEWER (ago/2026): sessão válida basta para VER o dashboard — usuário criado no
  // Supabase Auth que não é admin navega em somente-leitura (toda escrita é barrada
  // nos guards das rotas; a UI esconde as ações). Antes, e-mail fora de ADMIN_EMAILS
  // era expulso com "forbidden" — não existia nível de visualização.
  return response;
}

function isPublicAppPath(pathname: string): boolean {
  if (PUBLIC_APP_EXACT.has(pathname)) return true;
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



