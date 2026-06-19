import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/server/request-guards";
import {
  clampScore,
  detectComplianceFlags,
  QUALIDADE_CRITERIOS,
  QUALIDADE_AGENCIAS,
  sanitizeEvidenceText,
  scoreToLevel,
} from "@/lib/server/qualidade-regulatoria";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { recomputeAndPersistDiagnostics } from "@/lib/server/qualidade-regulatoria-service";

export const dynamic = "force-dynamic";

type Body = {
  agencia_sigla?: string;
  ano?: number;
  criterio_id?: number;
  nota?: number;
  observacao?: string | null;
  status_revisao?: "preliminar" | "pendente" | "em_revisao" | "validado" | "rejeitado";
  evidencias?: Array<{ titulo: string; url?: string | null; fonte?: string | null; trecho?: string | null; data_referencia?: string | null }>;
};

export async function GET(req: NextRequest) {
  const year = Number(req.nextUrl.searchParams.get("ano") ?? new Date().getFullYear());
  const agencia = req.nextUrl.searchParams.get("agencia_sigla")?.toUpperCase();
  try {
    const db = createSupabaseServerClient();
    let query = db.from("qualidade_regulatoria_avaliacoes").select("*").eq("ano", year).order("agencia_sigla").order("criterio_id");
    if (agencia) query = query.eq("agencia_sigla", agencia);
    const { data, error } = await query;
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ data: data ?? [] });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Erro ao buscar avaliações" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const guard = await requireAdmin(req);
  if (guard) return guard;

  const body = await req.json().catch(() => ({})) as Body;
  const agenciaSigla = body.agencia_sigla?.trim().toUpperCase();
  const criterion = QUALIDADE_CRITERIOS.find((item) => item.id === Number(body.criterio_id));
  const agency = QUALIDADE_AGENCIAS.find((item) => item.sigla === agenciaSigla);
  if (!agency || !criterion || typeof body.nota !== "number") {
    return NextResponse.json({ error: "Informe agencia_sigla, criterio_id e nota válidos." }, { status: 400 });
  }

  const db = createSupabaseServerClient();
  const note = clampScore(body.nota);
  const row = {
    agencia_sigla: agency.sigla,
    ano: Number(body.ano ?? new Date().getFullYear()),
    criterio_id: criterion.id,
    nota: note,
    nivel: scoreToLevel(note),
    observacao: sanitizeEvidenceText(body.observacao ?? ""),
    fonte_avaliacao: "manual_review",
    status_revisao: body.status_revisao ?? "pendente",
    metadata: {
      lgpd_lai_guardrails: true,
      institutional_assessment_only: true,
    },
    updated_at: new Date().toISOString(),
  };

  const { data, error } = await db
    .from("qualidade_regulatoria_avaliacoes")
    .upsert(row, { onConflict: "agencia_sigla,ano,criterio_id" })
    .select("*")
    .single();

  if (error || !data) {
    return NextResponse.json({ error: error?.message ?? "Erro ao salvar avaliação" }, { status: 500 });
  }

  const evidences = (body.evidencias ?? []).filter((item) => item.titulo?.trim()).slice(0, 10);
  if (evidences.length) {
    const { error: evidenceError } = await db.from("qualidade_regulatoria_evidencias").insert(evidences.map((item) => {
      const rawText = item.trecho ?? "";
      return {
        avaliacao_id: data.id,
        agencia_sigla: agency.sigla,
        criterio_id: criterion.id,
        titulo: sanitizeEvidenceText(item.titulo),
        url: item.url ?? null,
        fonte: item.fonte ?? null,
        trecho_publico: sanitizeEvidenceText(rawText),
        data_referencia: item.data_referencia ?? null,
        status_revisao: "pendente",
        compliance_flags: detectComplianceFlags(`${item.titulo} ${rawText}`),
      };
    }));
    if (!evidenceError) {
      await db
        .from("qualidade_regulatoria_avaliacoes")
        .update({ evidencias_count: evidences.length })
        .eq("id", data.id);
    }
  }

  // Persiste o recálculo de scores no diagnóstico (antes só acontecia on-the-fly no dashboard).
  const recompute = await recomputeAndPersistDiagnostics(Number(body.ano ?? new Date().getFullYear()));

  return NextResponse.json({ avaliacao: data, diagnosticos: recompute });
}
