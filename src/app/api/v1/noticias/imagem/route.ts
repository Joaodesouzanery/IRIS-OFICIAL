import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";

const MAX_IMAGE_BYTES = 8 * 1024 * 1024;

export async function GET(req: NextRequest) {
  const rawUrl = req.nextUrl.searchParams.get("url");
  if (!rawUrl) {
    return NextResponse.json({ error: "URL da imagem obrigatória" }, { status: 400 });
  }

  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return NextResponse.json({ error: "URL da imagem inválida" }, { status: 400 });
  }

  if (!isAllowedOfficialImageHost(url)) {
    return NextResponse.json({ error: "Domínio de imagem não autorizado" }, { status: 403 });
  }

  const res = await fetch(url, {
    headers: {
      "User-Agent": "IRIS-Regulacao-Noticias/1.0 (+https://iris-oficial.vercel.app)",
      Accept: "image/avif,image/webp,image/png,image/jpeg,image/*",
      Referer: `${url.origin}/`,
    },
    next: { revalidate: 3600 },
  });

  if (!res.ok || !res.body) {
    return NextResponse.json({ error: "Imagem oficial indisponível" }, { status: 502 });
  }

  const contentType = res.headers.get("content-type") ?? "";
  if (!contentType.toLowerCase().startsWith("image/")) {
    return NextResponse.json({ error: "Resposta não é uma imagem" }, { status: 415 });
  }

  const contentLength = Number(res.headers.get("content-length") ?? 0);
  if (contentLength > MAX_IMAGE_BYTES) {
    return NextResponse.json({ error: "Imagem excede o tamanho permitido" }, { status: 413 });
  }

  return new NextResponse(res.body, {
    status: 200,
    headers: {
      "Content-Type": contentType,
      "Cache-Control": "public, max-age=3600, s-maxage=86400, stale-while-revalidate=604800",
    },
  });
}

function isAllowedOfficialImageHost(url: URL) {
  if (url.protocol !== "https:" && url.protocol !== "http:") return false;
  const host = url.hostname.toLowerCase();
  return host === "gov.br" ||
    host.endsWith(".gov.br") ||
    host === "sp.gov.br" ||
    host.endsWith(".sp.gov.br");
}
