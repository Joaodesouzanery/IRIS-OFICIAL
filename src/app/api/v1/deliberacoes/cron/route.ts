import { NextRequest, NextResponse } from "next/server";
import { requireCron } from "@/lib/server/request-guards";

export const dynamic = "force-dynamic";

/**
 * Cron diário do pipeline de votos. Executa em sequência os workers já existentes,
 * repassando o header de autorização do cron:
 *   1. monitoramento/check  → detecta documentos novos e auto-enfileira PDFs
 *   2. upload/process       → extrai texto e sugere votos (status review_pending)
 *   3. upload/auto-confirm  → grava votos automaticamente quando alta confiança
 * Os casos de baixa confiança permanecem em review_pending para revisão humana.
 */
export async function GET(req: NextRequest) {
  const guard = requireCron(req);
  if (guard) return guard;

  const authorization = req.headers.get("authorization") ?? "";

  const callWorker = async (pathname: string, method: "GET" | "POST", body?: Record<string, unknown>) => {
    const url = req.nextUrl.clone();
    url.pathname = pathname;
    url.search = "";
    try {
      const res = await fetch(url, {
        method,
        headers: method === "POST"
          ? { "content-type": "application/json", authorization }
          : { authorization },
        body: method === "POST" ? JSON.stringify(body ?? {}) : undefined,
      });
      const data = await res.json().catch(() => ({}));
      return { path: pathname, ok: res.ok, status: res.status, data };
    } catch (error) {
      return { path: pathname, ok: false, status: 0, error: error instanceof Error ? error.message : "falha" };
    }
  };

  // Sequencial: cada passo depende do anterior.
  const check = await callWorker("/api/v1/monitoramento/check", "GET"); // handler é GET-only
  const process = await callWorker("/api/v1/upload/process", "GET");
  const autoConfirm = await callWorker("/api/v1/upload/auto-confirm", "POST", {});

  const allOk = check.ok && process.ok && autoConfirm.ok;

  return NextResponse.json(
    { ok: allOk, steps: { check, process, auto_confirm: autoConfirm } },
    { status: allOk ? 200 : 207, headers: { "x-iris-votos-cron": "1" } },
  );
}
