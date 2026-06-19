import { NextRequest, NextResponse } from "next/server";
import { isDemo } from "@/lib/server/is-demo";
import { isDemoRequest } from "@/lib/server/request-guards";
import { buildRichDocxFromHtml } from "@/lib/server/docx-export";

export const dynamic = "force-dynamic";

/**
 * GET /api/v1/associados/documentos/[id]/docx
 * .docx estrutural (headings, parágrafos, listas e tabelas) para edição no Word.
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
    const buffer = buildRichDocxFromHtml({ title: data.titulo, html: data.html });
    return new NextResponse(new Uint8Array(buffer), {
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        "Content-Disposition": `attachment; filename="${safeFilename(data.titulo)}.docx"`,
      },
    });
  } catch (e) {
    console.error("[associados/documentos/docx] Falha ao gerar DOCX:", e);
    return NextResponse.json({ error: "Falha ao gerar DOCX" }, { status: 500 });
  }
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
