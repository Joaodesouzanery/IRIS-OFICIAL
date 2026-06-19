import { NextRequest, NextResponse } from "next/server";
import { requireAdminOrCron } from "@/lib/server/request-guards";
import {
  QUALIDADE_AGENCIAS,
  QUALIDADE_FONTES,
  sanitizeEvidenceText,
} from "@/lib/server/qualidade-regulatoria";
import { FetchFailureError, resilientFetch } from "@/lib/server/resilient-fetch";
import { tryRenderHtmlFallback } from "@/lib/server/headless";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

type CollectionStatus = "sucesso" | "restrito" | "falha_rede" | "falha_conteudo";

type CollectionResult = {
  agencia_sigla: string;
  fonte_id: string;
  criterio_id: number | null;
  status: CollectionStatus;
  warnings: string[];
  url: string;
  title?: string | null;
  confidence: number;
  evidence_source: "og:image" | "h1" | "title" | null;
  reliable_source: boolean;
};

/** Limiar de auto-validação: evidências de alta confiança vão direto para revisão humana. */
const AUTO_REVIEW_CONFIDENCE = 80;

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
    partial_success: results.some((item) => item.status === "sucesso"),
    auto_revisao: results.filter((item) => item.confidence >= AUTO_REVIEW_CONFIDENCE && item.reliable_source).length,
    falhas_rede: results.filter((item) => item.status === "falha_rede").length,
    falhas_conteudo: results.filter((item) => item.status === "falha_conteudo").length,
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
      confidence: 0,
      evidence_source: null,
      reliable_source: false,
    };
  }

  const url = fonte.id === "site_agencia" ? agencia.site_oficial : fonte.url;
  try {
    const response = await resilientFetch(url, {
      timeoutMs: 8000,
      retries: 2,
      label: "qualidade-coleta",
      headers: { "User-Agent": "IRIS-Qualidade-Regulatoria/1.0 coleta institucional" },
    });
    const contentType = response.headers.get("content-type") ?? "";
    const isHtml = contentType.includes("text") || contentType.includes("html");
    const html = isHtml ? await response.text() : "";
    return buildSuccessResult(agencia, fonte, url, html);
  } catch (error) {
    const kind = error instanceof FetchFailureError ? error.kind : "falha_rede";
    // Falha de rede (403/timeout): tenta renderização headless como fallback.
    if (kind === "falha_rede") {
      const rendered = await tryRenderHtmlFallback(url, "qualidade-coleta");
      if (rendered) return buildSuccessResult(agencia, fonte, url, rendered);
    }
    return {
      agencia_sigla: agencia.sigla,
      fonte_id: fonte.id,
      criterio_id: fonte.criterios_relacionados[0] ?? null,
      status: kind,
      warnings: [error instanceof Error ? error.message : "Falha de coleta"],
      url,
      title: null,
      confidence: 0,
      evidence_source: null,
      reliable_source: false,
    };
  }
}

function buildSuccessResult(
  agencia: (typeof QUALIDADE_AGENCIAS)[number],
  fonte: (typeof QUALIDADE_FONTES)[number],
  url: string,
  html: string,
): CollectionResult {
  const meta = extractEvidenceMeta(html);
  const bestTitle = meta.title ?? meta.ogTitle ?? meta.h1 ?? fonte.nome;
  const reliableSource = Boolean(meta.ogImage || (meta.h1 && meta.h1.length >= 8));
  const evidenceSource: CollectionResult["evidence_source"] = meta.ogImage
    ? "og:image"
    : meta.h1 && meta.h1.length >= 8
      ? "h1"
      : meta.title || meta.ogTitle
        ? "title"
        : null;
  const confidence = computeEvidenceConfidence({
    httpOk: true,
    ogImage: Boolean(meta.ogImage),
    h1: Boolean(meta.h1 && meta.h1.length >= 8),
    title: Boolean(meta.title || meta.ogTitle),
  });
  return {
    agencia_sigla: agencia.sigla,
    fonte_id: fonte.id,
    criterio_id: fonte.criterios_relacionados[0] ?? null,
    status: "sucesso",
    warnings: [],
    url,
    title: bestTitle ? sanitizeEvidenceText(bestTitle) : fonte.nome,
    confidence,
    evidence_source: evidenceSource,
    reliable_source: reliableSource,
  };
}

/** Extrai metadados públicos de identificação da página (sem dados pessoais). */
function extractEvidenceMeta(html: string) {
  if (!html) return { title: null, ogTitle: null, ogImage: null, h1: null };
  const title = matchClean(html, /<title[^>]*>([\s\S]*?)<\/title>/i);
  const ogTitle = matchAttr(html, /<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i)
    ?? matchAttr(html, /<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:title["']/i);
  const ogImage = matchAttr(html, /<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i)
    ?? matchAttr(html, /<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image["']/i);
  const h1 = matchClean(html, /<h1[^>]*>([\s\S]*?)<\/h1>/i);
  return { title, ogTitle, ogImage, h1 };
}

function matchClean(html: string, re: RegExp): string | null {
  const raw = re.exec(html)?.[1];
  if (!raw) return null;
  const text = raw.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
  return text || null;
}

function matchAttr(html: string, re: RegExp): string | null {
  const raw = re.exec(html)?.[1];
  const text = raw?.trim();
  return text || null;
}

function computeEvidenceConfidence(signals: { httpOk: boolean; ogImage: boolean; h1: boolean; title: boolean }) {
  let score = 0;
  if (signals.httpOk) score += 40;
  if (signals.ogImage) score += 25;
  if (signals.h1) score += 25;
  if (signals.title) score += 15;
  return Math.min(100, score);
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
      confidence: item.confidence,
      evidence_source: item.evidence_source,
      html_raw_stored: false,
      lgpd_lai_guardrails: true,
    },
    evidencias_detectadas: item.title
      ? [{ titulo: item.title, url: item.url, status_revisao: evidenceStatus(item), confidence: item.confidence }]
      : [],
    warnings: item.warnings,
    compliance_status: "pendente_revisao",
  }));
  if (rows.length) await db.from("qualidade_regulatoria_coletas").insert(rows);

  const evidenceRows = results
    .filter((item) => item.status === "sucesso" && item.title && item.criterio_id)
    .map((item) => ({
      agencia_sigla: item.agencia_sigla,
      criterio_id: item.criterio_id!,
      titulo: item.title!,
      url: item.url,
      fonte: item.fonte_id,
      trecho_publico: item.title!,
      status_revisao: evidenceStatus(item),
      compliance_flags: {
        auto_collected: true,
        reviewed: false,
        confidence: item.confidence,
        evidence_source: item.evidence_source,
      },
    }));
  if (evidenceRows.length) await db.from("qualidade_regulatoria_evidencias").insert(evidenceRows);
}

/**
 * Evidências de alta confiança e fonte confiável (og:image/h1) entram já em "em_revisao"
 * (humano segue como última barreira); as demais ficam "pendente".
 */
function evidenceStatus(item: CollectionResult): "pendente" | "em_revisao" {
  return item.confidence >= AUTO_REVIEW_CONFIDENCE && item.reliable_source ? "em_revisao" : "pendente";
}
