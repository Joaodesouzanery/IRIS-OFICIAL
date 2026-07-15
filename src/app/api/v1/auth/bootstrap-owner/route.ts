import { NextRequest, NextResponse } from "next/server";
import { hasConfiguredAdminEmail, isConfiguredAdminEmail } from "@/lib/server/admin-emails";
import { getAuthenticatedUser, isAdminUser } from "@/lib/server/request-guards";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const userResult = await getAuthenticatedUser(req);
  if (userResult instanceof NextResponse) return userResult;

  // Fail-closed: /api/v1/auth/* faz bypass do middleware. Sem allowlist configurada,
  // qualquer usuário autenticado se auto-promovia a owner. Exige a allowlist E que o
  // e-mail do chamador bata.
  if (!hasConfiguredAdminEmail()) {
    return NextResponse.json(
      { error: "Bootstrap indisponível: configure IRIS_OWNER_EMAIL/ADMIN_EMAILS antes." },
      { status: 503 },
    );
  }
  if (!isConfiguredAdminEmail(userResult.email)) {
    return NextResponse.json({ error: "Este e-mail não é o administrador global autorizado." }, { status: 403 });
  }

  // A allowlist obrigatória acima é o gate real: só e-mail em IRIS_OWNER_EMAIL/ADMIN_EMAILS
  // chega aqui, e para esse e-mail `isAdminUser` já é true (via isConfiguredAdminEmail),
  // então o caminho de concessão abaixo é idempotente (retorna "já é owner").
  const alreadyAdmin = await isAdminUser(userResult);
  if (alreadyAdmin) {
    return NextResponse.json({ user: userResult, role: "owner", created: false });
  }

  const db = createSupabaseServerClient();
  const { data: updated, error: updateError } = await db.auth.admin.updateUserById(userResult.id, {
    app_metadata: {
      ...(userResult.app_metadata ?? {}),
      iris_owner: true,
      iris_role: "owner",
    },
  });

  if (updateError || !updated.user?.id) {
    return NextResponse.json(
      { error: updateError?.message ?? "Erro ao registrar permissão administrativa no Auth." },
      { status: 500 },
    );
  }

  const adminResult = await upsertAdminUser(userResult.id, userResult.email);

  return NextResponse.json({
    user: userResult,
    role: adminResult.ok ? adminResult.role : "owner",
    created: true,
    admin_table_synced: adminResult.ok,
    warning: adminResult.ok ? null : adminResult.error,
  });
}

async function upsertAdminUser(userId: string, email: string): Promise<{ ok: true; role: string } | { ok: false; error: string }> {
  const db = createSupabaseServerClient();

  const { data: existing, error: findError } = await db
    .from("admin_users")
    .select("id")
    .eq("user_id", userId)
    .maybeSingle();

  if (findError) return { ok: false, error: findError.message };

  const write = existing?.id
    ? async (role: "owner" | "admin") =>
        db
          .from("admin_users")
          .update({ email, role, active: true })
          .eq("id", existing.id)
          .select("id, role")
          .single()
    : async (role: "owner" | "admin") =>
        db
          .from("admin_users")
          .insert({ user_id: userId, email, role, active: true })
          .select("id, role")
          .single();

  let { data, error } = await write("owner");
  if (error && error.code === "23514") {
    const fallback = await write("admin");
    data = fallback.data;
    error = fallback.error;
  }

  if (error || !data) return { ok: false, error: error?.message ?? "Falhou ao sincronizar admin_users." };
  return { ok: true, role: data.role };
}
