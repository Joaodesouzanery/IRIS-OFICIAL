/**
 * POST /api/v1/qualidade-regulatoria/coletas/classificar/run
 * Auto-classificação de maturidade (Matriz IMQN): para cada agência × dimensão propõe
 * um nível (Inexistente→Melhoria Contínua) a partir dos dados do IRIS, gravando
 * `qualidade_regulatoria_avaliacoes` com status_revisao='preliminar' (revisável).
 * NÃO sobrescreve avaliações validadas/manuais. Admin/cron. Idempotente por (agência,ano,dimensão).
 */

import { NextRequest, NextResponse } from "next/server";
import { requireAdminOrCron } from "@/lib/server/request-guards";
import { classifyMaturidade } from "@/lib/server/qualidade-maturidade-classifier";
import { collectSiteSignals } from "@/lib/server/qualidade-site-coletor";
import { QUALIDADE_AGENCIAS } from "@/lib/server/qualidade-regulatoria";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

const ANO_RE = /^(20)\d{2}$/;

export async function POST(req: NextRequest) {
  const guard = await requireAdminOrCron(req, "qualidade/classificar");
  if (guard) return guard;

  const body = (await req.json().catch(() => ({}))) as { ano?: number | string; agencia_sigla?: string };
  const anoParam = String(body.ano ?? "");
  const ano = ANO_RE.test(anoParam) ? Number(anoParam) : new Date().getFullYear();
  const agencyFilter = typeof body.agencia_sigla === "string" ? body.agencia_sigla.trim().toUpperCase() : null;

  const { createSupabaseServerClient } = await import("@/lib/supabase/server");
  const db = createSupabaseServerClient();

  // Enriquece com sinais dos SITES: busca o portal de cada agência e detecta as seções
  // por dimensão (Agenda/AIR/ARR/Consultas/Estoque). Throttled; falha degrada p/ vazio.
  const agenciasSite = (agencyFilter ? QUALIDADE_AGENCIAS.filter((a) => a.sigla === agencyFilter) : QUALIDADE_AGENCIAS)
    .map((a) => ({ sigla: a.sigla, site_oficial: a.site_oficial }));
  const siteSignals = await collectSiteSignals(agenciasSite);

  const { propostas, resultados } = await classifyMaturidade(db, { ano, siteSignals });

  // Não clobbra o que já foi revisado por humano: pula (agência|dimensão) já validado/em revisão/manual.
  const { data: existentes } = await db
    .from("qualidade_regulatoria_avaliacoes")
    .select("agencia_sigla, criterio_id, status_revisao, fonte_avaliacao")
    .eq("ano", ano);
  const protegidas = new Set(
    (existentes ?? [])
      .filter((r: any) => ["validado", "em_revisao"].includes(r.status_revisao) || r.fonte_avaliacao === "manual")
      .map((r: any) => `${r.agencia_sigla}|${r.criterio_id}`),
  );

  let avaliacoes = 0;
  let evidencias = 0;
  let erros = 0;
  for (const p of propostas) {
    if (protegidas.has(`${p.agencia_sigla}|${p.criterio_id}`)) continue;

    const { error: avError } = await db.from("qualidade_regulatoria_avaliacoes").upsert(
      {
        agencia_sigla: p.agencia_sigla,
        ano,
        criterio_id: p.criterio_id,
        nota: p.nota,
        nivel: p.nivel,
        observacao: p.observacao,
        fonte_avaliacao: "iris_auto_classificacao",
        status_revisao: "preliminar",
        evidencias_count: p.evidencias.length,
        metadata: { auto_classificacao: true, amostra_n: p.amostra_n, gerado_em: new Date().toISOString() },
      },
      { onConflict: "agencia_sigla,ano,criterio_id" },
    );
    if (avError) {
      erros++;
      console.warn("[qualidade/classificar] avaliacao falhou:", avError.message);
      continue;
    }
    avaliacoes++;

    // Evidência-resumo da dimensão (idempotente: substitui a auto-classificação anterior).
    const metricKey = `maturidade_auto_${ano}`;
    await db
      .from("qualidade_regulatoria_evidencias")
      .delete()
      .eq("agencia_sigla", p.agencia_sigla)
      .eq("criterio_id", p.criterio_id)
      .eq("origem", "derivada_dados")
      .eq("metadata->>metric_key", metricKey);

    const { error: evError } = await db.from("qualidade_regulatoria_evidencias").insert({
      agencia_sigla: p.agencia_sigla,
      criterio_id: p.criterio_id,
      titulo: `Auto-classificação: ${p.observacao.slice(0, 120)}`,
      url: p.evidencias[0]?.url ?? null,
      fonte: "iris_auto_classificacao",
      trecho_publico: p.evidencias.map((e) => `• ${e.titulo}`).join(" ") || "Sem itens públicos associados nos dados do IRIS.",
      status_revisao: "pendente",
      origem: "derivada_dados",
      compliance_flags: { auto_collected: true, reviewed: false },
      metadata: { metric_key: metricKey, nivel: p.nivel, nota: p.nota, amostra_n: p.amostra_n, evidencias: p.evidencias },
    });
    if (!evError) evidencias++;
  }

  const coletaRows = resultados.map((r) => ({
    agencia_sigla: r.agencia_sigla,
    criterio_id: null,
    fonte_id: null,
    status: r.status,
    dados_brutos: { origem: "maturidade_auto", ano, dimensoes: r.dimensoes_classificadas },
    evidencias_detectadas: [],
    warnings: r.warnings,
    compliance_status: "pendente_revisao",
  }));
  if (coletaRows.length) await db.from("qualidade_regulatoria_coletas").insert(coletaRows);

  return NextResponse.json({
    ano,
    avaliacoes_preliminares: avaliacoes,
    evidencias_geradas: evidencias,
    protegidas: protegidas.size,
    erros,
    agencias: resultados.map((r) => r.agencia_sigla),
    resultados,
    legal_notice:
      "Classificação PRELIMINAR e automática de maturidade (Matriz IMQN) a partir dos dados do IRIS, sujeita a revisão humana. Não substitui a avaliação metodológica oficial nem avalia agentes públicos individualmente.",
  });
}
