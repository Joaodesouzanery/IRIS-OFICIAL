/**
 * POST /api/v1/empresas/backfill
 * Popula deliberacoes.empresa_id para registros existentes (interessado não-nulo,
 * empresa_id nulo), criando/normalizando empresas. Idempotente e paginado.
 */

import { NextRequest, NextResponse } from "next/server";
import { isDemo } from "@/lib/server/is-demo";
import { requireAdminOrCron } from "@/lib/server/request-guards";
import { resolveEmpresaId, type EmpresaCache } from "@/lib/server/empresa-resolver";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const guard = await requireAdminOrCron(req, "empresas/backfill");
  if (guard) return guard;
  if (isDemo()) return NextResponse.json({ deliberacoes_atualizadas: 0, demo: true });

  const limit = Math.min(500, Math.max(1, parseInt(req.nextUrl.searchParams.get("limit") ?? "300", 10)));

  const { createSupabaseServerClient } = await import("@/lib/supabase/server");
  const db = createSupabaseServerClient();

  const { data: pendentes, error } = await db
    .from("deliberacoes")
    .select("id, agencia_id, interessado, microtema")
    .not("interessado", "is", null)
    .is("empresa_id", null)
    .limit(limit);

  if (error) {
    return NextResponse.json({ error: "Erro ao buscar deliberações pendentes" }, { status: 500 });
  }

  const cache: EmpresaCache = new Map();
  let atualizadas = 0;
  let empresasCriadas = 0;
  const empresasVistas = new Set<string>();

  for (const d of (pendentes ?? []) as any[]) {
    if (!d.agencia_id || !d.interessado) continue;
    const empresaId = await resolveEmpresaId(db, d.interessado, d.agencia_id, { cache, setor: d.microtema });
    if (!empresaId) continue;
    if (!empresasVistas.has(empresaId)) empresasVistas.add(empresaId);
    const { error: upErr } = await db.from("deliberacoes").update({ empresa_id: empresaId }).eq("id", d.id);
    if (!upErr) atualizadas++;
  }
  empresasCriadas = empresasVistas.size;

  const processados = (pendentes ?? []).length;
  return NextResponse.json({
    deliberacoes_atualizadas: atualizadas,
    empresas_referenciadas: empresasCriadas,
    processados,
    // Há mais a processar se a página veio cheia.
    tem_mais: processados === limit,
  });
}
