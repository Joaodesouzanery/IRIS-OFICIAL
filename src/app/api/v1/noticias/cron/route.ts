import { NextRequest, NextResponse } from "next/server";
import { requireCron } from "@/lib/server/request-guards";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 120;

// Fan-out por fonte: uma sub-coleta INDEPENDENTE por agência (cada uma na sua própria
// função serverless de 120s), com concorrência limitada. Cobre as 12 fontes no MESMO
// dia — antes a coleta automática visitava só 2 das 10 "expanded" por run (rotação de
// ~5 dias), então notícias sumiam. Educado com o gov.br (mesmo host): 4 por vez.
const FANOUT_CONCURRENCY = 4;
const PER_SOURCE_TIMEOUT_MS = 25_000;

export async function GET(req: NextRequest) {
  const guard = requireCron(req);
  if (guard) return guard;

  const base = req.nextUrl.clone();
  base.pathname = "/api/v1/noticias/coletar";
  const auth = req.headers.get("authorization") ?? "";

  // Descobre as siglas ativas de notícias. Se a leitura falhar, cai para o comportamento
  // antigo (uma coleta automática única) — degrada sem derrubar o cron.
  let siglas: string[] = [];
  try {
    const { createSupabaseServerClient } = await import("@/lib/supabase/server");
    const db = createSupabaseServerClient();
    const { data: sites } = await db
      .from("monitoramento_sites")
      .select("agencia:agencias(sigla)")
      .eq("tipo_fonte", "noticias")
      .eq("ativo", true);
    siglas = [...new Set(
      (sites ?? [])
        .map((s: any) => (Array.isArray(s.agencia) ? s.agencia[0] : s.agencia)?.sigla)
        .filter((x: unknown): x is string => typeof x === "string" && x.length > 0),
    )];
  } catch {
    siglas = [];
  }

  if (siglas.length === 0) {
    const url = base.clone();
    url.search = "?automatic=1&scope=all&tier=all&limit=8&mode=enrich";
    const response = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: auth },
      body: "{}",
    });
    const body = await response.text();
    return new NextResponse(body, {
      status: response.status,
      headers: { "content-type": response.headers.get("content-type") ?? "application/json; charset=utf-8", "x-iris-news-cron": "fallback" },
    });
  }

  async function collectOne(sigla: string) {
    const url = base.clone();
    url.search = `?automatic=1&mode=enrich&agencia_sigla=${encodeURIComponent(sigla)}&limit=10`;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), PER_SOURCE_TIMEOUT_MS);
    try {
      const r = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: auth },
        body: "{}",
        signal: controller.signal,
      });
      return { sigla, status: r.status };
    } catch (err) {
      return { sigla, status: 0, error: err instanceof Error ? err.message : "erro" };
    } finally {
      clearTimeout(timeout);
    }
  }

  const queue = [...siglas];
  const resultados: Array<{ sigla: string; status: number; error?: string }> = [];
  const workers = Array.from({ length: Math.min(FANOUT_CONCURRENCY, queue.length) }, async () => {
    while (queue.length) {
      const sigla = queue.shift();
      if (!sigla) break;
      resultados.push(await collectOne(sigla));
    }
  });
  await Promise.all(workers);

  const ok = resultados.filter((r) => r.status >= 200 && r.status < 300).length;
  return new NextResponse(
    JSON.stringify({ fan_out: true, fontes: siglas.length, ok, resultados }),
    { status: 200, headers: { "content-type": "application/json; charset=utf-8", "x-iris-news-cron": "fanout" } },
  );
}
