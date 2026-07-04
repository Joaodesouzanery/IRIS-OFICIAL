import { NextRequest, NextResponse } from "next/server";
import { isDemo } from "@/lib/server/is-demo";
import { requireAdmin, getAuthenticatedUser } from "@/lib/server/request-guards";
import { aprovarCandidato } from "@/lib/server/candidato-approval";

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export async function POST(
  req: NextRequest,
  { params }: any,
) {
  const guard = await requireAdmin(req);
  if (guard) return guard;

  if (isDemo()) {
    return NextResponse.json({ id: params.id, review_status: "aprovado", persisted: false });
  }

  const userResult = await getAuthenticatedUser(req);
  const reviewedBy = userResult instanceof NextResponse ? null : userResult.email;

  const body = await req.json().catch(() => ({}));
  const { createSupabaseServerClient } = await import("@/lib/supabase/server");
  const db = createSupabaseServerClient();

  const { data: candidato, error } = await db
    .from("diretor_candidatos")
    .select("*")
    .eq("id", params.id)
    .single();

  if (error || !candidato) {
    return NextResponse.json({ error: "Candidato nao encontrado" }, { status: 404 });
  }

  try {
    const result = await aprovarCandidato(db, candidato, {
      cargo: typeof body.cargo === "string" ? body.cargo : null,
      diretorId: typeof body.diretor_id === "string" && body.diretor_id ? body.diretor_id : null,
      dataInicio: typeof body.data_inicio === "string" && ISO_DATE_RE.test(body.data_inicio) ? body.data_inicio : null,
      dataFim: typeof body.data_fim === "string" && ISO_DATE_RE.test(body.data_fim) ? body.data_fim : null,
      reviewedBy,
    });

    return NextResponse.json({
      id: params.id,
      diretor_id: result.diretorId,
      mandato_id: result.mandatoId,
      review_status: "aprovado",
      votos_retroativos: result.votosRetroativos,
    });
  } catch (e) {
    console.error("[candidatos/aprovar] Falha ao aprovar candidato:", e);
    return NextResponse.json({ error: "Erro ao criar diretor" }, { status: 500 });
  }
}
