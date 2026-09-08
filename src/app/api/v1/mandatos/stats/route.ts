/**
 * GET /api/v1/mandatos/stats?agencia_id=X
 * KPIs para o painel de mandatos.
 */

import { isFinalDecisionRecord } from "@/lib/server/regulatory-documents";
import { NextRequest, NextResponse } from "next/server";
import { demoData } from "@/lib/demo-data";
import type { MandatosStats } from "@/types";
import { isLocalMode, getSyncedDelibs } from "@/lib/server/local-data-store";
import { computeMandatosStats } from "@/lib/server/analytics-engine";
import { isDemo } from "@/lib/server/is-demo";
import { isDemoRequest } from "@/lib/server/request-guards";
import { TIPOS_NAO_FINAIS_PG } from "@/lib/server/regulatory-documents";


export async function GET(req: NextRequest) {
  const agenciaId = req.nextUrl.searchParams.get("agencia_id") || null;

  if (isDemo() || isDemoRequest(req)) {
    if (isLocalMode()) {
      return NextResponse.json(computeMandatosStats(getSyncedDelibs(), agenciaId));
    }
    const stats = demoData.mandatosStats(agenciaId);
    return NextResponse.json(stats);
  }

  const { createSupabaseServerClient } = await import("@/lib/supabase/server");
  const db = createSupabaseServerClient();

  // Diretores ativos
  let diretoresQuery = db
    .from("mandatos")
    .select("diretor_id, diretores!inner(agencia_id)", { count: "exact", head: true })
    .gte("data_fim", new Date().toISOString().slice(0, 10));
  if (agenciaId) diretoresQuery = diretoresQuery.eq("diretores.agencia_id", agenciaId);

  // Total deliberações FINAIS (aproximação SQL do isFinalDecisionRecord: exclui
  // ata-mãe e docs de apoio) — alinha o card ao Dashboard (28), sem contar
  // ata-mãe/pauta/voto_individual que inflavam para 36.
  let deliberQuery = db
    .from("deliberacoes")
    .select("id", { count: "exact", head: true })
    .not("tipo_documento", "in", TIPOS_NAO_FINAIS_PG)
    .or("tipo_documento.neq.ata,documento_pai_id.not.is.null");
  if (agenciaId) deliberQuery = deliberQuery.eq("agencia_id", agenciaId);

  // Fase 21 — o número ESTRITO, pelo predicado canônico, ao lado do aproximado. A aproximação
  // acima conta filho de ata SEM `resultado` (o quinto estado da METODOLOGIA) e por isso diverge
  // do Dashboard. Trocar o card muda número público: primeiro os dois aparecem juntos.
  let estritoQuery = db
    .from("deliberacoes")
    .select("tipo_documento, documento_pai_id, resultado, import_counts_as_final:raw_extraction->>import_counts_as_final, documento_subtipo:raw_extraction->>documento_subtipo, documento_antt_tipo:raw_extraction->>documento_antt_tipo")
    .limit(40000);
  if (agenciaId) estritoQuery = estritoQuery.eq("agencia_id", agenciaId);

  // Participações colegiadas = total votos
  let votosQuery = db
    .from("votos")
    .select("deliberacoes!inner(agencia_id)", { count: "exact", head: true });
  if (agenciaId) votosQuery = votosQuery.eq("deliberacoes.agencia_id", agenciaId);

  // Taxa de consenso: deliberações sem voto divergente / deliberações COM VOTO (etapa60).
  let divergQuery = db
    .from("votos")
    .select("deliberacao_id, deliberacoes!inner(agencia_id)")
    .eq("is_divergente", true);
  if (agenciaId) divergQuery = divergQuery.eq("deliberacoes.agencia_id", agenciaId);

  // O DENOMINADOR do consenso: deliberações distintas com ao menos UM voto. Era `total`
  // (todas as deliberações), então item sem voto entrava como concordância — a última rota de
  // consenso que ainda usava o denominador antigo.
  let comVotoQuery = db
    .from("votos")
    .select("deliberacao_id, deliberacoes!inner(agencia_id)");
  if (agenciaId) comVotoQuery = comVotoQuery.eq("deliberacoes.agencia_id", agenciaId);

  // As 4 queries são independentes → paralelas (antes eram 4 awaits sequenciais).
  const [{ count: diretores_ativos }, { count: total_deliberacoes }, { count: participacoes_colegiadas }, { data: divergData }, { data: comVotoData }, { data: estritoData }] =
    await Promise.all([diretoresQuery, deliberQuery, votosQuery, divergQuery, comVotoQuery, estritoQuery]);
  // O canônico, linha a linha: item de ata só conta com PAI e RESULTADO (`documento_pai_id && resultado`).
  const total_finais_estrito = ((estritoData ?? []) as Array<Record<string, unknown>>).filter((r) =>
    isFinalDecisionRecord({
      tipo_documento: r.tipo_documento as string | null,
      documento_pai_id: r.documento_pai_id as string | null,
      resultado: r.resultado as string | null,
      import_counts_as_final: r.import_counts_as_final === "false" ? false : r.import_counts_as_final === "true" ? true : null,
      documento_subtipo: (r.documento_subtipo as string | null) ?? null,
      documento_antt_tipo: (r.documento_antt_tipo as string | null) ?? null,
    }),
  ).length;
  const comDivergencia = new Set((divergData ?? []).map((v: { deliberacao_id: string }) => v.deliberacao_id)).size;
  const comVoto = new Set((comVotoData ?? []).map((v: { deliberacao_id: string }) => v.deliberacao_id)).size;
  const total = total_deliberacoes ?? 0;
  // Base vazia devolve "—", não "100%": ausência de voto não é consenso perfeito, e era isso que
  // o fallback antigo afirmava — do jeito mais confiante possível.
  const taxa_consenso =
    comVoto > 0 ? (((comVoto - comDivergencia) / comVoto) * 100).toFixed(1) + "%" : "—";

  const result: MandatosStats = {
    diretores_ativos: diretores_ativos ?? 0,
    participacoes_colegiadas: participacoes_colegiadas ?? 0,
    taxa_consenso,
    total_deliberacoes: total,
    /** Fase 21 — o número pelo predicado canônico. Quando o usuário aprovar, ele substitui `total`. */
    total_finais_estrito,
    total_com_voto: comVoto,
  };

  return NextResponse.json(result);
}
