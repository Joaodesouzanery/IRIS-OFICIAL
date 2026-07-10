import { NextRequest, NextResponse } from "next/server";
import { isDemo } from "@/lib/server/is-demo";
import { isDemoRequest } from "@/lib/server/request-guards";

export const dynamic = "force-dynamic";

const DEMO_SOURCES = ["ARTESP", "ANTT", "ANM", "ANA", "ANAC", "ANATEL", "ANCINE", "ANEEL", "ANP", "ANPD", "ANS", "ANTAQ", "ANVISA"] as const;
const NEWS_SCHEDULE = "A cada 30 minutos entre 08:00 e 20:30 (America/Sao_Paulo): ANTT/ANM/ARTESP em toda rodada e agencias expandidas em rodizio; Vercel Cron diario como fallback no plano Hobby";
const NEWS_CRON_UTC = "*/30 11-23 * * *";
const VERCEL_NEWS_CRON_UTC = "0 11 * * *";

export async function GET(req: NextRequest) {
  if (isDemo() || isDemoRequest(req)) {
    return NextResponse.json({
      cron: NEWS_CRON_UTC,
      vercel_cron: VERCEL_NEWS_CRON_UTC,
      schedule_label: NEWS_SCHEDULE,
      next_run_at: nextNewsRun().toISOString(),
      vercel_cron_configured: true,
      cron_secret_configured: Boolean(process.env.CRON_SECRET),
      sources: DEMO_SOURCES.map((sigla) => ({
        agencia_sigla: sigla,
        total: sigla === "ARTESP" ? 1 : 0,
        last_seen_at: new Date().toISOString(),
        recent_7d: sigla === "ARTESP" ? 1 : 0,
      })),
    });
  }

  const { createSupabaseServerClient } = await import("@/lib/supabase/server");
  const db = createSupabaseServerClient();
  let { data: configuredSources, error: sourcesError } = await listConfiguredSources(db, true);
  if (!sourcesError && configuredSources?.length === 0) {
    ({ data: configuredSources, error: sourcesError } = await listConfiguredSources(db, false));
  }

  if (sourcesError) return NextResponse.json({ error: "Erro ao verificar fontes de noticias" }, { status: 500 });

  const sources = (configuredSources ?? []).map((source) => {
    const agencia = Array.isArray(source.agencia) ? source.agencia[0] : source.agencia;
    return {
      site_id: source.id,
      agencia_sigla: agencia?.sigla ?? "",
      source_url: source.url,
      news_tier: readString(source.metadata, "news_tier") ?? (["ARTESP", "ANTT", "ANM"].includes(agencia?.sigla ?? "") ? "core" : "expanded"),
      news_profile: readString(source.metadata, "news_profile"),
      collection_status: source.ultimo_status,
      collection_error: source.ultimo_erro,
      last_check_at: source.ultimo_check,
      metadata: source.metadata,
    };
  }).filter((source) => Boolean(source.agencia_sigla));
  const siglas = sources.map((source) => source.agencia_sigla);
  if (siglas.length === 0) {
    return NextResponse.json({
      cron: NEWS_CRON_UTC,
      vercel_cron: VERCEL_NEWS_CRON_UTC,
      schedule_label: NEWS_SCHEDULE,
      next_run_at: nextNewsRun().toISOString(),
      vercel_cron_configured: true,
      cron_secret_configured: Boolean(process.env.CRON_SECRET),
      sources: [],
    });
  }

  const [{ data, error }, { data: runs }] = await Promise.all([
    db
      .from("regulatory_news")
      .select("agencia_sigla, titulo, url, publicado_em, last_seen_at")
      .in("agencia_sigla", siglas)
      .order("publicado_em", { ascending: false, nullsFirst: false })
      .order("last_seen_at", { ascending: false })
      .limit(500),
    db
      .from("regulatory_news_collection_runs")
      .select("site_id, trigger_type, batch_offset, links_detectados, itens_processados, itens_pendentes, imagens_encontradas, imagens_ausentes, imagens_com_falha, status, error_message, created_at")
      .order("created_at", { ascending: false })
      .limit(100),
  ]);

  if (error) return NextResponse.json({ error: "Erro ao verificar saude das noticias" }, { status: 500 });

  const sevenDaysAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
  const healthSources = sources.map((source) => {
    const rows = (data ?? []).filter((item) => item.agencia_sigla === source.agencia_sigla);
    const latestBySeen = rows
      .map((item) => item.last_seen_at)
      .filter(Boolean)
      .sort()
      .at(-1) ?? null;
    const latestByPublication = [...rows].sort((left, right) => {
      const rightTime = new Date(right.publicado_em ?? right.last_seen_at ?? 0).getTime();
      const leftTime = new Date(left.publicado_em ?? left.last_seen_at ?? 0).getTime();
      return rightTime - leftTime;
    })[0] ?? null;
    const latestRun = (runs ?? []).find((run) => run.site_id === source.site_id) ?? null;
    const latestSuccessRun = (runs ?? []).find((run) => run.site_id === source.site_id && run.status === "ok") ?? null;
    const latestErrorRun = (runs ?? []).find((run) => run.site_id === source.site_id && run.status === "error") ?? null;
    const lastSuccessAt = latestSuccessRun?.created_at ?? readString(source.metadata, "news_last_success_at");
    const lastErrorAt = latestErrorRun?.created_at ?? readString(source.metadata, "news_last_error_at");
    const lastSuccessTime = new Date(lastSuccessAt ?? 0).getTime();
    const lastErrorTime = new Date(lastErrorAt ?? 0).getTime();
    // Falha transitória (rate-limit/render, prefixo "[transitorio]"): não é alarme
    // se a fonte tem notícias recentes — será re-tentada na próxima rodada.
    const errorIsTransient = /^\[transitorio\]/i.test(latestErrorRun?.error_message ?? "");
    const recent7dCount = rows.filter((item) => {
      const date = new Date(item.publicado_em ?? item.last_seen_at ?? 0).getTime();
      return date >= sevenDaysAgo;
    }).length;
    const hasActiveError = Boolean(
      latestErrorRun?.error_message &&
      Number.isFinite(lastErrorTime) &&
      lastErrorTime > 0 &&
      (!Number.isFinite(lastSuccessTime) || lastSuccessTime < lastErrorTime) &&
      !(errorIsTransient && recent7dCount > 0),
    );
    const officialPublished = readString(source.metadata, "news_latest_official_publicado_em");
    const officialUrl = readString(source.metadata, "news_latest_official_url");
    const officialTitle = readString(source.metadata, "news_latest_official_title");
    const latestSavedTime = new Date(latestByPublication?.publicado_em ?? latestByPublication?.last_seen_at ?? 0).getTime();
    const latestOfficialTime = new Date(officialPublished ?? 0).getTime();
    const isStale = Boolean(
      officialPublished &&
      Number.isFinite(latestOfficialTime) &&
      latestOfficialTime > 0 &&
      (!latestByPublication || latestSavedTime + 60_000 < latestOfficialTime || (officialUrl && latestByPublication.url !== officialUrl && latestSavedTime <= latestOfficialTime)),
    );
    // Dias desde a última notícia PUBLICADA salva — fonte parada há >7d enquanto as
    // outras avançam = sinal de listagem movida (ex.: defeso eleitoral). QA Etapa 22.
    const diasSemPublicar = latestByPublication?.publicado_em
      ? Math.max(0, Math.floor((Date.now() - new Date(latestByPublication.publicado_em).getTime()) / 86_400_000))
      : null;
    return {
      ...source,
      total: rows.length,
      dias_sem_publicar: diasSemPublicar,
      last_seen_at: latestBySeen,
      latest_last_seen_at: latestBySeen,
      latest_publicado_em: latestByPublication?.publicado_em ?? null,
      latest_title: latestByPublication?.titulo ?? null,
      latest_url: latestByPublication?.url ?? null,
      latest_official_publicado_em: officialPublished,
      latest_official_title: officialTitle,
      latest_official_url: officialUrl,
      is_stale: isStale,
      active_error: hasActiveError,
      latest_error: latestErrorRun?.error_message ?? source.collection_error ?? null,
      latest_success_at: lastSuccessAt,
      latest_error_at: lastErrorAt,
      fresh_items_processed: readNumber(source.metadata, "news_fresh_items_processed"),
      backlog_items_processed: readNumber(source.metadata, "news_backlog_items_processed"),
      recent_7d: rows.filter((item) => {
        const date = new Date(item.publicado_em ?? item.last_seen_at ?? 0).getTime();
        return date >= sevenDaysAgo;
      }).length,
      latest_run: latestRun,
    };
  });

  return NextResponse.json({
    cron: NEWS_CRON_UTC,
    vercel_cron: VERCEL_NEWS_CRON_UTC,
    schedule_label: NEWS_SCHEDULE,
    next_run_at: nextNewsRun().toISOString(),
    vercel_cron_configured: true,
    cron_secret_configured: Boolean(process.env.CRON_SECRET),
    sources: healthSources,
  });
}

