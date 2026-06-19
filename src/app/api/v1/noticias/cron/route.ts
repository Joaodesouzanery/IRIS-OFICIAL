import { NextRequest, NextResponse } from "next/server";
import { requireCron } from "@/lib/server/request-guards";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const guard = requireCron(req);
  if (guard) return guard;

  // Permite que o agendamento defina o recorte (tier/scope/limit) via querystring do cron.
  const params = req.nextUrl.searchParams;
  const tier = params.get("tier") ?? "all";        // core | expanded | all
  const scope = params.get("scope") ?? "all";
  const limit = params.get("limit") ?? "8";
  const mode = params.get("mode") ?? "enrich";

  const url = req.nextUrl.clone();
  url.pathname = "/api/v1/noticias/coletar";
  url.search = `?automatic=1&scope=${encodeURIComponent(scope)}&tier=${encodeURIComponent(tier)}&limit=${encodeURIComponent(limit)}&mode=${encodeURIComponent(mode)}`;

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
