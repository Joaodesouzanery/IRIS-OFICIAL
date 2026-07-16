import { NextRequest, NextResponse } from "next/server";
import { isDemo } from "@/lib/server/is-demo";
import { collectRegulatoryNews, NEWS_WINDOW_DAYS, type DeepCollectOptions, type NewsCollectionMode, type NewsSourceConfig } from "@/lib/server/news-collector";
import { ensureFederalNewsSources, getNewsProfile, getNewsTier } from "@/lib/server/news-sources";
import { isDemoRequest, requireAdminOrCron } from "@/lib/server/request-guards";
import { parseIntParam } from "@/lib/server/http-params";
import { drainFetchStats, type FetchStats } from "@/lib/server/resilient-fetch";
import { drainHeadlessOutcomes, type HeadlessStats } from "@/lib/server/headless";
import type { RegulatoryNewsCollectResponse } from "@/types";

type CollectionTelemetry = { durationMs: number; fetch: FetchStats; headless: HeadlessStats };

export const dynamic = "force-dynamic";
// Garante runtime Node (puppeteer/Buffer/TextDecoder) e tempo p/ coleta + validação de imagens.
export const runtime = "nodejs";
export const maxDuration = 60;

type NewsTierFilter = "core" | "expanded" | "all";
type NewsCollectionScope = "all" | "priority";
type CollectionNextBatch = { recommended: boolean; tier: NewsTierFilter; scope: NewsCollectionScope; offset: number; limit: number } | null;

const PRIORITY_NEWS_AGENCIES = new Set(["ANTT", "ANM", "ARTESP"]);

export async function POST(req: NextRequest) {
  return collectSafely(req);
}

export async function GET(req: NextRequest) {
  return collectSafely(req);
}

async function collectSafely(req: NextRequest) {
  try {
    return await collect(req);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Falha desconhecida na coleta de noticias";
    console.error("[noticias/coletar] Falha nao tratada:", error);
    return NextResponse.json({
      found: 0,
      upserted: 0,
      items: [],
      source_reports: [],
      batch: emptyBatchSummary(),
      audit: emptyNewsAudit(),
      partial_success: false,
      failed_sources: [],
      next_batch: null,
      error: `Coleta interrompida com resposta segura: ${message}`,
    } satisfies RegulatoryNewsCollectResponse, { status: 200 });
  }
}

