/**
 * GET /api/v1/newsletter/eventos
 * Próximos eventos do IRIS (auto-fetch de irisregulacao.org/eventos/) para a seção de eventos
 * da newsletter. Read-only, admin (o middleware já gateia GET /api/v1/*). Nunca 500 — degrade → [].
 */

import { NextRequest, NextResponse } from "next/server";
import { isDemo } from "@/lib/server/is-demo";
import { isDemoRequest, requireAdmin } from "@/lib/server/request-guards";
import { fetchIrisEventos } from "@/lib/server/iris-eventos";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

export async function GET(req: NextRequest) {
  if (isDemo() || isDemoRequest(req)) {
    return NextResponse.json({ eventos: [] });
  }
  const guard = await requireAdmin(req);
  if (guard) return guard;

  const eventos = await fetchIrisEventos(4);
  return NextResponse.json({ eventos });
}
