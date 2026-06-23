/**
 * GET /api/v1/reunioes/detalhe?agencia_id&data_reuniao&numero_reuniao
 * Detalhe de uma reunião: cabeçalho, itens (deliberações) com voto por diretor,
 * agregado de diretores e consenso. Querystring (evita data em path).
 */

import { NextRequest, NextResponse } from "next/server";
import { isLocalMode, getSyncedDelibs } from "@/lib/server/local-data-store";
import { computeReuniaoDetalhe } from "@/lib/server/analytics-engine";
import { isDemo } from "@/lib/server/is-demo";
import { isDemoRequest } from "@/lib/server/request-guards";
import { mapDeliberacaoRows, DELIB_SELECT } from "@/lib/server/deliberacao-fetch";

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl;
  const agenciaId = searchParams.get("agencia_id");
  const dataReuniao = searchParams.get("data_reuniao");
  const numeroReuniao = searchParams.get("numero_reuniao");

  if (!dataReuniao || !ISO_DATE_RE.test(dataReuniao)) {
    return NextResponse.json({ error: "data_reuniao (YYYY-MM-DD) obrigatória" }, { status: 400 });
  }
  const key = { agenciaId, dataReuniao, numeroReuniao: numeroReuniao || null };

  if (isDemo() || isDemoRequest(req)) {
    if (isLocalMode()) {
      const detalhe = computeReuniaoDetalhe(getSyncedDelibs(), key);
      return detalhe ? NextResponse.json(detalhe) : NextResponse.json({ error: "Reunião não encontrada" }, { status: 404 });
    }
    return NextResponse.json({ error: "Indisponível em modo demo" }, { status: 404 });
  }

  const { createSupabaseServerClient } = await import("@/lib/supabase/server");
  const db = createSupabaseServerClient();
  let query = db.from("deliberacoes").select(DELIB_SELECT).eq("data_reuniao", dataReuniao);
  if (agenciaId) query = query.eq("agencia_id", agenciaId);
  if (numeroReuniao) query = query.eq("numero_reuniao", numeroReuniao);

  const { data, error } = await query;
  if (error) return NextResponse.json({ error: "Erro ao buscar reunião" }, { status: 500 });

  const detalhe = computeReuniaoDetalhe(mapDeliberacaoRows(data ?? []), key);
  return detalhe ? NextResponse.json(detalhe) : NextResponse.json({ error: "Reunião não encontrada" }, { status: 404 });
}
