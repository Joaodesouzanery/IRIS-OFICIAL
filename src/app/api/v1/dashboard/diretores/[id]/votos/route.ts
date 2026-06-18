import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/server/request-guards";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const guard = await requireAdmin(req);
  if (guard) return guard;

  const { id } = await params;
  const agenciaId = req.nextUrl.searchParams.get("agencia_id");
  const limit = Math.min(parseInt(req.nextUrl.searchParams.get("limit") ?? "50", 10), 200);

  const { createSupabaseServerClient } = await import("@/lib/supabase/server");
  const db = createSupabaseServerClient();

  let query = db
    .from("votos")
    .select(
      `id, tipo_voto, is_divergente, created_at,
       deliberacao:deliberacoes(
         id, numero_deliberacao, titulo, resultado, data_deliberacao, tema, microtema,
         agencia:agencias(sigla)
       )`
    )
    .eq("diretor_id", id)
    .order("created_at", { ascending: false })
    .limit(limit);

  if (agenciaId) {
    query = query.eq("deliberacoes.agencia_id", agenciaId);
  }

  const { data, error } = await query;

  if (error) {
    return NextResponse.json({ error: "Erro ao buscar votos do diretor" }, { status: 500 });
  }

  return NextResponse.json(data ?? []);
}
