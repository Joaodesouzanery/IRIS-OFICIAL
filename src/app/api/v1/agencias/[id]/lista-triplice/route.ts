import { NextRequest, NextResponse } from "next/server";
import { isDemo } from "@/lib/server/is-demo";
import { requireAdmin } from "@/lib/server/request-guards";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { normalizeListaTriplicePayload } from "@/lib/server/agencias-crud";

export async function GET(
  _req: NextRequest,
  { params }: any
) {
  const db = createSupabaseServerClient();
  const { data, error } = await db
    .from("lista_triplice")
    .select("*")
    .eq("agencia_id", params.id)
    .order("created_at", { ascending: false });

  if (error) {
    return NextResponse.json({ error: "Erro ao listar lista tríplice" }, { status: 500 });
  }

  return NextResponse.json(data ?? []);
}

export async function POST(
  req: NextRequest,
  { params }: any
) {
  const guard = await requireAdmin(req);
  if (guard) return guard;
  if (isDemo()) return NextResponse.json({ error: "Cadastro indisponível em modo demo" }, { status: 403 });

  try {
    const body = await req.json().catch(() => ({}));
    const payload = normalizeListaTriplicePayload(body, params.id);
    const db = createSupabaseServerClient();
    const { data, error } = await db
      .from("lista_triplice")
      .insert(payload)
      .select()
      .single();

    if (error || !data) {
      return NextResponse.json({ error: "Erro ao criar item de lista tríplice" }, { status: 500 });
    }

    return NextResponse.json(data, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Payload inválido";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
