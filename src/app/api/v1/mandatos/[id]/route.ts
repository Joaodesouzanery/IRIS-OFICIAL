/**
 * PATCH/DELETE /api/v1/mandatos/[id]
 * Edição administrativa de um mandato (datas/cargo) e remoção.
 */

import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/server/request-guards";
import { isoDateOrNull } from "@/lib/server/diretores-admin";

const SAFE_ID_RE = /^[a-zA-Z0-9_-]+$/;

export async function PATCH(req: NextRequest, { params }: any) {
  const guard = await requireAdmin(req);
  if (guard) return guard;

  const { id } = params;
  if (!id || !SAFE_ID_RE.test(id)) {
    return NextResponse.json({ error: "ID inválido" }, { status: 400 });
  }

  const body = await req.json().catch(() => ({})) as Record<string, unknown>;
  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if ("data_inicio" in body) {
    const di = isoDateOrNull(body.data_inicio);
    if (!di) return NextResponse.json({ error: "data_inicio inválida (YYYY-MM-DD)" }, { status: 400 });
    patch.data_inicio = di;
  }
  if ("data_fim" in body) patch.data_fim = isoDateOrNull(body.data_fim);
  if ("cargo" in body) patch.cargo = body.cargo ? String(body.cargo).slice(0, 100) : null;

  const { createSupabaseServerClient } = await import("@/lib/supabase/server");
  const db = createSupabaseServerClient();
  const { data, error } = await db.from("mandatos").update(patch).eq("id", id).select("*").single();
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json(data);
}

export async function DELETE(req: NextRequest, { params }: any) {
  const guard = await requireAdmin(req);
  if (guard) return guard;

  const { id } = params;
  if (!id || !SAFE_ID_RE.test(id)) {
    return NextResponse.json({ error: "ID inválido" }, { status: 400 });
  }

  const { createSupabaseServerClient } = await import("@/lib/supabase/server");
  const db = createSupabaseServerClient();
  const { error } = await db.from("mandatos").delete().eq("id", id);
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ deleted: true, id });
}
