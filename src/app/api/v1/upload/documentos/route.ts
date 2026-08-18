/**
 * GET /api/v1/upload/documentos
 * Lista documentos brutos para a tela de revisao.
 */

import { NextRequest, NextResponse } from "next/server";
import { isDemo } from "@/lib/server/is-demo";
import { requireAdmin } from "@/lib/server/request-guards";

export async function GET(req: NextRequest) {
  const guard = await requireAdmin(req);
  if (guard) return guard;

  if (isDemo()) {
    return NextResponse.json({ data: [], total: 0 });
  }

  const ids = req.nextUrl.searchParams.get("ids")
    ?.split(",")
    .map((id) => id.trim())
    .filter(Boolean)
    .slice(0, 500);
  const status = req.nextUrl.searchParams.get("status");
  const limit = Math.min(500, Math.max(1, Number(req.nextUrl.searchParams.get("limit") ?? "100")));

  const { createSupabaseServerClient } = await import("@/lib/supabase/server");
  const db = createSupabaseServerClient();

  // Perf (QA ago/2026): `texto_extraido` (até 50k chars/doc) só sai quando a chamada é
  // pontual por `ids` (painel expandido) — na LISTA de 500 ele inflava o payload em MB.
  const incluirTexto = Boolean(ids && ids.length > 0);
  const selectCols: string = `
      id, upload_job_id, agencia_id, agencia_sigla_detected, filename, source_archive,
      storage_bucket, storage_path, file_hash, size_bytes, status, tipo_documento,
      documento_subtipo, semantic_duplicate_key, is_duplicate, duplicate_documento_id,
      duplicate_deliberacao_id, extraction_confidence, page_count, chars_per_page,
      ${incluirTexto ? "texto_extraido," : ""} campos_detectados, ata_items, warnings, error_message, metadata,
      processed_at, reviewed_at, created_at, updated_at,
      agencias (sigla, nome)
    `;
  let query = db
    .from("documentos_regulatorios")
    .select(selectCols, { count: "exact" })
    .order("created_at", { ascending: false })
    .limit(limit);

  if (ids && ids.length > 0) query = query.in("id", ids);
  if (status) query = query.eq("status", status);

  const { data, error, count } = await query;
  if (error) {
    console.error("[upload/documentos] Erro:", error);
    return NextResponse.json({ error: "Erro ao buscar documentos" }, { status: 500 });
  }

  // Perf (QA ago/2026): eram até 500 chamadas de Storage (1 createSignedUrl por doc) por
  // carregamento da tela — a maior latência percebida da revisão. Agora 1 chamada em lote
  // por bucket (createSignedUrls preserva a ordem dos paths).
  const docsList = (data ?? []) as any[];
  const signedByPath = new Map<string, string>();
  const porBucket = new Map<string, string[]>();
  for (const doc of docsList) {
    if (!doc.storage_path) continue;
    const bucket = doc.storage_bucket ?? "pdfs";
    porBucket.set(bucket, [...(porBucket.get(bucket) ?? []), doc.storage_path]);
  }
  for (const [bucket, paths] of porBucket) {
    const { data: signedList } = await db.storage.from(bucket).createSignedUrls(paths, 60 * 60);
    for (const s of signedList ?? []) {
      if (s?.path && s.signedUrl) signedByPath.set(`${bucket}|${s.path}`, s.signedUrl);
    }
  }

  const formatted = docsList.map((doc: any) => {
    const duplicateConfirmed = doc.status === "confirmed" && Boolean(doc.is_duplicate || doc.duplicate_documento_id || doc.duplicate_deliberacao_id);
    return {
      ...doc,
      is_duplicate: duplicateConfirmed,
      agencia: doc.agencias ?? null,
      agencias: undefined,
      signed_url: signedByPath.get(`${doc.storage_bucket ?? "pdfs"}|${doc.storage_path}`) ?? null,
      preview: toPreview({ ...doc, is_duplicate: duplicateConfirmed }),
    };
  });

  return NextResponse.json({ data: formatted, total: count ?? formatted.length });
}

function toPreview(doc: any) {
  const preview = doc.campos_detectados?.preview;
  if (preview && typeof preview === "object") {
    return {
      ...preview,
      filename: doc.filename,
      source_archive: doc.source_archive,
      file_hash: doc.file_hash,
      is_duplicate: Boolean(doc.is_duplicate || preview.is_duplicate),
      agencia_id_detected: doc.agencia_id ?? preview.agencia_id_detected ?? null,
      agencia_sigla_detected: doc.agencia_sigla_detected ?? preview.agencia_sigla_detected ?? null,
      confidence: Number(doc.extraction_confidence ?? preview.confidence ?? 0),
      page_count: Number(doc.page_count ?? preview.page_count ?? 0),
      chars_per_page: Number(doc.chars_per_page ?? preview.chars_per_page ?? 0),
      ata_items: doc.ata_items ?? preview.ata_items,
      warnings: doc.warnings ?? preview.warnings ?? [],
    };
  }

  return null;
}
