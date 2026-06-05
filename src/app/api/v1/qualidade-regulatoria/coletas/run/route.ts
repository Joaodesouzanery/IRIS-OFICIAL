import { NextRequest, NextResponse } from "next/server";
import { requireAdminOrCron } from "@/lib/server/request-guards";
import {
  QUALIDADE_AGENCIAS,
  QUALIDADE_CRITERIOS,
  QUALIDADE_FONTES,
  sanitizeEvidenceText,
} from "@/lib/server/qualidade-regulatoria";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

type CollectionResult = {
  agencia_sigla: string;
  fonte_id: string;
  criterio_id: number | null;
  status: "sucesso" | "falha" | "restrito" | "parcial";
  warnings: string[];
  url: string;
  title?: string | null;
};

export async function POST(req: NextRequest) {
  const guard = await requireAdminOrCron(req);
  if (guard) return guard;

  const body = await req.json().catch(() => ({})) as { agencia_sigla?: string; offset?: number; limit?: number };
  const agencyFilter = body.agencia_sigla?.trim().toUpperCase();
  const tasks = buildTasks(agencyFilter);
  const offset = Math.max(0, Number(body.offset ?? 0));
  const limit = Math.min(30, Math.max(1, Number(body.limit ?? 24)));
  const slice = tasks.slice(offset, offset + limit);

  const results: CollectionResult[] = [];
  for (const task of slice) {
    results.push(await collectTask(task.agencia, task.fonte));
  }

  await persistResults(results).catch((error) => {
    console.warn("[qualidade-regulatoria/coletas] Falha ao persistir resultados:", error instanceof Error ? error.message : error);
  });

  return NextResponse.json({
    processed: results.length,
    total: tasks.length,
    next_offset: offset + limit < tasks.length ? offset + limit : null,
    partial_success: results.some((item) => item.status === "sucesso" || item.status === "parcial"),
    results,
    legal_notice: "Coleta segura: não armazena HTML bruto e remove dados pessoais detectáveis antes de registrar evidências.",
  });
}

function buildTasks(agencyFilter?: string) {
  const agencies = agencyFilter ? QUALIDADE_AGENCIAS.filter((item) => item.sigla === agencyFilter) : QUALIDADE_AGENCIAS;
  return agencies.flatMap((agencia) => QUALIDADE_FONTES.map((fonte) => ({ agencia, fonte })));
}

async function collectTask(agencia: (typeof QUALIDADE_AGENCIAS)[number], fonte: (typeof QUALIDADE_FONTES)[number]): Promise<CollectionResult> {
  if (fonte.requer_chave && fonte.id === "portal_transparencia_federal" && !process.env.TRANSPARENCIA_API_KEY) {
    return {
      agencia_sigla: agencia.sigla,
      fonte_id: fonte.id,
      criterio_id: fonte.criterios_relacionados[0] ?? null,
      status: "restrito",
      warnings: ["Fonte exige chave TRANSPARENCIA_API_KEY. Pendência registrada sem contornar restrição."],
      url: fonte.url,
      title: null,
    };
  }

  const url = fonte.id === "site_agencia" ? agencia.site_oficial : fonte.url;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);
  try {
    const response = await fetch(url, {
      method: "GET",
      signal: controller.signal,
      headers: { "User-Agent": "IRIS-Qualidade-Regulatoria/1.0 coleta institucional" },
    });
    const contentType = response.headers.get("content-type") ?? "";
    const text = contentType.includes("text") || contentType.includes("html")
      ? sanitizeEvidenceText(await response.text())
      : "";
    const title = text.match(/<title[^>]*>(.*?)<\/title>/i)?.[1]?.replace(/\s+/g, " ").trim() ?? null;
    return {
      agencia_sigla: agencia.sigla,
      fonte_id: fonte.id,
      criterio_id: fonte.criterios_relacionados[0] ?? null,
      status: response.ok ? "sucesso" : "parcial",
      warnings: response.ok ? [] : [`HTTP ${response.status}`],
      url,
      title: title ? sanitizeEvidenceText(title) : fonte.nome,
    };
  } catch (error) {
    return {
      agencia_sigla: agencia.sigla,
      fonte_id: fonte.id,
      criterio_id: fonte.criterios_relacionados[0] ?? null,
      status: "falha",
      warnings: [error instanceof Error ? error.message : "Falha de coleta"],
      url,
      title: null,
    };
  } finally {
    clearTimeout(timer);
  }
}

async function persistResults(results: CollectionResult[]) {
  const db = createSupabaseServerClient();
  const rows = results.map((item) => ({
    agencia_sigla: item.agencia_sigla,
    criterio_id: item.criterio_id,
    fonte_id: item.fonte_id,
    status: item.status,
    dados_brutos: {
      url: item.url,
      title: item.title,
      html_raw_stored: false,
      lgpd_lai_guardrails: true,
    },
    evidencias_detectadas: item.title ? [{ titulo: item.title, url: item.url, status_revisao: "pendente" }] : [],
    warnings: item.warnings,
    compliance_status: "pendente_revisao",
  }));
  if (rows.length) await db.from("qualidade_regulatoria_coletas").insert(rows);

  const evidenceRows = results
    .filter((item) => item.title && item.criterio_id)
    .map((item) => ({
      agencia_sigla: item.agencia_sigla,
      criterio_id: item.criterio_id!,
      titulo: item.title!,
      url: item.url,
      fonte: item.fonte_id,
      trecho_publico: item.title!,
      status_revisao: "pendente",
      compliance_flags: { auto_collected: true, reviewed: false },
    }));
  if (evidenceRows.length) await db.from("qualidade_regulatoria_evidencias").insert(evidenceRows);
}
