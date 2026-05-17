import { NextRequest, NextResponse } from "next/server";
import { isDemo } from "@/lib/server/is-demo";
import { isDemoRequest, requireAdmin } from "@/lib/server/request-guards";
import type { AssociadoDocumentoAgendamento, DocumentoAssociadoTipo } from "@/types";

const EMAIL_RE = /^[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}$/;
const TIPO_VALIDO = new Set<DocumentoAssociadoTipo>(["relatorio_trimestral", "boletim_mensal"]);
const memoryStore = new Map<string, AssociadoDocumentoAgendamento>();

export async function GET(req: NextRequest) {
  const associadoId = req.nextUrl.searchParams.get("associado_id");
  if (isDemo() || isDemoRequest(req)) {
    const schedules = [...memoryStore.values()].filter((s) => !associadoId || s.associado_id === associadoId);
    return NextResponse.json({ schedules });
  }

  const { createSupabaseServerClient } = await import("@/lib/supabase/server");
  const db = createSupabaseServerClient();
  let query = db
    .from("associado_documento_agendamentos")
    .select("*, associado:associados(nome, setor)")
    .order("proximo_envio", { ascending: true });
  if (associadoId) query = query.eq("associado_id", associadoId);

  const { data, error } = await query;
  if (error) return NextResponse.json({ error: "Erro ao buscar agendamentos" }, { status: 500 });
  return NextResponse.json({ schedules: data ?? [] });
}

export async function POST(req: NextRequest) {
  const guard = await requireAdmin(req);
  if (guard) return guard;

  const body = await req.json().catch(() => ({}));
  const associadoId = typeof body.associado_id === "string" ? body.associado_id : "";
  const tipo = TIPO_VALIDO.has(body.tipo) ? body.tipo : "boletim_mensal";
  const frequencia: "mensal" | "trimestral" = tipo === "relatorio_trimestral" ? "trimestral" : "mensal";
  const dia_mes = clampDay(Number(body.dia_mes) || 5);
  const destinatarios: string[] = Array.isArray(body.destinatarios) ? body.destinatarios.map(String).map((v: string) => v.trim()).filter(Boolean) : [];

  if (!associadoId) return NextResponse.json({ error: "associado_id obrigatorio" }, { status: 400 });
  if (!destinatarios.length) return NextResponse.json({ error: "Adicione ao menos um destinatario" }, { status: 400 });
  const invalid = destinatarios.find((email: string) => !EMAIL_RE.test(email));
  if (invalid) return NextResponse.json({ error: `E-mail invalido: ${invalid}` }, { status: 400 });

  const payload = {
    associado_id: associadoId,
    tipo,
    frequencia,
    dia_mes,
    destinatarios,
    ativo: body.ativo !== false,
    proximo_envio: nextSendDate(frequencia, dia_mes).toISOString(),
    secoes: Array.isArray(body.secoes) ? body.secoes.map(String) : [],
    observacoes: typeof body.observacoes === "string" ? body.observacoes : null,
  };

  if (isDemo()) {
    const schedule: AssociadoDocumentoAgendamento = {
      id: crypto.randomUUID(),
      ...payload,
      ultimo_envio: null,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
    memoryStore.set(schedule.id, schedule);
    return NextResponse.json({ schedule }, { status: 201 });
  }

  const { createSupabaseServerClient } = await import("@/lib/supabase/server");
  const db = createSupabaseServerClient();
  const { data, error } = await db
    .from("associado_documento_agendamentos")
    .insert(payload)
    .select("*, associado:associados(nome, setor)")
    .single();

  if (error) return NextResponse.json({ error: "Erro ao criar agendamento" }, { status: 500 });
  return NextResponse.json({ schedule: data }, { status: 201 });
}

export async function DELETE(req: NextRequest) {
  const guard = await requireAdmin(req);
  if (guard) return guard;

  const id = req.nextUrl.searchParams.get("id");
  if (!id) return NextResponse.json({ error: "id obrigatorio" }, { status: 400 });

  if (isDemo()) {
    memoryStore.delete(id);
    return NextResponse.json({ ok: true });
  }

  const { createSupabaseServerClient } = await import("@/lib/supabase/server");
  const db = createSupabaseServerClient();
  const { error } = await db.from("associado_documento_agendamentos").delete().eq("id", id);
  if (error) return NextResponse.json({ error: "Erro ao excluir agendamento" }, { status: 500 });
  return NextResponse.json({ ok: true });
}

function clampDay(value: number) {
  return Math.min(28, Math.max(1, Math.floor(value)));
}

function nextSendDate(frequencia: "mensal" | "trimestral", day: number) {
  const now = new Date();
  const next = new Date(now);
  next.setDate(day);
  next.setHours(9, 0, 0, 0);
  if (next <= now) next.setMonth(next.getMonth() + (frequencia === "trimestral" ? 3 : 1));
  return next;
}
