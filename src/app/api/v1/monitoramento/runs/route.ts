import { NextRequest, NextResponse } from "next/server";
import { isDemo } from "@/lib/server/is-demo";
import { isDemoRequest } from "@/lib/server/request-guards";

export async function GET(req: NextRequest) {
  if (isDemo() || isDemoRequest(req)) return NextResponse.json([]);

  const { createSupabaseServerClient } = await import("@/lib/supabase/server");
  const db = createSupabaseServerClient();
  const { data, error } = await db
    .from("monitoramento_runs")
    .select("*, site:monitoramento_sites(nome)")
    .order("started_at", { ascending: false })
    .limit(100);

  if (error) {
    return NextResponse.json({ error: "Erro ao buscar histórico de monitoramento" }, { status: 500 });
  }

  return NextResponse.json(data ?? []);
}
