import { NextRequest, NextResponse } from "next/server";
import { User } from "@supabase/supabase-js";
import { hasConfiguredAdminEmail, isConfiguredAdminEmail, isValidEmailFormat } from "@/lib/server/admin-emails";
import { adminUsersCount, timingSafeEqualStr } from "@/lib/server/request-guards";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  let body: { email?: string; password?: string; setup_token?: string };

  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "JSON inválido." }, { status: 400 });
  }

  const email = body.email?.trim().toLowerCase();
  const password = body.password ?? "";
  const setupToken = body.setup_token?.trim() ?? "";
  const requiredToken = process.env.IRIS_SETUP_TOKEN?.trim();

  if (!email || !password) {
    return NextResponse.json({ error: "Informe e-mail e senha." }, { status: 400 });
  }

  // Barra metacaracteres do PostgREST (vírgula/parênteses) antes que o e-mail
  // alcance o `.or(...)` de upsertAdminUser.
  if (!isValidEmailFormat(email)) {
    return NextResponse.json({ error: "E-mail inválido." }, { status: 400 });
  }

  if (password.length < 8) {
    return NextResponse.json({ error: "A senha precisa ter pelo menos 8 caracteres." }, { status: 400 });
  }

  // Fail-closed: /api/v1/auth/* faz bypass do middleware, então esta rota é pública.
  // Sem IRIS_SETUP_TOKEN ela criaria/reescreveria owner (inclusive reset de senha do
  // owner real) anonimamente — exige o token configurado e compara em tempo constante.
  if (!requiredToken) {
    return NextResponse.json({ error: "Setup indisponível: IRIS_SETUP_TOKEN não configurado." }, { status: 503 });
  }
  if (!timingSafeEqualStr(setupToken, requiredToken)) {
    return NextResponse.json({ error: "Código de setup inválido." }, { status: 403 });
  }

  if (hasConfiguredAdminEmail() && !isConfiguredAdminEmail(email)) {
    return NextResponse.json({ error: "Este e-mail não é o administrador global autorizado." }, { status: 403 });
  }

  // Fail-closed pós-bootstrap: este endpoint existe SÓ para o bootstrap inicial. Depois
  // que há um admin ativo, ele recusa — senão, gated apenas pelo IRIS_SETUP_TOKEN e SEM
  // rate-limit no projeto, vira vetor de takeover: brute-force do token → reset da senha
  // do owner existente (updateUserById abaixo). Rotação de senha passa a ser pelo fluxo
  // normal de redefinição do Supabase. `adminUsersCount` retorna 1 em erro (fail-closed);
  // se o admin_users ficou dessincronizado (owner no Auth mas sem linha ativa), o count=0
  // permite o retry de auto-cura.
  if ((await adminUsersCount()) > 0) {
    return NextResponse.json(
      { error: "Setup já concluído: já existe um administrador. Use a redefinição de senha do Supabase." },
      { status: 409 },
    );
  }

  const db = createSupabaseServerClient();
  let user: User | null = null;
  let reusedExistingUser = false;

  const { data: created, error: createError } = await db.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });

  if (created.user?.id) {
    user = created.user;
  } else if (createError && isAlreadyRegisteredError(createError.message)) {
    const existing = await findUserByEmail(email);
    if (!existing) {
      return NextResponse.json(
        { error: "Esse e-mail já existe no Supabase, mas não consegui localizar o usuário para atualizar a senha." },
        { status: 500 },
      );
    }

    const { data: updated, error: updateError } = await db.auth.admin.updateUserById(existing.id, {
      password,
      email_confirm: true,
    });

    if (updateError || !updated.user?.id) {
      return NextResponse.json(
        { error: updateError?.message ?? "Não foi possível atualizar a senha do usuário existente." },
        { status: 500 },
      );
    }

    user = updated.user;
    reusedExistingUser = true;
  } else {
    return NextResponse.json(
      { error: createError?.message ?? "Não foi possível criar o usuário global." },
      { status: 500 },
    );
  }

  const { data: permissionUser, error: permissionError } = await db.auth.admin.updateUserById(user.id, {
    app_metadata: {
      ...(user.app_metadata ?? {}),
      iris_owner: true,
      iris_role: "owner",
    },
  });

  if (permissionError || !permissionUser.user?.id) {
    return NextResponse.json(
      { error: permissionError?.message ?? "Conta criada, mas falhou ao gravar permissão no Auth." },
      { status: 500 },
    );
  }

  const adminResult = await upsertAdminUser(user.id, email);

  return NextResponse.json({
    email,
    role: adminResult.ok ? adminResult.role : "owner",
    created: !reusedExistingUser,
    reused_existing_user: reusedExistingUser,
    admin_table_synced: adminResult.ok,
    warning: adminResult.ok ? null : adminResult.error,
  });
}

async function findUserByEmail(email: string): Promise<User | null> {
  const db = createSupabaseServerClient();

  for (let page = 1; page <= 10; page += 1) {
    const { data, error } = await db.auth.admin.listUsers({ page, perPage: 100 });
    if (error) return null;
    const match = data.users.find((user) => user.email?.toLowerCase() === email);
    if (match) return match;
    if (data.users.length < 100) return null;
  }

  return null;
}

async function upsertAdminUser(userId: string, email: string): Promise<{ ok: true; role: string } | { ok: false; error: string }> {
  const db = createSupabaseServerClient();

  const { data: existing } = await db
    .from("admin_users")
    .select("id")
    .or(`user_id.eq.${userId},email.eq.${email}`)
    .maybeSingle();

  if (existing?.id) {
    const updateWithRole = async (role: "owner" | "admin") =>
      db
        .from("admin_users")
        .update({
          user_id: userId,
          email,
          role,
          active: true,
        })
        .eq("id", existing.id)
        .select("id, role")
        .single();

    let { data, error } = await updateWithRole("owner");
    if (error && error.code === "23514") {
      const fallback = await updateWithRole("admin");
      data = fallback.data;
      error = fallback.error;
    }
    if (error || !data) return { ok: false, error: "Falhou ao reativar permissão administrativa." };
    return { ok: true, role: data.role };
  }

  const createWithRole = async (role: "owner" | "admin") =>
    db
      .from("admin_users")
      .insert({
        user_id: userId,
        email,
        role,
        active: true,
      })
      .select("id, role")
      .single();

  let { data, error } = await createWithRole("owner");
  if (error && error.code === "23514") {
    const fallback = await createWithRole("admin");
    data = fallback.data;
    error = fallback.error;
  }
  if (error || !data) return { ok: false, error: "Falhou ao registrar permissão administrativa." };
  return { ok: true, role: data.role };
}

function isAlreadyRegisteredError(message: string): boolean {
  const normalized = message.toLowerCase();
  return normalized.includes("already") || normalized.includes("registered") || normalized.includes("exists");
}
