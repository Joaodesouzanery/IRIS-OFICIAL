import { NextRequest, NextResponse } from "next/server";
import { isDemo } from "@/lib/server/is-demo";
import { requireAdmin } from "@/lib/server/request-guards";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const guard = await requireAdmin(req);
  if (guard) return guard;

  if (isDemo()) {
    return NextResponse.json({ error: "Limpeza de fila indisponivel em modo DEMO." }, { status: 403 });
  }

  const body = await req.json().catch(() => ({}));
  if (body.confirm !== "LIMPAR FILA DE TESTES") {
    return NextResponse.json({ error: "Confirmacao invalida para limpar a fila." }, { status: 400 });
  }

  const { createSupabaseServerClient } = await import("@/lib/supabase/server");
  const db = createSupabaseServerClient();
  const { data: docs, error } = await db
    .from("documentos_regulatorios")
    .select("id, upload_job_id, storage_bucket, storage_path, status")
    .neq("status", "confirmed")
    .limit(1000);

  if (error) {
    return NextResponse.json({ error: "Erro ao buscar documentos da fila" }, { status: 500 });
  }

  const rows = docs ?? [];
  const ids = rows.map((doc) => doc.id as string);
  const jobIds = rows.map((doc) => doc.upload_job_id as string | null).filter((id): id is string => Boolean(id));
  const pathsByBucket = new Map<string, string[]>();
  for (const doc of rows) {
    const bucket = (doc.storage_bucket as string | null) ?? "pdfs";
    const path = doc.storage_path as string | null;
    if (!path) continue;
    pathsByBucket.set(bucket, [...(pathsByBucket.get(bucket) ?? []), path]);
  }

  for (const [bucket, paths] of pathsByBucket) {
    await db.storage.from(bucket).remove([...new Set(paths)]);
  }

  if (ids.length > 0) {
    await db.from("documentos_regulatorios").delete().in("id", ids);
  }
  let deletedJobs = 0;
  if (jobIds.length > 0) {
    const uniqueJobIds = [...new Set(jobIds)];
    const { data: usedJobs } = await db
      .from("deliberacoes")
      .select("upload_job_id")
      .in("upload_job_id", uniqueJobIds);
    const protectedJobIds = new Set((usedJobs ?? []).map((row) => row.upload_job_id).filter(Boolean));
    const deletableJobIds = uniqueJobIds.filter((id) => !protectedJobIds.has(id));
    if (deletableJobIds.length > 0) {
      await db.from("upload_jobs").delete().in("id", deletableJobIds);
      deletedJobs = deletableJobIds.length;
    }
  }

  return NextResponse.json({
    deleted_documents: ids.length,
    deleted_jobs: deletedJobs,
    deleted_files: [...pathsByBucket.values()].reduce((sum, paths) => sum + new Set(paths).size, 0),
  });
}
