import { NextRequest, NextResponse } from "next/server";
import { isDemo } from "@/lib/server/is-demo";
import { fetchMonitoringSite } from "@/lib/server/monitoring";
import { processMonitoringSite } from "@/lib/server/monitoring-runner";
import type { MonitoramentoCheckResponse } from "@/types";
import { requireAdminOrCron } from "@/lib/server/request-guards";

export const dynamic = "force-dynamic";

const DEMO_SITE = {
  id: "demo-monitor-artesp",
  agencia_id: "demo-agency-artesp",
  nome: "ARTESP - Reuniões da Diretoria",
  url: "https://www.artesp.sp.gov.br/artesp/transparencia/reunioes-diretoria",
  seletor_links: "a[href]",
  tipo_fonte: "documentos_regulatorios",
  auto_enfileirar_pdf: true,
};

const DEMO_SITES = [DEMO_SITE];

export async function GET(req: NextRequest): Promise<NextResponse> {
  const guard = await requireAdminOrCron(req);
  if (guard) return guard;

  if (isDemo()) {
    const runs: MonitoramentoCheckResponse["runs"] = [];
    let novos = 0;
    for (const site of DEMO_SITES) {
      try {
        const result = await fetchMonitoringSite(site);
        novos += result.items.length;
        runs.push({
          site_id: site.id,
          site_nome: site.nome,
          status: result.needsHeadless ? "needs_headless" : "ok",
          itens_encontrados: result.items.length,
          novos_itens: result.items.length,
        });
      } catch (error) {
        runs.push({
          site_id: site.id,
          site_nome: site.nome,
          status: "error",
          itens_encontrados: 0,
          novos_itens: 0,
          error: error instanceof Error ? error.message : "Erro inesperado",
        });
      }
    }
    return NextResponse.json({
      checked: DEMO_SITES.length,
      novos_detectados: novos,
      runs,
    } satisfies MonitoramentoCheckResponse);
    /*
    try {
      const result = await fetchMonitoringSite(DEMO_SITE);
      return NextResponse.json({
        checked: 1,
        novos_detectados: result.items.length,
        runs: [{
          site_id: DEMO_SITE.id,
          site_nome: DEMO_SITE.nome,
          status: result.needsHeadless ? "needs_headless" : "ok",
          itens_encontrados: result.items.length,
          novos_itens: result.items.length,
        }],
      } satisfies MonitoramentoCheckResponse);
    } catch (error) {
      return NextResponse.json({
        checked: 1,
        novos_detectados: 0,
        runs: [{
          site_id: DEMO_SITE.id,
          site_nome: DEMO_SITE.nome,
          status: "error",
          itens_encontrados: 0,
          novos_itens: 0,
          error: error instanceof Error ? error.message : "Erro inesperado",
        }],
      } satisfies MonitoramentoCheckResponse);
    }
    */
  }

  const { createSupabaseServerClient } = await import("@/lib/supabase/server");
  const db = createSupabaseServerClient();

  const { data: sites, error } = await db
    .from("monitoramento_sites")
    .select("id, agencia_id, nome, url, estrategia, seletor_links, ativo, tipo_fonte, auto_enfileirar_pdf")
    .eq("ativo", true)
    .neq("tipo_fonte", "noticias");

  if (error) {
    return NextResponse.json({ error: "Erro ao buscar sites monitorados" }, { status: 500 });
  }

  const runs: MonitoramentoCheckResponse["runs"] = [];
  let novosDetectados = 0;

  for (const site of sites ?? []) {
    const result = await processMonitoringSite(db, site);
    novosDetectados += result.novos_itens;
    runs.push({
      site_id: result.site_id,
      site_nome: result.site_nome,
      status: result.status as "error" | "ok" | "needs_headless",
      itens_encontrados: result.itens_encontrados,
      novos_itens: result.novos_itens,
      documentos_enfileirados: result.documentos_enfileirados,
      ...(result.error ? { error: result.error } : {}),
    });
  }

  return NextResponse.json({
    checked: sites?.length ?? 0,
    novos_detectados: novosDetectados,
    runs,
  } satisfies MonitoramentoCheckResponse);
}