function listConfiguredSources(db: ReturnType<typeof import("@/lib/supabase/server").createSupabaseServerClient>, activeOnly: boolean) {
  let query = db
    .from("monitoramento_sites")
    .select("id, url, ultimo_check, ultimo_status, ultimo_erro, metadata, agencia:agencias(sigla)")
    .eq("tipo_fonte", "noticias");
  if (activeOnly) query = query.eq("ativo", true);
  return query.order("nome", { ascending: true });
}

function readNumber(metadata: unknown, key: string) {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) return 0;
  const value = (metadata as Record<string, unknown>)[key];
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function readString(metadata: unknown, key: string) {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) return null;
  const value = (metadata as Record<string, unknown>)[key];
  return typeof value === "string" && value ? value : null;
}

function nextNewsRun(now = new Date()) {
  const utc = new Date(now);
  for (let hour = 11; hour <= 23; hour += 1) {
    for (const minute of [0, 30]) {
      const next = new Date(Date.UTC(utc.getUTCFullYear(), utc.getUTCMonth(), utc.getUTCDate(), hour, minute));
      if (next.getTime() > now.getTime()) return next;
    }
  }
  return new Date(Date.UTC(utc.getUTCFullYear(), utc.getUTCMonth(), utc.getUTCDate() + 1, 11, 0));
}
