import { NextRequest, NextResponse } from "next/server";
import { isDemo } from "@/lib/server/is-demo";
import {
  ANTT_2026_SOURCE_URL,
  buildAnttMeetingSkipSet,
  collectAntt2026Documents,
  discoverAntt2026Meetings,
  type AnttMeeting,
} from "@/lib/server/antt-2026-collector";
import type { AnttCollectResponse, AnttPreviewResponse } from "@/types";
import { requireAdminOrCron } from "@/lib/server/request-guards";
import { drainFetchStats } from "@/lib/server/resilient-fetch";
import { drainHeadlessOutcomes } from "@/lib/server/headless";

export const dynamic = "force-dynamic";

const MAX_PAGES_RE = /^\d{1,2}$/;
const MAX_MEETINGS_RE = /^\d{1,3}$/;

export async function GET(req: NextRequest) {
  const searchParams = req.nextUrl.searchParams;
  const maxPages = parseBoundedInt(searchParams.get("max_pages"), MAX_PAGES_RE, 3, 1, 3);
  const maxMeetings = parseBoundedInt(searchParams.get("max_meetings"), MAX_MEETINGS_RE, 60, 1, 80);

  try {
    const { meetings } = await discoverAntt2026Meetings({ maxPages, maxMeetings, deadlineAt: Date.now() + 88_000 });
    return NextResponse.json(buildPreviewResponse(meetings, maxPages, maxMeetings));
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Erro inesperado na previa ANTT 2026" },
      { status: 500 },
    );
  }
}

export async function POST(req: NextRequest) {
  const dryRun = req.nextUrl.searchParams.get("dry_run") === "1";
  if (!dryRun) {
    const guard = await requireAdminOrCron(req);
    if (guard) return guard;
  }

  const searchParams = req.nextUrl.searchParams;
  const maxPages = parseBoundedInt(searchParams.get("max_pages"), MAX_PAGES_RE, 12, 1, 20);
  const maxMeetings = parseBoundedInt(searchParams.get("max_meetings"), MAX_MEETINGS_RE, 120, 1, 200);
  // Orçamento: 120 reuniões × throttle 800ms ≈ 96s+ já estourava o maxDuration
  // (SIGKILL) em dias de portal lento. Para graciosamente e retoma via skip-set.
  const deadlineAt = Date.now() + 88_000;
  const refresh = searchParams.get("refresh") === "1";

  try {
    if (isDemo() || dryRun) {
      const { meetings } = await discoverAntt2026Meetings({ maxPages, maxMeetings, deadlineAt });
      const response = buildPreviewResponse(meetings, maxPages, maxMeetings);
      response.errors = isDemo() ? ["Modo demo: coleta validada sem persistir no Supabase."] : [];
      return NextResponse.json(response);
    }

    const { createSupabaseServerClient } = await import("@/lib/supabase/server");
    const db = createSupabaseServerClient();

    const { data: site } = await db
      .from("monitoramento_sites")
      .select("id")
      .eq("estrategia", "antt-2026")
      .eq("url", "https://portal.antt.gov.br/web/guest/reunioes-da-diretoria")
      .maybeSingle();

    if (site?.id) {
      // Run "running" >10min = SIGKILL de rodada anterior; sem isso vira órfão eterno.
      await db.from("monitoramento_runs").update({
        status: "error",
        finished_at: new Date().toISOString(),
        error_message: "interrompido (timeout da plataforma) — marcado por limpeza oportunista",
      }).eq("site_id", site.id).eq("status", "running")
        .lt("started_at", new Date(Date.now() - 10 * 60_000).toISOString());
    }

    const { data: run } = site?.id
      ? await db.from("monitoramento_runs").insert({ site_id: site.id, status: "running", trigger_type: "scheduled" }).select("id").single()
      : { data: null };

    const startedAt = Date.now();
    drainFetchStats();
    drainHeadlessOutcomes();

    const skipMeetingUrls = refresh ? undefined : await buildAnttMeetingSkipSet(db, { siteId: site?.id ?? null });
    const result = await collectAntt2026Documents(db, { maxPages, maxMeetings, deadlineAt, skipMeetingUrls });

    if (run?.id) {
      const fetchStats = drainFetchStats();
      const headlessStats = drainHeadlessOutcomes();
      await db.from("monitoramento_runs").update({
        finished_at: new Date().toISOString(),
        status: result.errors.length > 0 ? "error" : "ok",
        itens_encontrados: result.documentos_encontrados,
        novos_itens: result.documentos_baixados,
        error_message: result.errors.length > 0 ? result.errors.slice(0, 5).join(" | ").slice(0, 1000) : null,
        duration_ms: Date.now() - startedAt,
        fetch_retries: fetchStats.retries,
        http_429_count: fetchStats.http429,
        throttle_wait_ms: fetchStats.throttleWaitsMs,
        headless_dependency_missing: headlessStats.dependency_missing,
        headless_launch_failed: headlessStats.launch_failed,
      }).eq("id", run.id);
    }

    // Carimba a fonte: este cron É a verificação diária completa da ANTT, mas antes só
    // gravava monitoramento_runs — a UI ("Última verificação") lia um ultimo_check
    // congelado do site e parecia parada.
    if (site?.id) {
      await db.from("monitoramento_sites").update({
        ultimo_check: new Date().toISOString(),
        ultimo_status: result.errors.length > 0 ? "error" : "ok",
        ultimo_erro: result.errors.length > 0 ? result.errors[0].slice(0, 500) : null,
      }).eq("id", site.id);
    }

    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Erro inesperado na coleta ANTT 2026" },
      { status: 500 },
    );
  }
}

