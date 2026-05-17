/**
 * POST /api/v1/upload/batch
 * Salva PDFs/ZIPs no Storage e cria uma fila persistida.
 * O processamento acontece em /api/v1/upload/process ou via waitUntil.
 */

import { NextRequest, NextResponse } from "next/server";
import { waitUntil } from "@vercel/functions";
import { isDemo } from "@/lib/server/is-demo";
import { requireAdmin } from "@/lib/server/request-guards";

const MAX_FILE_SIZE = 50 * 1024 * 1024;
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
    const { isPdfBuffer, sha256Hex } = await import("@/lib/server/pdf-extractor");
    const { isZipBuffer, extractPdfEntriesFromZip } = await import("@/lib/server/zip-extractor");
    const { processQueue } = await import("@/lib/server/pipeline");

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
      status: "queued" | "duplicate" | "rejected" | "error";
      message?: string;
    }> = [];
    const jobsToProcess: Array<{ jobId: string; agenciaId: string | null }> = [];

    for (const file of expanded) {
      if (file.size > MAX_FILE_SIZE) {
        results.push({
          filename: file.name,
          job_id: null,
          document_id: null,
          status: "rejected",
          message: `Arquivo muito grande (${(file.size / 1024 / 1024).toFixed(1)} MB, max 50 MB)`,
        });
        continue;
      }

      if (!isPdfBuffer(file.buffer)) {
        results.push({
          filename: file.name,
          job_id: null,
          document_id: null,
          status: "rejected",
          message: "Arquivo invalido: nao e um PDF",
        });
        continue;
      }

      const fileHash = await sha256Hex(file.buffer);
      const { data: existingDoc } = await db
        .from("documentos_regulatorios")
        .select("id, upload_job_id, status")
        .eq("file_hash", fileHash)
        .maybeSingle();

      if (existingDoc) {
        results.push({
          filename: file.name,
          job_id: (existingDoc.upload_job_id as string | null) ?? null,
          document_id: existingDoc.id as string,
          status: "duplicate",
          message: `PDF ja existe na fila/revisao (status: ${existingDoc.status})`,
        });
        continue;
      }

      const storagePath = `${fallbackAgenciaId ?? "auto"}/${fileHash}.pdf`;
      const { error: uploadErr } = await db.storage
        .from("pdfs")
        .upload(storagePath, file.buffer, {
          contentType: "application/pdf",
          upsert: true,
        });

      if (uploadErr) {
        results.push({
          filename: file.name,
          job_id: null,
          document_id: null,
          status: "error",
          message: `Falha no upload: ${uploadErr.message}`,
        });
        continue;
      }

      const { data: job, error: jobErr } = await db
        .from("upload_jobs")
        .insert({
          filename: file.name,
          file_hash: fileHash,
          status: "pending",
          agencia_id: fallbackAgenciaId,
          storage_path: storagePath,
        })
        .select("id")
        .single();

      if (jobErr || !job) {
        results.push({
          filename: file.name,
          job_id: null,
          document_id: null,
          status: "error",
          message: `Falha ao criar job: ${jobErr?.message ?? "erro desconhecido"}`,
        });
        continue;
      }

      const { data: doc, error: docErr } = await db
        .from("documentos_regulatorios")
        .insert({
          upload_job_id: job.id,
          agencia_id: fallbackAgenciaId,
          filename: file.name,
          source_archive: file.source_archive,
          storage_bucket: "pdfs",
          storage_path: storagePath,
          file_hash: fileHash,
          size_bytes: file.size,
          status: "queued",
          metadata: {
            uploaded_via: "manual_batch",
            source_archive: file.source_archive,
          },
        })
        .select("id")
        .single();

      if (docErr || !doc) {
        results.push({
          filename: file.name,
          job_id: job.id as string,
          document_id: null,
          status: "error",
          message: `Falha ao criar documento bruto: ${docErr?.message ?? "erro desconhecido"}`,
        });
        continue;
      }

      await db.from("upload_jobs").update({ documento_id: doc.id }).eq("id", job.id);
      jobsToProcess.push({ jobId: job.id as string, agenciaId: fallbackAgenciaId });
      results.push({
        filename: file.name,
        job_id: job.id as string,
        document_id: doc.id as string,
        status: "queued",
      });
    }

    if (jobsToProcess.length > 0) {
      waitUntil(processQueue(jobsToProcess.slice(0, 10), 2));
    }

    const queued = results.filter((r) => r.status === "queued").length;
    const rejected = results.filter((r) => r.status === "rejected" || r.status === "error").length;
    const duplicate = results.filter((r) => r.status === "duplicate").length;

    return NextResponse.json({ total: expanded.length, queued, rejected, duplicate, results }, { status: 201 });
  } catch (error) {
    console.error("[upload/batch] Erro inesperado:", error);
    return NextResponse.json({ error: "Erro interno do servidor" }, { status: 500 });
  }
}

async function ensurePdfStorageBucket(db: any): Promise<string | null> {
  const { data: bucket } = await db.storage.getBucket("pdfs");
  if (bucket) return null;

  const { error } = await db.storage.createBucket("pdfs", {
    public: false,
    fileSizeLimit: MAX_FILE_SIZE,
    allowedMimeTypes: ["application/pdf"],
  });

  if (!error) return null;
  if (/already exists|duplicate/i.test(error.message ?? "")) return null;
  return `Bucket de PDFs ausente e nao foi possivel cria-lo automaticamente: ${error.message}`;
}
