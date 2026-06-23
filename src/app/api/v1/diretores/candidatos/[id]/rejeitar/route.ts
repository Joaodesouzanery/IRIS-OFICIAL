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

  const { error } = await db
    .from("diretor_candidatos")
    .update({
      review_status: "rejeitado",
      reviewed_at: new Date().toISOString(),
      reviewed_by: reviewedBy,
    })
    .eq("id", params.id);

  if (error) {
    return NextResponse.json({ error: "Erro ao rejeitar candidato" }, { status: 500 });
  }

  return NextResponse.json({ id: params.id, review_status: "rejeitado" });
}
