/**
 * POST /api/v1/associados/documentos/docx  { html, titulo }
 * Converte o HTML de um Relatório do Observatório (Associado/Mensal) em .docx (Word) editável,
 * reusando o gerador docx próprio do projeto. Admin-only, demo-guarded.
 */

import { NextRequest, NextResponse } from "next/server";
import { isDemo } from "@/lib/server/is-demo";
import { isDemoRequest, requireAdmin } from "@/lib/server/request-guards";
import { buildSimpleDocxFromHtml } from "@/lib/server/docx-export";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function safeFilename(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9-]+/gi, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80)
    .toLowerCase() || "relatorio";
}

export async function POST(req: NextRequest) {
  if (isDemo() || isDemoRequest(req)) {
    return NextResponse.json({ error: "Exportação indisponível em modo DEMO." }, { status: 403 });
  }
  const guard = await requireAdmin(req);
  if (guard) return guard;

  const body = await req.json().catch(() => ({}));
  const html = typeof body?.html === "string" ? body.html : "";
  const titulo = typeof body?.titulo === "string" && body.titulo.trim() ? body.titulo.trim().slice(0, 200) : "Relatório do Observatório";
  if (!html || html.length < 20) {
    return NextResponse.json({ error: "HTML do relatório ausente." }, { status: 400 });
  }

  const buffer = buildSimpleDocxFromHtml({ title: titulo, html });
  return new NextResponse(new Uint8Array(buffer), {
    headers: {
      "content-type": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      "content-disposition": `attachment; filename="${safeFilename(titulo)}.docx"`,
    },
  });
}
