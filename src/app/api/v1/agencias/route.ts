/**
 * GET /api/v1/agencias  — lista agências
 * POST /api/v1/agencias — cria agência
 */

import { NextRequest, NextResponse } from "next/server";
import { demoData } from "@/lib/demo-data";
import { isDemo } from "@/lib/server/is-demo";
import { isDemoRequest, requireAdmin } from "@/lib/server/request-guards";


export async function GET(req: NextRequest) {
  if (isDemo() || isDemoRequest(req)) {
    return NextResponse.json(demoData.agencias());
  }

  const { createSupabaseServerClient } = await import("@/lib/supabase/server");
  const db = createSupabaseServerClient();
  const { data, error } = await db
    .from("agencias")
    .select("*")
    .order("sigla", { ascending: true });

  if (error) {
    return NextResponse.json({ error: "Erro ao buscar agências" }, { status: 500 });
  }

  return NextResponse.json(data ?? []);
}

export async function POST(req: NextRequest) {
  const guard = await requireAdmin(req);
  if (guard) return guard;

  if (isDemo()) {
    return NextResponse.json(
      { error: "Criação de agências não disponível em modo demo" },
      { status: 403 }
    );
  }

  const body = await req.json();

  const sigla = body.sigla?.trim().toUpperCase();
  const nome = body.nome?.trim();
  const nome_completo = body.nome_completo?.trim() || null;

  if (!sigla || sigla.length > 20) {
    return NextResponse.json({ error: "Sigla inválida (máx 20 caracteres)" }, { status: 400 });
  }
  if (!nome || nome.length > 200) {
    return NextResponse.json({ error: "Nome inválido (máx 200 caracteres)" }, { status: 400 });
  }

  const { createSupabaseServerClient } = await import("@/lib/supabase/server");
  const db = createSupabaseServerClient();
  const { data, error } = await db
    .from("agencias")
    .insert({ sigla, nome, nome_completo })
    .select()
    .single();

  if (error) {
    if (error.code === "23505") {
      return NextResponse.json({ error: "Sigla já cadastrada" }, { status: 409 });
    }
    return NextResponse.json({ error: "Erro ao criar agência" }, { status: 500 });
  }

  return NextResponse.json(data, { status: 201 });
}
