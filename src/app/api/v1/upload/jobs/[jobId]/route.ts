/**
 * GET /api/v1/upload/jobs/[jobId]
 * Retorna status de um job de upload.
 */

import { NextRequest, NextResponse } from "next/server";
import { isDemo } from "@/lib/server/is-demo";
import { isDemoRequest } from "@/lib/server/request-guards";


export async function GET(
  req: NextRequest,
  { params }: { params: { jobId: string } }
) {
  if (isDemo() || isDemoRequest(req)) {
    return NextResponse.json({ error: "Job não encontrado" }, { status: 404 });
  }

  const { createSupabaseServerClient } = await import("@/lib/supabase/server");
  const db = createSupabaseServerClient();
  const { data, error } = await db
    .from("upload_jobs")
    .select("id, filename, status, error_message, documento_id, created_at, updated_at")
    .eq("id", params.jobId)
    .single();

  if (error || !data) {
    return NextResponse.json({ error: "Job não encontrado" }, { status: 404 });
  }

  return NextResponse.json(data);
}