function parseBoundedInt(
  value: string | null,
  pattern: RegExp,
  fallback: number,
  min: number,
  max: number,
) {
  if (!value || !pattern.test(value)) return fallback;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, parsed));
}

function buildPreviewResponse(
  meetings: AnttMeeting[],
  maxPages: number,
  maxMeetings: number,
): AnttPreviewResponse {
  return {
    dry_run: true,
    source_url: ANTT_2026_SOURCE_URL,
    max_pages: maxPages,
    max_meetings: maxMeetings,
    collected_at: new Date().toISOString(),
    reunioes_encontradas: meetings.length,
    reunioes_salvas: 0,
    processos_salvos: meetings.reduce((sum, meeting) => sum + meeting.processos.length, 0),
    documentos_encontrados: meetings.reduce((sum, meeting) => sum + meeting.documentos.length, 0),
    documentos_baixados: 0,
    documentos_duplicados: 0,
    documentos_rejeitados: 0,
    errors: [],
    reunioes: meetings.map((meeting) => ({
      numero: meeting.numero,
      titulo: meeting.titulo,
      tipo: meeting.tipo,
      data_inicio: meeting.data_inicio,
      data_fim: meeting.data_fim,
      hora_inicio: meeting.hora_inicio,
      hora_fim: meeting.hora_fim,
      url_reuniao: meeting.url_reuniao,
      documentos: meeting.documentos.map((doc) => ({
        tipo: doc.tipo,
        titulo: doc.titulo,
        url: doc.url,
        processo: doc.processo?.processo ?? null,
        interessado: doc.processo?.interessado ?? null,
        relator: doc.processo?.relator ?? null,
        assunto: doc.processo?.assunto ?? null,
      })),
      processos: meeting.processos.map((processo) => ({
        item_numero: processo.item_numero,
        processo: processo.processo,
        interessado: processo.interessado,
        relator: processo.relator,
        assunto: processo.assunto,
        decisao: processo.decisao,
        documentos: processo.documentos.map((doc) => ({
          tipo: doc.tipo,
          titulo: doc.titulo,
          url: doc.url,
          processo: processo.processo,
          interessado: processo.interessado,
          relator: processo.relator,
          assunto: processo.assunto,
        })),
      })),
    })),
  };
}
