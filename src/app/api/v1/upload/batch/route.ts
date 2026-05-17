/**
 * POST /api/v1/upload/batch
 * Aceita múltiplos PDFs, valida via magic bytes, envia para Supabase Storage,
 * cria registros upload_jobs e dispara o pipeline em background via waitUntil.
 */

import { NextRequest, NextResponse } from "next/server";
import { waitUntil } from "@vercel/functions";
import { demoData } from "@/lib/demo-data";
import { isDemo } from "@/lib/server/is-demo";
import { requireAdmin } from "@/lib/server/request-guards";

const MAX_FILE_SIZE = 50 * 1024 * 1024; // 50 MB por arquivo
const MAX_FILES_PER_BATCH = 1000;


export async function POST(req: NextRequest) {
  const guard = await requireAdmin(req);
  if (guard) return guard;

  try {
    const formData = await req.formData();

    // Modo demo: processa PDFs via NLP sem persistir no Supabase.
    // Extrai campos e retorna resultado imediato (status "done") para cada arquivo válido.
    if (isDemo()) {
      const files = formData.getAll("files") as File[];
      if (files.length === 0) {
        return NextResponse.json({ error: "Nenhum arquivo enviado" }, { status: 400 });
      }

      const { isPdfBuffer, extractPdfText } = await import("@/lib/server/pdf-extractor");
      const { extractFields } = await import("@/lib/server/nlp-extractor");
      const { classifyMicrotema } = await import("@/lib/server/classifier");

      const results: Array<{ filename: string; job_id: string | null; status: string; message?: string }> = [];

      for (const file of files) {
        if (file.size > MAX_FILE_SIZE) {
          results.push({
            filename: file.name, job_id: null, status: "rejected",
            message: `Arquivo muito grande (${(file.size / 1024 / 1024).toFixed(1)} MB, máx 50 MB)`,
          });
          continue;
        }

        const buffer = Buffer.from(await file.arrayBuffer());

        if (!isPdfBuffer(buffer)) {
          results.push({
            filename: file.name, job_id: null, status: "rejected",
            message: "Arquivo inválido: não é um PDF (magic bytes incorretos)",
          });
          continue;
        }

        let extraction: Awaited<ReturnType<typeof extractPdfText>>;
        try {
          extraction = await extractPdfText(buffer);
        } catch {
          results.push({
            filename: file.name, job_id: null, status: "rejected",
            message: "Falha ao extrair texto do PDF",
          });
          continue;
        }

        if (!extraction.text || extraction.text.length < 50) {
          results.push({
            filename: file.name, job_id: null, status: "rejected",
            message: "PDF sem texto extraível — possível documento digitalizado (imagem)",
          });
          continue;
        }

        const fields = extractFields(extraction.text);
        const { microtema } = classifyMicrotema(extraction.text);

        const partes: string[] = [];
        if (fields.numero_deliberacao) partes.push(`Deliberação nº ${fields.numero_deliberacao}`);
        if (fields.reuniao_ordinaria)  partes.push(fields.reuniao_ordinaria);
        if (fields.data_reuniao)       partes.push(fields.data_reuniao);
        if (fields.resultado)          partes.push(fields.resultado);
        if (microtema && microtema !== "outros") partes.push(`[${microtema}]`);
        const summary = partes.length > 0
          ? partes.join(" · ")
          : "Campos extraídos — configure o Supabase para persistir os dados";

        results.push({
          filename: file.name,
          job_id: crypto.randomUUID(), // ID fictício — status já é terminal, não haverá polling
          status: "done",
          message: summary,
        });
      }

      const processed = results.filter((r) => r.status === "done").length;
      const rejected  = results.filter((r) => r.status === "rejected").length;
      return NextResponse.json({ total: files.length, queued: processed, rejected, results });
    }

    // Importação dinâmica para evitar erro em build sem credenciais
    const { createSupabaseServerClient } = await import("@/lib/supabase/server");
    const { isPdfBuffer, sha256Hex } = await import("@/lib/server/pdf-extractor");
    const { processQueue } = await import("@/lib/server/pipeline");

    const agenciaId = formData.get("agencia_id");

    if (!agenciaId || typeof agenciaId !== "string") {
      return NextResponse.json(
        { error: "agencia_id é obrigatório" },
        { status: 400 }
      );
    }

    const files = formData.getAll("files") as File[];

    if (files.length === 0) {
      return NextResponse.json(
        { error: "Nenhum arquivo enviado" },
        { status: 400 }
      );
    }

    if (files.length > MAX_FILES_PER_BATCH) {
      return NextResponse.json(
        { error: `Máximo de ${MAX_FILES_PER_BATCH} arquivos por lote` },
        { status: 400 }
      );
    }

    const db = createSupabaseServerClient();

    // Verifica se a agência existe
    const { data: agencia } = await db
      .from("agencias")
      .select("id")
      .eq("id", agenciaId)
      .single();

    if (!agencia) {
      return NextResponse.json(
        { error: "Agência não encontrada" },
        { status: 404 }
      );
    }

    const results: Array<{
      filename: string;
      job_id: string | null;
      status: string;
      message?: string;
    }> = [];

    const jobsToProcess: Array<{ jobId: string; agenciaId: string }> = [];

    for (const file of files) {
      // Validação de tamanho
      if (file.size > MAX_FILE_SIZE) {
        results.push({
          filename: file.name,
          job_id: null,
          status: "rejected",
          message: `Arquivo muito grande (${(file.size / 1024 / 1024).toFixed(1)} MB, máx 50 MB)`,
        });
        continue;
      }

      const buffer = Buffer.from(await file.arrayBuffer());

      // Validação de tipo via magic bytes (não confia na extensão)
      if (!isPdfBuffer(buffer)) {
        results.push({
          filename: file.name,
          job_id: null,
          status: "rejected",
          message: "Arquivo inválido: não é um PDF",
        });
        continue;
      }

      // SHA-256 para deduplicação
      const fileHash = await sha256Hex(buffer);

      // Verifica duplicata
      const { data: existing } = await db
        .from("upload_jobs")
        .select("id, status")
        .eq("file_hash", fileHash)
        .maybeSingle();

      if (existing) {
        results.push({
          filename: file.name,
          job_id: existing.id,
          status: "duplicate",
          message: `PDF já processado anteriormente (status: ${existing.status})`,
        });
        continue;
      }

      // Upload para Supabase Storage
      const storagePath = `${agenciaId}/${fileHash}.pdf`;
      const { error: uploadErr } = await db.storage
        .from("pdfs")
        .upload(storagePath, buffer, {
          contentType: "application/pdf",
          upsert: false,
        });

      if (uploadErr) {
        results.push({
          filename: file.name,
          job_id: null,
          status: "error",
          message: `Falha no upload: ${uploadErr.message}`,
        });
        continue;
      }

      // Criar registro upload_job
      const { data: job, error: jobErr } = await db
        .from("upload_jobs")
        .insert({
          filename: file.name,
          file_hash: fileHash,
          status: "pending",
          agencia_id: agenciaId,
          storage_path: storagePath,
        })
        .select("id")
        .single();

      if (jobErr || !job) {
        results.push({
          filename: file.name,
          job_id: null,
          status: "error",
          message: "Falha ao criar registro de job",
        });
        continue;
      }

      jobsToProcess.push({ jobId: job.id, agenciaId });

      results.push({
        filename: file.name,
        job_id: job.id,
        status: "queued",
      });
    }

    // Dispara pipeline em background com concorrência limitada (max 3 simultâneos)
    if (jobsToProcess.length > 0) {
      waitUntil(
        processQueue(
          jobsToProcess.map(({ jobId, agenciaId: aid }) => ({
            jobId, agenciaId: aid,
          })),
          3, // concorrência máxima
        )
      );
    }

    const queued = results.filter((r) => r.status === "queued").length;
    const rejected = results.filter(
      (r) => r.status === "rejected" || r.status === "error"
    ).length;

    return NextResponse.json(
      {
        total: files.length,
        queued,
        rejected,
        results,
      },
      { status: 201 }
    );
  } catch (error) {
    console.error("[upload/batch] Erro inesperado:", error);
    return NextResponse.json(
      { error: "Erro interno do servidor" },
      { status: 500 }
    );
  }
}
