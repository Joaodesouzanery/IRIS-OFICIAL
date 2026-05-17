/**
 * GET /api/v1/empresas?agencia_id=...&search=...&microtema=...
 * Agregação de empresas/concessionárias reguladas a partir das deliberações.
 */

import { NextRequest, NextResponse } from "next/server";
import { demoData } from "@/lib/demo-data";
import { isLocalMode, getSyncedDelibs } from "@/lib/server/local-data-store";
import { computeEmpresas } from "@/lib/server/analytics-engine";
import { isDemo } from "@/lib/server/is-demo";
import { isDemoRequest } from "@/lib/server/request-guards";
import { isFinalDecisionRecord } from "@/lib/server/regulatory-documents";


export async function GET(req: NextRequest) {
  const agenciaId = req.nextUrl.searchParams.get("agencia_id") || null;
  const search    = req.nextUrl.searchParams.get("search")?.toLowerCase() ?? "";
  const microtema = req.nextUrl.searchParams.get("microtema") ?? "";

  if (isDemo() || isDemoRequest(req)) {
    if (isLocalMode()) {
      return NextResponse.json(computeEmpresas(getSyncedDelibs(), agenciaId));
    }

    let rows = demoData.empresas(agenciaId);
    if (search) rows = rows.filter((e) => e.nome.toLowerCase().includes(search));
    if (microtema) rows = rows.filter((e) => e.microtemas.includes(microtema));
    return NextResponse.json(rows);
  }

  const { createSupabaseServerClient } = await import("@/lib/supabase/server");
  const db = createSupabaseServerClient();

  let q: any = db
    .from("deliberacoes")
    .select("interessado, resultado, microtema, data_reuniao, agencia_id, tipo_documento, documento_pai_id, raw_extraction")
    .not("interessado", "is", null);
  if (agenciaId) q = q.eq("agencia_id", agenciaId);
  if (microtema) q = q.eq("microtema", microtema);

  const { data, error } = await q;
  if (error) return NextResponse.json({ error: "Erro ao buscar empresas" }, { status: 500 });

  const map = new Map<string, {
    total: number; deferido: number; indeferido: number;
    ultima: string; microtemas: Set<string>; agencia: string | null;
  }>();
  for (const d of (data ?? []).filter(isFinalDecisionRecord)) {
    if (!d.interessado) continue;
    if (!map.has(d.interessado)) {
      map.set(d.interessado, { total: 0, deferido: 0, indeferido: 0, ultima: "", microtemas: new Set(), agencia: d.agencia_id });
    }
    const s = map.get(d.interessado)!;
    s.total++;
    if (d.resultado === "Deferido") s.deferido++;
    else if (d.resultado === "Indeferido") s.indeferido++;
    if (!s.ultima || (d.data_reuniao ?? "") > s.ultima) s.ultima = d.data_reuniao ?? "";
    if (d.microtema) s.microtemas.add(d.microtema);
  }

  let rows = [...map.entries()].map(([nome, s]) => {
    const microtemas = [...s.microtemas];
    return {
      nome,
      total_deliberacoes: s.total,
      deferidos: s.deferido,
      indeferidos: s.indeferido,
      pct_deferido: s.total > 0 ? (s.deferido / s.total) * 100 : 0,
      ultima_deliberacao: s.ultima || null,
      microtemas,
      microtema_principal: microtemas[0] ?? null,
      agencia_id: s.agencia,
    };
  }).sort((a, b) => b.total_deliberacoes - a.total_deliberacoes);

  if (search) rows = rows.filter((e) => e.nome.toLowerCase().includes(search));
  return NextResponse.json(rows);
}
