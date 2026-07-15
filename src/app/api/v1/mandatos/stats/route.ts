/**
 * GET /api/v1/mandatos/stats?agencia_id=X
 * KPIs para o painel de mandatos.
 */

import { NextRequest, NextResponse } from "next/server";
import { demoData } from "@/lib/demo-data";
import type { MandatosStats } from "@/types";
import { isLocalMode, getSyncedDelibs } from "@/lib/server/local-data-store";
import { computeMandatosStats } from "@/lib/server/analytics-engine";
import { isDemo } from "@/lib/server/is-demo";
import { isDemoRequest } from "@/lib/server/request-guards";


export async function GET(req: NextRequest) {
  const agenciaId = req.nextUrl.searchParams.get("agencia_id") || null;

  if (isDemo() || isDemoRequest(req)) {
    if (isLocalMode()) {
      return NextResponse.json(computeMandatosStats(getSyncedDelibs(), agenciaId));
    }
    const stats = demoData.mandatosStats(agenciaId);
    return NextResponse.json(stats);
  }

  const { createSupabaseServerClient } = await import("@/lib/supabase/server");
  const db = createSupabaseServerClient();

  // Diretores ativos
  let diretoresQuery = db
    .from("mandatos")
    .select("diretor_id, diretores!inner(agencia_id)", { count: "exact", head: true })
    .gte("data_fim", new Date().toISOString().slice(0, 10));
  if (agenciaId) diretoresQuery = diretoresQuery.eq("diretores.agencia_id", agenciaId);

  // Total deliberações FINAIS (aproximação SQL do isFinalDecisionRecord: exclui
  // ata-mãe e docs de apoio) — alinha o card ao Dashboard (28), sem contar
  // ata-mãe/pauta/voto_individual que inflavam para 36.
  let deliberQuery = db
    .from("deliberacoes")
    .select("id", { count: "exact", head: true })
    .not("tipo_documento", "in", "(pauta,voto_individual,documento_apoio)")
    .or("tipo_documento.neq.ata,documento_pai_id.not.is.null");
  if (agenciaId) deliberQuery = deliberQuery.eq("agencia_id", agenciaId);

  // Participações colegiadas = total votos
  let votosQuery = db
    .from("votos")
    .select("deliberacoes!inner(agencia_id)", { count: "exact", head: true });
  if (agenciaId) votosQuery = votosQuery.eq("deliberacoes.agencia_id", agenciaId);

  // Taxa de consenso: deliberações sem voto divergente / total
  let divergQuery = db
    .from("votos")
    .select("deliberacao_id, deliberacoes!inner(agencia_id)")
    .eq("is_divergente", true);
  if (agenciaId) divergQuery = divergQuery.eq("deliberacoes.agencia_id", agenciaId);

  // As 4 queries são independentes → paralelas (antes eram 4 awaits sequenciais).
  const [{ count: diretores_ativos }, { count: total_deliberacoes }, { count: participacoes_colegiadas }, { data: divergData }] =
    await Promise.all([diretoresQuery, deliberQuery, votosQuery, divergQuery]);
  const comDivergencia = new Set((divergData ?? []).map((v: { deliberacao_id: string }) => v.deliberacao_id)).size;
  const total = total_deliberacoes ?? 0;
  const taxa_consenso =
    total > 0 ? (((total - comDivergencia) / total) * 100).toFixed(1) + "%" : "100%";

  const result: MandatosStats = {
    diretores_ativos: diretores_ativos ?? 0,
    participacoes_colegiadas: participacoes_colegiadas ?? 0,
    taxa_consenso,
    total_deliberacoes: total,
  };

  return NextResponse.json(result);
}
