import { NextRequest, NextResponse } from "next/server";
import { isDemo } from "@/lib/server/is-demo";
import { isDemoRequest } from "@/lib/server/request-guards";
import { renderPdfFromHtml } from "@/lib/server/headless";

export const dynamic = "force-dynamic";

/**
 * GET /api/v1/associados/documentos/[id]/pdf
 * Renderiza o documento salvo em PDF fiel no servidor (Puppeteer), sem depender da
 * impressão do navegador.
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

  try {
    const pdf = await renderPdfFromHtml(data.html);
    return new NextResponse(new Uint8Array(pdf), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="${safeFilename(data.titulo)}.pdf"`,
      },
    });
  } catch (e) {
    console.error("[associados/documentos/pdf] Falha ao gerar PDF:", e);
    return NextResponse.json({ error: "Falha ao gerar PDF" }, { status: 500 });
  }
}

function safeFilename(value: string) {
  return value
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9-]+/gi, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80)
    .toLowerCase();
}
