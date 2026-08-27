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
  // Orçamento (QA ago/2026): sem deadline, 20 PDFs × até 65s (pdf-parse+OCR) estourava o
  // SIGKILL de 60s do Hobby — a rota morria sem responder e a esteira "concluía" com 0.
  // budget_ms opcional (a pipeline passa fatias menores); default = orçamento Hobby.
  const { HOBBY_BUDGET_MS } = await import("@/lib/server/time-budget");
  const budgetParam = Number(req.nextUrl.searchParams.get("budget_ms"));
  const budgetMs = Number.isFinite(budgetParam) && budgetParam > 0
    ? Math.min(budgetParam, HOBBY_BUDGET_MS)
    : HOBBY_BUDGET_MS;
  // `apenas_reaper=1` roda só os três reapers de documento preso e volta. A esteira usa este modo
  // num passo BARATO e cedo na rodada: reparar custa ~2s por documento, extrair custa até 20s, e
  // enquanto os dois moraram no mesmo passo os presos herdaram o preço da extração — 62 deles
  // ficaram parados em `queued` por 26 rodadas.
  const apenasReaper = req.nextUrl.searchParams.get("apenas_reaper") === "1";
  const { processPendingDocuments } = await import("@/lib/server/pipeline");
  const result = await processPendingDocuments(
    Number.isFinite(limit) ? limit : 5,
    Date.now() + budgetMs,
    { apenasReaper },
  );
  return NextResponse.json(result);
}
