/**
 * GET /api/v1/diretores
 * Lista diretores, opcionalmente filtrados por agência.
 */

import { NextRequest, NextResponse } from "next/server";
import { demoData } from "@/lib/demo-data";
import { isLocalMode, getSyncedDelibs } from "@/lib/server/local-data-store";
import { computeDiretores } from "@/lib/server/analytics-engine";
import { isDemo } from "@/lib/server/is-demo";
import { isDemoRequest, requireAdmin } from "@/lib/server/request-guards";
import { sanitizeNomeVariantes, VALID_SITUACAO } from "@/lib/server/diretores-admin";


export async function GET(req: NextRequest) {
  if (isDemo() || isDemoRequest(req)) {
    if (isLocalMode()) {
      const agenciaId = req.nextUrl.searchParams.get("agencia_id");
      return NextResponse.json(computeDiretores(getSyncedDelibs(), agenciaId));
    }
    return NextResponse.json(demoData.diretores());
  }

  const { createSupabaseServerClient } = await import("@/lib/supabase/server");
  const db = createSupabaseServerClient();
  const agenciaId = req.nextUrl.searchParams.get("agencia_id");

  let query = db
    .from("diretores")
    .select("*, mandatos (id, data_inicio, data_fim, cargo)")
    .order("nome", { ascending: true });

  if (agenciaId) query = query.eq("agencia_id", agenciaId);

  const { data, error } = await query;

  if (error) {
    return NextResponse.json({ error: "Erro ao buscar diretores" }, { status: 500 });
  }

  return NextResponse.json(data ?? []);
}

/**
 * POST /api/v1/diretores — cria um diretor (admin).
 * Usado pela tela /dashboard/diretores para gerenciar diretores e suas variantes de nome.
 */
export async function POST(req: NextRequest) {
  const guard = await requireAdmin(req);
  if (guard) return guard;

  const body = await req.json().catch(() => ({})) as Record<string, unknown>;
  const nome = String(body.nome ?? "").trim();
  const agenciaId = String(body.agencia_id ?? "").trim();
  if (!nome || !agenciaId) {
    return NextResponse.json({ error: "nome e agencia_id são obrigatórios" }, { status: 400 });
  }

  const row = {
    nome: nome.slice(0, 200),
    agencia_id: agenciaId,
    cargo: body.cargo ? String(body.cargo).slice(0, 100) : null,
    nome_variantes: sanitizeNomeVariantes(body.nome_variantes),
    situacao: typeof body.situacao === "string" && VALID_SITUACAO.has(body.situacao) ? body.situacao : "titular",
    ativo: body.ativo === false ? false : true,
    needs_review: Boolean(body.needs_review),
    fonte_dado: "manual",
  };

  const { createSupabaseServerClient } = await import("@/lib/supabase/server");
  const db = createSupabaseServerClient();
  const { data, error } = await db.from("diretores").insert(row).select("*").single();
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json(data, { status: 201 });
}
