/**
 * GET /api/v1/dashboard/governanca-agencias[?year=2026]
 * Indicadores de governança REAIS por agência (consenso, deferimento, qualidade
 * IA, sanções) — computados de deliberacoes+votos agrupados por agencia_id, só
 * sobre DECISÕES FINAIS. Substitui o cálculo antigo que repetia o número GLOBAL
 * para todas as agências (ANA/ANAC/... apareciam com o mesmo 68 sem ter dados).
 */

import { NextRequest, NextResponse } from "next/server";
import { isDemo } from "@/lib/server/is-demo";
import { isDemoRequest } from "@/lib/server/request-guards";
import { decisionStatus, isConsensual, isFinalDecisionRecord, isSancao, FINAL_DECISION_RAW_SELECT, juizoSelect } from "@/lib/server/regulatory-documents";
import { isResultadoPositivo } from "@/lib/utils";

export const dynamic = "force-dynamic";

interface AgenciaGovernanca {
  agencia_id: string | null;
  sigla: string;
  nome: string;
  /** PAUTADO: tudo que entrou em pauta. Não muda — é o número que os consumidores já leem. */
  total: number;
  // ─── Etapa60: os quatro estados, publicados ao lado do pautado ────────────
  /** Julgado no MÉRITO. É o denominador de `deferimento`. */
  total_decidido: number;
  /** NÃO CONHECIDO: o colegiado não julgou o pedido. Fora dos dois lados da taxa. */
  total_admissibilidade: number;
  total_retirado: number;
  total_sem_resultado: number;
  /** Com ao menos 1 voto registrado. É o denominador de `consenso`. */
  total_com_voto: number;
  /**
   * % de deliberações COM VOTO e sem divergência. `null` quando não há base — publicar 0 faria
   * "nenhum voto lido" parecer "colegiado em conflito total".
   */
  consenso: number | null;
  /** false quando não há item decidido: `deferimento` não deve ser lido como taxa real. */
  deferimento_disponivel: boolean;
  cobertura_nominal: number; // % de deliberações com ao menos 1 voto NOMINAL (confiabilidade do consenso)
  /** % de resultados positivos sobre os DECIDIDOS (antes: sobre o pautado). */
  deferimento: number;
  qualidade: number;    // média de extraction_confidence * 100
  sancao: number;       // % multa/indeferido
}

