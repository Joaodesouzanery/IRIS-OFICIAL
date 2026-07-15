import { NextRequest, NextResponse } from "next/server";
import { isPublicUrl } from "@/lib/server/url-guard";

export const dynamic = "force-dynamic";

const MAX_IMAGE_BYTES = 8 * 1024 * 1024;

// Corta o stream no teto de bytes (SSRF/egress): resposta chunked não tem
// content-length, então o cap só por header era contornável.
function limitStreamBytes(body: ReadableStream<Uint8Array>, maxBytes: number): ReadableStream<Uint8Array> {
  const reader = body.getReader();
  let total = 0;
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      const { done, value } = await reader.read();
      if (done) return controller.close();
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel();
        return controller.error(new Error("Imagem excede o tamanho permitido"));
      }
      controller.enqueue(value);
    },
    cancel() {
      void reader.cancel();
    },
  });
}

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

  if (!isAllowedOfficialImageHost(url) || !isPublicUrl(rawUrl)) {
    return NextResponse.json({ error: "Domínio de imagem não autorizado" }, { status: 403 });
  }

  const res = await fetchOfficialImage(url);
  if (!res || !res.ok || !res.body) {
    return NextResponse.json({ error: "Imagem oficial indisponível" }, { status: 502 });
  }

  const contentType = res.headers.get("content-type") ?? "";
  const normalizedContentType = contentType.toLowerCase();
  const looksLikeImagePath = /\.(avif|gif|jpe?g|png|webp|svg)(?:$|\?)/i.test(url.pathname);
  if (!normalizedContentType.startsWith("image/") && !looksLikeImagePath) {
    return NextResponse.json({ error: "Resposta não é uma imagem" }, { status: 415 });
  }

  const contentLength = Number(res.headers.get("content-length") ?? 0);
  if (contentLength > MAX_IMAGE_BYTES) {
    return NextResponse.json({ error: "Imagem excede o tamanho permitido" }, { status: 413 });
  }

  return new NextResponse(limitStreamBytes(res.body, MAX_IMAGE_BYTES), {
    status: 200,
    headers: {
      "Content-Type": normalizedContentType.startsWith("image/") ? contentType : inferImageContentType(url.pathname),
      "Cache-Control": "public, max-age=3600, s-maxage=86400, stale-while-revalidate=604800",
    },
  });
}

// UA de navegador real reduz bloqueio de hotlink/WAF que rejeita user-agents de bot.
const BROWSER_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";
const IMAGE_ACCEPT = "image/avif,image/webp,image/png,image/jpeg,image/*,*/*;q=0.8";

// Busca a imagem oficial; em 401/403 (proteção de hotlink) tenta de novo SEM Referer.
// SSRF: `redirect:"manual"` — a allowlist valida só a URL LITERAL; um open-redirect num
// host gov.br levaria o fetch (e o corpo devolvido ao cliente) para 169.254/127.0.0.1. Um
// redirect vira resposta opaca (res.ok=false) → 502/placeholder, nunca seguido.
async function fetchOfficialImage(url: URL): Promise<Response | null> {
  const attempts: Array<Record<string, string>> = [
    { "User-Agent": BROWSER_UA, Accept: IMAGE_ACCEPT, Referer: `${url.origin}/` },
    { "User-Agent": BROWSER_UA, Accept: IMAGE_ACCEPT },
  ];
  let last: Response | null = null;
  for (const headers of attempts) {
    try {
      const res = await fetch(url, { headers, redirect: "manual", next: { revalidate: 3600 } });
      if (res.ok) return res;
      last = res;
      if (res.status !== 401 && res.status !== 403) return res; // só re-tenta bloqueio de hotlink
      await res.body?.cancel();
    } catch {
      last = null;
    }
  }
  return last;
}

function isAllowedOfficialImageHost(url: URL) {
  if (url.protocol !== "https:" && url.protocol !== "http:") return false;
  const host = url.hostname.toLowerCase();
  return host === "gov.br" ||
    host.endsWith(".gov.br") ||
    host === "sp.gov.br" ||
    host.endsWith(".sp.gov.br") ||
    host === "senado.leg.br" ||
    host.endsWith(".senado.leg.br") ||
    host === "senado.gov.br" ||
    host.endsWith(".senado.gov.br");
}

function inferImageContentType(pathname: string) {
  const path = pathname.toLowerCase();
  if (path.endsWith(".png")) return "image/png";
  if (path.endsWith(".webp")) return "image/webp";
  if (path.endsWith(".gif")) return "image/gif";
  if (path.endsWith(".svg")) return "image/svg+xml";
  if (path.endsWith(".avif")) return "image/avif";
  return "image/jpeg";
}
