import { NextRequest, NextResponse } from "next/server";
import { demoData } from "@/lib/demo-data";
import { isDemo } from "@/lib/server/is-demo";
import { isDemoRequest, requireAdmin } from "@/lib/server/request-guards";

export async function GET(
  req: NextRequest,
  { params }: any
) {
  if (isDemo() || isDemoRequest(req)) {
    const found = demoData.agencias().find((a) => a.id === params.id);
    if (!found) return NextResponse.json({ error: "Agência não encontrada" }, { status: 404 });
    return NextResponse.json(found);
  }

  const { createSupabaseServerClient } = await import("@/lib/supabase/server");
  const db = createSupabaseServerClient();
  const { data, error } = await db
    .from("agencias")
    .select("*")
    .eq("id", params.id)
    .single();

  if (error || !data) {
    return NextResponse.json({ error: "Agência não encontrada" }, { status: 404 });
  }

  return NextResponse.json(data);
}

export async function PATCH(
  req: NextRequest,
  { params }: any
) {
  const guard = await requireAdmin(req);
  if (guard) return guard;

  if (isDemo()) {
    return NextResponse.json(
      { error: "Edição não disponível em modo demo" },
      { status: 403 }
    );
  }

  const body = await req.json().catch(() => ({}));
  const updates: Record<string, unknown> = {};

  if ("sigla" in body) updates.sigla = String(body.sigla ?? "").trim().toUpperCase().slice(0, 20);
  for (const key of [
    "nome",
    "nome_completo",
    "tipo",
    "esfera",
    "ministerio_vinculado",
    "url_institucional",
    "url_diretores",
    "estado",
    "status",
    "ativo",
    "metadata",
  ]) {
    if (key in body) updates[key] = body[key];
  }

  if ("status" in updates) updates.ativo = updates.status === "ativa";
  if ("ativo" in updates && !("status" in updates)) updates.status = updates.ativo ? "ativa" : "inativa";
  updates.updated_at = new Date().toISOString();

  if (Object.keys(updates).length <= 1) {
    return NextResponse.json({ error: "Nenhum campo válido" }, { status: 400 });
  }

  const { createSupabaseServerClient } = await import("@/lib/supabase/server");
  const db = createSupabaseServerClient();
  const { data, error } = await db
    .from("agencias")
    .update(updates)
    .eq("id", params.id)
    .select()
    .single();

  if (error || !data) {
    return NextResponse.json({ error: "Falha ao atualizar agência" }, { status: 500 });
  }

  return NextResponse.json(data);
}

export async function PUT(
  req: NextRequest,
  context: any
) {
  return PATCH(req, context);
}

export async function DELETE(
  req: NextRequest,
  { params }: any
) {
  const guard = await requireAdmin(req);
  if (guard) return guard;

  if (isDemo()) {
    return NextResponse.json(
      { error: "Exclusão não disponível em modo demo" },
      { status: 403 }
    );
  }

  const { createSupabaseServerClient } = await import("@/lib/supabase/server");
  const db = createSupabaseServerClient();
  const { error } = await db
    .from("agencias")
    .delete()
    .eq("id", params.id);

  if (error) {
    return NextResponse.json({ error: "Falha ao excluir agência" }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
