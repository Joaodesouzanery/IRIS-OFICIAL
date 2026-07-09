/**
 * POST /api/v1/diretores/merge  { keep_id, merge_id }
 * Funde dois cadastros do MESMO diretor (duplicata): reaponta votos (sem violar
 * a unique (deliberacao_id, diretor_id) — onde os dois votaram, prevalece o do
 * keep), mandatos e candidatos; aprende o nome do duplicado como variante; e
 * remove o cadastro duplicado. Admin explícito — ação irreversível.
 */

import { NextRequest, NextResponse } from "next/server";
import { isDemo } from "@/lib/server/is-demo";
import { requireAdmin } from "@/lib/server/request-guards";
import { mergeDiretores } from "@/lib/server/diretor-merge";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const guard = await requireAdmin(req);
  if (guard) return guard;
  if (isDemo()) {
    return NextResponse.json({ error: "Indisponível em modo DEMO." }, { status: 403 });
  }

  const body = (await req.json().catch(() => ({}))) as { keep_id?: string; merge_id?: string };
  const keepId = body.keep_id?.trim();
  const mergeId = body.merge_id?.trim();
  if (!keepId || !mergeId || keepId === mergeId) {
    return NextResponse.json({ error: "Informe keep_id e merge_id distintos." }, { status: 400 });
  }

  const { createSupabaseServerClient } = await import("@/lib/supabase/server");
  const db = createSupabaseServerClient();

  try {
    const result = await mergeDiretores(db, keepId, mergeId);
    return NextResponse.json(result);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Erro ao fundir diretores.";
    const status = msg.includes("não encontrados") ? 404 : msg.includes("mesma agência") || msg.includes("distintos") ? 400 : 500;
    return NextResponse.json({ error: msg }, { status });
  }
}
