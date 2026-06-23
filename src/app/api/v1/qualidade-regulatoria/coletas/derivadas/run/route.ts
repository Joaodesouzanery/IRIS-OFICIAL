/**
 * POST /api/v1/qualidade-regulatoria/coletas/derivadas/run
 * Gera evidências de qualidade DERIVADAS dos dados internos do IRIS (votação nominal,
 * pontualidade de publicação, cobertura de área, atividade, divergência).
 * Admin/cron. Idempotente: substitui apenas evidências de origem='derivada_dados'.
 */

import { NextRequest, NextResponse } from "next/server";
import { requireAdminOrCron } from "@/lib/server/request-guards";
import { collectDerivedEvidence } from "@/lib/server/qualidade-evidencias-coletor";

export const dynamic = "force-dynamic";

const ANO_RE = /^(20)\d{2}$/;

export async function POST(req: NextRequest) {
  const guard = await requireAdminOrCron(req, "qualidade/derivadas");
  if (guard) return guard;

  const body = await req.json().catch(() => ({})) as { ano?: number | string };
  const anoParam = String(body.ano ?? "");
  const ano = ANO_RE.test(anoParam) ? Number(anoParam) : new Date().getFullYear();

  const { createSupabaseServerClient } = await import("@/lib/supabase/server");
  const db = createSupabaseServerClient();

  const { evidencias, results } = await collectDerivedEvidence(db, { ano });

  let persistidas = 0;
  for (const ev of evidencias) {
    // Substitui a evidência derivada anterior dessa métrica (idempotente).
    await db
      .from("qualidade_regulatoria_evidencias")
      .delete()
      .eq("agencia_sigla", ev.agencia_sigla)
      .eq("criterio_id", ev.criterio_id)
      .eq("origem", "derivada_dados")
      .eq("metadata->>metric_key", ev.metric_key);

    const { error } = await db.from("qualidade_regulatoria_evidencias").insert({
      agencia_sigla: ev.agencia_sigla,
      criterio_id: ev.criterio_id,
      titulo: ev.titulo,
      url: null,
      fonte: "iris_dados_internos",
      trecho_publico: ev.trecho_publico,
      status_revisao: "pendente",
      origem: "derivada_dados",
      compliance_flags: { auto_collected: true, reviewed: false },
      metadata: { ...ev.metadata, metric_key: ev.metric_key },
    });
    if (!error) persistidas++;
    else console.warn("[qualidade/derivadas] insert falhou:", error.message);
  }

  // Registra a execução por agência em qualidade_regulatoria_coletas.
  const coletaRows = results.map((r) => ({
    agencia_sigla: r.agencia_sigla,
    criterio_id: null,
    fonte_id: null,
    status: r.status,
    dados_brutos: { origem: "derivada_dados", ano, evidencias: r.evidencias },
    evidencias_detectadas: [],
    warnings: r.warnings,
    compliance_status: "pendente_revisao",
  }));
  if (coletaRows.length) await db.from("qualidade_regulatoria_coletas").insert(coletaRows);

  return NextResponse.json({
    ano,
    evidencias_geradas: persistidas,
    agencias: results.map((r) => r.agencia_sigla),
    results,
    legal_notice: "Evidências derivadas de dados internos do IRIS, marcadas como pendentes até revisão humana. Não atribuem nota automaticamente.",
  });
}
