import { NextRequest, NextResponse } from "next/server";
import { isDemo } from "@/lib/server/is-demo";
import { requireAdmin, getAuthenticatedUser } from "@/lib/server/request-guards";

export async function POST(req: NextRequest, { params }: any) {
  const guard = await requireAdmin(req);
  if (guard) return guard;

  if (isDemo()) {
    return NextResponse.json({ id: params.id, review_status: "rejeitado", persisted: false });
  }

  const userResult = await getAuthenticatedUser(req);
  const reviewedBy = userResult instanceof NextResponse ? null : userResult.email;

  const { createSupabaseServerClient } = await import("@/lib/supabase/server");
  const db = createSupabaseServerClient();

  const { data: candidato } = await db
    .from("diretor_candidatos")
    .select("id, agencia_id, nome_detectado")
    .eq("id", params.id)
    .single();

  const patch = {
    review_status: "rejeitado",
    reviewed_at: new Date().toISOString(),
    reviewed_by: reviewedBy,
  };

  // CASCATA por nome: rejeita também os demais cartões pendentes do mesmo nome
  // (o mesmo nome gera 1 cartão por documento — rejeitar um resolve todos).
  if (candidato?.agencia_id && candidato?.nome_detectado) {
    await db
      .from("diretor_candidatos")
      .update(patch)
      .eq("agencia_id", candidato.agencia_id)
      .eq("nome_detectado", candidato.nome_detectado)
      .eq("review_status", "pendente");
  }

  const { error } = await db
    .from("diretor_candidatos")
    .update(patch)
    .eq("id", params.id);

  if (error) {
    return NextResponse.json({ error: "Erro ao rejeitar candidato" }, { status: 500 });
  }

  return NextResponse.json({ id: params.id, review_status: "rejeitado" });
}
