/**
 * POST /api/v1/admin/upload/reprocess-ignorados[?dry_run=0][&agencia_id=...]
 *
 * Reentrada em LOTE dos documentos `ignored` que hoje já são capturáveis — em
 * especial os "Voto DXX" da ANTT descartados pelo confirm ANTIGO (antes da via
 * de captura do voto individual). dry_run (padrão) só conta; com dry_run=0
 * re-enfileira via requeueDocument → o cron upload/process reprocessa (parser
 * novo extrai relator+resultado) e o auto-confirm (gate de voto) materializa os
 * inequívocos; o resto fica em review_pending. Admin explícito; orçamento de
 * tempo contra o SIGKILL de 120s.
 */

import { NextRequest, NextResponse } from "next/server";
import { isDemo } from "@/lib/server/is-demo";
import { requireAdminOrCron } from "@/lib/server/request-guards";
import { requeueDocument } from "@/lib/server/upload-queue";
import { hasBudget } from "@/lib/server/time-budget";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const guard = await requireAdminOrCron(req, "reprocess-ignorados"); // pipeline (passo 2b) roda como cron
  if (guard) return guard;
  if (isDemo()) {
    return NextResponse.json({ error: "Indisponível em modo DEMO." }, { status: 403 });
  }

  const dryRun = req.nextUrl.searchParams.get("dry_run") !== "0";
  const agenciaId = req.nextUrl.searchParams.get("agencia_id");
  const deadlineAt = Date.now() + 50_000; // Hobby mata a função aos 60s — corta antes, o resto fica p/ a próxima chamada

  const { createSupabaseServerClient } = await import("@/lib/supabase/server");
  const db = createSupabaseServerClient();

  // Docs ignorados que a esteira atual sabe capturar: votos individuais (o alvo
  // principal) e atas ignoradas por classificação antiga. upload_job_id é
  // obrigatório para reprocessar (requeueDocument reusa o job).
  let query = db
    .from("documentos_regulatorios")
    .select("id, filename, tipo_documento, agencia_id, upload_job_id")
    .eq("status", "ignored")
    .in("tipo_documento", ["voto_individual", "ata"])
    .not("upload_job_id", "is", null)
    .order("created_at", { ascending: true })
    .limit(500);
  if (agenciaId) query = query.eq("agencia_id", agenciaId);

  const { data: docs, error } = await query;
  if (error) {
    return NextResponse.json({ error: "Erro ao listar documentos ignorados" }, { status: 500 });
  }

  const encontrados = (docs ?? []).length;
  let reenfileirados = 0;
  let falhas = 0;
  let restantes = 0;
  const amostra: Array<{ id: string; filename: string | null; tipo: string | null }> = [];

  for (const doc of (docs ?? []) as Array<{ id: string; filename: string | null; tipo_documento: string | null }>) {
    if (amostra.length < 20) amostra.push({ id: doc.id, filename: doc.filename, tipo: doc.tipo_documento });
    if (dryRun) continue;
    if (!hasBudget(deadlineAt, 5_000)) { restantes++; continue; }
    try {
      await requeueDocument(db, doc.id);
      reenfileirados++;
    } catch (err) {
      falhas++;
      console.warn(`[reprocess-ignorados] falha em ${doc.id}: ${err instanceof Error ? err.message : err}`);
    }
  }

  return NextResponse.json({
    dry_run: dryRun,
    encontrados,
    reenfileirados,
    falhas,
    restantes,
    amostra,
    ...(dryRun
      ? { notice: "Somente contagem. Repita com ?dry_run=0 para re-enfileirar; o cron upload/process reprocessa e o auto-confirm materializa os inequívocos." }
      : { notice: "Re-enfileirados. Rode 'Processar atas/votos' (ou aguarde o cron 12:00) e depois 'Auto-confirmar alta confiança'." }),
  });
}
