/**
 * GET /api/v1/dashboard/diretores/overview
 * Métricas de participação por diretor.
 */

import { NextRequest, NextResponse } from "next/server";
import { demoData } from "@/lib/demo-data";
import { isLocalMode, getSyncedDelibs } from "@/lib/server/local-data-store";
import { computeDiretoresOverview } from "@/lib/server/analytics-engine";
import { isDemo } from "@/lib/server/is-demo";
import { isDemoRequest } from "@/lib/server/request-guards";
import { selectAllPaged } from "@/lib/server/select-all-paged";


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

  // Parte dos DIRETORES aprovados (não dos votos) para que TODO diretor apareça —
  // inclusive com 0 voto. Antes o overview partia de `votos` com !inner, então
  // diretor sem voto (ex.: ANTT com votos presos em candidatos) sumia da tabela.
  let diretoresQuery = db
    .from("diretores")
    .select("id, nome, agencia_id")
    .eq("review_status", "aprovado")
    .limit(5000);
  if (agenciaId) diretoresQuery = diretoresQuery.eq("agencia_id", agenciaId);

  // is_nominal p/ separar voto LIDO (nominal) de INFERIDO por unanimidade/mandato.
  // `votos` cresce sem limite → paginado (PERF-4) p/ a contagem por diretor não parar
  // no ~1000 do PostgREST e subcontar em silêncio quando a base crescer.
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
    db.from("mandatos").select("diretor_id").limit(20000),
  ]);
  if (diretoresRes.error || votosRes.error) {
    return NextResponse.json({ error: "Erro ao buscar overview de diretores" }, { status: 500 });
  }
  const comMandato = new Set((mandatosRes.data ?? []).map((m: { diretor_id: string }) => m.diretor_id));

  const stats = new Map<
    string,
    { nome: string; total: number; favoravel: number; desfavoravel: number; divergente: number; nominais: number; inferidos: number }
  >();
  // Semeia com todos os diretores aprovados (zeros).
  for (const d of (diretoresRes.data ?? []) as Array<{ id: string; nome: string }>) {
    stats.set(d.id, { nome: d.nome, total: 0, favoravel: 0, desfavoravel: 0, divergente: 0, nominais: 0, inferidos: 0 });
  }

  for (const row of votosRes.rows) {
    const dir = (row as any).diretores;
    const id = dir?.id;
    if (!id) continue;
    // Diretor pode ter voto mas não estar na lista de aprovados (raro) — inclui mesmo assim.
    if (!stats.has(id)) {
      stats.set(id, { nome: dir.nome ?? "—", total: 0, favoravel: 0, desfavoravel: 0, divergente: 0, nominais: 0, inferidos: 0 });
    }
    const s = stats.get(id)!;
    s.total++;
    if ((row as any).tipo_voto === "Favoravel") s.favoravel++;
    else if ((row as any).tipo_voto === "Desfavoravel") s.desfavoravel++;
    if ((row as any).is_divergente) s.divergente++;
    if ((row as any).is_nominal) s.nominais++; else s.inferidos++;
  }

  const result = [...stats.entries()]
    // Exclui fantasmas/ex-diretores: sem mandato E sem nenhum voto (relatores citados
    // em ata que viraram "diretor", ex-mandatos encerrados). Diretor com mandato OU
    // com voto permanece.
    .filter(([id, s]) => comMandato.has(id) || s.total > 0)
    .map(([id, s]) => ({
      diretor_id: id,
      diretor_nome: s.nome,
      total: s.total,
      favoravel: s.favoravel,
      desfavoravel: s.desfavoravel,
      divergente: s.divergente,
      nominais: s.nominais,
      inferidos: s.inferidos,
      pct_favor: s.total > 0 ? parseFloat(((s.favoravel / s.total) * 100).toFixed(1)) : 0,
    }))
    .sort((a, b) => b.total - a.total);

  return NextResponse.json(result);
}
