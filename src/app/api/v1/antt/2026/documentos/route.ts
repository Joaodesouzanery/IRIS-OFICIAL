import { NextRequest, NextResponse } from "next/server";
import { isDemo } from "@/lib/server/is-demo";
import type { DocumentoColetado } from "@/types";
import { isDemoRequest } from "@/lib/server/request-guards";

export const dynamic = "force-dynamic";

const STATUS_RE = /^(coletado|validado|em_revisao|importado|ignorado|erro)$/;

export async function GET(req: NextRequest) {
  if (isDemo() || isDemoRequest(req)) {
    return NextResponse.json([] satisfies DocumentoColetado[]);
  }

  const status = req.nextUrl.searchParams.get("status");
  if (status && !STATUS_RE.test(status)) {
    return NextResponse.json({ error: "Status invalido" }, { status: 400 });
  }

  const { createSupabaseServerClient } = await import("@/lib/supabase/server");
  const db = createSupabaseServerClient();
  let query = db
    .from("documentos_coletados")
    .select(`
      *,
      reuniao:antt_reunioes_coletadas(titulo, tipo, data_inicio, url_reuniao),
      processo:antt_processos_coletados(processo, interessado, relator, assunto, decisao)
    `)
    .order("coletado_em", { ascending: false })
    .limit(500);

  if (status) query = query.eq("status", status);

  const { data, error } = await query;

  if (error) {
    return NextResponse.json({ error: "Erro ao buscar documentos ANTT 2026" }, { status: 500 });
  }

  return NextResponse.json(data ?? []);
}
