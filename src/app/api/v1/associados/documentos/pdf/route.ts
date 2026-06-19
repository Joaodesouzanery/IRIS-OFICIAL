import { NextRequest, NextResponse } from "next/server";
import { requireAdminOrCron } from "@/lib/server/request-guards";
import { renderPdfFromHtml } from "@/lib/server/headless";

export const dynamic = "force-dynamic";

/**
 * POST /api/v1/associados/documentos/pdf
 * Renderiza em PDF um HTML de preview ainda não salvo. Body: { html: string, filename?: string }.
 */
export async function POST(req: NextRequest) {
  const guard = await requireAdminOrCron(req);
  if (guard) return guard;

  const body = await req.json().catch(() => ({})) as { html?: unknown; filename?: unknown };
  const html = typeof body.html === "string" ? body.html : "";
  if (!html || html.length < 20) {
    return NextResponse.json({ error: "html é obrigatório" }, { status: 400 });
  }
  if (html.length > 5_000_000) {
    return NextResponse.json({ error: "html muito grande" }, { status: 413 });
  }

  const filename = typeof body.filename === "string" && body.filename.trim() ? body.filename : "relatorio";

  try {
    const pdf = await renderPdfFromHtml(html);
    return new NextResponse(new Uint8Array(pdf), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="${safeFilename(filename)}.pdf"`,
      },
    });
  } catch (e) {
    console.error("[associados/documentos/pdf POST] Falha ao gerar PDF:", e);
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
    .toLowerCase() || "relatorio";
}
