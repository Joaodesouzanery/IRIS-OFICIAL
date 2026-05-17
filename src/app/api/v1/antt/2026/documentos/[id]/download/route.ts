import { NextRequest, NextResponse } from "next/server";
import { isDemo } from "@/lib/server/is-demo";
import { isDemoRequest } from "@/lib/server/request-guards";

const SAFE_ID_RE = /^[0-9a-f-]{32,36}$/i;

export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  if (!SAFE_ID_RE.test(params.id)) {
    return NextResponse.json({ error: "ID invalido" }, { status: 400 });
  }

  if (isDemo() || isDemoRequest(req)) {
    return NextResponse.json({ error: "Download indisponivel em modo demo" }, { status: 403 });
  }

  const { createSupabaseServerClient } = await import("@/lib/supabase/server");
  const db = createSupabaseServerClient();
  const { data: doc, error } = await db
    .from("documentos_coletados")
    .select("storage_bucket, storage_path")
    .eq("id", params.id)
    .single();

  if (error || !doc?.storage_path) {
    return NextResponse.json({ error: "Documento nao encontrado" }, { status: 404 });
  }

  const { data, error: signedError } = await db.storage
    .from(doc.storage_bucket ?? "pdfs")
    .createSignedUrl(doc.storage_path, 60);

  if (signedError || !data?.signedUrl) {
    return NextResponse.json({ error: "Falha ao criar URL temporaria" }, { status: 500 });
  }

  return NextResponse.json({ url: data.signedUrl, expires_in: 60 });
}
