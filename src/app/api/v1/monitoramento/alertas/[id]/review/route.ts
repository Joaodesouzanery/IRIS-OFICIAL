import { NextRequest, NextResponse } from "next/server";
import { isDemo } from "@/lib/server/is-demo";
import { requireAdmin } from "@/lib/server/request-guards";

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  const guard = await requireAdmin(req);
  if (guard) return guard;

  if (isDemo()) {
    return NextResponse.json({
      alerta_id: params.id,
      status: "em_revisao",
      message: "Abra o documento e envie os PDFs na tela de Upload para revisão.",
    });
  }

  const { createSupabaseServerClient } = await import("@/lib/supabase/server");
  const db = createSupabaseServerClient();

  const { data: alerta, error } = await db
    .from("monitoramento_alertas")
    .update({ lido: true })
    .eq("id", params.id)
    .select("id, item_id, url_item")
    .single();

  if (error || !alerta) {
    return NextResponse.json({ error: "Alerta não encontrado" }, { status: 404 });
  }

  await db
    .from("monitoramento_itens")
    .update({ status: "em_revisao" })
    .eq("id", alerta.item_id);

  return NextResponse.json({
    alerta_id: alerta.id,
    item_id: alerta.item_id,
    status: "em_revisao",
    url_item: alerta.url_item,
  });
}
