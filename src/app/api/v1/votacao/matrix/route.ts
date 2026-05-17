/**
 * GET /api/v1/votacao/matrix
 * Matriz de votação por diretor: total, favorável, contrário, divergente.
 */

import { NextRequest, NextResponse } from "next/server";
import { demoData } from "@/lib/demo-data";
import { isLocalMode, getSyncedDelibs } from "@/lib/server/local-data-store";
import { computeVotacaoMatrix } from "@/lib/server/analytics-engine";
import { isDemo } from "@/lib/server/is-demo";
import { isDemoRequest } from "@/lib/server/request-guards";


export async function GET(req: NextRequest) {
  if (isDemo() || isDemoRequest(req)) {
    if (isLocalMode()) {
      const agenciaId = req.nextUrl.searchParams.get("agencia_id");
      return NextResponse.json(computeVotacaoMatrix(getSyncedDelibs(), agenciaId));
    }
    return NextResponse.json(demoData.votacaoMatrix());
  }

  const { createSupabaseServerClient } = await import("@/lib/supabase/server");
  const db = createSupabaseServerClient();
  const agenciaId = req.nextUrl.searchParams.get("agencia_id");

  let query = db
    .from("votos")
    .select(`tipo_voto, is_divergente, diretores!inner (id, nome, agencia_id)`);

  if (agenciaId) {
    query = query.eq("diretores.agencia_id", agenciaId);
  }

  const { data, error } = await query;

  if (error) {
    return NextResponse.json({ error: "Erro ao buscar matriz" }, { status: 500 });
  }

  const matrix = new Map<
    string,
    { nome: string; total: number; favoravel: number; desfavoravel: number; abstencao: number; divergente: number }
  >();

  for (const row of data ?? []) {
    const dir = (row as any).diretores;
    const id = dir.id;
    if (!matrix.has(id)) {
      matrix.set(id, { nome: dir.nome, total: 0, favoravel: 0, desfavoravel: 0, abstencao: 0, divergente: 0 });
    }
    const m = matrix.get(id)!;
    m.total++;
    if ((row as any).tipo_voto === "Favoravel") m.favoravel++;
    else if ((row as any).tipo_voto === "Desfavoravel") m.desfavoravel++;
    else if ((row as any).tipo_voto === "Abstencao") m.abstencao++;
    if ((row as any).is_divergente) m.divergente++;
  }

  const result = [...matrix.entries()]
    .map(([id, m]) => ({
      diretor_id: id,
      diretor_nome: m.nome,
      total: m.total,
      favoravel: m.favoravel,
      desfavoravel: m.desfavoravel,
      abstencao: m.abstencao,
      divergente: m.divergente,
    }))
    .sort((a, b) => b.total - a.total);

  return NextResponse.json(result);
}
