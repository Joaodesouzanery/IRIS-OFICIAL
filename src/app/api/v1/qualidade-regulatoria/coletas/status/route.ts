import { NextResponse } from "next/server";
import { QUALIDADE_FONTES } from "@/lib/server/qualidade-regulatoria";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const db = createSupabaseServerClient();
    const { data, error } = await db
      .from("qualidade_regulatoria_coletas")
      .select("id, agencia_sigla, criterio_id, fonte_id, status, data_coleta, warnings, compliance_status")
      .order("data_coleta", { ascending: false })
      .limit(200);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    const rows = data ?? [];
    return NextResponse.json({
      data: rows,
      fontes: QUALIDADE_FONTES,
      metricas: {
        total: rows.length,
        sucesso: rows.filter((item) => item.status === "sucesso").length,
        falha: rows.filter((item) => item.status === "falha").length,
        restrito: rows.filter((item) => item.status === "restrito").length,
        pendente_revisao: rows.filter((item) => item.compliance_status === "pendente_revisao").length,
      },
    });
  } catch {
    return NextResponse.json({
      data: [],
      fontes: QUALIDADE_FONTES,
      metricas: { total: 0, sucesso: 0, falha: 0, restrito: 0, pendente_revisao: 0 },
    });
  }
}
