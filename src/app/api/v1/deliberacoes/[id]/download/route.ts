import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/server/request-guards";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const guard = await requireAdmin(req);
  if (guard) return guard;

  const { id } = await params;
  const { createSupabaseServerClient } = await import("@/lib/supabase/server");
  const db = createSupabaseServerClient();

  const { data: deliberacao, error } = await db
    .from("deliberacoes")
    .select("id, upload_job_id, upload_jobs(storage_path)")
    .eq("id", id)
    .single();

  if (error || !deliberacao?.upload_job_id) {
    return NextResponse.json({ error: "Anexo não encontrado" }, { status: 404 });
  }

  const uploadJob = Array.isArray(deliberacao.upload_jobs)
    ? deliberacao.upload_jobs[0]
    : deliberacao.upload_jobs;
  const storagePath = uploadJob?.storage_path;
  if (!storagePath) {
    return NextResponse.json({ error: "Caminho do anexo não encontrado" }, { status: 404 });
  }

  const { data, error: signedError } = await db.storage
    .from("pdfs")
    .createSignedUrl(storagePath, 60);

  if (signedError || !data?.signedUrl) {
    return NextResponse.json({ error: "Falha ao gerar URL assinada" }, { status: 500 });
  }

  return NextResponse.json({ url: data.signedUrl, expires_in: 60 });
}
