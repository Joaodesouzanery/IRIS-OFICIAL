/**
 * Pipeline de processamento de PDF.
 *
 * V1 assíncrona: o worker processa documentos brutos e os deixa em revisão.
 * Nenhuma deliberação final é criada aqui; isso só acontece em /upload/confirm.
 */

import { createSupabaseServerClient } from "@/lib/supabase/server";
import { analyzeUploadPdf, markBatchDuplicates } from "@/lib/server/upload-analysis";
import { hasBudget } from "@/lib/server/time-budget";

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

    // Fase 7 — a marcação de "processing" passa a DEVOLVER a linha, para colher a URL de origem
    // sem um round-trip novo. Ela é gravada em `metadata.source_url` pelo enfileiramento e, até
    // agora, morria ali: a deliberação nascia sem proveniência e o card de inspeção do detalhe
    // ficava sem "Fonte original".
    const docRow = await updateDocument(db, documentoId, {
      status: "processing",
      error_message: null,
      updated_at: new Date().toISOString(),
    }, true);
    const docMeta = (docRow?.metadata ?? {}) as Record<string, unknown>;
    const sourceUrl = typeof docMeta.source_url === "string" ? docMeta.source_url : null;

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
      campos_detectados: previewToJson(analysis, sourceUrl),
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

export async function processQueue(jobs: QueueJob[], concurrency = 2, deadlineAt?: number): Promise<number> {
  const queue = [...jobs];
  const active: Promise<void>[] = [];
  let started = 0;

  while (queue.length > 0 || active.length > 0) {
    while (active.length < concurrency && queue.length > 0) {
      // Orçamento (QA ago/2026): um PDF escaneado custa até ~65s (pdf-parse 25s + OCR
      // 40s) — sem esta parada o lote de 20 estourava sozinho o SIGKILL de 60s do
      // Hobby. Nunca INICIA um job sem saldo; os não iniciados seguem 'pending' e a
      // próxima rodada os pega (progresso preservado, nada órfão).
      if (deadlineAt !== undefined && !hasBudget(deadlineAt, 12_000)) {
        queue.length = 0;
        break;
      }
      const job = queue.shift()!;
      started++;
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
  return started;
}

export async function processPendingDocuments(limit = 5, deadlineAt?: number): Promise<{ processed: number; job_ids: string[]; reaped: number }> {
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

  // Reaper do DOCUMENTO preso em "processing" (QA ago/2026): quando o job morreu de vez
  // (foi a 'failed' sem conseguir atualizar o doc, ou nunca conheceu o documento_id), o
  // doc ficava 'processing' PARA SEMPRE — invisível e fora de qualquer fila. Vira 'failed'
  // com motivo (aparece no diagnóstico e é reprocessável); se o job correspondente ainda
  // for reprocessado, o processPdf sobrescreve o status normalmente.
  await db
    .from("documentos_regulatorios")
    .update({
      status: "failed",
      error_message: "Processamento interrompido (timeout/SIGKILL) — reprocessável.",
      updated_at: new Date().toISOString(),
    })
    .eq("status", "processing")
    .lt("updated_at", staleCutoff);

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

  let processed = 0;
  if (selected.length > 0) {
    // Fase 7 — 2 → 3. Cada job faz download do Storage (I/O), pdf-parse (CPU), às vezes OCR
    // (rede) e escritas no banco (I/O): há espera de sobra para sobrepor. Subir MUITO não
    // ajudaria — o pdf-parse é CPU-bound e satura cedo — e custaria memória no runtime da
    // função. 3 é o passo conservador; o número honesto sai da medição em produção.
    processed = await processQueue(selected, 3, deadlineAt);
  }

  return { processed, job_ids: selected.map((job) => job.jobId), reaped };
}

/** Quanto do texto lido viaja junto com a deliberação, para conferência a olho. */
const TRECHO_MAX_CHARS = 4_000;

/**
 * Fase 7 — PROVENIÊNCIA.
 *
 * O `raw_text` (até 50k) continua fora daqui de propósito: ele já vive inteiro na coluna
 * `documentos_regulatorios.texto_extraido`, e duplicá-lo no JSONB inflaria a tabela de
 * deliberações (todo consumidor downstream copia este objeto). O que entra no lugar é o mínimo
 * que torna a decisão AUDITÁVEL sem abrir o banco:
 *   · `source_url`    — de qual URL o PDF veio (o card "Fonte original" do detalhe estava vazio);
 *   · `texto_trecho`  — o começo do texto realmente lido, para bater o olho contra o PDF;
 *   · `extracao_metodo` — pdf-parse ou OCR, que era calculado e jogado fora.
 * Os três nomes são explícitos: `texto_trecho` não se disfarça de texto completo.
 */
function previewToJson(
  analysis: Awaited<ReturnType<typeof analyzeUploadPdf>>,
  sourceUrl: string | null,
) {
  const raw = analysis.extraction_raw ?? {};
  const { raw_text: rawText, ...rawWithoutText } = raw;
  const trecho = typeof rawText === "string" ? rawText.slice(0, TRECHO_MAX_CHARS) : null;
  return {
    preview: {
      ...analysis,
      extraction_raw: {
        ...rawWithoutText,
        ...(sourceUrl ? { source_url: sourceUrl } : {}),
        ...(trecho ? { texto_trecho: trecho } : {}),
      },
    },
  };
}

async function updateDocument(
  db: any,
  documentoId: string | null,
  patch: Record<string, unknown>,
  devolverLinha = false,
): Promise<Record<string, unknown> | null> {
  if (!documentoId) return null;
  const q = db.from("documentos_regulatorios").update(patch).eq("id", documentoId);
  // `.select()` no UPDATE devolve a linha na MESMA ida ao banco — é assim que a proveniência
  // sai de graça, sem um SELECT extra por PDF na parte quente da esteira.
  const { data, error } = devolverLinha ? await q.select("metadata").maybeSingle() : await q;
  if (error) console.warn("[pipeline] Falha ao atualizar documento:", error.message);
  return (data as Record<string, unknown> | null) ?? null;
}

export { markBatchDuplicates };
