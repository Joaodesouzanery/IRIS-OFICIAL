/**
 * Re-hospedagem de imagens da newsletter num bucket PÚBLICO do Supabase Storage.
 *
 * Por quê: no e-mail a imagem precisa de URL público, estável e sem auth. As imagens de
 * post social (Instagram/LinkedIn) vêm de CDN que EXPIRA, e o proxy /noticias/imagem só
 * serve host gov.br — ambas quebrariam no e-mail. Baixamos a imagem (SSRF-guard + cap de
 * bytes) e re-hospedamos num bucket público → URL permanente do próprio projeto.
 *
 * O bucket é criado em RUNTIME (espelha ensurePdfStorageBucket) — bucket público serve
 * leitura sem RLS e o service_role escreve bypassando RLS, então NÃO exige migration.
 */

import { assertPublicUrl } from "@/lib/server/url-guard";
import { sha256Hex } from "@/lib/server/pdf-extractor";

// Mesmo padrão do upload-queue.ts (db: any) — o client do Supabase não é tipado no projeto.
type SupabaseLike = any;

const BUCKET = "newsletter-images";
const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
const BROWSER_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";
const IMAGE_ACCEPT = "image/avif,image/webp,image/png,image/jpeg,image/*,*/*;q=0.8";
const ALLOWED_TYPES = ["image/jpeg", "image/png", "image/webp", "image/gif", "image/avif", "image/svg+xml"];
const EXT_BY_TYPE: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif",
  "image/avif": "avif",
  "image/svg+xml": "svg",
};

/** Cria o bucket público em runtime se ainda não existir (idempotente). */
export async function ensureNewsletterImagesBucket(db: SupabaseLike): Promise<void> {
  const { data: bucket } = await db.storage.getBucket(BUCKET);
  if (bucket) return;
  const { error } = await db.storage.createBucket(BUCKET, {
    public: true,
    fileSizeLimit: MAX_IMAGE_BYTES,
    allowedMimeTypes: ALLOWED_TYPES,
  });
  if (error && !/already exists|duplicate/i.test(error.message ?? "")) throw error;
}

function normalizeContentType(raw: string | null): string {
  return (raw ?? "").toLowerCase().split(";")[0].trim();
}

/** Lê o corpo cortando no teto de bytes (chunked não tem content-length → cap por header é contornável). */
async function readCappedBuffer(body: ReadableStream<Uint8Array>, maxBytes: number): Promise<Buffer> {
  const reader = body.getReader();
  const chunks: Buffer[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel();
      throw new Error("Imagem excede o tamanho permitido");
    }
    chunks.push(Buffer.from(value));
  }
  return Buffer.concat(chunks);
}

async function storeBuffer(db: SupabaseLike, buffer: Buffer, contentType: string): Promise<string | null> {
  await ensureNewsletterImagesBucket(db);
  const ext = EXT_BY_TYPE[contentType] ?? "jpg";
  const path = `posts/${await sha256Hex(buffer)}.${ext}`;
  const { error } = await db.storage.from(BUCKET).upload(path, buffer, { contentType, upsert: true });
  if (error) throw error;
  const { data } = db.storage.from(BUCKET).getPublicUrl(path);
  return (data?.publicUrl as string | undefined) ?? null;
}

/**
 * Baixa a imagem de uma URL pública e re-hospeda no bucket. Devolve a URL pública estável,
 * ou null se não for imagem / o download falhar (degrade PROPOSITAL — o card fica sem foto,
 * não quebra o fluxo). SSRF: `assertPublicUrl` + `redirect:"manual"` (não segue redirect p/
 * IP interno; um redirect vira resposta opaca → null).
 */
export async function rehostImageFromUrl(db: SupabaseLike, rawUrl: string): Promise<string | null> {
  let url: URL;
  try {
    url = assertPublicUrl(rawUrl);
  } catch {
    return null;
  }
  let res: Response | null = null;
  const attempts: Array<Record<string, string>> = [
    { "User-Agent": BROWSER_UA, Accept: IMAGE_ACCEPT, Referer: `${url.origin}/` },
    { "User-Agent": BROWSER_UA, Accept: IMAGE_ACCEPT },
  ];
  for (const headers of attempts) {
    try {
      const r = await fetch(url, { headers, redirect: "manual" });
      if (r.ok && r.body) {
        res = r;
        break;
      }
      await r.body?.cancel();
      if (r.status !== 401 && r.status !== 403) break; // só re-tenta bloqueio de hotlink
    } catch {
      /* tenta o próximo conjunto de headers */
    }
  }
  if (!res || !res.body) return null;
  const contentType = normalizeContentType(res.headers.get("content-type"));
  if (!contentType.startsWith("image/")) {
    await res.body.cancel();
    return null;
  }
  if (Number(res.headers.get("content-length") ?? 0) > MAX_IMAGE_BYTES) {
    await res.body.cancel();
    return null;
  }
  try {
    const buffer = await readCappedBuffer(res.body, MAX_IMAGE_BYTES);
    return await storeBuffer(db, buffer, contentType);
  } catch {
    return null;
  }
}

/** Re-hospeda a partir de um buffer (upload manual/screenshot). Lança em entrada inválida. */
export async function rehostImageBuffer(db: SupabaseLike, buffer: Buffer, rawContentType: string): Promise<string | null> {
  const contentType = normalizeContentType(rawContentType);
  if (!contentType.startsWith("image/")) throw new Error("Arquivo não é uma imagem");
  if (buffer.byteLength > MAX_IMAGE_BYTES) throw new Error("Imagem excede o tamanho permitido");
  return storeBuffer(db, buffer, contentType);
}
