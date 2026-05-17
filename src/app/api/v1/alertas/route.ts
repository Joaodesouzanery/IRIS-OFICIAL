/**
 * GET /api/v1/alertas?agencia_id=...
 * Retorna alertas inteligentes computados a partir das deliberações:
 * - Empresa com ≥ 3 indeferimentos nos últimos 90 dias
 * - Tema emergente (crescimento > 20% no último trimestre)
 * - Diretor com taxa de divergência > 30%
 */

import { NextRequest, NextResponse } from "next/server";
import { demoData } from "@/lib/demo-data";
import { isLocalMode, getSyncedDelibs } from "@/lib/server/local-data-store";
import { computeAlertas } from "@/lib/server/analytics-engine";
import { isDemo } from "@/lib/server/is-demo";
import { isDemoRequest } from "@/lib/server/request-guards";
import { isFinalDecisionRecord } from "@/lib/server/regulatory-documents";


export async function GET(req: NextRequest) {
  const agenciaId = req.nextUrl.searchParams.get("agencia_id") || null;

  if (isDemo() || isDemoRequest(req)) {
    const delibs = isLocalMode() ? getSyncedDelibs() : demoData.deliberacoes({ limit: 9999 }).data;
    return NextResponse.json(computeAlertas(delibs, agenciaId));
  }

  const { createSupabaseServerClient } = await import("@/lib/supabase/server");
  const db = createSupabaseServerClient();

  let q = db
    .from("deliberacoes")
    .select(
      `id, interessado, resultado, microtema, data_reuniao, agencia_id,
       tipo_documento, documento_pai_id, raw_extraction,
       votos (tipo_voto, is_divergente, diretor_id, diretores (nome))`
    );

  if (agenciaId) q = q.eq("agencia_id", agenciaId) as typeof q;

  const { data, error } = await q;
  if (error) {
    return NextResponse.json({ error: "Erro ao computar alertas" }, { status: 500 });
  }

  const deliberacoes = (data ?? []).filter(isFinalDecisionRecord).map((d: any) => ({
    ...d,
    votos: (d.votos ?? []).map((v: any) => ({
      id: `v-${Math.random()}`,
      tipo_voto: v.tipo_voto,
      is_divergente: v.is_divergente,
      is_nominal: true,
      diretor_id: v.diretor_id,
      diretor_nome: v.diretores?.nome ?? null,
    })),
  }));

  return NextResponse.json(computeAlertas(deliberacoes, agenciaId));
}
