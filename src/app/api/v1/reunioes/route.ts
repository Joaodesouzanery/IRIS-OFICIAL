/**
 * GET /api/v1/reunioes?agencia_id&year&date_from&date_to
 * Lista de reuniões de diretoria (agrupamento de deliberações por
 * agência + data + número), com consenso e contagens.
 */

import { NextRequest, NextResponse } from "next/server";
import { isLocalMode, getSyncedDelibs } from "@/lib/server/local-data-store";
import { computeReunioesList } from "@/lib/server/analytics-engine";
import { isDemo } from "@/lib/server/is-demo";
import { isDemoRequest } from "@/lib/server/request-guards";
import { mapDeliberacaoRows, DELIB_SELECT } from "@/lib/server/deliberacao-fetch";

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const YEAR_RE = /^(19|20)\d{2}$/;

export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl;
  const agenciaId = searchParams.get("agencia_id");

  if (isDemo() || isDemoRequest(req)) {
    if (isLocalMode()) return NextResponse.json(computeReunioesList(getSyncedDelibs(), agenciaId));
    return NextResponse.json([]);
  }

  const { createSupabaseServerClient } = await import("@/lib/supabase/server");
  const db = createSupabaseServerClient();
  let query = db.from("deliberacoes").select(DELIB_SELECT).not("data_reuniao", "is", null).limit(10000);

  if (agenciaId) query = query.eq("agencia_id", agenciaId);
  const year = searchParams.get("year");
  if (year && YEAR_RE.test(year)) query = query.gte("data_reuniao", `${year}-01-01`).lte("data_reuniao", `${year}-12-31`);
  const dateFrom = searchParams.get("date_from");
  if (dateFrom && ISO_DATE_RE.test(dateFrom)) query = query.gte("data_reuniao", dateFrom);
  const dateTo = searchParams.get("date_to");
  if (dateTo && ISO_DATE_RE.test(dateTo)) query = query.lte("data_reuniao", dateTo);

  const { data, error } = await query;
  if (error) return NextResponse.json({ error: "Erro ao buscar reuniões" }, { status: 500 });

  return NextResponse.json(computeReunioesList(mapDeliberacaoRows(data ?? []), agenciaId));
}