async function collect(req: NextRequest) {
  if (isDemo() || isDemoRequest(req)) {
    return NextResponse.json(
      { error: "Coleta real indisponível em modo DEMO. Confirme que o ambiente está em Dados Reais para gravar notícias." },
      { status: 403 },
    );
  }

  const guard = await requireAdminOrCron(req);
  if (guard) return guard;

  const sourceIdFilter = req.nextUrl.searchParams.get("source_id")?.trim() || null;
  const agenciaFilter = req.nextUrl.searchParams.get("agencia_sigla")?.trim().toUpperCase() || null;
  const hasSourceFilter = Boolean(sourceIdFilter || agenciaFilter);
  const automatic = req.nextUrl.searchParams.get("automatic") === "1";
  const scope = parseCollectionScope(req.nextUrl.searchParams.get("scope"));
  const mode = parseCollectionMode(req.nextUrl.searchParams.get("mode"));
  const tierFilter = parseTierFilter(
    req.nextUrl.searchParams.get("tier"),
    "all",
  );
  const defaultLimit = scope === "priority" ? 8 : tierFilter === "core" ? 8 : 3;
  const requestedLimit = Number(req.nextUrl.searchParams.get("limit") ?? defaultLimit);
  const maxLimit = hasSourceFilter ? 24 : scope === "priority" ? 12 : tierFilter === "core" ? 8 : 5;
  const limit = Math.min(maxLimit, Math.max(3, Number.isFinite(requestedLimit) ? requestedLimit : defaultLimit));
  const offset = parseIntParam(req.nextUrl.searchParams.get("offset"), 0, 0);
  const { createSupabaseServerClient } = await import("@/lib/supabase/server");
  const db = createSupabaseServerClient();
  try {
    await ensureFederalNewsSources(db);
  } catch {
    return NextResponse.json({ error: "Erro ao preparar fontes federais de noticias" }, { status: 500 });
  }
  let { data: configuredSources, error: sourceError } = await listConfiguredSources(db, true);
  if (!sourceError && configuredSources?.length === 0) {
    ({ data: configuredSources, error: sourceError } = await listConfiguredSources(db, false));
  }

  if (sourceError) {
    return NextResponse.json({ error: "Erro ao buscar fontes de noticias" }, { status: 500 });
  }

  const filteredSources = (configuredSources ?? []).filter((source) => {
    const agencia = Array.isArray(source.agencia) ? source.agencia[0] : source.agencia;
    if (sourceIdFilter && source.id !== sourceIdFilter) return false;
    if (agenciaFilter && agencia?.sigla !== agenciaFilter) return false;
    if (scope === "priority" && !PRIORITY_NEWS_AGENCIES.has(agencia?.sigla ?? "")) return false;
    if (tierFilter !== "all" && sourceNewsTier(source) !== tierFilter) return false;
    return true;
  });
  const selectedSources = !automatic && tierFilter === "expanded" && !hasSourceFilter
    ? selectExpandedSourceRows(filteredSources, 3)
    : filteredSources;

  const sources = selectedSources
    .map(toNewsSourceConfig)
    .filter((source): source is NewsSourceConfig => Boolean(source));

  if (sources.length === 0) {
    return NextResponse.json({ error: "Nenhuma fonte de noticias ativa foi cadastrada" }, { status: 409 });
  }

  const sourceRows = new Map(selectedSources.map((source) => [source.id, source]));
  const batchOffsets = new Map<string, number>();
  const collectStartedAt = Date.now();
  drainFetchStats();
  drainHeadlessOutcomes();

  // Coleta PROFUNDA (cobre a janela de recência de cada fonte): monta o conjunto de
  // URLs já conhecidas dentro da janela para NÃO re-baixar o que já temos — só os
  // artigos NOVOS ganham detail-fetch. Assim "trazer tudo" fica eficiente.
  const windowCutoffIso = new Date(Date.now() - NEWS_WINDOW_DAYS * 24 * 60 * 60 * 1000).toISOString();
  // Inclui também os itens SEM data (publicado_em NULL) vistos recentemente (last_seen_at):
  // antes o `.gte("publicado_em")` os excluía → eram re-baixados TODO run, queimando o
  // orçamento de 45s em vez de descobrir os novos (crítico nas fontes React/Volto).
  const { data: knownRows } = await db
    .from("regulatory_news")
    .select("url")
    .or(`publicado_em.gte.${windowCutoffIso},last_seen_at.gte.${windowCutoffIso}`)
    .limit(12000);
  const deep: DeepCollectOptions = {
    windowDays: NEWS_WINDOW_DAYS,
    knownUrls: new Set((knownRows ?? []).map((r) => r.url as string)),
    // Hobby mata a função aos 60s (SIGKILL sem resposta) — o orçamento corta os
    // detalhes graciosamente; o que sobrar fica pending → "Buscar mais notícias".
    deadlineAt: Date.now() + 45_000,
  };

  const result = automatic
    ? await collectAutomaticBatches(sources, sourceRows, limit, mode, deep)
    : await collectRegulatoryNews(sources, limit, offset, { mode, deep });
  const telemetry: CollectionTelemetry = {
    durationMs: Date.now() - collectStartedAt,
    fetch: drainFetchStats(),
    headless: drainHeadlessOutcomes(),
  };
  for (const report of result.source_reports) {
    batchOffsets.set(report.source_id ?? report.agencia_sigla, report.batch_offset ?? offset);
  }
  const items = result.items;
  const { data: agencias } = await db.from("agencias").select("id, sigla");
  const agencyBySigla = new Map((agencias ?? []).map((a) => [a.sigla, a.id]));

  await Promise.all([...sourceRows.keys()].map((sourceId) => {
    const reports = result.source_reports.filter((report) => report.source_id === sourceId);
    if (reports.length === 0) return Promise.resolve();
    const source = sourceRows.get(sourceId);
    if (!source) return Promise.resolve();
    const currentMetadata = source?.metadata && typeof source.metadata === "object" ? source.metadata : {};
    const freshReport = reports.find((report) => report.collection_phase === "fresh") ?? reports[0];
    const backlogReport = reports.find((report) => report.collection_phase === "backlog");
    const offsetReport = automatic ? backlogReport ?? freshReport : freshReport;
    const sourceOffset = batchOffsets.get(offsetReport.source_id ?? sourceId) ?? offset;
    const nextOffset = automatic && offsetReport.status === "ok" && (offsetReport.items_pending ?? 0) > 0
      ? sourceOffset + (offsetReport.items_processed ?? 0)
      : 0;
    // "empty" (fonte OK, sem item novo) conta como sucesso do check — só é "error" se houver erro real.
    const status = reports.some((report) => report.status === "ok")
      ? "ok"
      : reports.some((report) => report.status === "error") ? "error" : "ok";
    const error = reports.find((report) => report.status === "error")?.error ?? null;
    return db
      .from("monitoramento_sites")
      .update({
        ultimo_check: new Date().toISOString(),
        ultimo_status: status,
        ultimo_erro: error?.slice(0, 1000) ?? null,
        metadata: {
          ...currentMetadata,
          news_next_offset: nextOffset,
          news_tier: sourceNewsTier(source),
          news_profile: sourceNewsProfile(source),
          news_last_trigger: automatic ? "scheduled" : "manual",
          news_last_scope: scope,
          news_last_mode: mode,
          news_last_collection_at: new Date().toISOString(),
          news_last_success_at: status === "ok" ? new Date().toISOString() : currentMetadata.news_last_success_at,
          news_last_error_at: status === "error" ? new Date().toISOString() : currentMetadata.news_last_error_at,
          news_last_fresh_collection_at: freshReport ? new Date().toISOString() : currentMetadata.news_last_fresh_collection_at,
          news_last_collection_mode: automatic
            ? backlogReport ? "combined" : "fresh"
            : "manual",
          news_fresh_items_processed: freshReport?.items_processed ?? 0,
          news_backlog_items_processed: backlogReport?.items_processed ?? 0,
          news_items_pending: offsetReport.items_pending ?? 0,
          news_latest_official_title: freshReport?.latest_title ?? currentMetadata.news_latest_official_title,
          news_latest_official_url: freshReport?.latest_urls?.[0] ?? currentMetadata.news_latest_official_url,
          news_latest_official_publicado_em: freshReport?.latest_publicado_em ?? currentMetadata.news_latest_official_publicado_em,
        },
      })
      .eq("id", sourceId);
  }));

  let rows = items.map((item) => {
    const row: Record<string, unknown> = {
      agencia_id: agencyBySigla.get(item.agencia_sigla) ?? null,
      agencia_sigla: item.agencia_sigla,
      titulo: item.titulo,
      url: item.url,
      fonte: item.fonte,
      publicado_em: item.publicado_em,
      hash_item: item.hash_item,
      metadata: {
        ...item.metadata,
        collection_batch: { offset, limit, mode, scope, processed_at: new Date().toISOString(), source_id: item.metadata.source_id ?? null },
      },
      last_seen_at: new Date().toISOString(),
    };
    // Enrich reescreve imagem_url a cada coleta; NUNCA sobrescrever uma imagem já boa
    // por null (o Plone às vezes recusa o probe e o candidato vem null) — só atualiza
    // quando há imagem nova. Preserva a última foto boa. QA Etapa 20.
    if (item.imagem_url) row.imagem_url = item.imagem_url;
    if (item.resumo) row.resumo = item.resumo;
    if (item.conteudo) row.conteudo = item.conteudo;
    return row;
  });

  // Suprime imagem GENÉRICA (logo/banner da agência usado como og:image em muitos
  // artigos): se a mesma imagem aparece em ≥3 artigos (banco + lote), não é foto
  // real → grava sem foto, evitando a mesma imagem repetida no feed/Newsletter.
  const batchImageUrls = [...new Set(rows.map((r) => r.imagem_url).filter((u): u is string => typeof u === "string" && u.length > 0))];
  if (batchImageUrls.length > 0) {
    const { data: existingImgs } = await db.from("regulatory_news").select("imagem_url").in("imagem_url", batchImageUrls);
    const count = new Map<string, number>();
    for (const e of existingImgs ?? []) if (e.imagem_url) count.set(e.imagem_url, (count.get(e.imagem_url) ?? 0) + 1);
    for (const r of rows) if (typeof r.imagem_url === "string") count.set(r.imagem_url, (count.get(r.imagem_url) ?? 0) + 1);
    // Imagem por-artigo do Plone é ÚNICA por notícia — nunca é logo genérico; jamais
    // suprimir (senão zeraria a única foto real do card). Cobre o lead-image Volto
    // (…/@@images/image[/scale]) E o formato UUID da ANM/gov.br clássico
    // (…/@@images/<uuid>.<ext>), que o guard da Etapa 19 não protegia. QA Etapa 20.
    const isPerArticleLeadImage = (u: string) =>
      /\/@@images\/image(?:\/[a-z]+)?$/i.test(u) ||
      /\/@@images\/[0-9a-f-]{8,}\.(?:jpe?g|png|webp|gif)$/i.test(u);
    const generic = new Set(
      [...count.entries()].filter(([u, n]) => n >= 3 && !isPerArticleLeadImage(u)).map(([u]) => u),
    );
    if (generic.size > 0) {
      for (const r of rows) {
        if (typeof r.imagem_url === "string" && generic.has(r.imagem_url)) {
          r.imagem_url = null;
          r.metadata = { ...(r.metadata as Record<string, unknown>), image_generic_suppressed: true };
        }
      }
    }
  }

  // ── Republicação sob NOVA URL (defeso eleitoral) ─────────────────────────────
  // A mesma notícia (mesma agência + mesmo título ± mesma data) já existe no banco
  // com a URL antiga — que pode ter virado login-walled (caso ANTT). Em vez de
  // inserir DUPLICATA, MIGRA a linha existente para a URL nova/pública (o "Saiba
  // Mais" volta a funcionar) e preenche a imagem se faltava. QA Etapa 22.
  if (rows.length > 0) {
    const normTitulo = (s: unknown) =>
      String(s ?? "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/\s+/g, " ").trim();
    const siglas = [...new Set(rows.map((r) => r.agencia_sigla as string).filter(Boolean))];
    const { data: existentes } = await db
      .from("regulatory_news")
      .select("id, url, titulo, agencia_sigla, publicado_em, imagem_url")
      .in("agencia_sigla", siglas)
      .limit(4000);
    const porChave = new Map<string, { id: string; url: string; publicado_em: string | null; imagem_url: string | null }>();
    const urlsExistentes = new Set<string>();
    for (const e of (existentes ?? []) as Array<{ id: string; url: string; titulo: string; agencia_sigla: string; publicado_em: string | null; imagem_url: string | null }>) {
      urlsExistentes.add(e.url);
      porChave.set(`${e.agencia_sigla}|${normTitulo(e.titulo)}`, e);
    }
    const restantes: typeof rows = [];
    let migradas = 0;
    for (const r of rows) {
      const ex = porChave.get(`${r.agencia_sigla}|${normTitulo(r.titulo)}`);
      const urlNova = String(r.url ?? "");
      if (ex && ex.url !== urlNova) {
        // Datas incompatíveis (ambas presentes e dias diferentes) → provavelmente
        // notícias distintas com título igual; segue como insert normal.
        const d1 = String(ex.publicado_em ?? "").slice(0, 10);
        const d2 = String(r.publicado_em ?? "").slice(0, 10);
        if (d1 && d2 && d1 !== d2) { restantes.push(r); continue; }
        if (urlsExistentes.has(urlNova)) continue; // ambas versões já no banco → não insere de novo
        const patch: Record<string, unknown> = {
          url: urlNova,
          hash_item: r.hash_item,
          last_seen_at: r.last_seen_at,
          metadata: { ...(r.metadata as Record<string, unknown>), url_migrada_de: ex.url },
        };
        if (!ex.imagem_url && r.imagem_url) patch.imagem_url = r.imagem_url;
        if (!ex.publicado_em && r.publicado_em) patch.publicado_em = r.publicado_em;
        const { error: migErr } = await db.from("regulatory_news").update(patch).eq("id", ex.id);
        if (migErr) restantes.push(r); // migração falhou → deixa o upsert seguir
        else migradas++;
        continue;
      }
      restantes.push(r);
    }
    if (migradas > 0) console.log(`[noticias/coletar] ${migradas} notícia(s) migrada(s) para a URL republicada (defeso).`);
    rows = restantes;
  }

  if (rows.length === 0) {
    await recordCollectionRuns(db, result.source_reports, automatic, telemetry);
    return NextResponse.json({
      found: 0,
      upserted: 0,
      items: [],
      source_reports: result.source_reports,
      batch: summarizeBatch(result.source_reports),
      audit: summarizeNewsAudit(items),
      partial_success: false,
      failed_sources: result.source_reports.filter((report) => report.status === "error").map((report) => ({
        agencia_sigla: report.agencia_sigla,
        fonte: report.fonte,
        source_url: report.source_url,
        error: report.error ?? report.detail_errors?.[0] ?? "Falha sem detalhe",
      })),
      next_batch: buildNextBatch(result.source_reports, { tier: tierFilter, scope, offset, limit }),
    } satisfies RegulatoryNewsCollectResponse);
  }

  const { data, error } = await db
    .from("regulatory_news")
    .upsert(rows, { onConflict: "url" })
    .select("*, agencia:agencias(sigla, nome)");

  if (error) {
    const failedReports = result.source_reports.map((report) => ({
      ...report,
      status: "error" as const,
      error: `Erro ao salvar noticias coletadas: ${error.message}`,
    }));
    await recordCollectionRuns(db, failedReports, automatic, telemetry);
    return NextResponse.json({
      error: "Erro ao salvar noticias coletadas",
      source_reports: failedReports,
      batch: summarizeBatch(failedReports),
      audit: summarizeNewsAudit(items),
      partial_success: false,
      failed_sources: failedReports.map((report) => ({
        agencia_sigla: report.agencia_sigla,
        fonte: report.fonte,
        source_url: report.source_url,
        error: report.error ?? "Erro ao salvar noticias coletadas",
      })),
      next_batch: buildNextBatch(result.source_reports, { tier: tierFilter, scope, offset, limit }),
    }, { status: 500 });
  }
  await recordCollectionRuns(db, result.source_reports, automatic, telemetry);

  return NextResponse.json({
    found: items.length,
    upserted: data?.length ?? 0,
    items: data ?? [],
    source_reports: result.source_reports,
    batch: summarizeBatch(result.source_reports),
    audit: summarizeNewsAudit(items),
    partial_success: result.source_reports.some((report) => report.status === "ok") && result.source_reports.some((report) => report.status === "error"),
    failed_sources: result.source_reports.filter((report) => report.status === "error").map((report) => ({
      agencia_sigla: report.agencia_sigla,
      fonte: report.fonte,
      source_url: report.source_url,
      error: report.error ?? report.detail_errors?.[0] ?? "Falha sem detalhe",
    })),
    next_batch: buildNextBatch(result.source_reports, { tier: tierFilter, scope, offset, limit }),
  } satisfies RegulatoryNewsCollectResponse);
}

function summarizeBatch(reports: Array<{ links_found: number; items_processed: number; items_pending: number; images_found: number; images_absent: number; images_failed: number }>) {
  return reports.reduce((summary, report) => ({
    links_detectados: summary.links_detectados + report.links_found,
    itens_processados: summary.itens_processados + report.items_processed,
    itens_pendentes: summary.itens_pendentes + report.items_pending,
    imagens_encontradas: summary.imagens_encontradas + report.images_found,
    imagens_ausentes: summary.imagens_ausentes + report.images_absent,
    imagens_com_falha: summary.imagens_com_falha + report.images_failed,
  }), {
    links_detectados: 0,
    itens_processados: 0,
    itens_pendentes: 0,
    imagens_encontradas: 0,
    imagens_ausentes: 0,
    imagens_com_falha: 0,
  });
}

function emptyBatchSummary() {
  return {
    links_detectados: 0,
    itens_processados: 0,
    itens_pendentes: 0,
    imagens_encontradas: 0,
    imagens_ausentes: 0,
    imagens_com_falha: 0,
  };
}

function summarizeNewsAudit(items: Array<{ imagem_url?: string | null; conteudo?: string | null; resumo?: string | null; metadata?: Record<string, unknown> }>) {
  return items.reduce((summary, item) => {
    const quality = item.metadata?.image_quality;
    const contentStatus = item.metadata?.content_status;
    return {
      imagens_alta_qualidade: summary.imagens_alta_qualidade + (quality === "high" ? 1 : 0),
      imagens_baixa_qualidade: summary.imagens_baixa_qualidade + (quality === "low" ? 1 : 0),
      conteudo_completo: summary.conteudo_completo + (contentStatus === "complete" ? 1 : 0),
      conteudo_curto: summary.conteudo_curto + (contentStatus === "short" || contentStatus === "partial" ? 1 : 0),
      sem_conteudo: summary.sem_conteudo + (!item.conteudo && !item.resumo ? 1 : 0),
      proxy_pronto: summary.proxy_pronto + (item.imagem_url ? 1 : 0),
    };
  }, {
    imagens_alta_qualidade: 0,
    imagens_baixa_qualidade: 0,
    conteudo_completo: 0,
    conteudo_curto: 0,
    sem_conteudo: 0,
    proxy_pronto: 0,
  });
}

function emptyNewsAudit() {
  return {
    imagens_alta_qualidade: 0,
    imagens_baixa_qualidade: 0,
    conteudo_completo: 0,
    conteudo_curto: 0,
    sem_conteudo: 0,
    proxy_pronto: 0,
  };
}

function buildNextBatch(
  reports: Array<{ status: "ok" | "empty" | "error"; items_pending?: number; items_processed?: number; batch_offset?: number }>,
  current: { tier: NewsTierFilter; scope: NewsCollectionScope; offset: number; limit: number },
): CollectionNextBatch {
  const pending = reports.some((report) => (report.items_pending ?? 0) > 0);
  if (!pending) return null;
  const processed = Math.max(...reports.map((report) => report.items_processed ?? 0), current.limit);
  return {
    recommended: true,
    tier: current.tier,
    scope: current.scope,
    offset: current.offset + processed,
    limit: current.limit,
  };
}

function toNewsSourceConfig(source: {
  id: string;
  nome: string;
  url: string;
  estrategia: string;
  seletor_links?: string | null;
  metadata?: Record<string, unknown> | null;
  agencia: { sigla: string } | Array<{ sigla: string }> | null;
}): NewsSourceConfig | null {
  const agencia = Array.isArray(source.agencia) ? source.agencia[0] : source.agencia;
  if (!agencia?.sigla) return null;
  const tier = sourceNewsTier(source);
  return {
    id: source.id,
    agencia_sigla: agencia.sigla,
    fonte: agencia.sigla,
    url: source.url,
    strategy: source.estrategia === "artesp-news" || source.url.includes("artesp.sp.gov.br")
      ? "artesp"
      : "govbr",
    tier,
    profile: sourceNewsProfile(source),
    linkSelector: source.seletor_links ?? null,
  };
}

function listConfiguredSources(db: ReturnType<typeof import("@/lib/supabase/server").createSupabaseServerClient>, activeOnly: boolean) {
  let query = db
    .from("monitoramento_sites")
    .select("id, nome, url, estrategia, seletor_links, metadata, agencia:agencias(sigla)")
    .eq("tipo_fonte", "noticias");
  if (activeOnly) query = query.eq("ativo", true);
  return query.order("nome", { ascending: true });
}

async function collectAutomaticBatches(
  sources: NewsSourceConfig[],
  configured: Map<string, { metadata?: Record<string, unknown> | null }>,
  limit: number,
  mode: NewsCollectionMode,
  deep?: DeepCollectOptions,
) {
  const coreSources = sources.filter((source) => (source.tier ?? "core") === "core");
  const expandedSources = selectExpandedSources(
    sources.filter((source) => source.tier === "expanded"),
    configured,
    mode === "discover" ? 3 : 2,
  );
  const selectedSources = [...coreSources, ...expandedSources];
  const batches: Array<{
    items: Awaited<ReturnType<typeof collectRegulatoryNews>>["items"];
    source_reports: Awaited<ReturnType<typeof collectRegulatoryNews>>["source_reports"];
  }> = [];
  for (const source of selectedSources) {
    const metadata = source.id ? configured.get(source.id)?.metadata : null;
    const rawOffset = metadata && typeof metadata.news_next_offset === "number" ? metadata.news_next_offset : 0;
    const sourceOffset = Number.isFinite(rawOffset) && rawOffset >= 0 ? rawOffset : 0;
    const sourceLimit = source.tier === "expanded" ? Math.min(5, limit) : limit;
    const freshBatch = await collectRegulatoryNews([source], sourceLimit, 0, { mode, deep });
    // No modo profundo a janela já cobre o backlog → não precisa varredura por offset.
    const backlogBatch = !deep && mode === "enrich" && sourceOffset > 0
      ? await collectRegulatoryNews([source], sourceLimit, sourceOffset, { mode })
      : { items: [], source_reports: [] };
    batches.push({
      items: dedupeNewsItems([...freshBatch.items, ...backlogBatch.items]),
      source_reports: [
        ...freshBatch.source_reports.map((report) => ({ ...report, collection_phase: "fresh" as const, batch_offset: 0 })),
        ...backlogBatch.source_reports.map((report) => ({ ...report, collection_phase: "backlog" as const, batch_offset: sourceOffset })),
      ],
    });
  }
  return {
    items: batches.flatMap((batch) => batch.items),
    source_reports: batches.flatMap((batch) => batch.source_reports),
  };
}

function parseTierFilter(value: string | null, fallback: NewsTierFilter): NewsTierFilter {
  return value === "core" || value === "expanded" || value === "all" ? value : fallback;
}

function parseCollectionMode(value: string | null): NewsCollectionMode {
  return value === "discover" ? "discover" : "enrich";
}

function parseCollectionScope(value: string | null): NewsCollectionScope {
  return value === "priority" ? "priority" : "all";
}

function sourceNewsTier(source: { metadata?: Record<string, unknown> | null; agencia: { sigla: string } | Array<{ sigla: string }> | null }) {
  const metadata = source.metadata && typeof source.metadata === "object" ? source.metadata : {};
  const configured = metadata.news_tier;
  if (configured === "core" || configured === "expanded") return configured;
  const agencia = Array.isArray(source.agencia) ? source.agencia[0] : source.agencia;
  return getNewsTier(agencia?.sigla ?? "");
}

function sourceNewsProfile(source: { metadata?: Record<string, unknown> | null; agencia: { sigla: string } | Array<{ sigla: string }> | null }) {
  const metadata = source.metadata && typeof source.metadata === "object" ? source.metadata : {};
  const configured = metadata.news_profile;
  if (typeof configured === "string" && configured) return configured;
  const agencia = Array.isArray(source.agencia) ? source.agencia[0] : source.agencia;
  return getNewsProfile(agencia?.sigla ?? "");
}

function selectExpandedSourceRows<T extends { id: string; metadata?: Record<string, unknown> | null }>(sources: T[], maxSources: number) {
  return [...sources]
    .sort((left, right) => sourceRotationTime(left.metadata) - sourceRotationTime(right.metadata))
    .slice(0, maxSources);
}

function selectExpandedSources(
  sources: NewsSourceConfig[],
  configured: Map<string, { metadata?: Record<string, unknown> | null }>,
  maxSources: number,
) {
  return [...sources]
    .sort((left, right) => {
      const leftMetadata = left.id ? configured.get(left.id)?.metadata : null;
      const rightMetadata = right.id ? configured.get(right.id)?.metadata : null;
      return sourceRotationTime(leftMetadata) - sourceRotationTime(rightMetadata);
    })
    .slice(0, maxSources);
}

function sourceRotationTime(metadata: Record<string, unknown> | null | undefined) {
  const value = metadata?.news_last_success_at ?? metadata?.news_last_collection_at;
  if (typeof value !== "string") return 0;
  const time = new Date(value).getTime();
  return Number.isFinite(time) ? time : 0;
}

function dedupeNewsItems<T extends { url: string }>(items: T[]) {
  const seen = new Set<string>();
  return items.filter((item) => {
    if (seen.has(item.url)) return false;
    seen.add(item.url);
    return true;
  });
}

async function recordCollectionRuns(
  db: ReturnType<typeof import("@/lib/supabase/server").createSupabaseServerClient>,
  reports: RegulatoryNewsCollectResponse["source_reports"],
  automatic: boolean,
  telemetry?: CollectionTelemetry,
) {
  if (!reports?.length) return;
  // Agregados da execução (duração/retries/429/headless) repetidos em cada row.
  const tele = telemetry
    ? {
        duration_ms: telemetry.durationMs,
        fetch_retries: telemetry.fetch.retries,
        http_429_count: telemetry.fetch.http429,
        throttle_wait_ms: telemetry.fetch.throttleWaitsMs,
        headless_dependency_missing: telemetry.headless.dependency_missing,
        headless_launch_failed: telemetry.headless.launch_failed,
      }
    : {};
  const rows = reports.map((report) => ({
    site_id: report.source_id ?? null,
    trigger_type: automatic ? "scheduled" : "manual",
    batch_offset: report.batch_offset ?? 0,
    links_detectados: report.links_found,
    itens_processados: report.items_processed ?? report.items_collected,
    itens_salvos: report.items_collected,
    itens_pendentes: report.items_pending ?? 0,
    imagens_encontradas: report.images_found ?? 0,
    imagens_ausentes: report.images_absent ?? 0,
    imagens_com_falha: report.images_failed ?? 0,
    status: report.status,
    // Prefixa erros transitórios (rate-limit/render) para o health route não pintar
    // a fonte de vermelho quando ela já tem notícias recentes (será re-tentada).
    error_message: report.error ? (report.transient ? `[transitorio] ${report.error}` : report.error) : null,
    ...tele,
  }));
  const { error } = await db.from("regulatory_news_collection_runs").insert(rows);
  if (error) console.warn("[noticias/coletar] Nao foi possivel registrar historico:", error.message);
}
