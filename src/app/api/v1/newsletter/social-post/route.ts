/**
 * POST /api/v1/newsletter/social-post
 * Auto-fetch de um post (Instagram/LinkedIn/qualquer link): tenta puxar título + resumo +
 * imagem via og-tags (reusa extractNewsFromUrl) e RE-HOSPEDA a imagem num URL estável.
 * IG/LinkedIn têm login-wall → frequentemente falha; nesse caso devolve `{ ok:false }`
 * (HTTP 200) para a UI cair no preenchimento MANUAL. Nunca 500 (degrade proposital).
 * Admin-only, demo-guarded.
 */

import { NextRequest, NextResponse } from "next/server";
import { isDemo } from "@/lib/server/is-demo";
import { isDemoRequest, requireAdmin } from "@/lib/server/request-guards";
import { assertPublicUrl } from "@/lib/server/url-guard";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(req: NextRequest) {
  if (isDemo() || isDemoRequest(req)) {
    return NextResponse.json({ ok: false, reason: "Indisponível em modo DEMO." }, { status: 403 });
  }
  const guard = await requireAdmin(req);
  if (guard) return guard;

  const body = await req.json().catch(() => ({}));
  const rawUrl = typeof body?.url === "string" ? body.url.trim() : "";
  if (!rawUrl) {
    return NextResponse.json({ ok: false, reason: "Informe a URL do post (campo 'url')." }, { status: 400 });
  }
  try {
    assertPublicUrl(rawUrl);
  } catch {
    return NextResponse.json({ ok: false, reason: "URL inválida ou não permitida." }, { status: 400 });
  }

  const { extractNewsFromUrl } = await import("@/lib/server/news-collector");
  let extracted: Awaited<ReturnType<typeof extractNewsFromUrl>> = null;
  try {
    extracted = await extractNewsFromUrl(rawUrl);
  } catch {
    extracted = null;
  }
  if (!extracted || !extracted.item?.titulo) {
    return NextResponse.json({
      ok: false,
      reason: "Não consegui ler esse post automaticamente (Instagram/LinkedIn costumam bloquear). Preencha título e resumo à mão.",
    });
  }

  const { item } = extracted;
  let imagem_url: string | null = null;
  if (item.imagem_url) {
    try {
      const { createSupabaseServerClient } = await import("@/lib/supabase/server");
      const { rehostImageFromUrl } = await import("@/lib/server/newsletter-images");
      imagem_url = await rehostImageFromUrl(createSupabaseServerClient(), item.imagem_url);
    } catch {
      imagem_url = null; // sem foto estável → o usuário sobe manualmente se quiser
    }
  }

  const resumo = (item.resumo ?? (item.conteudo ? item.conteudo.slice(0, 400) : "")) || "";
  return NextResponse.json({
    ok: true,
    titulo: item.titulo,
    resumo,
    imagem_url,
    fonte: extracted.detected?.agencia_sigla ?? null,
    warnings: imagem_url ? [] : item.imagem_url ? ["A imagem do post não pôde ser hospedada — suba uma manualmente se quiser foto."] : [],
  });
}
