/**
 * GET /api/v1/agencias/[id]    — detalhe
 * PATCH /api/v1/agencias/[id]  — editar
 */

import { NextRequest, NextResponse } from "next/server";
import { demoData } from "@/lib/demo-data";
import { isDemo } from "@/lib/server/is-demo";
import { isDemoRequest, requireAdmin } from "@/lib/server/request-guards";


export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } }
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
  { params }: { params: { id: string } }
) {
  const guard = await requireAdmin(req);
  if (guard) return guard;

  if (isDemo()) {
    return NextResponse.json(
      { error: "Edição não disponível em modo demo" },
      { status: 403 }
    );
  }

  const body = await req.json();
  const allowed = ["nome", "nome_completo", "ativo"];
  const updates: Record<string, unknown> = {};

  for (const key of allowed) {
    if (key in body) updates[key] = body[key];
  }

  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: "Nenhum campo válido" }, { status: 400 });
  }

  updates.updated_at = new Date().toISOString();

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
