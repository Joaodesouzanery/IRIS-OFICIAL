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

  // Parte dos DIRETORES aprovados (não dos votos) para que TODO diretor apareça —
  // inclusive com 0 voto. Antes o overview partia de `votos` com !inner, então
  // diretor sem voto (ex.: ANTT com votos presos em candidatos) sumia da tabela.
  let diretoresQuery = db
    .from("diretores")
    .select("id, nome, agencia_id")
    .eq("review_status", "aprovado")
    .limit(5000);
  if (agenciaId) diretoresQuery = diretoresQuery.eq("agencia_id", agenciaId);

  let votosQuery = db
    .from("votos")
    .select("tipo_voto, is_divergente, diretores!inner (id, nome, agencia_id)");
  if (agenciaId) {
    votosQuery = votosQuery.eq("diretores.agencia_id", agenciaId);
  }

  const [diretoresRes, votosRes] = await Promise.all([diretoresQuery, votosQuery]);
  if (diretoresRes.error || votosRes.error) {
    return NextResponse.json({ error: "Erro ao buscar overview de diretores" }, { status: 500 });
  }

  const stats = new Map<
    string,
    { nome: string; total: number; favoravel: number; desfavoravel: number; divergente: number }
  >();
  // Semeia com todos os diretores aprovados (zeros).
  for (const d of (diretoresRes.data ?? []) as Array<{ id: string; nome: string }>) {
    stats.set(d.id, { nome: d.nome, total: 0, favoravel: 0, desfavoravel: 0, divergente: 0 });
  }

  for (const row of votosRes.data ?? []) {
    const dir = (row as any).diretores;
    const id = dir?.id;
    if (!id) continue;
    // Diretor pode ter voto mas não estar na lista de aprovados (raro) — inclui mesmo assim.
    if (!stats.has(id)) {
      stats.set(id, { nome: dir.nome ?? "—", total: 0, favoravel: 0, desfavoravel: 0, divergente: 0 });
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
