/**
 * GET /api/v1/dashboard/governanca-agencias[?year=2026]
 * Indicadores de governança REAIS por agência (consenso, deferimento, qualidade
 * IA, sanções) — computados de deliberacoes+votos agrupados por agencia_id, só
 * sobre DECISÕES FINAIS. Substitui o cálculo antigo que repetia o número GLOBAL
 * para todas as agências (ANA/ANAC/... apareciam com o mesmo 68 sem ter dados).
 */

import { NextRequest, NextResponse } from "next/server";
import { isDemo } from "@/lib/server/is-demo";
import { isDemoRequest } from "@/lib/server/request-guards";
import { isFinalDecisionRecord } from "@/lib/server/regulatory-documents";
import { isResultadoPositivo } from "@/lib/utils";

export const dynamic = "force-dynamic";

interface AgenciaGovernanca {
  agencia_id: string | null;
  sigla: string;
  nome: string;
  total: number;
  consenso: number;     // % de deliberações sem voto divergente
  cobertura_nominal: number; // % de deliberações com ao menos 1 voto NOMINAL (confiabilidade do consenso)
  deferimento: number;  // % de resultados positivos
  qualidade: number;    // média de extraction_confidence * 100
  sancao: number;       // % multa/indeferido
}

export async function GET(req: NextRequest) {
  if (isDemo() || isDemoRequest(req)) {
    return NextResponse.json({ por_agencia: [] });
  }

  const { createSupabaseServerClient } = await import("@/lib/supabase/server");
  const db = createSupabaseServerClient();

  const [agenciasRes, delibsRes] = await Promise.all([
    db.from("agencias").select("id, sigla, nome").eq("ativo", true),
    db.from("deliberacoes")
      .select("agencia_id, resultado, microtema, extraction_confidence, tipo_documento, documento_pai_id, raw_extraction, votos(is_divergente, is_nominal)")
      .limit(40000),
  ]);

  const agencias: Array<{ id: string; sigla: string; nome: string }> = agenciasRes.data ?? [];
  type Acc = { total: number; consensoOk: number; comNominal: number; deferido: number; confSum: number; confN: number; sancao: number };
  const acc = new Map<string, Acc>();

  for (const d of (delibsRes.data ?? []) as Array<{
    agencia_id: string | null; resultado: string | null; microtema: string | null;
    extraction_confidence: number | null; tipo_documento: string | null;
    documento_pai_id: string | null; raw_extraction: any;
    votos: Array<{ is_divergente: boolean; is_nominal: boolean }>;
  }>) {
    if (!isFinalDecisionRecord(d as any) || !d.agencia_id) continue;
    const a = acc.get(d.agencia_id) ?? { total: 0, consensoOk: 0, comNominal: 0, deferido: 0, confSum: 0, confN: 0, sancao: 0 };
    a.total += 1;
    if (!(d.votos ?? []).some((v) => v.is_divergente)) a.consensoOk += 1;
    if ((d.votos ?? []).some((v) => v.is_nominal)) a.comNominal += 1;
    if (isResultadoPositivo(d.resultado)) a.deferido += 1;
    if (d.microtema === "multa" || d.resultado === "Indeferido") a.sancao += 1;
    if (d.extraction_confidence != null) { a.confSum += d.extraction_confidence; a.confN += 1; }
    acc.set(d.agencia_id, a);
  }

  const pct = (n: number, d: number) => (d > 0 ? Math.round((n / d) * 1000) / 10 : 0);
  const por_agencia: AgenciaGovernanca[] = agencias.map((ag) => {
    const a = acc.get(ag.id);
    return {
      agencia_id: ag.id, sigla: ag.sigla, nome: ag.nome,
      total: a?.total ?? 0,
      consenso: a ? pct(a.consensoOk, a.total) : 0,
      cobertura_nominal: a ? pct(a.comNominal, a.total) : 0,
      deferimento: a ? pct(a.deferido, a.total) : 0,
      qualidade: a && a.confN > 0 ? Math.round((a.confSum / a.confN) * 1000) / 10 : 0,
      sancao: a ? pct(a.sancao, a.total) : 0,
    };
  });

  return NextResponse.json({ por_agencia });
}
