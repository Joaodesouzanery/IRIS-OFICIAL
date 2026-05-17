import { NextRequest, NextResponse } from "next/server";
import { isDemo } from "@/lib/server/is-demo";
import { requireAdmin } from "@/lib/server/request-guards";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { normalizeListaTriplicePayload } from "@/lib/server/agencias-crud";

export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const guard = await requireAdmin(req);
  if (guard) return guard;
  if (isDemo()) return NextResponse.json({ error: "Edição indisponível em modo demo" }, { status: 403 });

  try {
    const body = await req.json().catch(() => ({}));
    const payload = normalizeListaTriplicePayload(body);
    const db = createSupabaseServerClient();
    const { data, error } = await db
      .from("lista_triplice")
      .update(payload)
      .eq("id", params.id)
      .select()
      .single();

    if (error || !data) {
      return NextResponse.json({ error: "Erro ao atualizar lista tríplice" }, { status: 500 });
    }

    return NextResponse.json(data);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Payload inválido";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}

export async function PUT(
  req: NextRequest,
  context: { params: { id: string } }
) {
  return PATCH(req, context);
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const guard = await requireAdmin(req);
  if (guard) return guard;
  if (isDemo()) return NextResponse.json({ error: "Exclusão indisponível em modo demo" }, { status: 403 });

  const db = createSupabaseServerClient();
  const { error } = await db
    .from("lista_triplice")
    .delete()
    .eq("id", params.id);

  if (error) {
    return NextResponse.json({ error: "Erro ao excluir lista tríplice" }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
