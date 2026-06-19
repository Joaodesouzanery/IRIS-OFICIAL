import { NextRequest, NextResponse } from "next/server";
import { isDemo } from "@/lib/server/is-demo";
import { requireAdmin } from "@/lib/server/request-guards";

const SAFE_ID_RE = /^[a-zA-Z0-9_-]+$/;

/**
 * PATCH /api/v1/associados/[id]
 * Edita campos curáveis do associado (admin): foto/minibio do VP, agências correlatas,
 * microtemas, ministérios e palavras-chave. Usado para "Levantar Foto/Minibio" e ajustar
 * as áreas correlatas (ex.: ARTESP + ANTT).
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
  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };

  const strArray = (v: unknown) => (Array.isArray(v) ? [...new Set(v.map((x) => String(x).trim()).filter(Boolean))].slice(0, 40) : undefined);

  if (typeof body.nome === "string" && body.nome.trim()) patch.nome = body.nome.trim().slice(0, 200);
  if (typeof body.setor === "string" && body.setor.trim()) patch.setor = body.setor.trim().slice(0, 120);
  if ("descricao" in body) patch.descricao = body.descricao ? String(body.descricao).slice(0, 1000) : null;
  if ("vp_nome" in body) patch.vp_nome = body.vp_nome ? String(body.vp_nome).slice(0, 200) : null;
  if ("vp_cargo" in body) patch.vp_cargo = body.vp_cargo ? String(body.vp_cargo).slice(0, 200) : null;
  if ("vp_minibio" in body) patch.vp_minibio = body.vp_minibio ? String(body.vp_minibio).slice(0, 3000) : null;
  if ("vp_foto_url" in body) {
    const url = typeof body.vp_foto_url === "string" && body.vp_foto_url.trim().startsWith("http") ? body.vp_foto_url.trim().slice(0, 1000) : null;
    patch.vp_foto_url = url;
  }
  if (strArray(body.agencia_siglas)) patch.agencia_siglas = strArray(body.agencia_siglas)!.map((s) => s.toUpperCase());
  if (strArray(body.microtemas)) patch.microtemas = strArray(body.microtemas);
  if (strArray(body.ministerios)) patch.ministerios = strArray(body.ministerios);
  if (strArray(body.ministerio_urls)) patch.ministerio_urls = strArray(body.ministerio_urls);
  if (strArray(body.palavras_chave)) patch.palavras_chave = strArray(body.palavras_chave);
  if ("ativo" in body) patch.ativo = Boolean(body.ativo);

  const { createSupabaseServerClient } = await import("@/lib/supabase/server");
  const db = createSupabaseServerClient();
  const { data, error } = await db.from("associados").update(patch).eq("id", id).select("*").single();
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json(data);
}
