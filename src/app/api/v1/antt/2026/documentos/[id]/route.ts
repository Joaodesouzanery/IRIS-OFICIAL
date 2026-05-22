import { NextRequest, NextResponse } from "next/server";
import { isDemo } from "@/lib/server/is-demo";
import { requireAdmin } from "@/lib/server/request-guards";

const SAFE_ID_RE = /^[0-9a-f-]{32,36}$/i;
const STATUS_RE = /^(coletado|validado|em_revisao|importado|ignorado|erro)$/;

export async function PATCH(
  req: NextRequest,
  { params }: any,
) {
  const guard = await requireAdmin(req);
  if (guard) return guard;

  if (!SAFE_ID_RE.test(params.id)) {
    return NextResponse.json({ error: "ID invalido" }, { status: 400 });
  }

  if (isDemo()) {
    return NextResponse.json({ error: "Edicao indisponivel em modo demo" }, { status: 403 });
  }

  const body = await req.json().catch(() => ({}));
  const status = typeof body.status === "string" ? body.status : "";
  if (!STATUS_RE.test(status)) {
    return NextResponse.json({ error: "Status invalido" }, { status: 400 });
  }

  const validation_status =
    status === "validado" || status === "importado" ? "ok"
    : status === "ignorado" ? "rejeitado"
    : status === "erro" ? "erro"
    : "pendente";

  const { createSupabaseServerClient } = await import("@/lib/supabase/server");
  const db = createSupabaseServerClient();
  const { data, error } = await db
    .from("documentos_coletados")
    .update({
      status,
      validation_status,
      error_message: status === "erro" && typeof body.error_message === "string"
        ? body.error_message.slice(0, 1000)
        : null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", params.id)
    .select("*")
    .single();

  if (error || !data) {
    return NextResponse.json({ error: "Falha ao atualizar documento" }, { status: 500 });
  }

  return NextResponse.json(data);
}
