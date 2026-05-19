/**
 * POST /api/v1/upload/batch
 * Salva PDFs/ZIPs no Storage e cria uma fila persistida.
 * O processamento acontece em /api/v1/upload/process ou via waitUntil.
 */

import { NextRequest, NextResponse } from "next/server";
import { waitUntil } from "@vercel/functions";
import { isDemo } from "@/lib/server/is-demo";
import { requireAdmin } from "@/lib/server/request-guards";

const MAX_TOTAL_SIZE = 150 * 1024 * 1024;
const MAX_FILES_PER_BATCH = 500;

type ExpandedUpload = {
  name: string;
  buffer: Buffer;
  source_archive: string | null;
  size: number;
};

export async function POST(req: NextRequest) {
  const guard = await requireAdmin(req);
  if (guard) return guard;

  if (isDemo()) {
    return NextResponse.json(
      { error: "Upload real indisponivel em modo DEMO." },
      { status: 403 },
    );
  }

  try {
    const formData = await req.formData();
    const files = formData.getAll("files") as File[];
    const agenciaIdRaw = formData.get("agencia_id");
    const fallbackAgenciaId = typeof agenciaIdRaw === "string" && agenciaIdRaw ? agenciaIdRaw : null;

    if (files.length === 0) {
      return NextResponse.json({ error: "Nenhum arquivo enviado" }, { status: 400 });
    }

    if (files.length > MAX_FILES_PER_BATCH) {
      return NextResponse.json({ error: `Maximo de ${MAX_FILES_PER_BATCH} arquivos por lote` }, { status: 400 });
    }

    const totalSize = files.reduce((sum, file) => sum + file.size, 0);
    if (totalSize > MAX_TOTAL_SIZE) {
      return NextResponse.json({ error: `Tamanho total excede ${MAX_TOTAL_SIZE / 1024 / 1024} MB` }, { status: 413 });
    }

    const { createSupabaseServerClient } = await import("@/lib/supabase/server");
    const { isZipBuffer, extractPdfEntriesFromZip } = await import("@/lib/server/zip-extractor");
    const { processQueue } = await import("@/lib/server/pipeline");
    const { enqueuePdfBuffer, ensurePdfStorageBucket } = await import("@/lib/server/upload-queue");

    const db = createSupabaseServerClient();
    const bucketErr = await ensurePdfStorageBucket(db);
    if (bucketErr) return NextResponse.json({ error: bucketErr }, { status: 500 });

    if (fallbackAgenciaId) {
      const { data: agencia } = await db.from("agencias").select("id").eq("id", fallbackAgenciaId).maybeSingle();
      if (!agencia) return NextResponse.json({ error: "Agencia nao encontrada" }, { status: 404 });
    }

    const expanded: ExpandedUpload[] = [];
    for (const file of files) {
      const buffer = Buffer.from(await file.arrayBuffer());
      if (isZipBuffer(buffer)) {
        const entries = extractPdfEntriesFromZip(buffer, {
          maxFiles: MAX_FILES_PER_BATCH,
          maxTotalUncompressedBytes: MAX_TOTAL_SIZE,
        });
        for (const entry of entries) {
          expanded.push({
            name: entry.name,
            buffer: entry.buffer,
            source_archive: file.name,
            size: entry.uncompressedSize,
          });
        }
      } else {
        expanded.push({
          name: file.name,
          buffer,
          source_archive: null,
          size: file.size,
        });
      }
    }

    if (expanded.length === 0) {
      return NextResponse.json({ error: "Nenhum PDF encontrado no lote" }, { status: 400 });
    }

    if (expanded.length > MAX_FILES_PER_BATCH) {
      return NextResponse.json({ error: `Maximo de ${MAX_FILES_PER_BATCH} PDFs por lote` }, { status: 400 });
    }

    const results: Array<{
      filename: string;
      job_id: string | null;
      document_id: string | null;
      status:
        | "queued"
        | "existing_pending"
        | "existing_failed"
        | "existing_review"
        | "duplicate_confirmed"
        | "rejected"
        | "error";
      message?: string;
    }> = [];
    const jobsToProcess: Array<{ jobId: string; agenciaId: string | null }> = [];

    for (const file of expanded) {
      const result = await enqueuePdfBuffer({
        db,
        filename: file.name,
        buffer: file.buffer,
        agenciaId: fallbackAgenciaId,
        sourceArchive: file.source_archive,
        metadata: {
          uploaded_via: "manual_batch",
          source_archive: file.source_archive,
        },
      });
      results.push(result);
      if ((result.status === "queued" || result.status === "existing_failed") && result.job_id) {
        jobsToProcess.push({ jobId: result.job_id, agenciaId: fallbackAgenciaId });
      }
    }

    if (jobsToProcess.length > 0) {
      waitUntil(processQueue(jobsToProcess.slice(0, 10), 2));
    }

    const queued = results.filter((r) => r.status === "queued").length;
    const rejected = results.filter((r) => r.status === "rejected" || r.status === "error").length;
    const duplicate = results.filter((r) => r.status === "duplicate_confirmed").length;

    return NextResponse.json({ total: expanded.length, queued, rejected, duplicate, results }, { status: 201 });
  } catch (error) {
    console.error("[upload/batch] Erro inesperado:", error);
    return NextResponse.json({ error: "Erro interno do servidor" }, { status: 500 });
  }
}
