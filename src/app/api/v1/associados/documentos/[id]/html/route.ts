import { NextRequest, NextResponse } from "next/server";
import { isDemo } from "@/lib/server/is-demo";
import { isDemoRequest } from "@/lib/server/request-guards";

export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  if (isDemo() || isDemoRequest(req)) {
    return new NextResponse("<!doctype html><html><body><p>Documento demo nao persistido. Gere novamente pela tela de Documentos.</p></body></html>", {
      headers: { "Content-Type": "text/html; charset=utf-8" },
    });
  }

  const { createSupabaseServerClient } = await import("@/lib/supabase/server");
  const db = createSupabaseServerClient();
  const { data, error } = await db
    .from("documentos_associado")
    .select("titulo, html")
    .eq("id", params.id)
    .single();

  if (error || !data) {
    return NextResponse.json({ error: "Documento nao encontrado" }, { status: 404 });
  }

  return new NextResponse(data.html, {
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Content-Disposition": `attachment; filename="${safeFilename(data.titulo)}.html"`,
    },
  });
}

function safeFilename(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9-]+/gi, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80)
    .toLowerCase();
}
