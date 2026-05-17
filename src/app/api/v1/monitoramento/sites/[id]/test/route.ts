import { NextRequest, NextResponse } from "next/server";
import { isDemo } from "@/lib/server/is-demo";
import { fetchMonitoringSite } from "@/lib/server/monitoring";
import { requireAdmin } from "@/lib/server/request-guards";

export const dynamic = "force-dynamic";

const DEMO_SITE = {
  id: "demo-monitor-artesp",
  agencia_id: "demo-agency-artesp",
  nome: "ARTESP - Reunioes da Diretoria",
  url: "https://www.artesp.sp.gov.br/artesp/transparencia/reunioes-diretoria",
  estrategia: "html-static",
  seletor_links: "a[href]",
};

export async function POST(
  _req: NextRequest,
  { params }: { params: { id: string } },
) {
  const guard = await requireAdmin(_req);
  if (guard) return guard;

  try {
    if (isDemo()) {
      const result = await fetchMonitoringSite(DEMO_SITE);
      return NextResponse.json({
        site_id: params.id,
        site_nome: DEMO_SITE.nome,
        status: result.needsHeadless ? "needs_headless" : "ok",
        itens_encontrados: result.items.length,
        novos_itens: result.items.length,
        sample: result.items.slice(0, 10),
        persisted: false,
      });
    }

    const { createSupabaseServerClient } = await import("@/lib/supabase/server");
    const db = createSupabaseServerClient();
    const { data: site, error } = await db
      .from("monitoramento_sites")
      .select("id, agencia_id, nome, url, estrategia, seletor_links")
      .eq("id", params.id)
      .single();

    if (error || !site) {
      return NextResponse.json({ error: "Monitor nao encontrado" }, { status: 404 });
    }

    const result = await fetchMonitoringSite(site);
    return NextResponse.json({
      site_id: site.id,
      site_nome: site.nome,
      status: result.needsHeadless ? "needs_headless" : "ok",
      itens_encontrados: result.items.length,
      novos_itens: 0,
      sample: result.items.slice(0, 10),
      persisted: false,
    });
  } catch (error) {
    return NextResponse.json({
      site_id: params.id,
      status: "error",
      itens_encontrados: 0,
      novos_itens: 0,
      persisted: false,
      error: error instanceof Error ? error.message : "Erro inesperado",
    }, { status: 500 });
  }
}
