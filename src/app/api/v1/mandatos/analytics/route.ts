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
import { isDemo } from "@/lib/server/is-demo";
import { isDemoRequest } from "@/lib/server/request-guards";


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

  // Busca deliberações com votos para calcular litígio/consenso
  let baseQ = db
    .from("deliberacoes")
    .select("id, resultado, microtema, data_reuniao, votos(tipo_voto, is_divergente)");
  if (agenciaId) baseQ = baseQ.eq("agencia_id", agenciaId);
  const { data: delibs, error } = await baseQ;

  if (error) {
    return NextResponse.json({ error: "Erro ao buscar analytics" }, { status: 500 });
  }

  const rows = (delibs ?? []) as Array<{
    id: string; resultado: string | null; microtema: string | null; data_reuniao: string | null;
    votos: Array<{ tipo_voto: string; is_divergente: boolean }>;
  }>;

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
      if (d.resultado === "Deferido") s.deferido++;
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
