import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/server/request-guards";
import { detectComplianceFlags, sanitizeEvidenceText } from "@/lib/server/qualidade-regulatoria";
import { loadQualidadeDashboardData } from "@/lib/server/qualidade-regulatoria-service";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const agencia = req.nextUrl.searchParams.get("agencia_sigla")?.toUpperCase();
  const criterio = Number(req.nextUrl.searchParams.get("criterio_id") ?? 0);
  try {
    const db = createSupabaseServerClient();
    let query = db.from("qualidade_regulatoria_evidencias").select("*").order("created_at", { ascending: false }).limit(500);
    if (agencia) query = query.eq("agencia_sigla", agencia);
    if (criterio) query = query.eq("criterio_id", criterio);
    const { data, error } = await query;
    if (!error && data?.length) return NextResponse.json({ data, source: "database" });
  } catch {
    // Fallback below covers local/demo environments without Supabase configured.
  }

  const year = Number(req.nextUrl.searchParams.get("ano") ?? new Date().getFullYear());
  const dashboard = await loadQualidadeDashboardData(year);
  const data = dashboard.evidencias_resumo
    .filter((item) => !agencia || item.agencia_sigla === agencia)
    .filter((item) => !criterio || item.criterio_id === criterio);
  return NextResponse.json({ data, source: dashboard.source });
}

export async function POST(req: NextRequest) {
  const guard = await requireAdmin(req);
  if (guard) return guard;

  const body = await req.json().catch(() => ({})) as {
    avaliacao_id?: string | null;
    agencia_sigla?: string;
    criterio_id?: number;
    titulo?: string;
    url?: string | null;
    fonte?: string | null;
    trecho_publico?: string | null;
    data_referencia?: string | null;
  };
  if (!body.agencia_sigla || !body.criterio_id || !body.titulo) {
    return NextResponse.json({ error: "Informe agência, critério e título da evidência." }, { status: 400 });
  }

  const raw = `${body.titulo} ${body.trecho_publico ?? ""}`;
  const db = createSupabaseServerClient();
  const { data, error } = await db
    .from("qualidade_regulatoria_evidencias")
    .insert({
      avaliacao_id: body.avaliacao_id ?? null,
      agencia_sigla: body.agencia_sigla.toUpperCase(),
      criterio_id: Number(body.criterio_id),
      titulo: sanitizeEvidenceText(body.titulo),
      url: body.url ?? null,
      fonte: body.fonte ?? null,
      trecho_publico: sanitizeEvidenceText(body.trecho_publico),
      data_referencia: body.data_referencia ?? null,
      status_revisao: "pendente",
      compliance_flags: detectComplianceFlags(raw),
    })
    .select("*")
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ evidencia: data });
}
