/**
 * GET /api/v1/noticias/export-2026?format=csv|json&order=asc|desc
 * Export cronológico de TODO o corpus de notícias de 2026 (sem o cap do feed), ordenado
 * por data de publicação — para anexar/consultar no prêmio. Admin.
 */

import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/server/request-guards";

export const dynamic = "force-dynamic";

const SINCE = "2026-01-01";
const UNTIL = "2026-12-31T23:59:59-03:00";
const MAX_ROWS = 20000;

const DIM_NOMES: Record<number, string> = {
  1: "AIR", 2: "Participação Social", 3: "Estoque Regulatório", 4: "Agenda Regulatória", 5: "Processo Normativo", 6: "ARR",
};

export async function GET(req: NextRequest) {
  const guard = await requireAdmin(req);
  if (guard) return guard;

  const format = req.nextUrl.searchParams.get("format") === "json" ? "json" : "csv";
  const order = req.nextUrl.searchParams.get("order") === "desc" ? false : true; // asc por padrão (cronológico)

  const { createSupabaseServerClient } = await import("@/lib/supabase/server");
  const db = createSupabaseServerClient();

  const { data, error } = await db
    .from("regulatory_news")
    .select("agencia_sigla, titulo, url, publicado_em, resumo, metadata")
    .gte("publicado_em", SINCE)
    .lte("publicado_em", UNTIL)
    .order("publicado_em", { ascending: order, nullsFirst: false })
    .limit(MAX_ROWS);

  if (error) return NextResponse.json({ error: "Falha ao exportar 2026" }, { status: 500 });

  const rows = (data ?? []).map((r: any) => {
    const dims = Array.isArray(r.metadata?.prize_dims) ? (r.metadata.prize_dims as number[]) : [];
    return {
      data: r.publicado_em ?? "",
      agencia: r.agencia_sigla ?? "",
      titulo: r.titulo ?? "",
      dimensoes: dims.map((d) => DIM_NOMES[d] ?? String(d)).join("; "),
      url: r.url ?? "",
      resumo: (r.resumo ?? "").replace(/\s+/g, " ").trim().slice(0, 500),
    };
  });

  if (format === "json") {
    return NextResponse.json({ ano: 2026, total: rows.length, order: order ? "asc" : "desc", itens: rows });
  }

  const header = ["data", "agencia", "titulo", "dimensoes", "url", "resumo"];
  const esc = (v: string) => `"${String(v).replace(/"/g, '""')}"`;
  const csv = [
    header.join(","),
    ...rows.map((r) => [r.data, r.agencia, r.titulo, r.dimensoes, r.url, r.resumo].map(esc).join(",")),
  ].join("\r\n");

  return new NextResponse("﻿" + csv, {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="iris-noticias-2026.csv"`,
    },
  });
}
