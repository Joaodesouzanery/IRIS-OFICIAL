import { NextRequest, NextResponse } from "next/server";
import { demoData } from "@/lib/demo-data";
import { isDemo } from "@/lib/server/is-demo";
import { fetchMonitoringSite } from "@/lib/server/monitoring";
import type { MonitoramentoCheckResponse } from "@/types";
import { requireAdminOrCron } from "@/lib/server/request-guards";

export const dynamic = "force-dynamic";

const DEMO_SITE = {
  id: "demo-monitor-artesp",
  agencia_id: "demo-agency-artesp",
  nome: "ARTESP - Reuniões da Diretoria",
  url: "https://www.artesp.sp.gov.br/artesp/transparencia/reunioes-diretoria",
  seletor_links: "a[href]",
};

const DEMO_SITES = [DEMO_SITE, {
  id: "demo-monitor-transportes",
  agencia_id: null,
  nome: "Ministerio dos Transportes - Noticias",
  url: "https://www.gov.br/transportes/pt-br/assuntos/noticias",
  estrategia: "govbr-news",
  seletor_links: "a[href]",
}, {
  id: "demo-monitor-mme",
  agencia_id: null,
  nome: "Ministerio de Minas e Energia - Noticias",
  url: "https://www.gov.br/mme/pt-br/assuntos/noticias",
  estrategia: "govbr-news",
  seletor_links: "a[href]",
}];

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
    .select("id, agencia_id, nome, url, estrategia, seletor_links, ativo")
    .eq("ativo", true);

  if (error) {
    return NextResponse.json({ error: "Erro ao buscar sites monitorados" }, { status: 500 });
  }

  const runs: MonitoramentoCheckResponse["runs"] = [];
  let novosDetectados = 0;

  for (const site of sites ?? []) {
    const { data: run } = await db
      .from("monitoramento_runs")
      .insert({ site_id: site.id, status: "running" })
      .select("id")
      .single();

    try {
      const result = await fetchMonitoringSite(site);
      let novosItens = 0;

      for (const item of result.items) {
        const { data: inserted, error: insertError } = await db
          .from("monitoramento_itens")
          .insert({
            site_id: site.id,
            agencia_id: site.agencia_id,
            tipo: item.tipo,
            titulo: item.titulo,
            url_item: item.url_item,
            reuniao: item.reuniao,
            data_reuniao: item.data_reuniao,
            hash_item: item.hash_item,
            metadata: item.metadata,
          })
          .select("id, titulo, url_item")
          .single();

        if (insertError) {
          if (insertError.code === "23505") {
            await db
              .from("monitoramento_itens")
              .update({ last_seen_at: new Date().toISOString() })
              .eq("site_id", site.id)
              .eq("hash_item", item.hash_item);
          }
          continue;
        }

        if (inserted) {
          novosItens++;
          await db.from("monitoramento_alertas").insert({
            item_id: inserted.id,
            site_id: site.id,
            agencia_id: site.agencia_id,
            tipo: "novo_item",
            titulo: inserted.titulo,
            url_item: inserted.url_item,
          });
        }
      }

      const status = result.needsHeadless ? "needs_headless" : "ok";
      await db.from("monitoramento_sites").update({
        ultimo_check: new Date().toISOString(),
        ultimo_hash: result.contentHash,
        ultimo_status: status,
        ultimo_erro: null,
        estrategia: result.needsHeadless ? "needs-headless" : "html-static",
      }).eq("id", site.id);

      if (run) {
        await db.from("monitoramento_runs").update({
          finished_at: new Date().toISOString(),
          status,
          itens_encontrados: result.items.length,
          novos_itens: novosItens,
        }).eq("id", run.id);
      }

      novosDetectados += novosItens;
      runs.push({
        site_id: site.id,
        site_nome: site.nome,
        status,
        itens_encontrados: result.items.length,
        novos_itens: novosItens,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Erro inesperado";
      await db.from("monitoramento_sites").update({
        ultimo_check: new Date().toISOString(),
        ultimo_status: "error",
        ultimo_erro: message.slice(0, 1000),
      }).eq("id", site.id);

      if (run) {
        await db.from("monitoramento_runs").update({
          finished_at: new Date().toISOString(),
          status: "error",
          error_message: message.slice(0, 1000),
        }).eq("id", run.id);
      }

      runs.push({
        site_id: site.id,
        site_nome: site.nome,
        status: "error",
        itens_encontrados: 0,
        novos_itens: 0,
        error: message,
      });
    }
  }

  return NextResponse.json({
    checked: sites?.length ?? 0,
    novos_detectados: novosDetectados,
    runs,
  } satisfies MonitoramentoCheckResponse);
}
