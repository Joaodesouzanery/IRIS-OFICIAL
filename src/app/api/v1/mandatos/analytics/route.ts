/**
 * GET /api/v1/mandatos/analytics?agencia_id=X
 * Indicadores analíticos de mandatos: litígio, consenso, sanção,
 * distribuição de decisões e evolução mensal.
 */

import { NextRequest, NextResponse } from "next/server";
import { demoData } from "@/lib/demo-data";
import type { MandatosAnalytics } from "@/types";
import { isLocalMode, getSyncedDelibs } from "@/lib/server/local-data-store";
import { computeMandatosAnalytics } from "@/lib/server/analytics-engine";
import { isFinalDecisionRecord } from "@/lib/server/regulatory-documents";
import { isResultadoPositivo } from "@/lib/utils";
import { isDemo } from "@/lib/server/is-demo";
import { isDemoRequest } from "@/lib/server/request-guards";
import { selectAllPaged } from "@/lib/server/select-all-paged";


export async function GET(req: NextRequest) {
  const agenciaId = req.nextUrl.searchParams.get("agencia_id") || null;

  if (isDemo() || isDemoRequest(req)) {
    if (isLocalMode()) {
      return NextResponse.json(computeMandatosAnalytics(getSyncedDelibs(), agenciaId));
    }
    const analytics = demoData.mandatosAnalytics(agenciaId);
    return NextResponse.json(analytics);
  }

  const { createSupabaseServerClient } = await import("@/lib/supabase/server");
  const db = createSupabaseServerClient();

  // Busca deliberações com votos para calcular litígio/consenso.
  // Inclui os campos de classificação para filtrar só DECISÕES FINAIS (exclui
  // ata-mãe/pauta/voto_individual/itens sem resultado) — senão a fatia "Sem
  // resultado" incha e o total (36) diverge do Dashboard (28).
  // Paginado (anti-truncamento ~1000 do PostgREST) — QA ago/2026.
  const { rows: delibs, error } = await selectAllPaged(() => {
    let baseQ = db
      .from("deliberacoes")
      .select("id, resultado, microtema, data_reuniao, tipo_documento, documento_pai_id, raw_extraction, votos(tipo_voto, is_divergente)")
      .order("id", { ascending: true });
    if (agenciaId) baseQ = baseQ.eq("agencia_id", agenciaId);
    return baseQ;
  }, { label: "mandatos/analytics" });

  if (error) {
    return NextResponse.json({ error: "Erro ao buscar analytics" }, { status: 500 });
  }

  const rows = ((delibs ?? []) as Array<{
    id: string; resultado: string | null; microtema: string | null; data_reuniao: string | null;
    tipo_documento: string | null; documento_pai_id: string | null; raw_extraction: any;
    votos: Array<{ tipo_voto: string; is_divergente: boolean }>;
  }>).filter((d) => isFinalDecisionRecord(d as any));

  const total = rows.length;
  let comLitigio = 0, sancao = 0;
  const resultadoCount = new Map<string, number>();
  const byMonth = new Map<string, { total: number; deferido: number; indeferido: number }>();

  for (const d of rows) {
    const temDivergente = d.votos.some((v) => v.is_divergente);
    if (temDivergente) comLitigio++;
    if (d.microtema === "multa" || d.resultado === "Indeferido") sancao++;

    const r = d.resultado ?? "Sem resultado";
    resultadoCount.set(r, (resultadoCount.get(r) ?? 0) + 1);

    if (d.data_reuniao) {
      const period = d.data_reuniao.slice(0, 7);
      if (!byMonth.has(period)) byMonth.set(period, { total: 0, deferido: 0, indeferido: 0 });
      const s = byMonth.get(period)!;
      s.total++;
      if (isResultadoPositivo(d.resultado)) s.deferido++;
      else if (d.resultado === "Indeferido") s.indeferido++;
    }
  }

  const consenso = total - comLitigio;
  const result: MandatosAnalytics = {
    total_deliberacoes: total,
    taxa_litigio: total > 0 ? `${((comLitigio / total) * 100).toFixed(1)}%` : "0%",
    taxa_consenso: total > 0 ? `${((consenso / total) * 100).toFixed(1)}%` : "0%",
    taxa_sancao: total > 0 ? `${((sancao / total) * 100).toFixed(1)}%` : "0%",
    distribuicao_decisao: [...resultadoCount.entries()]
      .map(([resultado, count]) => ({ resultado, count, pct: total > 0 ? Math.round((count / total) * 100) : 0 }))
      .sort((a, b) => b.count - a.count),
    evolucao_mensal: [...byMonth.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([period, s]) => ({ period, ...s })),
  };

  return NextResponse.json(result);
}
