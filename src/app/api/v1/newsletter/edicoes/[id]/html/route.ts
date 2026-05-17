import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/server/request-guards";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const guard = await requireAdmin(req);
  if (guard) return guard;

  const db = createSupabaseServerClient();
  const { data, error } = await db
    .from("regulatory_newsletter_editions")
    .select("assunto, html")
    .eq("id", params.id)
    .single();

  if (error || !data) {
    return NextResponse.json({ error: "Edição não encontrada" }, { status: 404 });
  }

  return new NextResponse(data.html, {
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Content-Disposition": `inline; filename="${safeFilename(data.assunto)}.html"`,
    },
  });
}

function safeFilename(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 80) || "newsletter-regulatorio";
}
