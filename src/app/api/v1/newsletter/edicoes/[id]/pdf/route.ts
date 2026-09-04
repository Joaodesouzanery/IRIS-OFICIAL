import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/server/request-guards";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest, { params }: any) {
  const guard = await requireAdmin(req);
  if (guard) return guard;

  const db = createSupabaseServerClient();
  const { data, error } = await db
    .from("regulatory_newsletter_editions")
    .select("assunto, html, metadata")
    .eq("id", params.id)
    .single();

  if (error || !data) {
    return NextResponse.json({ error: "Edição não encontrada" }, { status: 404 });
  }

  // Fase 17 — serve o HTML de IMPRESSÃO. Fallback para `html` nas edições salvas ANTES deste
  // commit (elas só têm o de e-mail — é o que existe, e continuar servindo é melhor que 404).
  const htmlDeImpressao =
    ((data.metadata as Record<string, unknown> | null)?.html_print as string | undefined) ?? data.html;
  return new NextResponse(htmlDeImpressao, {
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Content-Disposition": `inline; filename="${safeFilename(data.assunto)}-pdf.html"`,
      "X-IRIS-PDF-Mode": "browser-print",
    },
  });
}

function safeFilename(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 80) || "newsletter-regulatorio";
}
