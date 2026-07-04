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

  const computed = computeReunioesList(mapDeliberacaoRows(data ?? []), agenciaId);

  // Entidade materializada (Etapa 14): reuniões DESCOBERTAS pela coleta que ainda
  // não têm deliberação processada entram na lista (cobertura honesta) e as
  // demais ganham url_fonte/tipo. Fallback silencioso se a migration não foi aplicada.
  try {
    let reunioesQuery = db
      .from("reunioes")
      .select("agencia_id, numero_reuniao, tipo_reuniao, data_reuniao, url_fonte, source, agencia:agencias(sigla)")
      .not("data_reuniao", "is", null)
      .limit(2000);
    if (agenciaId) reunioesQuery = reunioesQuery.eq("agencia_id", agenciaId);
    if (year && YEAR_RE.test(year)) reunioesQuery = reunioesQuery.gte("data_reuniao", `${year}-01-01`).lte("data_reuniao", `${year}-12-31`);
    if (dateFrom && ISO_DATE_RE.test(dateFrom)) reunioesQuery = reunioesQuery.gte("data_reuniao", dateFrom);
    if (dateTo && ISO_DATE_RE.test(dateTo)) reunioesQuery = reunioesQuery.lte("data_reuniao", dateTo);
    const { data: materializadas, error: reunioesError } = await reunioesQuery;

    if (!reunioesError && materializadas) {
      const byKey = new Map(computed.map((r) => [`${r.agencia_id ?? "-"}__${r.data_reuniao ?? "-"}__${r.numero_reuniao ?? "-"}`, r]));
      for (const r of materializadas) {
        const key = `${r.agencia_id ?? "-"}__${r.data_reuniao ?? "-"}__${r.numero_reuniao ?? "-"}`;
        const match = byKey.get(key) as (typeof computed[number] & { url_fonte?: string | null }) | undefined;
        const agenciaRel = (r as { agencia?: { sigla?: string } | { sigla?: string }[] }).agencia;
        const sigla = Array.isArray(agenciaRel) ? agenciaRel[0]?.sigla ?? null : agenciaRel?.sigla ?? null;
        if (match) {
          if (r.url_fonte) match.url_fonte = r.url_fonte;
          if (!match.tipo_reuniao && r.tipo_reuniao) match.tipo_reuniao = r.tipo_reuniao;
        } else {
          computed.push({
            slug: key,
            agencia_id: r.agencia_id ?? null,
            agencia_sigla: sigla,
            data_reuniao: r.data_reuniao,
            numero_reuniao: r.numero_reuniao ?? null,
            tipo_reuniao: r.tipo_reuniao ?? null,
            total_itens: 0,
            total_votos: 0,
            votos_nominais: 0,
            votos_inferidos: 0,
            divergencias: 0,
            pct_consenso: 0,
            url_fonte: r.url_fonte ?? null,
            aguardando_documentos: true,
          } as typeof computed[number] & { url_fonte: string | null; aguardando_documentos: boolean });
        }
      }
      computed.sort((a, b) => (b.data_reuniao ?? "").localeCompare(a.data_reuniao ?? ""));
    }
  } catch {
    // Tabela reunioes ainda não migrada — lista derivada continua valendo.
  }

  return NextResponse.json(computed);
}
