import { NextRequest, NextResponse } from "next/server";
import { isDemo } from "@/lib/server/is-demo";
import { isDemoRequest, requireAdmin } from "@/lib/server/request-guards";
import type { RegulatoryNewsStatus } from "@/types";

const STATUS = new Set<RegulatoryNewsStatus>(["novo", "selecionado", "ignorado", "arquivado"]);

export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  if (isDemo() || isDemoRequest(req)) {
    return NextResponse.json({ error: "Curadoria indisponível em modo demo" }, { status: 403 });
  }

  const guard = await requireAdmin(req);
  if (guard) return guard;

  const body = await req.json().catch(() => ({}));
  const status = body.status_curadoria;
  if (!STATUS.has(status)) {
    return NextResponse.json({ error: "status_curadoria inválido" }, { status: 400 });
  }

  const { createSupabaseServerClient } = await import("@/lib/supabase/server");
  const db = createSupabaseServerClient();
  const { data, error } = await db
    .from("regulatory_news")
    .update({ status_curadoria: status })
    .eq("id", params.id)
    .select("*, agencia:agencias(sigla, nome)")
    .single();

  if (error || !data) {
    return NextResponse.json({ error: "Erro ao atualizar notícia" }, { status: 500 });
  }

  return NextResponse.json(data);
}
