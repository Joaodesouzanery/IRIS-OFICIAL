import { NextRequest, NextResponse } from "next/server";
import { requireCron } from "@/lib/server/request-guards";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

// Coleta automática diária (1 chamada leve — cabe nos 60s do plano Hobby). No plano
// grátis a Vercel agenda no máximo ~2 crons/dia; o fan-out por fonte (Etapa 20) foi
// revertido porque estourava os 60s. A cobertura COMPLETA das 12 fontes é feita sob
// demanda pelo botão "Coletar Notícias" da tela (que itera as expanded). Ver
// docs/PENDENCIAS.md: no PRO, restaurar o fan-out + os 8 crons.
export async function GET(req: NextRequest) {
  const guard = requireCron(req);
  if (guard) return guard;

  const url = req.nextUrl.clone();
  url.pathname = "/api/v1/noticias/coletar";
  url.search = "?automatic=1&scope=all&tier=all&limit=8&mode=enrich";

  const response = await fetch(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: req.headers.get("authorization") ?? "",
    },
    body: "{}",
  });

  const body = await response.text();
  return new NextResponse(body, {
    status: response.status,
    headers: {
      "content-type": response.headers.get("content-type") ?? "application/json; charset=utf-8",
      "x-iris-news-cron": "1",
    },
  });
}
