/**
 * POST /api/v1/upload/auto-confirm
 * Confirma automaticamente documentos de ALTA confiança, sem intervenção humana.
 *
 * Gate de segurança (TODAS verdadeiras): tipo ata + extraction_confidence >= 0.85 +
 * unanimidade detectada (sem divergência) + todos os nomes de votação resolvidos sem
 * revisão (match >= 0.85) + sem warnings bloqueantes + não duplicado.
 * Os casos que não passam permanecem em review_pending para a fila humana de /dashboard/upload.
 */

import { NextRequest, NextResponse } from "next/server";
import { requireAdminOrCron } from "@/lib/server/request-guards";
import { findBestMatch, normalizeName, type DiretorRecord } from "@/lib/server/name-matcher";
import { persistConfirmedDeliberacao } from "@/lib/server/confirm-deliberacoes";
import type { ConfirmDelib, TipoDocumento } from "@/types";

export const dynamic = "force-dynamic";

/** documentos_regulatorios.extraction_confidence é 0-1. */
const MIN_CONFIDENCE = 0.85;

type Gate = { confirm: boolean; reason: string };

export async function POST(req: NextRequest) {
  const guard = await requireAdminOrCron(req);
  if (guard) return guard;

  const body = await req.json().catch(() => ({})) as { limit?: number };
  const limit = Math.min(50, Math.max(1, Number(body.limit ?? 20)));

  const { createSupabaseServerClient } = await import("@/lib/supabase/server");
  const db = createSupabaseServerClient();

  const { data: docs, error } = await db
    .from("documentos_regulatorios")
    .select("id, upload_job_id, agencia_id, agencia_sigla_detected, filename, status, tipo_documento, documento_subtipo, semantic_duplicate_key, is_duplicate, extraction_confidence, campos_detectados, ata_items, warnings, created_at")
    .eq("status", "review_pending")
    .eq("tipo_documento", "ata")
    .gte("extraction_confidence", MIN_CONFIDENCE)
    .order("created_at", { ascending: true })
    .limit(limit);

  if (error) {
    console.error("[upload/auto-confirm] Erro ao buscar documentos:", error);
    return NextResponse.json({ error: "Erro ao buscar documentos" }, { status: 500 });
  }

  const diretoresCache = new Map<string, DiretorRecord[]>();
  async function getDiretores(agenciaId: string): Promise<DiretorRecord[]> {
    const cached = diretoresCache.get(agenciaId);
    if (cached) return cached;
    const { data } = await db.from("diretores").select("id, nome, nome_variantes").eq("agencia_id", agenciaId);
    const list: DiretorRecord[] = (data ?? []).map((dir: { id: string; nome: string; nome_variantes?: unknown }) => ({
      id: dir.id,
      nome: dir.nome,
      nome_variantes: Array.isArray(dir.nome_variantes) ? (dir.nome_variantes as string[]) : [],
    }));
    diretoresCache.set(agenciaId, list);
    return list;
  }

  const results: Array<{ documento_id: string; filename: string; auto_confirmed: boolean; reason: string; deliberacao_id?: string }> = [];

  for (const doc of docs ?? []) {
    const confirmDelib = documentToConfirmDelib(doc);
    const agenciaId = confirmDelib?.agencia_id ?? (doc.agencia_id as string | null);
    if (!confirmDelib || !agenciaId) {
      results.push({ documento_id: doc.id, filename: doc.filename, auto_confirmed: false, reason: "sem_preview_ou_agencia" });
      continue;
    }

    if (doc.is_duplicate === true) {
      results.push({ documento_id: doc.id, filename: doc.filename, auto_confirmed: false, reason: "duplicado" });
      continue;
    }

    const diretores = await getDiretores(agenciaId);
    const gate = evaluateGate(confirmDelib, diretores);
    if (!gate.confirm) {
      results.push({ documento_id: doc.id, filename: doc.filename, auto_confirmed: false, reason: gate.reason });
      continue;
    }

    const persisted = await persistConfirmedDeliberacao(db, confirmDelib, {
      globalAgenciaId: agenciaId,
      autoConfirmed: true,
    });

    if (persisted.status === "created") {
      results.push({ documento_id: doc.id, filename: doc.filename, auto_confirmed: true, reason: "ok", deliberacao_id: persisted.deliberacao_id });
    } else {
      results.push({ documento_id: doc.id, filename: doc.filename, auto_confirmed: false, reason: `persist_${persisted.status}:${persisted.error ?? ""}` });
    }
  }

  return NextResponse.json({
    scanned: docs?.length ?? 0,
    auto_confirmed: results.filter((r) => r.auto_confirmed).length,
    pending_review: results.filter((r) => !r.auto_confirmed).length,
    results,
  });
}

