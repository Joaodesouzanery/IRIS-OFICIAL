/**
 * GET /api/v1/dashboard/overview
 * KPIs principais do dashboard.
 */

import { NextRequest, NextResponse } from "next/server";
import { demoData } from "@/lib/demo-data";
import { isLocalMode, getSyncedDelibs } from "@/lib/server/local-data-store";
import { computeOverview } from "@/lib/server/analytics-engine";
import { isResultadoPositivo } from "@/lib/utils";
import { isDemo } from "@/lib/server/is-demo";
import { isDemoRequest } from "@/lib/server/request-guards";
import { isFinalDecisionRecord, FINAL_DECISION_RAW_SELECT , decisionStatus, isDecidedOnMerits, juizoSelect } from "@/lib/server/regulatory-documents";
import { classificarDescarte, reuniaoKey } from "@/lib/server/metricas-decomposicao";
import { selectAllPaged } from "@/lib/server/select-all-paged";
import { matchesYear, applyYearFilterSql } from "@/lib/server/year-filter";


export async function GET(req: NextRequest) {
  const agenciaId = req.nextUrl.searchParams.get("agencia_id") || null;
  const year = req.nextUrl.searchParams.get("year");

  if (isDemo() || isDemoRequest(req)) {
    if (isLocalMode()) {
      return NextResponse.json(computeOverview(getSyncedDelibs(), agenciaId));
    }
    return NextResponse.json(demoData.overview(agenciaId));
  }

  const { createSupabaseServerClient } = await import("@/lib/supabase/server");
  const db = createSupabaseServerClient();
  // Etapa66 — projeta a COLUNA `juizo` quando ela existe (sondada uma vez por processo).
  // O filho de ata gravava a coluna e nunca o JSON, e toda rota projetava só o JSON: a
  // admissibilidade de item de ata era invisível — 13 de 320 itens no corpus, 100% deles.
  const finalSelect = await juizoSelect(db);

  // Paginado (PERF-4): sem isto, a agregação em JS pararia no ~1000 do PostgREST e
  // subcontaria em silêncio quando a base crescer.
  const { rows: deliberacoes, error } = await selectAllPaged(() => {
    let q = db
      .from("deliberacoes")
      .select(`id, resultado, microtema, data_reuniao, data_publicacao, extraction_confidence, auto_classified, pauta_interna, tipo_documento, documento_pai_id, agencia_id, numero_reuniao, ${finalSelect}`);
    if (agenciaId) q = q.eq("agencia_id", agenciaId);
    q = applyYearFilterSql(q, year); // recorte no SQL (perf) — matchesYear segue como cinto
    // Ordem TOTAL única (PK) → paginação por offset determinística (sem pular/duplicar
    // linhas nas fronteiras de página; PostgREST não garante ordem sem ORDER BY).
    return q.order("id", { ascending: true });
  }, { label: "dashboard/overview" });

  if (error) {
    return NextResponse.json({ error: "Erro ao buscar overview" }, { status: 500 });
  }

  // `year` honrado (QA ago/2026: as abas mandavam o parâmetro e a rota ignorava).
  const doAno = deliberacoes.filter((r: any) => matchesYear(r, year));
  const rows = doAno.filter(isFinalDecisionRecord);
  const total = rows.length;

  // ═══ Fase 17 — o total passa a se EXPLICAR ═══════════════════════════════
  // "1028 no banco, 692 na tela" não é filtro de ano nem de agência (a tela não manda nenhum dos
  // dois): é inteiramente `isFinalDecisionRecord`. O número está certo — faltava ele dizer isso.
  // Publicar a decomposição custa uma passada sobre linhas que já estão em memória, e transforma
  // uma pergunta recorrente ("posso confiar?") em algo conferível na própria tela.
  const descartados: Record<string, number> = {};
  for (const r of doAno) {
    if (isFinalDecisionRecord(r as any)) continue;
    const motivo = classificarDescarte(r as any) ?? "outro";
    descartados[motivo] = (descartados[motivo] ?? 0) + 1;
  }
  // NUMERADOR no MESMO universo do denominador (etapa60). Contar positivos sobre TODAS as linhas
  // enquanto o divisor conta só as DECIDIDAS deixa a taxa passar de 100% quando um item de
  // admissibilidade carrega resultado positivo — assimetria que eu mesmo introduzi ao mudar só
  // o divisor.
  const decididosRows = rows.filter((r) => isDecidedOnMerits(r as any));
  const deferidos = decididosRows.filter((r) => isResultadoPositivo(r.resultado)).length;
  const indeferidos = decididosRows.filter((r) => r.resultado === "Indeferido").length;
  const semResultado = rows.filter((r) => !r.resultado).length;
  // Etapa60 — DENOMINADOR DE MÉRITO. `total` (pautado) fica intacto; a taxa passa a dividir pelos
  // itens efetivamente JULGADOS. Antes, retirado de pauta, item sem resultado extraído e
  // não-conhecimento ficavam no divisor sem entrar em numerador nenhum: a taxa de deferimento
  // caía por causa de itens que ninguém julgou, e "não conhecer por intempestividade" era contado
  // como jurisprudência.
  const decididos = decididosRows.length;
  const admissibilidade = rows.filter((r) => decisionStatus(r as any) === "admissibilidade").length;
  const retirados = rows.filter((r) => decisionStatus(r as any) === "retirado").length;

  const confidenceRows = rows.filter((r) => r.extraction_confidence !== null);
  const avgConfidence =
    confidenceRows.length > 0
      ? confidenceRows.reduce((sum, r) => sum + (r.extraction_confidence ?? 0), 0) / confidenceRows.length
      : 0;

  // Fase 17 — era `DISTINCT data_reuniao` GLOBAL: duas agências reunidas no mesmo dia viravam
  // UMA reunião, e a ANTT (ordinária + extraordinária na mesma data) perdia uma. A chave é a
  // mesma da tabela `reunioes` materializada: agência + data + número.
  const reunioesUnicas = new Set(
    rows.filter((r) => r.data_reuniao).map((r) => reuniaoKey(r as any)),
  ).size;

  const microtemaCount = new Map<string, number>();
  for (const r of rows) {
    if (r.microtema) {
      microtemaCount.set(r.microtema, (microtemaCount.get(r.microtema) ?? 0) + 1);
    }
  }
  const topMicrotema =
    microtemaCount.size > 0
      ? [...microtemaCount.entries()].sort((a, b) => b[1] - a[1])[0][0]
      : null;

  const autoClassified = rows.filter((r) => r.auto_classified).length;
  const auto_classified_pct = total > 0 ? Math.round((autoClassified / total) * 100) : 0;
  const pauta_interna_count = rows.filter((r) => r.pauta_interna).length;
  const pauta_externa = total - pauta_interna_count;

  return NextResponse.json({
    total_deliberacoes: total,
    // A conta inteira, para quem quiser conferir: linhas do recorte − descartadas = total.
    total_linhas: doAno.length,
    descartados,
    deferidos,
    indeferidos,
    sem_resultado: semResultado,
    // Modo duplo (etapa60): o pautado segue em `total_deliberacoes`; o denominador real da taxa
    // vem publicado ao lado, para o leitor saber SOBRE O QUÊ ela foi calculada.
    total_decidido: decididos,
    total_admissibilidade: admissibilidade,
    total_retirado: retirados,
    taxa_deferimento: decididos > 0 ? ((deferidos / decididos) * 100).toFixed(1) : "0",
    reunioes_unicas: reunioesUnicas,
    avg_confidence: avgConfidence,
    top_microtema: topMicrotema,
    auto_classified_pct,
    pauta_externa,
    pauta_interna_count,
  });
}
