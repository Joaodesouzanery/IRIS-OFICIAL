import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/server/request-guards";
import { detectComplianceFlags, sanitizeEvidenceText } from "@/lib/server/qualidade-regulatoria";
import { loadQualidadeDashboardData } from "@/lib/server/qualidade-regulatoria-service";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const agencia = req.nextUrl.searchParams.get("agencia_sigla")?.toUpperCase();
  const criterio = Number(req.nextUrl.searchParams.get("criterio_id") ?? 0);
  const origem = req.nextUrl.searchParams.get("origem");
  try {
    const db = createSupabaseServerClient();
    let query = db.from("qualidade_regulatoria_evidencias").select("*").order("created_at", { ascending: false }).limit(500);
    if (agencia) query = query.eq("agencia_sigla", agencia);
    if (criterio) query = query.eq("criterio_id", criterio);
    if (origem) query = query.eq("origem", origem);
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

// Revisao humana: muda o status de revisao (pendente -> validado/rejeitado).
// Apenas evidencias "validado" devem alimentar a pontuacao do premio.
export async function PATCH(req: NextRequest) {
  const guard = await requireAdmin(req);
  if (guard) return guard;

  const body = await req.json().catch(() => ({})) as {
    id?: string;
    status_revisao?: string;
  };
  const allowed = ["pendente", "em_revisao", "validado", "rejeitado"];
  if (!body.id || !body.status_revisao || !allowed.includes(body.status_revisao)) {
    return NextResponse.json({ error: "Informe id e status_revisao válido (validado/rejeitado/pendente)." }, { status: 400 });
  }

  const db = createSupabaseServerClient();
  const { data, error } = await db
    .from("qualidade_regulatoria_evidencias")
    .update({ status_revisao: body.status_revisao })
    .eq("id", body.id)
    .select("*")
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Fecha o ciclo: recalcula a contagem de evidências validadas da avaliação
  // correspondente (agência + critério). Apenas evidências "validado" contam
  // para o painel/prêmio. Falhas aqui não invalidam a mudança de status.
  let validated_count: number | null = null;
  try {
    if (data?.agencia_sigla && data?.criterio_id) {
      const { count } = await db
        .from("qualidade_regulatoria_evidencias")
        .select("id", { count: "exact", head: true })
        .eq("agencia_sigla", data.agencia_sigla)
        .eq("criterio_id", data.criterio_id)
        .eq("status_revisao", "validado");
      validated_count = count ?? 0;

      let upd = db
        .from("qualidade_regulatoria_avaliacoes")
        .update({ evidencias_count: validated_count, updated_at: new Date().toISOString() })
        .eq("agencia_sigla", data.agencia_sigla)
        .eq("criterio_id", data.criterio_id);
      if (data.avaliacao_id) upd = upd.eq("id", data.avaliacao_id);
      await upd;
    }
  } catch (recalcError) {
    console.warn("[qualidade/evidencias] Falha ao recalcular evidencias_count:", recalcError instanceof Error ? recalcError.message : recalcError);
  }

  return NextResponse.json({ evidencia: data, evidencias_validadas: validated_count });
}