/** Reconstrói o ConfirmDelib a partir do documento bruto, espelhando o mapeamento do dashboard. */
function documentToConfirmDelib(doc: any): ConfirmDelib | null {
  const preview = doc.campos_detectados?.preview;
  if (!preview) return null;
  const fields = preview.fields ?? {};
  return {
    filename: doc.filename,
    documento_id: doc.id,
    upload_job_id: doc.upload_job_id ?? null,
    agencia_id: doc.agencia_id ?? preview.agencia_id_detected ?? null,
    numero_deliberacao: fields.numero_deliberacao ?? null,
    numero_reuniao: fields.numero_reuniao ?? null,
    reuniao_ordinaria: fields.reuniao_ordinaria ?? null,
    tipo_reuniao: fields.tipo_reuniao ?? null,
    tipo_documento: (fields.tipo_documento ?? doc.tipo_documento ?? "deliberacao") as TipoDocumento,
    data_reuniao: fields.data_reuniao ?? null,
    interessado: fields.interessado ?? null,
    assunto: fields.assunto ?? null,
    procedencia: fields.procedencia ?? null,
    relator: fields.relator ?? null,
    item_numero: fields.item_numero ?? null,
    processo: fields.processo ?? null,
    resultado: fields.resultado ?? null,
    decisoes_todas: fields.decisoes_todas ?? [],
    microtema: fields.microtema ?? "outros",
    area_regulatoria: fields.area_regulatoria ?? "outros",
    pauta_interna: Boolean(fields.pauta_interna),
    resumo_pleito: fields.resumo_pleito ?? null,
    fundamento_decisao: fields.fundamento_decisao ?? null,
    nomes_votacao: fields.nomes_votacao ?? [],
    nomes_votacao_contra: fields.nomes_votacao_contra ?? [],
    nomes_votacao_ausente: fields.nomes_votacao_ausente ?? [],
    votos_sugeridos: fields.votos_sugeridos ?? [],
    extraction_confidence: Number(doc.extraction_confidence ?? preview.confidence ?? 0),
    documento_antt_tipo: preview.documento_antt_tipo ?? null,
    documento_subtipo: doc.documento_subtipo ?? preview.documento_subtipo ?? null,
    import_counts_as_final: preview.import_counts_as_final !== false,
    semantic_duplicate_key: doc.semantic_duplicate_key ?? null,
    warnings: doc.warnings ?? preview.warnings ?? [],
    extraction_raw: {
      ...(preview.extraction_raw ?? {}),
      documento_antt_tipo: preview.documento_antt_tipo,
      documento_subtipo: doc.documento_subtipo ?? preview.documento_subtipo,
      import_counts_as_final: preview.import_counts_as_final !== false,
      semantic_duplicate_key: doc.semantic_duplicate_key,
      warnings: doc.warnings ?? preview.warnings,
      area_regulatoria: fields.area_regulatoria,
    },
    ata_items: doc.ata_items ?? preview.ata_items ?? undefined,
  };
}

function isBlockingWarning(warning: string): boolean {
  return /revis|conflit|ambig|duplicat|n[aã]o foi|inconsist|faltando|sem texto|illegible|ileg[ií]vel/i.test(warning);
}

function collectVotingNames(d: ConfirmDelib): string[] {
  const fromItems = (d.ata_items ?? []).flatMap((it) => [
    ...(it.votos_detectados ?? []),
    ...(it.votos_contra_detectados ?? []),
    ...(it.votos_ausentes_detectados ?? []),
  ]);
  const top = [...d.nomes_votacao, ...d.nomes_votacao_contra, ...(d.nomes_votacao_ausente ?? [])];
  return [...new Set([...fromItems, ...top].map((n) => normalizeName(String(n))).filter((n) => n.length >= 3))];
}

function evaluateGate(d: ConfirmDelib, diretores: DiretorRecord[]): Gate {
  if (d.extraction_confidence < MIN_CONFIDENCE) return { confirm: false, reason: "confidence_baixa" };
  if (d.tipo_documento !== "ata") return { confirm: false, reason: "nao_ata" };

  const items = d.ata_items ?? [];
  if (items.length === 0) return { confirm: false, reason: "sem_itens" };

  const counting = items.filter((it) => it.resultado);
  if (counting.length === 0) return { confirm: false, reason: "sem_resultado" };

  const hasDivergence = items.some((it) => (it.votos_contra_detectados ?? []).length > 0);
  if (hasDivergence) return { confirm: false, reason: "tem_divergencia" };

  const allUnanime = counting.every((it) => it.unanimidade_detectada === true);
  if (!allUnanime) return { confirm: false, reason: "sem_unanimidade" };

  const itemsNeedingReview = items.some((it) => it.needs_review === true);
  if (itemsNeedingReview) return { confirm: false, reason: "item_needs_review" };

  const blocking = (d.warnings ?? []).filter(isBlockingWarning);
  if (blocking.length > 0) return { confirm: false, reason: "warnings_bloqueantes" };

  const names = collectVotingNames(d);
  if (names.length === 0) return { confirm: false, reason: "sem_nomes" };

  const unresolved = names.filter((name) => {
    const match = findBestMatch(name, diretores);
    return match.needsReview || match.isNew;
  });
  if (unresolved.length > 0) return { confirm: false, reason: `nomes_nao_resolvidos:${unresolved.length}` };

  return { confirm: true, reason: "ok" };
}
