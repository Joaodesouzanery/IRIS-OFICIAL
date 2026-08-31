/**
 * GET /api/v1/dashboard/diretores/overview
 * Métricas de participação por diretor + MANDATO (cargo · início–fim · fonte).
 * Ago/2026: restrito a agências COLEGIADAS e sem "diretores" fabricados — só quem tem
 * mandato confiável ou voto real aparece; rejeitados nunca voltam pela via dos votos.
 */

import { NextRequest, NextResponse } from "next/server";
import { contarRelatoriasPorDiretor } from "@/lib/server/relatoria";
import { demoData } from "@/lib/demo-data";
import { isLocalMode, getSyncedDelibs } from "@/lib/server/local-data-store";
import { computeDiretoresOverview } from "@/lib/server/analytics-engine";
import { isDemo } from "@/lib/server/is-demo";
import { isDemoRequest } from "@/lib/server/request-guards";
import { selectAllPaged } from "@/lib/server/select-all-paged";
import { COLEGIADO_SIGLAS } from "@/lib/server/colegiado-sources";

type MandatoRow = {
  diretor_id: string;
  cargo: string | null;
  data_inicio: string | null;
  data_fim: string | null;
  fonte_dado: string | null;
  ato_nomeacao: string | null;
};

export async function GET(req: NextRequest) {
  if (isDemo() || isDemoRequest(req)) {
    const agenciaId = req.nextUrl.searchParams.get("agencia_id");
    if (isLocalMode()) {
      return NextResponse.json(computeDiretoresOverview(getSyncedDelibs(), agenciaId));
    }
    return NextResponse.json(demoData.diretoresOverview());
  }

  const { createSupabaseServerClient } = await import("@/lib/supabase/server");
  const db = createSupabaseServerClient();
  const agenciaId = req.nextUrl.searchParams.get("agencia_id");

  // Agências colegiadas (única esteira de votos configurada) — fora delas nada entra.
  const { data: agRows } = await db.from("agencias").select("id, sigla");
  const siglaPorAgencia = new Map(
    ((agRows ?? []) as Array<{ id: string; sigla: string }>).map((a) => [a.id, String(a.sigla)]),
  );
  const colegiadaIds = new Set(
    [...siglaPorAgencia.entries()].filter(([, s]) => COLEGIADO_SIGLAS.has(s)).map(([id]) => id),
  );

  // Parte dos DIRETORES aprovados (não dos votos) para que TODO diretor apareça —
  // inclusive com 0 voto.
  let diretoresQuery = db
    .from("diretores")
    .select("id, nome, nome_variantes, cargo, agencia_id, review_status")
    .limit(5000);
  if (agenciaId) diretoresQuery = diretoresQuery.eq("agencia_id", agenciaId);

  // is_nominal p/ separar voto LIDO (nominal) de INFERIDO por unanimidade/mandato.
  // `votos` paginado (PERF-4) p/ não subcontar em silêncio no ~1000 do PostgREST.
  const [diretoresRes, votosRes, mandatosRes] = await Promise.all([
    diretoresQuery,
    selectAllPaged(() => {
      let q = db
        .from("votos")
        .select("id, tipo_voto, is_divergente, is_nominal, diretores!inner (id, nome, agencia_id)");
      if (agenciaId) q = q.eq("diretores.agencia_id", agenciaId);
      // Ordem total única (PK dos votos) → paginação por offset determinística.
      return q.order("id", { ascending: true });
    }, { label: "dashboard/diretores/overview" }),
    db.from("mandatos").select("diretor_id, cargo, data_inicio, data_fim, fonte_dado, ato_nomeacao").limit(20000),
  ]);
  if (diretoresRes.error || votosRes.error) {
    return NextResponse.json({ error: "Erro ao buscar overview de diretores" }, { status: 500 });
  }

  // Mandato REPRESENTATIVO por diretor: o mais recente; "confiável" = verificado/seed
  // (fonte 'verificado' ou com ato de nomeação). O fabricado pelo código é "estimado".
  const mandatoPorDiretor = new Map<string, MandatoRow>();
  for (const m of (mandatosRes.data ?? []) as MandatoRow[]) {
    const atual = mandatoPorDiretor.get(m.diretor_id);
    if (!atual || String(m.data_inicio ?? "") > String(atual.data_inicio ?? "")) {
      mandatoPorDiretor.set(m.diretor_id, m);
    }
  }
  const mandatoConfiavel = (m: MandatoRow | undefined) =>
    Boolean(m && (m.fonte_dado === "verificado" || m.ato_nomeacao));

  const aprovados = ((diretoresRes.data ?? []) as Array<{ id: string; nome: string; nome_variantes?: string[] | null; cargo: string | null; agencia_id: string | null; review_status: string | null }>)
    .filter((d) => d.review_status === "aprovado");
  const rejeitadosIds = new Set(
    ((diretoresRes.data ?? []) as Array<{ id: string; review_status: string | null }>)
      .filter((d) => d.review_status === "rejeitado")
      .map((d) => d.id),
  );

  type Stat = {
    nome: string; cargo: string | null; agencia_id: string | null;
    total: number; favoravel: number; desfavoravel: number; divergente: number; nominais: number; inferidos: number;
    // Fase 16 — Ausente/Abstencao contavam +1 no `total` que a tela compara. Voto EFETIVO é
    // Favoravel+Desfavoravel; ausência é presença de registro, não voto (METODOLOGIA 01/09/2026).
    ausentes: number; abstencoes: number;
  };
  const stats = new Map<string, Stat>();
  for (const d of aprovados) {
    if (d.agencia_id && !colegiadaIds.has(d.agencia_id)) continue; // fora da esteira de votos
    stats.set(d.id, { nome: d.nome, cargo: d.cargo ?? null, agencia_id: d.agencia_id, total: 0, favoravel: 0, desfavoravel: 0, divergente: 0, nominais: 0, inferidos: 0, ausentes: 0, abstencoes: 0 });
  }

  for (const row of votosRes.rows) {
    const dir = (row as any).diretores;
    const id = dir?.id;
    if (!id) continue;
    // Rejeitado NÃO ressuscita pela via dos votos (era o furo que re-exibia os fabricados).
    if (rejeitadosIds.has(id)) continue;
    if (dir.agencia_id && !colegiadaIds.has(dir.agencia_id)) continue;
    if (!stats.has(id)) {
      stats.set(id, { nome: dir.nome ?? "—", cargo: null, agencia_id: dir.agencia_id ?? null, total: 0, favoravel: 0, desfavoravel: 0, divergente: 0, nominais: 0, inferidos: 0, ausentes: 0, abstencoes: 0 });
    }
    const s = stats.get(id)!;
    s.total++;
    if ((row as any).tipo_voto === "Favoravel") s.favoravel++;
    else if ((row as any).tipo_voto === "Desfavoravel") s.desfavoravel++;
    else if ((row as any).tipo_voto === "Ausente") s.ausentes++;
    else if ((row as any).tipo_voto === "Abstencao") s.abstencoes++;
    if ((row as any).is_divergente) s.divergente++;
    if ((row as any).is_nominal) s.nominais++; else s.inferidos++;
  }

  // Etapa67 — RELATORIA por diretor: o eixo nominal em 100% dos itens. Uma matéria = um relator
  // (atribuída ao MELHOR match, nunca a todos que casam). Consulta enxuta, por agência.
  const relatoriasPorDiretor = new Map<string, number>();
  {
    const agencias = [...new Set(aprovados.map((d) => d.agencia_id).filter(Boolean))] as string[];
    for (const agId of agencias) {
      const { data: delibsRel } = await db
        .from("deliberacoes")
        .select("relator")
        .eq("agencia_id", agId)
        .not("relator", "is", null)
        .limit(20000);
      const dirs = aprovados
        .filter((d) => d.agencia_id === agId)
        .map((d) => ({ id: d.id, nome: d.nome, nome_variantes: Array.isArray(d.nome_variantes) ? d.nome_variantes : [] }));
      const contagem = contarRelatoriasPorDiretor(
        ((delibsRel ?? []) as Array<{ relator: string | null }>),
        dirs,
      );
      for (const [id, n] of contagem) relatoriasPorDiretor.set(id, n);
    }
  }

  const result = [...stats.entries()]
    // Só quem é diretor DE VERDADE na esteira: mandato confiável (seed/DOU) OU ≥1 voto.
    // (Mandato fabricado sozinho não basta — era o furo dos "25 diretores na ANM".)
    .filter(([id, s]) => mandatoConfiavel(mandatoPorDiretor.get(id)) || s.total > 0)
    .map(([id, s]) => {
      const m = mandatoPorDiretor.get(id);
      return {
        diretor_id: id,
        diretor_nome: s.nome,
        agencia_sigla: s.agencia_id ? siglaPorAgencia.get(s.agencia_id) ?? null : null,
        cargo: m?.cargo ?? s.cargo ?? null,
        mandato_inicio: m?.data_inicio ?? null,
        mandato_fim: m?.data_fim ?? null,
        mandato_fonte: m ? (mandatoConfiavel(m) ? "verificado" : "estimado") : null,
        total: s.total,
        efetivos: s.favoravel + s.desfavoravel,
        ausentes: s.ausentes,
        abstencoes: s.abstencoes,
        favoravel: s.favoravel,
        desfavoravel: s.desfavoravel,
        divergente: s.divergente,
        nominais: s.nominais,
        inferidos: s.inferidos,
        relatorias: relatoriasPorDiretor.get(id) ?? 0,
        // Denominador EFETIVO: ausência no denominador diluía a taxa de deferimento pessoal.
        pct_favor: s.favoravel + s.desfavoravel > 0
          ? parseFloat(((s.favoravel / (s.favoravel + s.desfavoravel)) * 100).toFixed(1))
          : 0,
      };
    })
    .sort((a, b) => b.efetivos - a.efetivos);

  return NextResponse.json(result);
}
