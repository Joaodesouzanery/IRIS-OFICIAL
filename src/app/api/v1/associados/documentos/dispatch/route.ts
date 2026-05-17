import { NextRequest, NextResponse } from "next/server";
import type { DocumentoAssociadoPreview, DocumentoAssociadoTipo } from "@/types";
import { requireAdminOrCron } from "@/lib/server/request-guards";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const guard = await requireAdminOrCron(req);
  if (guard) return guard;

  const { createSupabaseServerClient } = await import("@/lib/supabase/server");
  const db = createSupabaseServerClient();
  const now = new Date();

  const { data: schedules, error } = await db
    .from("associado_documento_agendamentos")
    .select("*")
    .eq("ativo", true)
    .lte("proximo_envio", now.toISOString())
    .limit(20);

  if (error) return NextResponse.json({ error: "Erro ao buscar agendamentos" }, { status: 500 });

  const results: Array<{ agendamento_id: string; documento_id: string | null; status: string; error?: string }> = [];

  for (const schedule of schedules ?? []) {
    try {
      const periodo = periodFor(schedule.tipo as DocumentoAssociadoTipo, now);
      const headers: Record<string, string> = { "Content-Type": "application/json" };
      if (process.env.CRON_SECRET) headers.Authorization = `Bearer ${process.env.CRON_SECRET}`;
      const generateRes = await fetch(new URL("/api/v1/associados/documentos", req.nextUrl.origin), {
        method: "POST",
        headers,
        body: JSON.stringify({
          associado_id: schedule.associado_id,
          tipo: schedule.tipo,
          periodo_inicio: periodo.inicio,
          periodo_fim: periodo.fim,
          save: true,
          gerado_por: "agendamento",
          agendamento_id: schedule.id,
        }),
      });

      if (!generateRes.ok) {
        const body = await generateRes.json().catch(() => ({}));
        throw new Error(body.error ?? "Erro ao gerar documento");
      }

      const preview = await generateRes.json() as DocumentoAssociadoPreview;
      const documentoId = preview.documento_id ?? null;
      if (!documentoId) throw new Error("Documento gerado sem id persistido");

      await db.from("documento_envios").insert({
        documento_id: documentoId,
        agendamento_id: schedule.id,
        destinatarios: schedule.destinatarios ?? [],
        status: "pendente",
        provider: null,
        error_message: "Envio de e-mail ainda nao configurado. Documento gerado e aguardando provedor.",
        metadata: {
          qualidade: preview.qualidade,
          metricas: preview.metricas,
        },
      });

      await db
        .from("associado_documento_agendamentos")
        .update({
          ultimo_envio: now.toISOString(),
          proximo_envio: nextSendDate(schedule.frequencia, Number(schedule.dia_mes) || 5, now).toISOString(),
        })
        .eq("id", schedule.id);

      results.push({ agendamento_id: schedule.id, documento_id: documentoId, status: "documento_gerado" });
    } catch (err) {
      results.push({
        agendamento_id: schedule.id,
        documento_id: null,
        status: "erro",
        error: err instanceof Error ? err.message : "Erro inesperado",
      });
    }
  }

  return NextResponse.json({
    processed: results.length,
    results,
    email_provider_configured: false,
  });
}

function periodFor(tipo: DocumentoAssociadoTipo, end: Date) {
  const start = new Date(end);
  start.setMonth(start.getMonth() - (tipo === "relatorio_trimestral" ? 3 : 1));
  return {
    inicio: start.toISOString().slice(0, 10),
    fim: end.toISOString().slice(0, 10),
  };
}

function nextSendDate(frequencia: "mensal" | "trimestral", day: number, from: Date) {
  const next = new Date(from);
  next.setDate(Math.min(28, Math.max(1, Math.floor(day))));
  next.setHours(9, 0, 0, 0);
  next.setMonth(next.getMonth() + (frequencia === "trimestral" ? 3 : 1));
  return next;
}
