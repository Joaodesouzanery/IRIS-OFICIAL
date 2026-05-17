/**
 * GET /api/v1/deliberacoes/[id]    — detalhe
 * PATCH /api/v1/deliberacoes/[id]  — correção manual de campos
 */

import { NextRequest, NextResponse } from "next/server";
import { demoData } from "@/lib/demo-data";
import { isLocalMode, getSyncedDelibs } from "@/lib/server/local-data-store";
import { computeDelibById } from "@/lib/server/analytics-engine";
import { isDemo } from "@/lib/server/is-demo";
import { isDemoRequest, requireAdmin } from "@/lib/server/request-guards";

const ALLOWED_PATCH_FIELDS = new Set([
  "numero_deliberacao",
  "reuniao_ordinaria",
  "data_reuniao",
  "interessado",
  "assunto",
  "processo",
  "microtema",
  "area_regulatoria",
  "resultado",
  "pauta_interna",
  "resumo_pleito",
  "fundamento_decisao",
]);


export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  if (isDemo() || isDemoRequest(req)) {
    if (isLocalMode()) {
      const found = computeDelibById(getSyncedDelibs(), params.id);
      if (!found) return NextResponse.json({ error: "Não encontrada" }, { status: 404 });
      return NextResponse.json(found);
    }

    const delib = demoData.deliberacaoById(params.id);
    if (!delib) {
      return NextResponse.json({ error: "Deliberação não encontrada" }, { status: 404 });
    }
    return NextResponse.json(delib);
  }

  const { createSupabaseServerClient } = await import("@/lib/supabase/server");
  const db = createSupabaseServerClient();
  const { data, error } = await db
    .from("deliberacoes")
    .select(
      `*, agencias (sigla, nome), votos (id, tipo_voto, is_divergente, is_nominal, diretor_id,
        diretores (nome))`
    )
    .eq("id", params.id)
    .single();

  if (error || !data) {
    return NextResponse.json({ error: "Deliberação não encontrada" }, { status: 404 });
  }

  const formatted = {
    ...data,
    agencia: data.agencias ?? null,
    agencias: undefined,
    votos: (data.votos ?? []).map((v: any) => ({
      id: v.id,
      tipo_voto: v.tipo_voto,
      is_divergente: v.is_divergente,
      is_nominal: v.is_nominal,
      diretor_id: v.diretor_id,
      diretor_nome: v.diretores?.nome ?? null,
    })),
  };

  return NextResponse.json(formatted);
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const guard = await requireAdmin(req);
  if (guard) return guard;

  if (isDemo()) {
    return NextResponse.json(
      { error: "Edição não disponível em modo demo" },
      { status: 403 }
    );
  }

  const body = await req.json();

  const updates: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(body)) {
    if (ALLOWED_PATCH_FIELDS.has(key)) {
      updates[key] = value;
    }
  }

  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: "Nenhum campo válido para atualizar" }, { status: 400 });
  }

  updates.updated_at = new Date().toISOString();

  const { createSupabaseServerClient } = await import("@/lib/supabase/server");
  const db = createSupabaseServerClient();
  const { data, error } = await db
    .from("deliberacoes")
    .update(updates)
    .eq("id", params.id)
    .select()
    .single();

  if (error || !data) {
    return NextResponse.json({ error: "Falha ao atualizar deliberação" }, { status: 500 });
  }

  return NextResponse.json(data);
}
