/**
 * POST /api/v1/deliberacoes/enqueue-pdfs
 *
 * Conecta o módulo de Monitoramento ao pipeline de Deliberações: busca itens
 * monitorados que apontam para PDFs de decisão (ata/voto/deliberação), baixa
 * cada PDF e o enfileira em upload_jobs via enqueuePdfBuffer (mesmo caminho do
 * upload manual). O processamento real (extração de texto + sugestão de votos)
 * acontece em /api/v1/upload/process; a confirmação dos votos individuais
 * continua sendo feita por revisão humana em /api/v1/upload/confirm.
 */

import { NextRequest, NextResponse } from "next/server";
import { waitUntil } from "@vercel/functions";
import { isDemo } from "@/lib/server/is-demo";
import { requireAdminOrCron } from "@/lib/server/request-guards";
import { hasBudget } from "@/lib/server/time-budget";

export const dynamic = "force-dynamic";

// Tipos de item que representam decisões (priorizamos voto/ata sobre pauta).
const DECISION_TIPOS = ["voto", "ata", "deliberacao", "pauta"] as const;
const PDF_RE = /\.pdf(?:$|[/?#])|\/@@download\/file(?:$|[/?#])/i;
const MAX_PER_RUN = 10;
const FETCH_TIMEOUT_MS = 20_000;

export async function POST(req: NextRequest) {
  const guard = await requireAdminOrCron(req);
  if (guard) return guard;

  if (isDemo()) {
    return NextResponse.json({ error: "Indisponível em modo DEMO." }, { status: 403 });
  }

  const body = (await req.json().catch(() => ({}))) as {
    agencia_sigla?: string;
    limit?: number;
    process?: boolean;
  };
  const limit = Math.min(MAX_PER_RUN, Math.max(1, Number(body.limit ?? MAX_PER_RUN)));

  const { createSupabaseServerClient } = await import("@/lib/supabase/server");
  const { enqueuePdfBuffer, ensurePdfStorageBucket } = await import("@/lib/server/upload-queue");
  const { processQueue } = await import("@/lib/server/pipeline");

  const db = createSupabaseServerClient();
  const bucketErr = await ensurePdfStorageBucket(db);
  if (bucketErr) return NextResponse.json({ error: bucketErr }, { status: 500 });

  // Busca candidatos: itens "novo" de tipo decisão. Filtramos PDFs em memória
  // porque url_item pode terminar em /@@download/file ou .pdf.
  let query = db
    .from("monitoramento_itens")
    .select("id, agencia_id, tipo, titulo, url_item, status, metadata")
    .eq("status", "novo")
    .in("tipo", DECISION_TIPOS as unknown as string[])
    .order("data_reuniao", { ascending: false, nullsFirst: false })
    .limit(60);

  if (body.agencia_sigla?.trim()) {
    const { data: agencia } = await db
      .from("agencias")
      .select("id")
      .eq("sigla", body.agencia_sigla.trim().toUpperCase())
      .maybeSingle();
    if (agencia?.id) query = query.eq("agencia_id", agencia.id);
  }

  const { data: itens, error } = await query;
  if (error) {
    return NextResponse.json({ error: `Falha ao listar itens monitorados: ${error.message}` }, { status: 500 });
  }

  const candidates = (itens ?? [])
    .filter((item) => PDF_RE.test(String(item.url_item ?? "")))
    .slice(0, limit);

  const results: Array<{
    monitoramento_item_id: string;
    titulo: string;
    url: string;
    status: string;
    job_id: string | null;
    message?: string;
  }> = [];
  const jobsToProcess: Array<{ jobId: string; agenciaId: string | null }> = [];

  // Orçamento: 10 PDFs × 20s de timeout = 200s > maxDuration 120s. Para
  // graciosamente; itens não processados continuam "novo" e entram no próximo clique.
  const deadlineAt = Date.now() + 90_000;
  let restantes = 0;

  for (const item of candidates) {
    if (!hasBudget(deadlineAt, 25_000)) {
      restantes++;
      continue;
    }
    const url = String(item.url_item);
    try {
      const buffer = await fetchPdfBuffer(url);
      const filename = deriveFilename(item.titulo as string, url);
      const enqueued = await enqueuePdfBuffer({
        db,
        filename,
        buffer,
        agenciaId: (item.agencia_id as string | null) ?? null,
        metadata: {
          uploaded_via: "monitoramento_deliberacoes",
          monitoramento_item_id: item.id,
          source_url: url,
          item_tipo: item.tipo,
        },
      });

      if (
        (enqueued.status === "queued" || enqueued.status === "existing_failed") &&
        enqueued.job_id
      ) {
        jobsToProcess.push({ jobId: enqueued.job_id, agenciaId: (item.agencia_id as string | null) ?? null });
      }

      // Marca o item como importado para não reprocessar (exceto erro real).
      if (enqueued.status !== "error" && enqueued.status !== "rejected") {
        await db
          .from("monitoramento_itens")
          .update({ status: "importado", last_seen_at: new Date().toISOString() })
          .eq("id", item.id);
      }

      results.push({
        monitoramento_item_id: item.id as string,
        titulo: String(item.titulo ?? filename),
        url,
        status: enqueued.status,
        job_id: enqueued.job_id,
        message: enqueued.message,
      });
    } catch (err) {
      results.push({
        monitoramento_item_id: item.id as string,
        titulo: String(item.titulo ?? url),
        url,
        status: "error",
        job_id: null,
        message: err instanceof Error ? err.message : "Falha ao baixar PDF",
      });
    }
  }

  // Processa em background (ou aguarda quando solicitado por cron/teste).
  let processed = 0;
  if (jobsToProcess.length > 0) {
    if (body.process) {
      await processQueue(jobsToProcess.slice(0, MAX_PER_RUN), 2);
      processed = jobsToProcess.length;
    } else {
      waitUntil(processQueue(jobsToProcess.slice(0, MAX_PER_RUN), 2));
    }
  }

  const queued = results.filter((r) => r.status === "queued").length;
  return NextResponse.json({
    candidates: candidates.length,
    queued,
    processed,
    enqueued_jobs: jobsToProcess.length,
    parcial: restantes > 0,
    restantes,
    results,
    notice:
      "Votos individuais são sugeridos automaticamente (mandato + texto da ata) e só são gravados após confirmação humana em Revisão.",
  });
}

async function fetchPdfBuffer(url: string): Promise<Buffer> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        Accept: "application/pdf,*/*",
      },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status} ao baixar PDF`);
    return Buffer.from(await res.arrayBuffer());
  } finally {
    clearTimeout(timer);
  }
}

function deriveFilename(titulo: string, url: string): string {
  const fromUrl = decodeURIComponent(url.split(/[?#]/)[0].split("/").filter(Boolean).at(-1) ?? "");
  if (fromUrl && /\.pdf$/i.test(fromUrl)) return fromUrl.slice(0, 180);
  const slug = (titulo || "documento")
    .normalize("NFD")
    .replace(/[^a-zA-Z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 120);
  return `${slug || "documento"}.pdf`;
}
