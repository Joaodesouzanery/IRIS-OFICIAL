/**
 * GET /api/v1/dashboard/diretores/overview
 * Métricas de participação por diretor.
 */

import { NextRequest, NextResponse } from "next/server";
import { demoData } from "@/lib/demo-data";
import { isLocalMode, getSyncedDelibs } from "@/lib/server/local-data-store";
import { computeDiretoresOverview } from "@/lib/server/analytics-engine";
import { isDemo } from "@/lib/server/is-demo";
import { isDemoRequest } from "@/lib/server/request-guards";


export async function GET(req: NextRequest) {
  if (isDemo() || isDemoRequest(req)) {
    const agenciaId = req.nextUrl.searchParams.get("agencia_id");
    if (isLocalMode()) {
      return NextResponse.json(computeDiretoresOverview(getSyncedDelibs(), agenciaId));
    }
    return NextResponse.json(demoData.diretoresOverview());
  }

  const { createSupabaseServerClient } = await import("@/lib/supabase/server");
  const db = createSupabaseServerClient();
  const agenciaId = req.nextUrl.searchParams.get("agencia_id");

  let query = db
    .from("votos")
    .select(
      `tipo_voto, is_divergente,
       diretores!inner (id, nome, agencia_id)`
    );

  if (agenciaId) {
    query = query.eq("diretores.agencia_id", agenciaId);
  }

  const { data, error } = await query;

  if (error) {
    return NextResponse.json({ error: "Erro ao buscar overview de diretores" }, { status: 500 });
  }

  const stats = new Map<
    string,
    { nome: string; total: number; favoravel: number; desfavoravel: number; divergente: number }
  >();

  for (const row of data ?? []) {
    const dir = (row as any).diretores;
    const id = dir.id;
    if (!stats.has(id)) {
      stats.set(id, { nome: dir.nome, total: 0, favoravel: 0, desfavoravel: 0, divergente: 0 });
    }
    const s = stats.get(id)!;
    s.total++;
    if ((row as any).tipo_voto === "Favoravel") s.favoravel++;
    else if ((row as any).tipo_voto === "Desfavoravel") s.desfavoravel++;
    if ((row as any).is_divergente) s.divergente++;
  }

  const result = [...stats.entries()]
    .map(([id, s]) => ({
      diretor_id: id,
      diretor_nome: s.nome,
      total: s.total,
      favoravel: s.favoravel,
      desfavoravel: s.desfavoravel,
      divergente: s.divergente,
      pct_favor: s.total > 0 ? parseFloat(((s.favoravel / s.total) * 100).toFixed(1)) : 0,
    }))
    .sort((a, b) => b.total - a.total);

  return NextResponse.json(result);
}
