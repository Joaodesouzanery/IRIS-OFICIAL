/**
 * POST /api/v1/votos/reprocessar-abstencoes
 * Reclassifica votos antigos gravados como "Desfavoravel" que, na verdade, eram
 * abstenções — re-extraindo `nomes_votacao_abstencao` do `raw_text` da deliberação.
 * Opt-in, admin-only, idempotente, paginado. Audita em votos_retroativos_audit.
 */

import { NextRequest, NextResponse } from "next/server";
import { isDemo } from "@/lib/server/is-demo";
import { requireAdmin } from "@/lib/server/request-guards";
import { extractFields } from "@/lib/server/nlp-extractor";
import { findBestMatch } from "@/lib/server/name-matcher";
import type { DiretorVoteRecord } from "@/lib/server/vote-inference";
import { parseIntParam } from "@/lib/server/http-params";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const guard = await requireAdmin(req);
  if (guard) return guard;
  if (isDemo()) return NextResponse.json({ reclassificados: 0, demo: true });

  const offset = parseIntParam(req.nextUrl.searchParams.get("offset"), 0, 0);
  const limit = parseIntParam(req.nextUrl.searchParams.get("limit"), 100, 1, 200);

  const { createSupabaseServerClient } = await import("@/lib/supabase/server");
  const db = createSupabaseServerClient();

  const { data: delibs, error } = await db
    .from("deliberacoes")
    .select("id, agencia_id, raw_text, votos(id, diretor_id, tipo_voto)")
    .not("raw_text", "is", null)
    .order("created_at", { ascending: false })
    .range(offset, offset + limit - 1);

  if (error) {
    return NextResponse.json({ error: "Erro ao buscar deliberações" }, { status: 500 });
  }

  // Cache de diretores por agência.
  const diretoresCache = new Map<string, DiretorVoteRecord[]>();
  async function getDiretores(agenciaId: string): Promise<DiretorVoteRecord[]> {
    if (diretoresCache.has(agenciaId)) return diretoresCache.get(agenciaId)!;
    const { data } = await db
      .from("diretores")
      .select("id, nome, nome_variantes")
      .eq("agencia_id", agenciaId);
    const list: DiretorVoteRecord[] = (data ?? []).map((d: any) => ({
      id: d.id, nome: d.nome, nome_variantes: Array.isArray(d.nome_variantes) ? d.nome_variantes : [],
    }));
    diretoresCache.set(agenciaId, list);
    return list;
  }

  let reclassificados = 0;
  let deliberacoesAfetadas = 0;
  // Coleta os ids (mesmo payload p/ TODOS) + auditoria, para aplicar em LOTE (UPDATE .in()
  // chunked + 1 insert) em vez de 1 UPDATE por voto + 1 INSERT por deliberação.
  const idsParaAbstencao: string[] = [];
  const auditRows: Array<Record<string, unknown>> = [];

  for (const d of (delibs ?? []) as any[]) {
    if (!d.agencia_id || !d.raw_text) continue;
    const votos = (d.votos ?? []) as Array<{ id: string; diretor_id: string; tipo_voto: string }>;
    const desfavoraveis = votos.filter((v) => v.tipo_voto === "Desfavoravel");
    if (desfavoraveis.length === 0) continue;

    const fields = extractFields(String(d.raw_text));
    const abstencoes = fields.nomes_votacao_abstencao ?? [];
    if (abstencoes.length === 0) continue;

    const diretores = await getDiretores(d.agencia_id);
    const abstencaoIds = new Set<string>();
    for (const nome of abstencoes) {
      const m = findBestMatch(nome, diretores);
      if (m.diretorId && !m.needsReview) abstencaoIds.add(m.diretorId);
    }
    if (abstencaoIds.size === 0) continue;

    const idsDaDelib = desfavoraveis.filter((v) => abstencaoIds.has(v.diretor_id)).map((v) => v.id);
    if (idsDaDelib.length === 0) continue;
    idsParaAbstencao.push(...idsDaDelib);
    deliberacoesAfetadas++;
    auditRows.push({
      diretor_id: null,
      agencia_id: d.agencia_id,
      nome_detectado: "(reclassificação de abstenção)",
      deliberacoes_afetadas: 1,
      votos_criados: 0,
      votos_ignorados_fora_mandato: 0,
      detalhe: { tipo: "reclassificacao_abstencao", deliberacao_id: d.id },
    });
  }

  for (let i = 0; i < idsParaAbstencao.length; i += 100) {
    const chunk = idsParaAbstencao.slice(i, i + 100);
    const { error: upErr } = await db.from("votos").update({ tipo_voto: "Abstencao", is_divergente: false }).in("id", chunk);
    if (!upErr) reclassificados += chunk.length;
  }
  if (auditRows.length > 0) await db.from("votos_retroativos_audit").insert(auditRows);

  const processados = (delibs ?? []).length;
  return NextResponse.json({
    reclassificados,
    deliberacoes_afetadas: deliberacoesAfetadas,
    processados,
    next_offset: processados === limit ? offset + limit : null,
  });
}