export async function GET(req: NextRequest) {
  if (isDemo() || isDemoRequest(req)) {
    return NextResponse.json({ por_agencia: [] });
  }

  const { createSupabaseServerClient } = await import("@/lib/supabase/server");
  const db = createSupabaseServerClient();
  // Etapa66 — projeta a COLUNA `juizo` quando ela existe (sondada uma vez por processo).
  // O filho de ata gravava a coluna e nunca o JSON, e toda rota projetava só o JSON: a
  // admissibilidade de item de ata era invisível — 13 de 320 itens no corpus, 100% deles.
  const finalSelect = await juizoSelect(db);

  const [agenciasRes, delibsRes] = await Promise.all([
    db.from("agencias").select("id, sigla, nome").eq("ativo", true),
    db.from("deliberacoes")
      .select(`agencia_id, resultado, microtema, extraction_confidence, tipo_documento, documento_pai_id, ${finalSelect}, votos(is_divergente, is_nominal)`)
      .limit(40000),
  ]);

  const agencias: Array<{ id: string; sigla: string; nome: string }> = agenciasRes.data ?? [];
  type Acc = {
    total: number; decidido: number; admissibilidade: number; retirado: number; semResultado: number;
    comVoto: number; consensoOk: number; comNominal: number; deferido: number;
    confSum: number; confN: number; sancao: number;
  };
  const acc = new Map<string, Acc>();

  // `as unknown as` porque o sub-select agora é resolvido em runtime (`finalSelect`): o parser de
  // tipos do supabase-js só entende string LITERAL e devolve `ParserError` para a dinâmica.
  for (const d of (delibsRes.data ?? []) as unknown as Array<{
    agencia_id: string | null; resultado: string | null; microtema: string | null;
    extraction_confidence: number | null; tipo_documento: string | null;
    documento_pai_id: string | null;
    import_counts_as_final?: unknown; documento_subtipo?: unknown; documento_antt_tipo?: unknown;
    votos: Array<{ is_divergente: boolean; is_nominal: boolean }>;
  }>) {
    if (!isFinalDecisionRecord(d as any) || !d.agencia_id) continue;
    const a = acc.get(d.agencia_id) ?? { total: 0, decidido: 0, admissibilidade: 0, retirado: 0, semResultado: 0, comVoto: 0, consensoOk: 0, comNominal: 0, deferido: 0, confSum: 0, confN: 0, sancao: 0 };
    a.total += 1;

    // Etapa60 — DENOMINADOR EM QUATRO ESTADOS. `total` (pautado) segue intacto para não quebrar
    // nenhum consumidor; as taxas de MÉRITO passam a usar `decidido`. Item retirado ou sem
    // resultado nunca foi julgado: contá-lo no divisor puxava a taxa de deferimento para baixo
    // como se fosse indeferimento.
    switch (decisionStatus(d as any)) {
      case "decidido": a.decidido += 1; break;
      case "admissibilidade": a.admissibilidade += 1; break;
      case "retirado": a.retirado += 1; break;
      default: a.semResultado += 1;
    }

    // Etapa60 — CONSENSO só onde há VOTO. `!votos.some(is_divergente)` é `true` para array vazio:
    // toda deliberação sem voto extraído era contada como CONSENSUAL. "Consenso de 100%" podia
    // significar, literalmente, "ninguém votou".
    const consensual = isConsensual(d.votos);
    if (consensual !== null) {
      a.comVoto += 1;
      if (consensual) a.consensoOk += 1;
    }
    if ((d.votos ?? []).some((v) => v.is_nominal)) a.comNominal += 1;
    // NUMERADOR no MESMO universo do denominador: só conta deferimento entre os DECIDIDOS, senão
    // a taxa pode passar de 100% (item de admissibilidade com resultado positivo).
    if (decisionStatus(d as any) === "decidido") {
      if (isResultadoPositivo(d.resultado)) a.deferido += 1;
      if (isSancao(d)) a.sancao += 1;
    }
    if (d.extraction_confidence != null) { a.confSum += d.extraction_confidence; a.confN += 1; }
    acc.set(d.agencia_id, a);
  }

  const pct = (n: number, d: number) => (d > 0 ? Math.round((n / d) * 1000) / 10 : 0);
  const por_agencia: AgenciaGovernanca[] = agencias.map((ag) => {
    const a = acc.get(ag.id);
    return {
      agencia_id: ag.id, sigla: ag.sigla, nome: ag.nome,
      total: a?.total ?? 0,
      // Modo duplo (etapa60): o pautado continua publicado, e o decidido vem ao lado.
      total_decidido: a?.decidido ?? 0,
      total_admissibilidade: a?.admissibilidade ?? 0,
      total_retirado: a?.retirado ?? 0,
      total_sem_resultado: a?.semResultado ?? 0,
      total_com_voto: a?.comVoto ?? 0,
      // Consenso sobre os itens COM VOTO — o único universo em que a pergunta faz sentido.
      // `null` quando NÃO HÁ base: publicar 0 tornaria "nenhum voto lido" indistinguível de
      // "consenso medido em zero", que é o mesmo defeito de sempre com outra roupa — e o Score de
      // Governança, que pondera consenso em 30%, leria essa ausência como colegiado em conflito
      // total, invertendo o sentido do número.
      consenso: a && a.comVoto > 0 ? pct(a.consensoOk, a.comVoto) : null,
      // Idem para o deferimento: sem item decidido não há taxa a publicar.
      deferimento_disponivel: Boolean(a && a.decidido > 0),
      cobertura_nominal: a ? pct(a.comNominal, a.total) : 0,
      // Deferimento sobre os DECIDIDOS (mérito), não sobre tudo que foi pautado.
      deferimento: a ? pct(a.deferido, a.decidido) : 0,
      qualidade: a && a.confN > 0 ? Math.round((a.confSum / a.confN) * 1000) / 10 : 0,
      sancao: a ? pct(a.sancao, a.decidido) : 0,
    };
  });

  return NextResponse.json({ por_agencia });
}
