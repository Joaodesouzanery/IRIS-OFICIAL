import { NextRequest, NextResponse } from "next/server";
import { isDemo } from "@/lib/server/is-demo";
import { isDemoRequest } from "@/lib/server/request-guards";

export const dynamic = "force-dynamic";

/**
 * GET /api/v1/associados/documentos/[id]/word
 * Devolve o relatório como .doc (HTML interpretado pelo Word), preservando tabelas,
 * imagens e layout — totalmente editável.
 */
export async function GET(req: NextRequest, { params }: any) {
  if (isDemo() || isDemoRequest(req)) {
    return NextResponse.json({ error: "Documento demo não persistido. Gere novamente pela tela de Relatórios." }, { status: 400 });
  }

  const { createSupabaseServerClient } = await import("@/lib/supabase/server");
  const db = createSupabaseServerClient();
  const { data, error } = await db
    .from("documentos_associado")
    .select("titulo, html")
    .eq("id", params.id)
    .single();

  if (error || !data) {
    return NextResponse.json({ error: "Documento não encontrado" }, { status: 404 });
  }

  return new NextResponse(data.html, {
    headers: {
      "Content-Type": "application/msword; charset=utf-8",
      "Content-Disposition": `attachment; filename="${safeFilename(data.titulo)}.doc"`,
    },
  });
}

function safeFilename(value: string) {
  return value
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9-]+/gi, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80)
    .toLowerCase() || "relatorio";
}
