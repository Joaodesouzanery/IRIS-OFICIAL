import { NextRequest, NextResponse } from "next/server";
import { isDemo } from "@/lib/server/is-demo";
import { requireAdmin } from "@/lib/server/request-guards";
import {
  buildAssociadoPreviewFromDb,
  curadoriaToInputsManuais,
  sanitizeCuradoria,
} from "@/lib/server/associado-report";
import type { Associado } from "@/types";

export const dynamic = "force-dynamic";

const STATUS_VALIDOS = new Set(["rascunho", "revisado", "aprovado", "arquivado"]);
const SAFE_ID_RE = /^[a-zA-Z0-9_-]+$/;

/**
 * PATCH /api/v1/associados/documentos/[id]
 * Edita um rascunho: regenera o HTML a partir da curadoria enviada (com fallback nos
 * inputs salvos), atualiza status e cria nova versão.
 */
export async function PATCH(req: NextRequest, { params }: any) {
  const guard = await requireAdmin(req);
  if (guard) return guard;
  if (isDemo()) {
    return NextResponse.json({ error: "Edição indisponível em modo demo" }, { status: 403 });
  }

  const { id } = params;
  if (!id || !SAFE_ID_RE.test(id)) {
    return NextResponse.json({ error: "ID inválido" }, { status: 400 });
  }

  const body = await req.json().catch(() => ({})) as Record<string, unknown>;
  const { createSupabaseServerClient } = await import("@/lib/supabase/server");
  const db = createSupabaseServerClient();

  const { data: doc, error: docError } = await db
    .from("documentos_associado")
    .select("id, associado_id, tipo, periodo_inicio, periodo_fim, qualidade, versao, status_revisao")
    .eq("id", id)
    .single();
  if (docError || !doc) {
    return NextResponse.json({ error: "Documento não encontrado" }, { status: 404 });
  }

  const { data: associado, error: assocError } = await db
    .from("associados")
    .select("*")
    .eq("id", doc.associado_id)
    .single();
  if (assocError || !associado) {
    return NextResponse.json({ error: "Associado não encontrado" }, { status: 404 });
  }

  const existingInputs = (doc.qualidade as { inputs_manuais?: Record<string, unknown> } | null)?.inputs_manuais;
  const curadoria = sanitizeCuradoria(body, existingInputs);
  const statusRevisao = typeof body.status_revisao === "string" && STATUS_VALIDOS.has(body.status_revisao)
    ? body.status_revisao
    : (doc.status_revisao ?? "rascunho");

  const preview = await buildAssociadoPreviewFromDb(db, {
    associado: associado as Associado,
    tipo: doc.tipo,
    periodo_inicio: doc.periodo_inicio,
    periodo_fim: doc.periodo_fim,
    curadoria,
  });

  const novaVersao = Number(doc.versao ?? 1) + 1;
  const { error: updateError } = await db
    .from("documentos_associado")
    .update({
      titulo: preview.titulo,
      html: preview.html,
      fontes: preview.fontes,
      metricas: preview.metricas,
      qualidade: { ...preview.qualidade, inputs_manuais: curadoriaToInputsManuais(curadoria) },
      status_revisao: statusRevisao,
      versao: novaVersao,
      updated_at: new Date().toISOString(),
    })
    .eq("id", id);

  if (updateError) {
    return NextResponse.json({ error: "Erro ao atualizar documento" }, { status: 500 });
  }

  // Atualiza as fontes (remove antigas e regrava).
  await db.from("documento_fontes").delete().eq("documento_id", id);
  if (preview.fontes.length) {
    await db.from("documento_fontes").insert(preview.fontes.map((fonte) => ({
      documento_id: id,
      fonte_tipo: fonte.tipo,
      titulo: fonte.titulo,
      url: fonte.url ?? null,
    })));
  }

  return NextResponse.json({ ...preview, documento_id: id, versao: novaVersao, status_revisao: statusRevisao });
}
