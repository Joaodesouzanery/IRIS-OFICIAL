import { NextRequest, NextResponse } from "next/server";
import { isDemo } from "@/lib/server/is-demo";
import { isDemoRequest } from "@/lib/server/request-guards";

export async function GET(req: NextRequest) {
  if (isDemo() || isDemoRequest(req)) return NextResponse.json([]);

  const agenciaId = req.nextUrl.searchParams.get("agencia_id");
  const status = req.nextUrl.searchParams.get("status") ?? "pendente";
  const { createSupabaseServerClient } = await import("@/lib/supabase/server");
  const db = createSupabaseServerClient();

  let query = db
    .from("diretor_candidatos")
    .select("*, agencia:agencias(sigla, nome), diretor:diretores(id, nome)")
    .order("created_at", { ascending: false })
    .limit(100);

  if (agenciaId) query = query.eq("agencia_id", agenciaId);
  if (status !== "todos") query = query.eq("review_status", status);

  const { data, error } = await query;
  if (error) {
    return NextResponse.json({ error: "Erro ao buscar candidatos" }, { status: 500 });
  }

  return NextResponse.json(data ?? []);
}
