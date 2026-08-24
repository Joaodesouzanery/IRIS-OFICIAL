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
import { isFinalDecisionRecord , decisionStatus, isConsensual, isDecidedOnMerits, isSancao } from "@/lib/server/regulatory-documents";
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
  let comLitigio = 0, sancao = 0, comVoto = 0, decidido = 0;
  const resultadoCount = new Map<string, number>();
  const byMonth = new Map<string, { total: number; deferido: number; indeferido: number }>();

  for (const d of rows) {
    // Etapa60: consenso/litígio só onde HÁ VOTO. `some()` sobre array vazio é `false`, então item
    // sem voto entrava como consensual — e o consenso subia justamente onde não havia dado nenhum.
    const consensual = isConsensual(d.votos);
    if (consensual !== null) {
      comVoto++;
      if (!consensual) comLitigio++;
    }
    // E o denominador de MÉRITO exclui retirado/sem-resultado/admissibilidade. O NUMERADOR de
    // sanção vive no MESMO universo: contá-lo sobre todas as linhas com o divisor só sobre as
    // decididas deixa a taxa passar de 100%.
    if (isDecidedOnMerits(d as any)) {
      decidido++;
      if (isSancao(d)) sancao++;
    }

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

  const consenso = comVoto - comLitigio;
  const result: MandatosAnalytics = {
    total_deliberacoes: total,
    // Etapa60 — modo duplo: o pautado continua publicado; os denominadores reais vêm ao lado, para
    // que quem lê a taxa saiba SOBRE O QUÊ ela foi calculada.
    total_decidido: decidido,
    total_com_voto: comVoto,
    taxa_litigio: comVoto > 0 ? `${((comLitigio / comVoto) * 100).toFixed(1)}%` : "0%",
    taxa_consenso: comVoto > 0 ? `${((consenso / comVoto) * 100).toFixed(1)}%` : "0%",
    taxa_sancao: decidido > 0 ? `${((sancao / decidido) * 100).toFixed(1)}%` : "0%",
    distribuicao_decisao: [...resultadoCount.entries()]
      .map(([resultado, count]) => ({ resultado, count, pct: total > 0 ? Math.round((count / total) * 100) : 0 }))
      .sort((a, b) => b.count - a.count),
    evolucao_mensal: [...byMonth.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([period, s]) => ({ period, ...s })),
  };

  return NextResponse.json(result);
}
