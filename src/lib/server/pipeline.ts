/**
 * Pipeline de processamento de PDF.
 *
 * V1 assíncrona: o worker processa documentos brutos e os deixa em revisão.
 * Nenhuma deliberação final é criada aqui; isso só acontece em /upload/confirm.
 */

import { createSupabaseServerClient } from "@/lib/supabase/server";
import { analyzeUploadPdf, markBatchDuplicates } from "@/lib/server/upload-analysis";

type QueueJob = { jobId: string; agenciaId?: string | null };

export async function processPdf(jobId: string): Promise<void> {
  const db = createSupabaseServerClient();

  await db
    .from("upload_jobs")
    .update({ status: "processing", updated_at: new Date().toISOString() })
    .eq("id", jobId);

  let documentoId: string | null = null;

  try {
    const { data: job } = await db
      .from("upload_jobs")
      .select("id, filename, file_hash, agencia_id, storage_path, documento_id")
      .eq("id", jobId)
      .single();

    if (!job) throw new Error("Job nao encontrado");
    documentoId = (job.documento_id as string | null) ?? null;
    if (!job.storage_path) throw new Error("Job sem storage_path");

    await updateDocument(db, documentoId, {
      status: "processing",
      error_message: null,
      updated_at: new Date().toISOString(),
    });

    const { data: fileData, error: downloadErr } = await db.storage
      .from("pdfs")
      .download(job.storage_path);

    if (downloadErr || !fileData) throw new Error(`Download falhou: ${downloadErr?.message ?? "sem arquivo"}`);

    const buffer = Buffer.from(await fileData.arrayBuffer());
    const { data: agencias } = await db.from("agencias").select("id, sigla").eq("ativo", true);

    const analysis = await analyzeUploadPdf({
      file: {
        name: job.filename,
        buffer,
        source_archive: null,
        size: buffer.length,
      },
      agencias: agencias ?? [],
      db,
      currentDocumentoId: documentoId,
      currentUploadJobId: job.id,
    });

    if (analysis.status === "error") {
      throw new Error(analysis.error ?? "Falha ao analisar PDF");
    }

    let duplicateDocumentoId: string | null = null;
    if (analysis.semantic_duplicate_key) {
      const { data: duplicateDoc } = await db
        .from("documentos_regulatorios")
        .select("id")
        .eq("semantic_duplicate_key", analysis.semantic_duplicate_key)
        .eq("status", "confirmed")
        .neq("id", documentoId)
        .limit(1)
        .maybeSingle();
      duplicateDocumentoId = (duplicateDoc?.id as string | null) ?? null;
    }

    await updateDocument(db, documentoId, {
      status: "review_pending",
      agencia_id: analysis.agencia_id_detected,
      agencia_sigla_detected: analysis.agencia_sigla_detected,
      tipo_documento: analysis.fields.tipo_documento,
      documento_subtipo: analysis.documento_subtipo ?? null,
      semantic_duplicate_key: analysis.semantic_duplicate_key ?? null,
      is_duplicate: Boolean(analysis.is_duplicate || duplicateDocumentoId),
      duplicate_documento_id: duplicateDocumentoId,
      extraction_confidence: analysis.confidence,
      page_count: analysis.page_count,
      chars_per_page: analysis.chars_per_page,
      texto_extraido: String(analysis.extraction_raw?.raw_text ?? ""),
      campos_detectados: previewToJson(analysis),
      ata_items: analysis.ata_items ?? null,
      warnings: analysis.warnings ?? [],
      error_message: null,
      processed_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });

    await db
      .from("upload_jobs")
      .update({ status: "done", agencia_id: analysis.agencia_id_detected, updated_at: new Date().toISOString() })
      .eq("id", jobId);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[pipeline] Job ${jobId} falhou:`, message);

    await db
      .from("upload_jobs")
      .update({
        status: "failed",
        error_message: message.slice(0, 500),
        updated_at: new Date().toISOString(),
      })
      .eq("id", jobId);

    await updateDocument(db, documentoId, {
      status: "failed",
      error_message: message.slice(0, 500),
      updated_at: new Date().toISOString(),
    });
  }
}

export async function processQueue(jobs: QueueJob[], concurrency = 2): Promise<void> {
  const queue = [...jobs];
  const active: Promise<void>[] = [];

  while (queue.length > 0 || active.length > 0) {
    while (active.length < concurrency && queue.length > 0) {
      const job = queue.shift()!;
      const p = processPdf(job.jobId)
        .catch((err) => console.error(`[queue] Job ${job.jobId} falhou:`, err))
        .then(() => {
          const idx = active.indexOf(p);
          if (idx !== -1) active.splice(idx, 1);
        });
      active.push(p);
    }
    if (active.length > 0) await Promise.race(active);
  }
}

export async function processPendingDocuments(limit = 5): Promise<{ processed: number; job_ids: string[]; reaped: number }> {
  const db = createSupabaseServerClient();

  // Reaper oportunista de órfãos: um job/doc preso em "processing" só é possível se o
  // SIGKILL (60s do Hobby) matou o background (waitUntil) ENTRE marcar "processing" e
  // gravar "done"/"failed". Como nenhum processamento legítimo dura minutos, todo job
  // "processing" com updated_at > 5min é órfão → volta para "pending" e é reprocessado
  // aqui mesmo (o processPdf sobrescreve o doc preso). Sem isto ficavam presos p/ sempre
  // (o select abaixo só lê "pending"). Espelha o reaper de monitoramento_runs.
  const staleCutoff = new Date(Date.now() - 5 * 60_000).toISOString();
  const { data: reapedRows } = await db
    .from("upload_jobs")
    .update({ status: "pending", updated_at: new Date().toISOString() })
    .eq("status", "processing")
    .lt("updated_at", staleCutoff)
    .select("id");
  const reaped = reapedRows?.length ?? 0;

  const normalizedLimit = Math.min(20, Math.max(1, limit));
  const { data: jobs } = await db
    .from("upload_jobs")
    .select("id, agencia_id")
    .eq("status", "pending")
    .order("created_at", { ascending: true })
    .limit(normalizedLimit);

  const selected = (jobs ?? []).map((job) => ({
    jobId: job.id as string,
    agenciaId: job.agencia_id as string | null,
  }));

  if (selected.length > 0) {
    await processQueue(selected, 2);
  }

  return { processed: selected.length, job_ids: selected.map((job) => job.jobId), reaped };
}

function previewToJson(analysis: Awaited<ReturnType<typeof analyzeUploadPdf>>) {
  const raw = analysis.extraction_raw ?? {};
  const { raw_text: _rawText, ...rawWithoutText } = raw;
  return {
    preview: {
      ...analysis,
      extraction_raw: rawWithoutText,
    },
  };
}

async function updateDocument(db: any, documentoId: string | null, patch: Record<string, unknown>) {
  if (!documentoId) return;
  const { error } = await db
    .from("documentos_regulatorios")
    .update(patch)
    .eq("id", documentoId);
  if (error) console.warn("[pipeline] Falha ao atualizar documento:", error.message);
}

export { markBatchDuplicates };
