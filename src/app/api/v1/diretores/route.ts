/**
 * GET /api/v1/diretores
 * Lista diretores, opcionalmente filtrados por agência.
 */

import { NextRequest, NextResponse } from "next/server";
import { demoData } from "@/lib/demo-data";
import { isLocalMode, getSyncedDelibs } from "@/lib/server/local-data-store";
import { computeDiretores } from "@/lib/server/analytics-engine";
import { isDemo } from "@/lib/server/is-demo";
import { isDemoRequest } from "@/lib/server/request-guards";


export async function GET(req: NextRequest) {
  if (isDemo() || isDemoRequest(req)) {
    if (isLocalMode()) {
      const agenciaId = req.nextUrl.searchParams.get("agencia_id");
      return NextResponse.json(computeDiretores(getSyncedDelibs(), agenciaId));
    }
    return NextResponse.json(demoData.diretores());
  }

  const { createSupabaseServerClient } = await import("@/lib/supabase/server");
  const db = createSupabaseServerClient();
  const agenciaId = req.nextUrl.searchParams.get("agencia_id");

  let query = db
    .from("diretores")
    .select("*, mandatos (id, data_inicio, data_fim, cargo)")
    .order("nome", { ascending: true });

  if (agenciaId) query = query.eq("agencia_id", agenciaId);

  const { data, error } = await query;

  if (error) {
    return NextResponse.json({ error: "Erro ao buscar diretores" }, { status: 500 });
  }

  return NextResponse.json(data ?? []);
}
