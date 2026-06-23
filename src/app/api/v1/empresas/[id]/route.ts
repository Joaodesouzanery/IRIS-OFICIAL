/**
 * GET /api/v1/empresas/[id]
 * Perfil detalhado de uma empresa regulada.
 * O [id] é o nome da empresa, URL-encoded.
 */

import { NextRequest, NextResponse } from "next/server";
import { demoData } from "@/lib/demo-data";
import { isLocalMode, getSyncedDelibs } from "@/lib/server/local-data-store";
import { computeEmpresaDetalhe } from "@/lib/server/analytics-engine";
import { isDemo } from "@/lib/server/is-demo";
import { isDemoRequest } from "@/lib/server/request-guards";


export async function GET(
  req: NextRequest,
  { params }: any
) {
  const nome = decodeURIComponent(params.id);

  if (isDemo() || isDemoRequest(req)) {
    const delibs = isLocalMode()
      ? getSyncedDelibs()
      : demoData.deliberacoes({ limit: 9999 }).data;

    const detalhe = computeEmpresaDetalhe(delibs, nome);
    if (!detalhe) {
      return NextResponse.json({ error: "Empresa não encontrada" }, { status: 404 });
    }
    return NextResponse.json(detalhe);
  }

  const { createSupabaseServerClient } = await import("@/lib/supabase/server");
  const db = createSupabaseServerClient();

  // Resolve a empresa normalizada pelo nome de exibição; se houver, busca por
  // empresa_id (captura todas as variantes). Senão, fallback por interessado exato.
  const { data: empresaRows } = await db
    .from("empresas")
    .select("id")
    .ilike("nome_exibicao", nome)
    .limit(1);
  const empresaId = empresaRows?.[0]?.id ?? null;

  let query = db
    .from("deliberacoes")
    .select(
      `id, numero_deliberacao, reuniao_ordinaria, data_reuniao,
       interessado, processo, microtema, resultado, pauta_interna,
       resumo_pleito, fundamento_decisao, agencia_id, extraction_confidence,
       created_at, tipo_documento, documento_pai_id, raw_extraction, agencias (sigla, nome),
       votos (id, tipo_voto, is_divergente, is_nominal, diretor_id, diretores (nome))`
    )
    .order("data_reuniao", { ascending: false });
  query = empresaId ? query.eq("empresa_id", empresaId) : query.eq("interessado", nome);

  const { data, error } = await query;

  if (error) {
    return NextResponse.json({ error: "Erro ao buscar deliberações" }, { status: 500 });
  }

  const deliberacoes = (data ?? []).map((d: any) => ({
    ...d,
    agencia: d.agencias ?? null,
    agencias: undefined,
    votos: (d.votos ?? []).map((v: any) => ({
      id: v.id,
      tipo_voto: v.tipo_voto,
      is_divergente: v.is_divergente,
      is_nominal: v.is_nominal,
      diretor_id: v.diretor_id,
      diretor_nome: v.diretores?.nome ?? null,
    })),
  }));

  const detalhe = computeEmpresaDetalhe(deliberacoes, nome);
  if (!detalhe) {
    return NextResponse.json({ error: "Empresa não encontrada" }, { status: 404 });
  }
  return NextResponse.json(detalhe);
}
