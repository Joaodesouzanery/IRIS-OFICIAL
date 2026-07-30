/**
 * POST /api/v1/newsletter/imagem
 * Re-hospeda uma imagem num bucket público do Supabase → URL estável para o e-mail
 * (não expira como CDN social, não depende da allowlist gov.br do proxy). Aceita
 * `{ url }` (baixa a imagem) OU upload multipart no campo `file` (screenshot/fallback).
 * Admin-only, demo-guarded (iris-api-conventions).
 */

import { NextRequest, NextResponse } from "next/server";
import { isDemo } from "@/lib/server/is-demo";
import { isDemoRequest, requireAdmin } from "@/lib/server/request-guards";
import { rehostImageFromUrl, rehostImageBuffer } from "@/lib/server/newsletter-images";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

const MAX_IMAGE_BYTES = 8 * 1024 * 1024;

export async function POST(req: NextRequest) {
  if (isDemo() || isDemoRequest(req)) {
    return NextResponse.json({ error: "Hospedagem de imagem indisponível em modo DEMO." }, { status: 403 });
  }
  const guard = await requireAdmin(req);
  if (guard) return guard;

  const { createSupabaseServerClient } = await import("@/lib/supabase/server");
  const db = createSupabaseServerClient();
  const contentType = req.headers.get("content-type") ?? "";

  try {
    if (contentType.includes("multipart/form-data")) {
      const form = await req.formData();
      const file = form.get("file");
      if (!(file instanceof File)) {
        return NextResponse.json({ error: "Envie um arquivo de imagem no campo 'file'." }, { status: 400 });
      }
      if (file.size > MAX_IMAGE_BYTES) {
        return NextResponse.json({ error: "Imagem excede o tamanho permitido (8 MB)." }, { status: 413 });
      }
      const buffer = Buffer.from(await file.arrayBuffer());
      const imagem_url = await rehostImageBuffer(db, buffer, file.type);
      if (!imagem_url) return NextResponse.json({ error: "Falha ao hospedar a imagem." }, { status: 502 });
      return NextResponse.json({ imagem_url });
    }

    const body = await req.json().catch(() => ({}));
    const rawUrl = typeof body?.url === "string" ? body.url.trim() : "";
    if (!rawUrl) {
      return NextResponse.json({ error: "Informe a URL da imagem (campo 'url') ou envie um arquivo." }, { status: 400 });
    }
    const imagem_url = await rehostImageFromUrl(db, rawUrl);
    if (!imagem_url) {
      return NextResponse.json(
        { error: "Não foi possível baixar/hospedar essa imagem (link inválido, privado, expirado ou não é imagem)." },
        { status: 502 },
      );
    }
    return NextResponse.json({ imagem_url });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Falha ao hospedar a imagem.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
