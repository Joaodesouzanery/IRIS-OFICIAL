/**
 * GET /api/v1/mandatos
 * Lista mandatos com dados de diretor, ordenados por data de início.
 */

import { NextRequest, NextResponse } from "next/server";
import { demoData } from "@/lib/demo-data";
import { isLocalMode, getSyncedDelibs } from "@/lib/server/local-data-store";
import { computeMandatos } from "@/lib/server/analytics-engine";
import { isDemo } from "@/lib/server/is-demo";
import { isDemoRequest } from "@/lib/server/request-guards";


export async function GET(req: NextRequest) {
  if (isDemo() || isDemoRequest(req)) {
    const statusFilter = req.nextUrl.searchParams.get("status");
    const agenciaId = req.nextUrl.searchParams.get("agencia_id");
    if (isLocalMode()) {
      return NextResponse.json(computeMandatos(getSyncedDelibs(), agenciaId, statusFilter));
    }
    const all = demoData.mandatos();
    const filtered = all.filter((m) => {
      if (statusFilter && m.status !== statusFilter) return false;
      if (agenciaId && m.agencia_id !== agenciaId) return false;
      return true;
    });
    return NextResponse.json(filtered);
  }

  const { createSupabaseServerClient } = await import("@/lib/supabase/server");
  const db = createSupabaseServerClient();
  const agenciaId = req.nextUrl.searchParams.get("agencia_id");
  const statusFilter = req.nextUrl.searchParams.get("status");

  let query = db
    .from("mandatos")
    .select(
      `id, data_inicio, data_fim, cargo,
       diretores!inner (id, nome, agencia_id, ativo)`
    )
    .order("data_inicio", { ascending: false });

  if (agenciaId) {
    query = query.eq("diretores.agencia_id", agenciaId);
  }

  const { data, error } = await query;

  if (error) {
    return NextResponse.json({ error: "Erro ao buscar mandatos" }, { status: 500 });
  }

  const now = new Date().toISOString().slice(0, 10);

  const formatted = (data ?? []).map((m: any) => {
    const status =
      !m.data_fim || m.data_fim >= now ? "Ativo" : "Inativo";
    return {
      id: m.id,
      data_inicio: m.data_inicio,
      data_fim: m.data_fim,
      cargo: m.cargo,
      diretor_id: m.diretores.id,
      diretor_nome: m.diretores.nome,
      agencia_id: m.diretores.agencia_id,
      status,
    };
  }).filter((m) => {
    if (statusFilter && m.status !== statusFilter) return false;
    return true;
  });

  return NextResponse.json(formatted);
}
