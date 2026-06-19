import { NextRequest, NextResponse } from "next/server";
import { requireCron } from "@/lib/server/request-guards";
import { QUALIDADE_AGENCIAS } from "@/lib/server/qualidade-regulatoria";
import { recomputeAndPersistDiagnostics } from "@/lib/server/qualidade-regulatoria-service";

export const dynamic = "force-dynamic";

/**
 * Cron semanal de Qualidade Regulatória (segunda de manhã).
 * Dispara a coleta por agência em paralelo (cada chamada cobre as ~10 fontes daquela agência,
 * offset/limit de 30 por chamada) e, ao final, persiste o recálculo de scores no diagnóstico.
 */
export async function GET(req: NextRequest) {
  const guard = requireCron(req);
  if (guard) return guard;

  const authorization = req.headers.get("authorization") ?? "";
  const year = Number(req.nextUrl.searchParams.get("ano") ?? new Date().getFullYear());

  const runForAgency = async (sigla: string) => {
    const url = req.nextUrl.clone();
    url.pathname = "/api/v1/qualidade-regulatoria/coletas/run";
    url.search = "";
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json", authorization },
        body: JSON.stringify({ agencia_sigla: sigla, offset: 0, limit: 30 }),
      });
      const data = await res.json().catch(() => ({} as Record<string, unknown>));
      return {
        sigla,
        ok: res.ok,
        processed: Number(data.processed ?? 0),
        auto_revisao: Number(data.auto_revisao ?? 0),
        falhas_rede: Number(data.falhas_rede ?? 0),
        falhas_conteudo: Number(data.falhas_conteudo ?? 0),
      };
    } catch (error) {
      return { sigla, ok: false, error: error instanceof Error ? error.message : "falha" };
    }
  };

  const coletas = await Promise.all(QUALIDADE_AGENCIAS.map((agencia) => runForAgency(agencia.sigla)));
  const diagnosticos = await recomputeAndPersistDiagnostics(year);

  return NextResponse.json(
    { ok: true, year, coletas, diagnosticos },
    { headers: { "x-iris-qualidade-cron": "1" } },
  );
}
