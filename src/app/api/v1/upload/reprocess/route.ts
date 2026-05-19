import { waitUntil } from "@vercel/functions";
import { NextRequest, NextResponse } from "next/server";
import { isDemo } from "@/lib/server/is-demo";
import { requireAdmin } from "@/lib/server/request-guards";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const guard = await requireAdmin(req);
  if (guard) return guard;

  if (isDemo()) {
    return NextResponse.json({ error: "Reprocessamento indisponivel em modo DEMO." }, { status: 403 });
  }

  const body = await req.json().catch(() => ({}));
  const ids = Array.isArray(body.ids)
    ? body.ids.map((id: unknown) => String(id)).filter(Boolean).slice(0, 100)
    : [];

  if (ids.length === 0) {
    return NextResponse.json({ error: "Informe ao menos um documento para reprocessar." }, { status: 400 });
  }

  const { createSupabaseServerClient } = await import("@/lib/supabase/server");
  const { requeueDocument } = await import("@/lib/server/upload-queue");
  const { processQueue } = await import("@/lib/server/pipeline");
  const db = createSupabaseServerClient();

  const jobs: Array<{ jobId: string; agenciaId: string | null }> = [];
  const results: Array<{ document_id: string; job_id: string | null; status: "queued" | "error"; error?: string }> = [];

  for (const id of ids) {
    try {
      const result = await requeueDocument(db, id);
      jobs.push({ jobId: result.job_id, agenciaId: null });
      results.push({ document_id: result.document_id, job_id: result.job_id, status: "queued" });
    } catch (error) {
      results.push({
        document_id: id,
        job_id: null,
        status: "error",
        error: error instanceof Error ? error.message : "Erro ao reprocessar documento",
      });
    }
  }

  if (jobs.length > 0) waitUntil(processQueue(jobs.slice(0, 20), 2));
  return NextResponse.json({
    queued: results.filter((r) => r.status === "queued").length,
    errors: results.filter((r) => r.status === "error").length,
    results,
  });
}
