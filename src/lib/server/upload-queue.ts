import { isPdfBuffer, sha256Hex } from "@/lib/server/pdf-extractor";

const MAX_FILE_SIZE = 50 * 1024 * 1024;

export type EnqueuePdfResult = {
  filename: string;
  job_id: string | null;
  document_id: string | null;
  status:
    | "queued"
    | "existing_pending"
    | "existing_failed"
    | "existing_archived"
    | "existing_review"
    | "duplicate_confirmed"
    | "rejected"
    | "error";
  message?: string;
};

export async function ensurePdfStorageBucket(db: any): Promise<string | null> {
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

export async function enqueuePdfBuffer(input: {
  db: any;
  filename: string;
  buffer: Buffer;
  agenciaId?: string | null;
  sourceArchive?: string | null;
  metadata?: Record<string, unknown>;
  /** Origem na tabela documentos_coletados (rastreabilidade coleta→regulatório). */
  documentoColetadoId?: string | null;
}): Promise<EnqueuePdfResult> {
  const { db, filename, buffer, agenciaId = null, sourceArchive = null, metadata = {}, documentoColetadoId = null } = input;
  const size = buffer.length;

  if (size > MAX_FILE_SIZE) {
    return {
      filename,
      job_id: null,
      document_id: null,
      status: "rejected",
      message: `Arquivo muito grande (${(size / 1024 / 1024).toFixed(1)} MB, max 50 MB)`,
    };
  }

  if (!isPdfBuffer(buffer)) {
    return {
      filename,
      job_id: null,
      document_id: null,
      status: "rejected",
      message: "Arquivo invalido: nao e um PDF",
    };
  }

  const fileHash = await sha256Hex(buffer);
  const { data: existingDoc } = await db
    .from("documentos_regulatorios")
    .select("id, upload_job_id, status")
    .eq("file_hash", fileHash)
    .maybeSingle();

  if (existingDoc) {
    const status = classifyExistingDocumentStatus(existingDoc.status as string | null);
    if (status === "existing_failed" && existingDoc.upload_job_id) {
      await requeueDocument(db, existingDoc.id as string);
    }
    return {
      filename,
      job_id: (existingDoc.upload_job_id as string | null) ?? null,
      document_id: existingDoc.id as string,
      status,
      message: existingDocumentMessage(existingDoc.status as string | null),
    };
  }

  const { data: existingJob } = await db
    .from("upload_jobs")
    .select("id, filename, file_hash, status, agencia_id, storage_path, documento_id")
    .eq("file_hash", fileHash)
    .maybeSingle();

  if (existingJob) {
    const linkedDocumentoId = existingJob.documento_id as string | null;
    if (linkedDocumentoId) {
      const { data: linkedDoc } = await db
        .from("documentos_regulatorios")
        .select("id, status")
        .eq("id", linkedDocumentoId)
        .maybeSingle();

      if (linkedDoc) {
        const status = classifyExistingDocumentStatus(linkedDoc.status as string | null);
        if (status === "existing_failed" && linkedDoc.id && existingJob.id) {
          await requeueDocument(db, linkedDoc.id as string);
        }
        return {
          filename,
          job_id: existingJob.id as string,
          document_id: linkedDoc.id as string,
          status,
          message: existingDocumentMessage(linkedDoc.status as string | null),
        };
      }
    }

    const reusedStoragePath = (existingJob.storage_path as string | null)
      ?? `${agenciaId ?? existingJob.agencia_id ?? "auto"}/${fileHash}.pdf`;
    const { error: uploadExistingErr } = await db.storage
      .from("pdfs")
      .upload(reusedStoragePath, buffer, {
        contentType: "application/pdf",
        upsert: true,
      });

    if (uploadExistingErr) {
      return {
        filename,
        job_id: existingJob.id as string,
        document_id: null,
        status: "error",
        message: `Falha no upload do PDF existente: ${uploadExistingErr.message}`,
      };
    }

    const { data: recoveredDoc, error: recoveredDocErr } = await db
      .from("documentos_regulatorios")
      .insert({
        upload_job_id: existingJob.id,
        agencia_id: agenciaId ?? (existingJob.agencia_id as string | null) ?? null,
        filename,
        source_archive: sourceArchive,
        storage_bucket: "pdfs",
        storage_path: reusedStoragePath,
        file_hash: fileHash,
        size_bytes: size,
        status: "queued",
        metadata: {
          uploaded_via: "queue_recovery",
          source_archive: sourceArchive,
          recovered_from_upload_job: existingJob.id,
          ...metadata,
        },
      })
      .select("id")
      .single();

    if (recoveredDocErr || !recoveredDoc) {
      return {
        filename,
        job_id: existingJob.id as string,
        document_id: null,
        status: "existing_pending",
        message: `PDF ja existe em upload_jobs (status: ${existingJob.status}); nao foi possivel recriar documento bruto: ${recoveredDocErr?.message ?? "erro desconhecido"}`,
      };
    }

    await db
      .from("upload_jobs")
      .update({
        documento_id: recoveredDoc.id,
        storage_path: reusedStoragePath,
        agencia_id: agenciaId ?? (existingJob.agencia_id as string | null) ?? null,
        status: "pending",
        error_message: null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", existingJob.id);

    return {
      filename,
      job_id: existingJob.id as string,
      document_id: recoveredDoc.id as string,
      status: "queued",
      message: "Job existente reaproveitado e reenfileirado para processamento.",
    };
  }

  const storagePath = `${agenciaId ?? "auto"}/${fileHash}.pdf`;
  const { error: uploadErr } = await db.storage
    .from("pdfs")
    .upload(storagePath, buffer, {
      contentType: "application/pdf",
      upsert: true,
    });

  if (uploadErr) {
    return {
      filename,
      job_id: null,
      document_id: null,
      status: "error",
      message: `Falha no upload: ${uploadErr.message}`,
    };
  }

  const { data: job, error: jobErr } = await db
    .from("upload_jobs")
    .insert({
      filename,
      file_hash: fileHash,
      status: "pending",
      agencia_id: agenciaId,
      storage_path: storagePath,
    })
    .select("id")
    .single();

  if (jobErr || !job) {
    return {
      filename,
      job_id: null,
      document_id: null,
      status: "error",
      message: `Falha ao criar job: ${jobErr?.message ?? "erro desconhecido"}`,
    };
  }

  const { data: doc, error: docErr } = await db
    .from("documentos_regulatorios")
    .insert({
      upload_job_id: job.id,
      agencia_id: agenciaId,
      filename,
      source_archive: sourceArchive,
      storage_bucket: "pdfs",
      storage_path: storagePath,
      file_hash: fileHash,
      size_bytes: size,
      status: "queued",
      metadata: {
        uploaded_via: "manual_batch",
        source_archive: sourceArchive,
        ...metadata,
      },
    })
    .select("id")
    .single();

  if (docErr || !doc) {
    return {
      filename,
      job_id: job.id as string,
      document_id: null,
      status: "error",
      message: `Falha ao criar documento bruto: ${docErr?.message ?? "erro desconhecido"}`,
    };
  }

  await db.from("upload_jobs").update({ documento_id: doc.id }).eq("id", job.id);
  // Link de rastreabilidade (coleta→regulatório) como UPDATE separado e tolerante:
  // se a coluna ainda não existir (migration não aplicada), não derruba o enqueue.
  if (documentoColetadoId) {
    const { error: linkErr } = await db
      .from("documentos_regulatorios")
      .update({ documento_coletado_id: documentoColetadoId })
      .eq("id", doc.id);
    if (linkErr && !/column .*documento_coletado_id/i.test(linkErr.message ?? "")) {
      console.warn("[upload-queue] Falha ao gravar documento_coletado_id:", linkErr.message);
    }
  }
  return {
    filename,
    job_id: job.id as string,
    document_id: doc.id as string,
    status: "queued",
  };
}

export async function requeueDocument(db: any, documentId: string) {
  const { data: doc, error } = await db
    .from("documentos_regulatorios")
    .select("id, upload_job_id, filename, agencia_id, storage_path, error_message")
    .eq("id", documentId)
    .single();

  if (error || !doc) throw new Error("Documento nao encontrado");
  if (!doc.upload_job_id) throw new Error("Documento sem upload_job_id para reprocessar");

  // ═══ Fase 9 — a ORDEM inverteu, e o elo passou a ser gravado ════════════════
  // Antes: documento → `queued` PRIMEIRO, job → `pending` DEPOIS, em dois UPDATEs
  // não-transacionais, com o erro do segundo NÃO checado. Morrer entre eles (o SIGKILL de 60s do
  // Hobby cai exatamente aqui, porque quem chama isto é o passo 9 da esteira) deixava o documento
  // em `queued` com o job `done` — invisível para sempre, porque a fila só lê jobs `pending`.
  //
  // Com o job primeiro, morrer no meio deixa um job `pending` sem o documento requeueado: estado
  // BENIGNO, que o `processPdf` apenas reprocessa. E `documento_id` entra no patch — sem ele, um
  // job que perdeu o vínculo entrava num laço fechado (requeue → pending → processPdf sem
  // documento_id → `done` → doc segue `queued`), e reprocessar de novo não adiantava.
  const { error: jobErr } = await db
    .from("upload_jobs")
    .update({
      status: "pending",
      documento_id: doc.id,
      error_message: null,
      agencia_id: doc.agencia_id,
      storage_path: doc.storage_path,
      updated_at: new Date().toISOString(),
    })
    .eq("id", doc.upload_job_id);
  if (jobErr) throw new Error(`Falha ao reenfileirar o job ${doc.upload_job_id}: ${jobErr.message}`);

  await db
    .from("documentos_regulatorios")
    .update({
      status: "queued",
      error_message: null,
      extraction_confidence: null,
      texto_extraido: null,
      // Preserva o motivo da falha anterior (QA ago/2026: era apagado sem arquivo —
      // impossível diagnosticar "falha sempre" vs "nunca tentado").
      campos_detectados: doc.error_message ? { ultimo_erro: String(doc.error_message).slice(0, 300) } : {},
      ata_items: null,
      warnings: [],
      processed_at: null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", documentId);

  return { document_id: doc.id as string, job_id: doc.upload_job_id as string };
}

/**
 * Fase 8 — `ignored` deixou de virar `existing_failed`.
 *
 * `existing_failed` dispara `requeueDocument`, que DESARQUIVA o documento (volta a 'queued' e
 * apaga texto_extraido/campos_detectados). Mas `ignored` é exatamente o status que o confirm-lote
 * grava ao arquivar pauta, documento_apoio, duplicata exata e ilegível — arquivar ali é uma
 * DECISÃO, não uma falha. Enquanto o item ia a terminal no primeiro tropeço, isso quase nunca
 * acontecia; com o retry, todo re-download de uma pauta já arquivada a desarquivaria, e o
 * confirm-lote a arquivaria de novo na rodada seguinte: o ping-pong da Fase 7 voltando pela porta
 * dos fundos, fora do guard que o vigia (esse guard vive no passo 9 da esteira; isto é o passo 7).
 *
 * `failed` continua sendo `existing_failed`: ali a extração QUEBROU e reprocessar é o certo.
 * Quem quiser desarquivar um `ignored` de propósito continua tendo a rota dedicada
 * (admin/upload/reprocess-ignorados), que roda sob o guard anti-ping-pong.
 */
function classifyExistingDocumentStatus(status: string | null): EnqueuePdfResult["status"] {
  if (status === "confirmed") return "duplicate_confirmed";
  if (status === "ignored") return "existing_archived";
  if (status === "failed") return "existing_failed";
  if (status === "review_pending") return "existing_review";
  return "existing_pending";
}

function existingDocumentMessage(status: string | null) {
  if (status === "confirmed") return "PDF ja consolidado no sistema.";
  if (status === "failed" || status === "ignored") return "PDF ja existia, mas foi reenfileirado para reprocessamento.";
  if (status === "review_pending") return "PDF ja esta pronto para revisao.";
  return `PDF ja esta na fila/processamento (status: ${status ?? "desconhecido"}).`;
}
