import { NextRequest, NextResponse } from "next/server";
import { isDemo } from "@/lib/server/is-demo";
import { isDemoRequest } from "@/lib/server/request-guards";
import { repairRegulatoryNewsItems } from "@/lib/news-repairs";
import type { RegulatoryNews, RegulatoryNewsListResponse } from "@/types";

const DEMO_NEWS: RegulatoryNews[] = [
  {
    id: "demo-news-artesp",
    agencia_id: "demo-agency-artesp",
    agencia_sigla: "ARTESP",
    agencia: { sigla: "ARTESP", nome: "ARTESP" },
    titulo: "ARTESP divulga atualização sobre concessões rodoviárias",
    url: "https://www.artesp.sp.gov.br/artesp/noticias/feriado-tiradentes",
    fonte: "ARTESP",
    imagem_url: null,
    resumo: "Notícia demonstrativa para curadoria da Newsletter Regulatório.",
    conteudo: null,
    publicado_em: new Date().toISOString(),
    status_curadoria: "novo",
    hash_item: "demo-news-artesp",
    metadata: {},
    first_seen_at: new Date().toISOString(),
    last_seen_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  },
];

export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl;
  const agencia = searchParams.get("agencia");
  const status = searchParams.get("status");
  const search = searchParams.get("search")?.trim();
  const tema = searchParams.get("tema")?.trim();
  const periodo = normalizePeriod(searchParams.get("periodo"));
  const includeAllRecent = searchParams.get("include_all_recent") === "1" || searchParams.get("include_all_recent") === "true";
  const range = resolvePeriodRange(periodo, includeAllRecent, searchParams.get("from"), searchParams.get("to"));
  const from = range.from;
  const to = range.to;
  const limit = Math.min(100, Math.max(1, Number(searchParams.get("limit") ?? 50)));
  const offset = Math.max(0, Number(searchParams.get("offset") ?? 0));

  if (isDemo() || isDemoRequest(req)) {
    let data = DEMO_NEWS;
    if (agencia) data = data.filter((item) => item.agencia_sigla === agencia);
    if (status) data = data.filter((item) => item.status_curadoria === status);
    if (from) data = data.filter((item) => compareDate(item.publicado_em ?? item.first_seen_at, from) >= 0);
    if (to) data = data.filter((item) => compareDate(item.publicado_em ?? item.first_seen_at, to) <= 0);
    const searchTerm = search || tema;
    if (searchTerm) {
      const term = searchTerm.toLowerCase();
      data = data.filter((item) =>
        [item.titulo, item.resumo, item.fonte].filter(Boolean).join(" ").toLowerCase().includes(term),
      );
    }
    return NextResponse.json({ data: repairRegulatoryNewsItems(data.slice(offset, offset + limit)), total: data.length } satisfies RegulatoryNewsListResponse);
  }

  const { createSupabaseServerClient } = await import("@/lib/supabase/server");
  const db = createSupabaseServerClient();
  let query = db
    .from("regulatory_news")
    .select("*, agencia:agencias(sigla, nome)", { count: "exact" })
    .order("publicado_em", { ascending: false, nullsFirst: false })
    .order("first_seen_at", { ascending: false })
    .range(offset, offset + limit - 1);

  if (agencia) query = query.eq("agencia_sigla", agencia);
  if (status) query = query.eq("status_curadoria", status);
  // Inclui itens SEM data (publicado_em null) recém-coletados, usando first_seen como
  // fallback — senão o `gte publicado_em` os escondia (Postgres: NULL >= x é falso) e
  // notícias coletadas sumiam da tela. Espelha o coalesce do caminho demo. QA Etapa 20.
  if (from) query = query.or(`publicado_em.gte.${from},and(publicado_em.is.null,first_seen_at.gte.${from})`);
  if (to) query = query.or(`publicado_em.lte.${to},and(publicado_em.is.null,first_seen_at.lte.${to})`);
  const searchTerm = search || tema;
  if (searchTerm && searchTerm.length >= 2) {
    const escaped = searchTerm.replace(/[\\%_]/g, "\\$&");
    query = query.or(`titulo.ilike.%${escaped}%,resumo.ilike.%${escaped}%,conteudo.ilike.%${escaped}%`);
  }

  const { data, error, count } = await query;
  if (error) {
    return NextResponse.json({ error: "Erro ao buscar notícias" }, { status: 500 });
  }

  return NextResponse.json({ data: repairRegulatoryNewsItems((data ?? []) as RegulatoryNews[]), total: count ?? 0 } satisfies RegulatoryNewsListResponse);
}

function daysAgoIso(days: number) {
  const date = new Date();
  date.setDate(date.getDate() - days);
  return date.toISOString();
}

function normalizePeriod(value: string | null) {
  return value === "hoje" ? "today" : value;
}

function resolvePeriodRange(periodo: string | null, includeAllRecent: boolean, fromRaw: string | null, toRaw: string | null) {
  if (includeAllRecent || periodo === "all") return { from: null, to: null };

  if (periodo === "custom") {
    return { from: parseDateParam(fromRaw), to: endOfDayIso(toRaw) };
  }

  if (periodo === "today") {
    const start = new Date();
    start.setHours(0, 0, 0, 0);
    const end = new Date(start);
    end.setHours(23, 59, 59, 999);
    return { from: start.toISOString(), to: end.toISOString() };
  }

  if (periodo === "month" || periodo === "mensal") {
    return { from: daysAgoIso(30), to: null };
  }

  return { from: parseDateParam(fromRaw) ?? daysAgoIso(7), to: endOfDayIso(toRaw) };
}

function parseDateParam(value: string | null) {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

function endOfDayIso(value: string | null) {
  if (!value) return null;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;
  parsed.setHours(23, 59, 59, 999);
  return parsed.toISOString();
}

function compareDate(value: string | null, boundary: string) {
  return new Date(value ?? 0).getTime() - new Date(boundary).getTime();
}
