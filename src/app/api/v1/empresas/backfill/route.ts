/**
 * POST /api/v1/empresas/backfill
 * Popula deliberacoes.empresa_id para registros existentes (interessado não-nulo,
 * empresa_id nulo), criando/normalizando empresas. Idempotente e paginado.
 */

import { NextRequest, NextResponse } from "next/server";
import { isDemo } from "@/lib/server/is-demo";
import { budgetFromRequest, hasBudget } from "@/lib/server/time-budget";
import { requireAdminOrCron } from "@/lib/server/request-guards";
import { resolveEmpresaId, type EmpresaCache } from "@/lib/server/empresa-resolver";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const guard = await requireAdminOrCron(req, "empresas/backfill");
  if (guard) return guard;
  if (isDemo()) return NextResponse.json({ deliberacoes_atualizadas: 0, demo: true });

  // Fase 10 — esta rota IGNORAVA o `budget_ms` que o orquestrador manda na URL. A esteira
  // encadeia ~12 sub-rotas na MESMA invocação repartindo um orçamento único; quem não lê a
  // própria fatia trabalha até acabar e a rodada estoura o relógio — foi o "passou de 90s sem
  // resposta" que a tela mostrou. Para no saldo e DIZ que ficou parcial, para o orquestrador
  // voltar na rodada seguinte.
  const deadlineAt = Date.now() + budgetFromRequest(req);
  /** Uma resolução de empresa + um UPDATE. */
  const RESERVA_POR_LINHA_MS = 600;

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

  let parcial = false;
  for (const d of (pendentes ?? []) as any[]) {
    if (!hasBudget(deadlineAt, RESERVA_POR_LINHA_MS)) { parcial = true; break; }
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
    // Parou no saldo: o orquestrador só volta na rodada seguinte se souber que sobrou.
    ...(parcial ? { parcial: true, restantes: true } : {}),
    deliberacoes_atualizadas: atualizadas,
    empresas_referenciadas: empresasCriadas,
    processados,
    // Há mais a processar se a página veio cheia.
    tem_mais: processados === limit,
  });
}
