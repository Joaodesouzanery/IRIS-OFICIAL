/**
 * POST /api/v1/noticias/backfill
 * Backfill cronológico de 2026 (scraper "perfeito" para o prêmio): varre o arquivo
 * paginado das fontes gov.br até uma data-início (default 2026-01-01), SEM a janela de
 * 45d e SEM o filtro de 120d, focando em itens regulatórios (AIR/ARR/Agenda/Consultas/
 * Estoque/deliberações — filtro por título). Resumável por cursor (b_start) guardado em
 * monitoramento_sites.metadata.backfill_2026. Admin/cron. Re-chamar enquanto `next=true`.
 */

import { NextRequest, NextResponse } from "next/server";
import { isDemo } from "@/lib/server/is-demo";
import { isDemoRequest, requireAdminOrCron } from "@/lib/server/request-guards";
import { backfillNewsSource, type NewsSourceConfig } from "@/lib/server/news-collector";
import { ensureFederalNewsSources } from "@/lib/server/news-sources";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

const SINCE_DEFAULT = "2026-01-01";

export async function POST(req: NextRequest) {
  if (isDemo() || isDemoRequest(req)) {
    return NextResponse.json({ error: "Backfill indisponível em modo DEMO." }, { status: 403 });
  }
  const guard = await requireAdminOrCron(req, "noticias/backfill");
  if (guard) return guard;

  const body = (await req.json().catch(() => ({}))) as { since?: string; agencia_sigla?: string; maxPagesPerRun?: number };
  const since = /^\d{4}-\d{2}-\d{2}$/.test(String(body.since ?? "")) ? String(body.since) : SINCE_DEFAULT;
  const agencyFilter = body.agencia_sigla?.trim().toUpperCase() || null;
  const maxPagesPerRun = Math.max(1, Math.min(Number(body.maxPagesPerRun ?? 8), 20));

  const { createSupabaseServerClient } = await import("@/lib/supabase/server");
  const db = createSupabaseServerClient();
  try {
    await ensureFederalNewsSources(db);
  } catch {
    /* segue com o que já existe */
  }

  const { data: sitesRaw } = await db
    .from("monitoramento_sites")
    .select("id, url, estrategia, seletor_links, metadata, agencia:agencias(sigla, id)")
    .eq("tipo_fonte", "noticias")
    .eq("ativo", true);

  const sites = (sitesRaw ?? []).filter((s: any) => {
    const ag = Array.isArray(s.agencia) ? s.agencia[0] : s.agencia;
    if (!ag?.sigla) return false;
    if (agencyFilter && ag.sigla !== agencyFilter) return false;
    const strategy = s.estrategia === "artesp-news" || String(s.url).includes("artesp.sp.gov.br") ? "artesp" : "govbr";
    return strategy === "govbr"; // ARTESP e afins (JS) não têm arquivo paginado estático
  });

  // URLs já no banco dentro da janela (evita re-baixar o que já temos).
  const { data: knownRows } = await db.from("regulatory_news").select("url").gte("publicado_em", since).limit(20000);
  const knownUrls = new Set((knownRows ?? []).map((r: any) => r.url as string));

  const fontes: Array<Record<string, unknown>> = [];
  const upsertItems: Array<{ item: any; agencia_id: string | null }> = [];

  for (const site of sites) {
    const ag = Array.isArray(site.agencia) ? site.agencia[0] : site.agencia;
    const source: NewsSourceConfig = {
      id: site.id,
      agencia_sigla: ag.sigla,
      fonte: ag.sigla,
      url: site.url,
      strategy: "govbr",
      linkSelector: site.seletor_links ?? null,
    };
    const meta = site.metadata && typeof site.metadata === "object" && !Array.isArray(site.metadata) ? (site.metadata as Record<string, unknown>) : {};
    const prev = meta.backfill_2026 && typeof meta.backfill_2026 === "object" ? (meta.backfill_2026 as Record<string, unknown>) : {};
    const cursor = typeof prev.cursor === "number" ? prev.cursor : 0;

    const result = await backfillNewsSource(source, { since, cursor, maxPagesPerRun, knownUrls });
    for (const item of result.items) {
      upsertItems.push({ item, agencia_id: ag.id ?? null });
      knownUrls.add(item.url);
    }

    const newState = {
      cursor: result.nextCursor ?? cursor,
      reached_since: result.reachedSince,
      collected: (typeof prev.collected === "number" ? prev.collected : 0) + result.collected,
      oldest_date: result.oldestDate ?? prev.oldest_date ?? null,
      undated: (typeof prev.undated === "number" ? prev.undated : 0) + result.undated,
      pages_last_run: result.pagesFetched,
      last_run_at: new Date().toISOString(),
    };
    await db.from("monitoramento_sites").update({ metadata: { ...meta, backfill_2026: newState } }).eq("id", site.id);

    fontes.push({
      agencia_sigla: ag.sigla,
      coletados_run: result.collected,
      relevantes_encontrados: result.relevantesEncontrados,
      paginas: result.pagesFetched,
      reached_since: result.reachedSince,
      oldest_date: result.oldestDate,
      cursor_atual: newState.cursor,
      total_coletado: newState.collected,
      undated: newState.undated,
    });
  }

  let upserted = 0;
  if (upsertItems.length) {
    const rows = upsertItems.map(({ item, agencia_id }) => {
      const row: Record<string, unknown> = {
        agencia_id,
        agencia_sigla: item.agencia_sigla,
        titulo: item.titulo,
        url: item.url,
        fonte: item.fonte,
        publicado_em: item.publicado_em,
        hash_item: item.hash_item,
        metadata: { ...item.metadata },
        last_seen_at: new Date().toISOString(),
      };
      if (item.imagem_url) row.imagem_url = item.imagem_url;
      if (item.resumo) row.resumo = item.resumo;
      if (item.conteudo) row.conteudo = item.conteudo;
      return row;
    });
    for (let i = 0; i < rows.length; i += 500) {
      const { error } = await db.from("regulatory_news").upsert(rows.slice(i, i + 500), { onConflict: "url" });
      if (error) console.warn("[noticias/backfill] upsert falhou:", error.message);
      else upserted += rows.slice(i, i + 500).length;
    }
  }

  const next = fontes.some((f) => f.reached_since === false);
  return NextResponse.json({
    since,
    agencias: fontes.length,
    upserted,
    next, // enquanto true, re-chamar para continuar a varredura até 01/01/2026
    fontes,
    legal_notice: "Backfill cronológico de 2026 (itens regulatórios), resumável por cursor. Re-chame enquanto next=true.",
  });
}
