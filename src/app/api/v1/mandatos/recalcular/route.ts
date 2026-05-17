import { NextRequest, NextResponse } from "next/server";
import { calcularMandato } from "@/lib/mandatos";
import { requireAdminOrCron } from "@/lib/server/request-guards";
import { isDemo } from "@/lib/server/is-demo";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export async function POST(req: NextRequest) {
  return recalculate(req);
}

export async function GET(req: NextRequest) {
  return recalculate(req);
}

async function recalculate(req: NextRequest) {
  const guard = await requireAdminOrCron(req);
  if (guard) return guard;
  if (isDemo()) return NextResponse.json({ error: "Recálculo indisponível em modo demo" }, { status: 403 });

  const db = createSupabaseServerClient();
  const { data: mandatos, error } = await db
    .from("mandatos")
    .select("id, diretor_id, data_inicio, data_fim");

  if (error) {
    return NextResponse.json({ error: "Erro ao listar mandatos" }, { status: 500 });
  }

  let updated = 0;
  for (const mandato of mandatos ?? []) {
    const calc = calcularMandato(mandato.data_inicio, mandato.data_fim);
    await db
      .from("mandatos")
      .update({
        percentual_mandato_concluido: calc.percentualConcluido,
        updated_at: new Date().toISOString(),
      })
      .eq("id", mandato.id);

    await db
      .from("diretores")
      .update({
        percentual_mandato_concluido: calc.percentualConcluido,
        updated_at: new Date().toISOString(),
      })
      .eq("id", mandato.diretor_id);
    updated++;
  }

  return NextResponse.json({ updated });
}
