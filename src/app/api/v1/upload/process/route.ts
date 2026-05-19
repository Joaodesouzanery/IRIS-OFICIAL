/**
 * POST/GET /api/v1/upload/process
 * Processa uma fatia da fila de upload.
 */

import { NextRequest, NextResponse } from "next/server";
import { requireAdminOrCron } from "@/lib/server/request-guards";
import { isDemo } from "@/lib/server/is-demo";

export async function POST(req: NextRequest) {
  return process(req);
}

export async function GET(req: NextRequest) {
  return process(req);
}

async function process(req: NextRequest) {
  const guard = await requireAdminOrCron(req);
  if (guard) return guard;

  if (isDemo()) {
    return NextResponse.json({ error: "Processamento real indisponivel em modo DEMO." }, { status: 403 });
  }

  const limit = Number(req.nextUrl.searchParams.get("limit") ?? "20");
  const { processPendingDocuments } = await import("@/lib/server/pipeline");
  const result = await processPendingDocuments(Number.isFinite(limit) ? limit : 5);
  return NextResponse.json(result);
}
