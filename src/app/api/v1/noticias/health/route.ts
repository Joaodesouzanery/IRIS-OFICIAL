import { NextRequest, NextResponse } from "next/server";
import { isDemo } from "@/lib/server/is-demo";
import { isDemoRequest } from "@/lib/server/request-guards";

export const dynamic = "force-dynamic";

const DEMO_SOURCES = ["ARTESP", "ANTT", "ANM", "ANA", "ANAC", "ANATEL", "ANCINE", "ANEEL", "ANP", "ANPD", "ANS", "ANTAQ", "ANVISA"] as const;
// Honestidade da agenda (QA jul/2026): no plano Hobby só existe UM Vercel Cron diário
// (0 11 * * * = 08:00 America/Sao_Paulo). Não há rodízio de 30 min; o resto é sob demanda
// pelo botão "Coletar Notícias". O label antigo ("a cada 30 minutos") não era verdade.
const NEWS_SCHEDULE = "Vercel Cron diario as 11:00 UTC (08:00 America/Sao_Paulo): ANTT/ANM/ARTESP em toda rodada e agencias expandidas em rodizio; demais coletas sob demanda pelo botao 'Coletar Noticias'";
const NEWS_CRON_UTC = "0 11 * * *";
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

  /**
   * ⚠️ PER AGÊNCIA, e não mais um `.limit(2000)` GLOBAL — é a mesma forma de erro que a Fase 24b já
   * pagou cinco vezes ("`.limit(N)` grande não pagina; o PostgREST corta e devolve isso em silêncio").
   *
   * Aqui o defeito era mais sutil: o `.limit(2000)` ordenava por `publicado_em DESC` em TODAS as
   * agências juntas. Uma fonte quieta (poucas notícias, publicação antiga) tem suas linhas empurradas
   * para fora do topo-2000 GLOBAL por agências mais ativas — e `total = 0` virava "nunca coletada",
   * mandando "rode Coletar Notícias" para uma fonte que na verdade TEM histórico.
   *
   * ⚠️ MEDIDO (30/09/2026): a ANAC tinha listagem OK, 71 links válidos e notícia do PRÓPRIO DIA —
   * e a tela dizia "Fonte configurada sem nenhuma notícia". Esta era a segunda causa plausível que eu
   * não pude confirmar sem o banco (a primeira, o orçamento de tempo na coleta, segue valendo
   * paralelamente); este conserto elimina a causa que DEPENDE do `/health`, de qualquer forma.
   *
   * `{ count: "exact" }` no select devolve a contagem TOTAL da agência (sem o `.limit` cortá-la) ao
   * lado das linhas — uma chamada por agência, todas em paralelo, não serializadas.
   */
  const [porAgencia, runsPorSite] = await Promise.all([
    Promise.all(siglas.map(async (sigla) => {
      const { data: rows, count, error } = await db
        .from("regulatory_news")
        .select("agencia_sigla, titulo, url, publicado_em, last_seen_at", { count: "exact" })
        .eq("agencia_sigla", sigla)
        .order("publicado_em", { ascending: false, nullsFirst: false })
        .order("last_seen_at", { ascending: false })
        // 100 por agência cobre folgado o que a tela usa (último item + notícias dos últimos 7
        // dias) — nenhuma destas fontes publica mais que isso numa semana.
        .limit(100);
      return { sigla, rows: rows ?? [], total: count ?? 0, error };
    })),
    /**
     * ⚠️ MESMA FORMA DE ERRO, segunda ocorrência no MESMO arquivo: `.limit(100)` aqui também era
     * GLOBAL — os runs mais recentes de QUALQUER site, não de cada um. Com ~13 agências rodando em
     * rotação, 100 runs se esgotam rápido entre OUTRAS agências, e o último run de uma fonte quieta
     * saía da janela: `latestRun` virava `null` (ou um run antigo) mesmo que ela tivesse rodado hoje
     * — e é exatamente o `latestRun` que alimenta `latest_links_found`/`active_error`/`blocked_now`.
     * Por site, com um teto pequeno por site (20 cobre folgado o que a tela usa: o mais recente, o
     * último sucesso, o último erro).
     */
    Promise.all(sources.map(async (source) => {
      const { data } = await db
        .from("regulatory_news_collection_runs")
        .select("site_id, trigger_type, batch_offset, links_detectados, itens_processados, itens_pendentes, imagens_encontradas, imagens_ausentes, imagens_com_falha, status, error_message, created_at")
        .eq("site_id", source.site_id)
        .order("created_at", { ascending: false })
        .limit(20);
      return data ?? [];
    })),
  ]);
  const runs = runsPorSite.flat();

  const erroDeAlgumaAgencia = porAgencia.find((p) => p.error)?.error;
  if (erroDeAlgumaAgencia) return NextResponse.json({ error: "Erro ao verificar saude das noticias" }, { status: 500 });
  const indicePorAgencia = new Map(porAgencia.map((p) => [p.sigla, p]));

  const sevenDaysAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
  const healthSources = sources.map((source) => {
    const entrada = indicePorAgencia.get(source.agencia_sigla);
    const rows = entrada?.rows ?? [];
    const total = entrada?.total ?? 0;
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
      total,
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
      // Sinais p/ o banner distinguir "fonte quieta" de "coletor não traz nada": última vez que
      // rodou VAZIO, última tentativa (qualquer), e nº de links do último run. links_found é
      // null quando DESCONHECIDO (sem run/metadata) — o banner só acusa "0 links" se comprovado.
      latest_empty_at: readString(source.metadata, "news_last_empty_at"),
      /**
       * ⚠️ O site devolveu uma página de VERIFICAÇÃO ANTI-ROBÔ (CAPTCHA/WAF) em vez do conteúdo real
       * — ver `looksLikeChallenge`/`BLOQUEIO_ANTIRROBO_MSG`. É uma TERCEIRA causa de zero, distinta
       * de "sem link válido" e de "a fonte não publicou": aqui a fonte TEM conteúdo, só não foi
       * servido a nós. Dois sinais, porque cada um sobrevive a uma lacuna diferente do outro:
       * `metadata` sobrevive à rotação de runs (`.limit(100)`); o run mais recente pega o caso em que
       * esta rodada bloqueou mas a metadata ainda não foi persistida (corrida entre leitura e escrita).
       */
      latest_blocked_at: readString(source.metadata, "news_last_blocked_at"),
      blocked_now: /^\[bloqueado_antirobo\]/i.test(latestRun?.error_message ?? ""),
      latest_collection_at: readString(source.metadata, "news_last_collection_at"),
      latest_links_found: typeof latestRun?.links_detectados === "number"
        ? latestRun.links_detectados
        : readNumberOrNull(source.metadata, "news_last_links_found"),
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

// Como readNumber, mas null quando a chave não existe/não é número — para distinguir
// "0 comprovado" de "desconhecido" (o banner só acusa 0 links se for comprovado).
function readNumberOrNull(metadata: unknown, key: string): number | null {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) return null;
  const value = (metadata as Record<string, unknown>)[key];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function readString(metadata: unknown, key: string) {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) return null;
  const value = (metadata as Record<string, unknown>)[key];
  return typeof value === "string" && value ? value : null;
}

function nextNewsRun(now = new Date()) {
  // Reflete o cron REAL do Hobby: uma vez por dia às 11:00 UTC (não há rodízio de 30 min).
  const utc = new Date(now);
  const today = new Date(Date.UTC(utc.getUTCFullYear(), utc.getUTCMonth(), utc.getUTCDate(), 11, 0));
  if (today.getTime() > now.getTime()) return today;
  return new Date(Date.UTC(utc.getUTCFullYear(), utc.getUTCMonth(), utc.getUTCDate() + 1, 11, 0));
}
