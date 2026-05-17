import { NextRequest, NextResponse } from "next/server";
import { isDemo } from "@/lib/server/is-demo";
import { requireAdmin } from "@/lib/server/request-guards";

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  const guard = await requireAdmin(req);
  if (guard) return guard;

  if (isDemo()) {
    return NextResponse.json({ id: params.id, review_status: "aprovado", persisted: false });
  }

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

  const cargo = typeof body.cargo === "string" && body.cargo.trim()
    ? body.cargo.trim().slice(0, 120)
    : candidato.cargo_detectado;
  const existingDiretorId = typeof body.diretor_id === "string" && body.diretor_id
    ? body.diretor_id
    : candidato.diretor_id;

  let diretorId = existingDiretorId;
  if (!diretorId) {
    const { data: diretor, error: diretorErr } = await db
      .from("diretores")
      .insert({
        agencia_id: candidato.agencia_id,
        nome: candidato.nome_detectado,
        cargo,
        needs_review: false,
        review_status: "aprovado",
        source_url: candidato.source_url,
        source_type: candidato.source_type,
        source_hash: candidato.source_hash,
        source_confidence: candidato.confidence,
        lgpd_basis: "public_official_function",
        last_verified_at: new Date().toISOString(),
      })
      .select("id")
      .single();

    if (diretorErr || !diretor) {
      return NextResponse.json({ error: "Erro ao criar diretor" }, { status: 500 });
    }
    diretorId = diretor.id;
  } else {
    await db
      .from("diretores")
      .update({
        needs_review: false,
        review_status: "aprovado",
        cargo,
        source_url: candidato.source_url,
        source_type: candidato.source_type,
        source_hash: candidato.source_hash,
        source_confidence: candidato.confidence,
        last_verified_at: new Date().toISOString(),
      })
      .eq("id", diretorId);
  }

  const data_inicio = typeof body.data_inicio === "string" && ISO_DATE_RE.test(body.data_inicio)
    ? body.data_inicio
    : null;
  const data_fim = typeof body.data_fim === "string" && ISO_DATE_RE.test(body.data_fim)
    ? body.data_fim
    : null;

  let mandatoId: string | null = null;
  if (data_inicio) {
    const { data: mandato } = await db
      .from("mandatos")
      .insert({
        diretor_id: diretorId,
        data_inicio,
        data_fim,
        cargo,
        review_status: "aprovado",
        source_url: candidato.source_url,
        source_type: candidato.source_type,
        source_hash: candidato.source_hash,
        source_confidence: candidato.confidence,
        lgpd_basis: "public_official_function",
        last_verified_at: new Date().toISOString(),
      })
      .select("id")
      .single();
    mandatoId = mandato?.id ?? null;
  }

  await db
    .from("diretor_candidatos")
    .update({
      diretor_id: diretorId,
      review_status: "aprovado",
      reviewed_at: new Date().toISOString(),
    })
    .eq("id", params.id);

  return NextResponse.json({
    id: params.id,
    diretor_id: diretorId,
    mandato_id: mandatoId,
    review_status: "aprovado",
  });
}
