import { NextRequest, NextResponse } from "next/server";
import { isDemo } from "@/lib/server/is-demo";
import { isDemoRequest } from "@/lib/server/request-guards";
import type { MonitoramentoAlerta } from "@/types";

export async function GET(req: NextRequest) {
  if (isDemo() || isDemoRequest(req)) {
    const now = new Date().toISOString();
    const demo: MonitoramentoAlerta[] = [{
      id: "demo-alert-artesp",
      item_id: "demo-item-artesp",
      site_id: "demo-monitor-artesp",
      agencia_id: "demo-agency-artesp",
      tipo: "novo_item",
      titulo: "Deliberações - ARTESP Reuniões da Diretoria",
      url_item: "https://www.artesp.sp.gov.br/artesp/transparencia/reunioes-diretoria",
      lido: false,
      resolvido: false,
      created_at: now,
      site: { nome: "ARTESP - Reuniões da Diretoria", url: "https://www.artesp.sp.gov.br/artesp/transparencia/reunioes-diretoria" },
      agencia: { sigla: "ARTESP", nome: "ARTESP" },
    }];
    return NextResponse.json(demo);
  }

  const { createSupabaseServerClient } = await import("@/lib/supabase/server");
  const db = createSupabaseServerClient();
  const { data, error } = await db
    .from("monitoramento_alertas")
    .select("*, site:monitoramento_sites(nome, url), agencia:agencias(sigla, nome), item:monitoramento_itens(*)")
    .order("created_at", { ascending: false })
    .limit(200);

  if (error) {
    return NextResponse.json({ error: "Erro ao buscar alertas" }, { status: 500 });
  }

  return NextResponse.json(data ?? []);
}
