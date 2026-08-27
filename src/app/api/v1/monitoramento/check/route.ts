import { NextRequest, NextResponse } from "next/server";
import { isDemo } from "@/lib/server/is-demo";
import { fetchMonitoringSite } from "@/lib/server/monitoring";
import { processMonitoringSite } from "@/lib/server/monitoring-runner";
import type { MonitoramentoCheckResponse } from "@/types";
import { requireAdminOrCron } from "@/lib/server/request-guards";
import { HOBBY_BUDGET_MS, budgetFromRequest } from "@/lib/server/time-budget";

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

  // MAIS ANTIGO PRIMEIRO: sem ordem, o crawl pesado da ANTT + headless da ANM estouravam
  // os 120s (SIGKILL do Vercel, incatchável) e os sites do fim da fila NUNCA recebiam
  // ultimo_check — ANTT/ANM ficaram congelados em "ok" por 8 dias enquanto a ARTESP
  // (rápida) atualizava. Quem ficou para trás agora lidera a próxima rodada.
  const { data: sites, error } = await db
    .from("monitoramento_sites")
    .select("id, agencia_id, nome, url, estrategia, seletor_links, ativo, tipo_fonte, auto_enfileirar_pdf, ultimo_check")
    .eq("ativo", true)
    .neq("tipo_fonte", "noticias")
    .order("ultimo_check", { ascending: true, nullsFirst: true });

  if (error) {
    return NextResponse.json({ error: "Erro ao buscar sites monitorados" }, { status: 500 });
  }

  const runs: MonitoramentoCheckResponse["runs"] = [];
  let novosDetectados = 0;
  // Orçamento de tempo: para graciosamente antes do limite Hobby (60s SIGKILL), gravando
  // o progresso — os sites restantes ficam para a próxima rodada (e vão à frente pela ordem).
  // `budget_ms` opcional (capado no Hobby): a pipeline zero-toque passa uma FATIA menor
  // para a coleta não consumir o orçamento da extração (QA ago/2026).
  // Fase 10 — era esta mesma conta, copiada palavra por palavra do `time-budget`. Duas cópias da
  // regra de orçamento são duas chances de divergir; e a varredura que garante que NENHUMA rota do
  // orquestrador ignore a fatia só é possível com uma fonte única.
  const budgetMs = budgetFromRequest(req);
  const deadline = Date.now() + budgetMs;
  let pulados = 0;

  for (const site of sites ?? []) {
    if (Date.now() > deadline) {
      pulados += 1;
      continue;
    }
    // O crawl COMPLETO da ANTT (até ~120 reuniões) é do backfill dedicado; aqui um passe leve
    // (novidades do topo) que cabe no orçamento da rodada. O skip-set torna o custo marginal das
    // reuniões já capturadas ~zero, então 30/5 varre mais reuniões 2026 por clique sem estourar o
    // orçamento Hobby (deadlineAt desce aos loops → parada graciosa dentro da fonte).
    const options = site.estrategia === "antt-2026"
      ? { maxPages: 5, maxMeetings: 30, deadlineAt: deadline }
      : { deadlineAt: deadline };
    const result = await processMonitoringSite(db, site, options);
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

  if (pulados > 0) console.warn(`[monitoramento/check] orçamento de tempo esgotado — ${pulados} site(s) ficaram para a próxima rodada (irão à frente pela ordem).`);

  return NextResponse.json({
    checked: runs.length,
    novos_detectados: novosDetectados,
    runs,
  } satisfies MonitoramentoCheckResponse);
}
