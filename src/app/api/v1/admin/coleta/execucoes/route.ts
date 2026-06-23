/**
 * GET /api/v1/admin/coleta/execucoes
 * Telemetria unificada de coleta (view coleta_execucoes): monitoramento + notícias.
 * Lista as execuções recentes (com filtros) e um resumo das últimas 24h.
 * Admin-only.
 */

import { NextRequest, NextResponse } from "next/server";
import { isDemo } from "@/lib/server/is-demo";
import { requireAdmin } from "@/lib/server/request-guards";

export const dynamic = "force-dynamic";

const VALID_DOMINIO = new Set(["monitoramento", "noticias"]);
const VALID_STATUS = new Set(["running", "ok", "error", "needs_headless"]);
const VALID_TRIGGER = new Set(["manual", "scheduled", "test", "backfill"]);

export async function GET(req: NextRequest) {
  const guard = await requireAdmin(req);
  if (guard) return guard;

  if (isDemo()) {
    return NextResponse.json({ execucoes: [], resumo_24h: emptyResumo() });
  }

  const { searchParams } = req.nextUrl;
  const limit = Math.min(200, Math.max(1, parseInt(searchParams.get("limit") ?? "50", 10)));

  const { createSupabaseServerClient } = await import("@/lib/supabase/server");
  const db = createSupabaseServerClient();

  let query = db
    .from("coleta_execucoes")
    .select(
      "dominio, id, site_id, trigger_type, status, started_at, finished_at, duration_ms, itens, novos, fetch_retries, http_429_count, throttle_wait_ms, headless_dependency_missing, headless_launch_failed, error_message",
    )
    .order("started_at", { ascending: false })
    .limit(limit);

  const dominio = searchParams.get("dominio");
  if (dominio && VALID_DOMINIO.has(dominio)) query = query.eq("dominio", dominio);
  const status = searchParams.get("status");
  if (status && VALID_STATUS.has(status)) query = query.eq("status", status);
  const trigger = searchParams.get("trigger_type");
  if (trigger && VALID_TRIGGER.has(trigger)) query = query.eq("trigger_type", trigger);

  const { data: execucoes, error } = await query;
  if (error) {
    console.error("[coleta/execucoes] Erro:", error);
    return NextResponse.json({ error: "Erro ao buscar telemetria de coleta" }, { status: 500 });
  }

  // Resumo das últimas 24h (janela separada, independente dos filtros de lista).
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const { data: recent } = await db
    .from("coleta_execucoes")
    .select("status, duration_ms, fetch_retries, http_429_count, headless_dependency_missing, headless_launch_failed")
    .gte("started_at", since)
    .limit(5000);

  return NextResponse.json({ execucoes: execucoes ?? [], resumo_24h: summarize(recent ?? []) });
}

function emptyResumo() {
  return {
    total: 0, ok: 0, error: 0, taxa_falha_pct: 0, duracao_media_ms: 0,
    total_retries: 0, total_429: 0, total_headless_falhas: 0,
  };
}

function summarize(rows: Array<Record<string, unknown>>) {
  const total = rows.length;
  if (total === 0) return emptyResumo();
  let ok = 0, error = 0, somaDuracao = 0, nDuracao = 0, retries = 0, http429 = 0, headlessFalhas = 0;
  for (const r of rows) {
    if (r.status === "ok") ok++;
    if (r.status === "error") error++;
    if (typeof r.duration_ms === "number") { somaDuracao += r.duration_ms; nDuracao++; }
    retries += Number(r.fetch_retries ?? 0);
    http429 += Number(r.http_429_count ?? 0);
    headlessFalhas += Number(r.headless_dependency_missing ?? 0) + Number(r.headless_launch_failed ?? 0);
  }
  return {
    total,
    ok,
    error,
    taxa_falha_pct: total > 0 ? Math.round((error / total) * 1000) / 10 : 0,
    duracao_media_ms: nDuracao > 0 ? Math.round(somaDuracao / nDuracao) : 0,
    total_retries: retries,
    total_429: http429,
    total_headless_falhas: headlessFalhas,
  };
}
