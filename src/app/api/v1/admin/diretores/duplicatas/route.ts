/**
 * GET /api/v1/admin/diretores/duplicatas[?agencia_id=...]
 * Auditoria de diretores possivelmente duplicados no cadastro (pares fuzzy
 * ≥0.85 por agência), com contagem de votos de cada lado para orientar o merge.
 * Consumida pelo card "Diretores possivelmente duplicados" (votos-diretores) e
 * pelos alertas do saude-dados. Somente leitura.
 */

import { NextRequest, NextResponse } from "next/server";
import { isDemo } from "@/lib/server/is-demo";
import { isDemoRequest, requireAdminOrCron } from "@/lib/server/request-guards";
import { findDiretorDuplicatas } from "@/lib/server/diretor-duplicatas";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  if (isDemo() || isDemoRequest(req)) {
    return NextResponse.json({ pares: [], demo: true });
  }
  const guard = await requireAdminOrCron(req);
  if (guard) return guard;

  const { createSupabaseServerClient } = await import("@/lib/supabase/server");
  const db = createSupabaseServerClient();

  const pares = await findDiretorDuplicatas(db, {
    agenciaId: req.nextUrl.searchParams.get("agencia_id"),
  });

  // Contagem de votos por diretor envolvido (orienta qual lado manter).
  const ids = [...new Set(pares.flatMap((p) => [p.keep.id, p.dup.id]))];
  if (ids.length > 0) {
    const { data: votos } = await db
      .from("votos")
      .select("diretor_id")
      .in("diretor_id", ids)
      .limit(50000);
    const contagem = new Map<string, number>();
    for (const v of votos ?? []) {
      contagem.set(v.diretor_id, (contagem.get(v.diretor_id) ?? 0) + 1);
    }
    for (const p of pares) {
      p.keep.votos = contagem.get(p.keep.id) ?? 0;
      p.dup.votos = contagem.get(p.dup.id) ?? 0;
    }
  }

  return NextResponse.json({ pares });
}
