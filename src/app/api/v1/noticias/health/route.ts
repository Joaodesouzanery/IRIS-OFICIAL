import { NextRequest, NextResponse } from "next/server";
import { isDemo } from "@/lib/server/is-demo";
import { isDemoRequest } from "@/lib/server/request-guards";

export const dynamic = "force-dynamic";

const SOURCES = ["ARTESP", "ANTT", "ANM"] as const;

export async function GET(req: NextRequest) {
  if (isDemo() || isDemoRequest(req)) {
    return NextResponse.json({
      cron: "0 11 * * *",
      sources: SOURCES.map((sigla) => ({
        agencia_sigla: sigla,
        total: sigla === "ARTESP" ? 1 : 0,
        last_seen_at: new Date().toISOString(),
        recent_7d: sigla === "ARTESP" ? 1 : 0,
      })),
    });
  }

  const { createSupabaseServerClient } = await import("@/lib/supabase/server");
  const db = createSupabaseServerClient();
  const { data, error } = await db
    .from("regulatory_news")
    .select("agencia_sigla, publicado_em, last_seen_at")
    .in("agencia_sigla", [...SOURCES])
    .order("last_seen_at", { ascending: false })
    .limit(500);

  if (error) return NextResponse.json({ error: "Erro ao verificar saude das noticias" }, { status: 500 });

  const sevenDaysAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
  const sources = SOURCES.map((sigla) => {
    const rows = (data ?? []).filter((item) => item.agencia_sigla === sigla);
    const last = rows
      .map((item) => item.last_seen_at)
      .filter(Boolean)
      .sort()
      .at(-1) ?? null;
    return {
      agencia_sigla: sigla,
      total: rows.length,
      last_seen_at: last,
      recent_7d: rows.filter((item) => {
        const date = new Date(item.publicado_em ?? item.last_seen_at ?? 0).getTime();
        return date >= sevenDaysAgo;
      }).length,
    };
  });

  return NextResponse.json({
    cron: "0 11 * * *",
    sources,
  });
}
