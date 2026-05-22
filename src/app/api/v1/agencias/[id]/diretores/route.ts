import { NextRequest, NextResponse } from "next/server";
import { isDemo } from "@/lib/server/is-demo";
import { requireAdmin } from "@/lib/server/request-guards";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { normalizeDiretorPayload, upsertCurrentMandato } from "@/lib/server/agencias-crud";

export async function GET(
  _req: NextRequest,
  { params }: any
) {
  const db = createSupabaseServerClient();
  const { data, error } = await db
    .from("diretores")
    .select("*, mandatos(id, data_inicio, data_fim, cargo, percentual_mandato_concluido)")
    .eq("agencia_id", params.id)
    .order("ativo", { ascending: false })
    .order("nome", { ascending: true });

  if (error) {
    return NextResponse.json({ error: "Erro ao listar diretores" }, { status: 500 });
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
    const payload = normalizeDiretorPayload(body, params.id);
    const db = createSupabaseServerClient();
    const { data, error } = await db
      .from("diretores")
      .insert(payload)
      .select()
      .single();

    if (error || !data) {
      return NextResponse.json({ error: "Erro ao criar diretor" }, { status: 500 });
    }

    await upsertCurrentMandato(db, data.id, payload);
    return NextResponse.json(data, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Payload inválido";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
