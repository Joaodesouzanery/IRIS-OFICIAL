/**
 * GET /api/v1/votacao/consenso-timeline
 * Série mensal de consenso do colegiado: % de deliberações finais sem voto divergente.
 */

import { NextRequest, NextResponse } from "next/server";
import { isLocalMode, getSyncedDelibs } from "@/lib/server/local-data-store";
import { computeConsensoTimeline } from "@/lib/server/analytics-engine";
import { isDemo } from "@/lib/server/is-demo";
import { isDemoRequest } from "@/lib/server/request-guards";
import { parseVotacaoFilters, filterDelibsForVotacao } from "@/lib/server/votacao-filters";
import { isFinalDecisionRecord , isConsensual } from "@/lib/server/regulatory-documents";

export async function GET(req: NextRequest) {
  const filters = parseVotacaoFilters(req.nextUrl.searchParams);

  if (isDemo() || isDemoRequest(req)) {
    if (isLocalMode()) {
      return NextResponse.json(computeConsensoTimeline(filterDelibsForVotacao(getSyncedDelibs(), filters), filters.agenciaId));
    }
    return NextResponse.json([]);
  }

  const { createSupabaseServerClient } = await import("@/lib/supabase/server");
  const db = createSupabaseServerClient();

  let query = db
    .from("deliberacoes")
    .select("data_reuniao, tipo_documento, documento_pai_id, microtema, area_regulatoria, numero_reuniao, agencia_id, votos (is_divergente, is_nominal)")
    .not("data_reuniao", "is", null)
    .limit(10000);

  if (filters.agenciaId) query = query.eq("agencia_id", filters.agenciaId);
  if (filters.microtema) query = query.eq("microtema", filters.microtema);
  if (filters.area) query = query.eq("area_regulatoria", filters.area);
  if (filters.numeroReuniao) query = query.eq("numero_reuniao", filters.numeroReuniao);
  if (filters.dateFrom) query = query.gte("data_reuniao", filters.dateFrom);
  if (filters.dateTo) query = query.lte("data_reuniao", filters.dateTo);

  const { data, error } = await query;
  if (error) {
    return NextResponse.json({ error: "Erro ao buscar timeline de consenso" }, { status: 500 });
  }

  const byMonth = new Map<string, { total: number; com_voto: number; divergentes: number; com_voto_nominal: number }>();
  for (const d of (data ?? []) as any[]) {
    if (!isFinalDecisionRecord(d)) continue;
    const period = String(d.data_reuniao).slice(0, 7);
    if (!period) continue;
    const m = byMonth.get(period) ?? { total: 0, com_voto: 0, divergentes: 0, com_voto_nominal: 0 };
    m.total++;
    // Etapa60: só entra na conta de consenso o item que TEM voto. Antes, mês sem nenhum voto
    // extraído aparecia como 100% de consenso — o gráfico subia justamente onde faltava dado.
    const consensual = isConsensual(d.votos);
    if (consensual !== null) {
      m.com_voto++;
      if (!consensual) m.divergentes++;
    }
    if ((d.votos ?? []).some((v: any) => v.is_nominal)) m.com_voto_nominal++;
    byMonth.set(period, m);
  }

  const result = [...byMonth.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([period, m]) => ({
      period,
      total_itens: m.total,
      // Denominador REAL do consenso, publicado ao lado (etapa60).
      total_com_voto: m.com_voto,
      consensuais: m.com_voto - m.divergentes,
      divergentes: m.divergentes,
      pct_consenso: m.com_voto > 0 ? Math.round(((m.com_voto - m.divergentes) / m.com_voto) * 1000) / 10 : 0,
      // % de itens com ao menos 1 voto NOMINAL: o consenso só é confiável onde há base
      // nominal. Sem isto, "consenso 100%" sobre base quase nula parecia real (QA Etapa 19).
      cobertura_nominal: m.total > 0 ? Math.round((m.com_voto_nominal / m.total) * 1000) / 10 : 0,
    }));

  return NextResponse.json(result);
}
