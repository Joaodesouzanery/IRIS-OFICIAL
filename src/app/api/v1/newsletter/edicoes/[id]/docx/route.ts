import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/server/request-guards";
import { buildSimpleDocxFromHtml } from "@/lib/server/docx-export";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest, { params }: any) {
  const guard = await requireAdmin(req);
  if (guard) return guard;

  const db = createSupabaseServerClient();
  const { data, error } = await db
    .from("regulatory_newsletter_editions")
    .select("assunto, html, documento_tipo")
    .eq("id", params.id)
    .single();

  if (error || !data) {
    return NextResponse.json({ error: "Edicao nao encontrada" }, { status: 404 });
  }

  const file = buildSimpleDocxFromHtml({
    title: data.assunto,
    html: data.html,
    landscape: data.documento_tipo === "minuto_regulacao",
  });

  return new NextResponse(file, {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      "Content-Disposition": `attachment; filename="${safeFilename(data.assunto)}.docx"`,
    },
  });
}

function safeFilename(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 80) || "newsletter-regulatorio";
}
