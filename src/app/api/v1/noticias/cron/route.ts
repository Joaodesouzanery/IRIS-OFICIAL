import { NextRequest, NextResponse } from "next/server";
import { requireCron } from "@/lib/server/request-guards";

export const dynamic = "force-dynamic";

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
