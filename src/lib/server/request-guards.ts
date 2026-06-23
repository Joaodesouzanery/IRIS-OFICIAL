import crypto from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { isConfiguredAdminEmail } from "@/lib/server/admin-emails";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { isDemo } from "@/lib/server/is-demo";

export interface AuthenticatedUser {
  id: string;
  email: string;
  app_metadata?: Record<string, unknown>;
}

export function isDemoRequest(req: NextRequest): boolean {
  return req.headers.get("x-iris-demo") === "1" || req.nextUrl.searchParams.get("demo") === "1";
}

export function isDemoWriteBlocked(req: NextRequest): NextResponse | null {
  if (!isDemoRequest(req)) return null;
  return NextResponse.json(
    { error: "Modo DEMO e somente leitura. Desligue o DEMO para gravar dados reais." },
    { status: 403 },
  );
}

function extractBearer(req: NextRequest): string {
  const authHeader = req.headers.get("authorization");
  return authHeader?.startsWith("Bearer ") ? authHeader.slice("Bearer ".length).trim() : "";
}

// Comparação de tempo constante para evitar timing attacks no token de cron.
function timingSafeEqualStr(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

type CronAuthResult = "ok" | "missing_secret" | "bad_token";

function evaluateCronAuth(req: NextRequest): CronAuthResult {
  const secret = process.env.CRON_SECRET;
  if (!secret) return "missing_secret";
  const token = extractBearer(req);
  return token && timingSafeEqualStr(token, secret) ? "ok" : "bad_token";
}

// Distingue "config ausente" (503, erro do servidor) de "token inválido" (401),
// e loga cada caso para que falhas de cron não passem silenciosas nos Runtime Logs.
export function requireCron(req: NextRequest, label = "cron"): NextResponse | null {
  const result = evaluateCronAuth(req);
  if (result === "missing_secret") {
    console.error(`[cron-auth] CRON_SECRET não configurado — ${label} não pode autenticar`);
    return NextResponse.json({ error: "CRON_SECRET não configurado" }, { status: 503 });
  }
  if (result === "bad_token") {
    console.warn(`[cron-auth] token inválido em ${label}`);
    return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
  }
  return null;
}

export async function requireAdmin(req: NextRequest): Promise<NextResponse | null> {
  const demoBlocked = isDemoWriteBlocked(req);
  if (demoBlocked) return demoBlocked;
  if (isDemo()) {
    return NextResponse.json(
      { error: "Operação de escrita indisponível sem Supabase configurado." },
      { status: 403 },
    );
  }

  try {
    const userResult = await getAuthenticatedUser(req);
    if (userResult instanceof NextResponse) return userResult;
    const user = userResult;

    if (isConfiguredAdminEmail(user.email) || isAppMetadataAdmin(user)) return null;

    const db = createSupabaseServerClient();
    const { data: admin, error } = await db
      .from("admin_users")
      .select("id, active, role")
      .eq("user_id", user.id)
      .eq("active", true)
      .maybeSingle();

    if (error) {
      console.warn("[auth] Falha ao consultar admin_users:", error.message);
    }

    if (!admin || !["owner", "admin"].includes(String(admin.role))) {
      return NextResponse.json({ error: "Usuário sem permissão administrativa" }, { status: 403 });
    }

    return null;
  } catch (error) {
    const message = error instanceof Error ? error.message : "Falha de autenticação";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function getAuthenticatedUser(req: NextRequest): Promise<AuthenticatedUser | NextResponse> {
  const authHeader = req.headers.get("authorization");
  const token = authHeader?.startsWith("Bearer ") ? authHeader.slice("Bearer ".length).trim() : "";
  if (!token) {
    return NextResponse.json({ error: "Login administrativo obrigatório" }, { status: 401 });
  }

  const db = createSupabaseServerClient();
  const { data: userResult, error: userError } = await db.auth.getUser(token);
  const user = userResult?.user;
  if (userError || !user?.id || !user.email) {
    return NextResponse.json({ error: "Sessão inválida" }, { status: 401 });
  }

  return { id: user.id, email: user.email, app_metadata: user.app_metadata };
}

export async function isAdminUser(user: AuthenticatedUser): Promise<boolean> {
  if (isConfiguredAdminEmail(user.email) || isAppMetadataAdmin(user)) return true;
  const db = createSupabaseServerClient();
  const { data } = await db
    .from("admin_users")
    .select("id, role, active")
    .eq("user_id", user.id)
    .eq("active", true)
    .maybeSingle();
  return Boolean(data && ["owner", "admin"].includes(String(data.role)));
}

export function isAppMetadataAdmin(user: AuthenticatedUser): boolean {
  const role = user.app_metadata?.iris_role;
  const owner = user.app_metadata?.iris_owner;
  return role === "owner" || role === "admin" || owner === true;
}

export async function adminUsersCount(): Promise<number> {
  const db = createSupabaseServerClient();
  const { count, error } = await db
    .from("admin_users")
    .select("id", { count: "exact", head: true })
    .eq("active", true);
  if (error) {
    console.warn("[auth] Falha ao contar admin_users:", error.message);
    return 1;
  }
  return count ?? 0;
}

export async function requireAdminOrCron(req: NextRequest, label = "cron"): Promise<NextResponse | null> {
  const demoBlocked = isDemoWriteBlocked(req);
  if (demoBlocked) return demoBlocked;

  const result = evaluateCronAuth(req);
  if (result === "ok") return null;

  // Bearer presente mas CRON_SECRET ausente: torna a falha silenciosa observável
  // (antes caía direto no fluxo admin e retornava 401 sem pista da causa).
  if (result === "missing_secret" && extractBearer(req)) {
    console.error(`[cron-auth] CRON_SECRET ausente; requisição com Bearer em ${label} caiu para fluxo admin`);
  }

  return requireAdmin(req);
}

// Indica se o segredo de cron está configurado — usado por endpoints de saúde.
export function hasCronSecret(): boolean {
  return Boolean(process.env.CRON_SECRET);
}
