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

export function requireCron(req: NextRequest): NextResponse | null {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    return NextResponse.json({ error: "CRON_SECRET não configurado" }, { status: 503 });
  }
  const authHeader = req.headers.get("authorization");
  if (authHeader !== `Bearer ${secret}`) {
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

export async function requireAdminOrCron(req: NextRequest): Promise<NextResponse | null> {
  const demoBlocked = isDemoWriteBlocked(req);
  if (demoBlocked) return demoBlocked;

  const cronSecret = process.env.CRON_SECRET;
  const authHeader = req.headers.get("authorization");
  if (cronSecret && authHeader === `Bearer ${cronSecret}`) return null;

  return requireAdmin(req);
}
