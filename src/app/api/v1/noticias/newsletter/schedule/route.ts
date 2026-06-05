import { NextRequest, NextResponse } from "next/server";
import { isDemo } from "@/lib/server/is-demo";
import { isDemoRequest, requireAdmin } from "@/lib/server/request-guards";
import type { RegulatoryNewsletterSchedule } from "@/types";

const EMAIL_RE = /^[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}$/;

const demoSchedule: RegulatoryNewsletterSchedule = {
  id: "demo-newsletter-schedule",
  nome: "Newsletter Regulatório",
  dia_semana: 5,
  hora_envio: "09:00:00",
  destinatarios: [],
  recipient_count: 0,
  ativo: true,
  proximo_envio: nextWeekdayIso(5, "09:00"),
  ultimo_aviso_em: null,
  observacoes: null,
  created_at: new Date().toISOString(),
  updated_at: new Date().toISOString(),
};

export async function GET(req: NextRequest) {
  if (isDemo() || isDemoRequest(req)) {
    return buildScheduleResponse([demoSchedule]);
  }

  const { createSupabaseServerClient } = await import("@/lib/supabase/server");
  const db = createSupabaseServerClient();
  const { data, error } = await db
    .from("regulatory_newsletter_schedules")
    .select("*")
    .order("created_at", { ascending: false });

  if (error) {
    return NextResponse.json({ error: "Erro ao buscar agendamentos" }, { status: 500 });
  }

  return buildScheduleResponse((data ?? []) as RegulatoryNewsletterSchedule[]);
}

export async function POST(req: NextRequest) {
  if (isDemo() || isDemoRequest(req)) {
    return NextResponse.json({ error: "Agendamento indisponível em modo DEMO" }, { status: 403 });
  }

  const guard = await requireAdmin(req);
  if (guard) return guard;

  const body = await req.json().catch(() => ({}));
  const destinatarios: string[] = Array.isArray(body.destinatarios)
    ? body.destinatarios.map((email: unknown) => String(email))
    : [];
  const invalidEmail = destinatarios.find((email) => !EMAIL_RE.test(email));
  if (invalidEmail) {
    return NextResponse.json({ error: `E-mail inválido: ${invalidEmail}` }, { status: 400 });
  }

  const dia_semana = Number(body.dia_semana ?? 5);
  if (!Number.isInteger(dia_semana) || dia_semana < 0 || dia_semana > 6) {
    return NextResponse.json({ error: "dia_semana deve estar entre 0 e 6" }, { status: 400 });
  }

  const hora_envio = typeof body.hora_envio === "string" && /^\d{2}:\d{2}/.test(body.hora_envio)
    ? body.hora_envio.slice(0, 5)
    : "09:00";

  const payload = {
    nome: typeof body.nome === "string" && body.nome.trim() ? body.nome.trim() : "Newsletter Regulatório",
    dia_semana,
    hora_envio,
    destinatarios,
    ativo: body.ativo ?? true,
    proximo_envio: nextWeekdayIso(dia_semana, hora_envio),
    observacoes: typeof body.observacoes === "string" ? body.observacoes.slice(0, 1000) : null,
  };

  const { createSupabaseServerClient } = await import("@/lib/supabase/server");
  const db = createSupabaseServerClient();
  const { data, error } = await db
    .from("regulatory_newsletter_schedules")
    .insert(payload)
    .select()
    .single();

  if (error || !data) {
    return NextResponse.json({ error: "Erro ao salvar agendamento" }, { status: 500 });
  }

  return NextResponse.json({ schedule: data }, { status: 201 });
}

function nextWeekdayIso(day: number, time: string) {
  const [hour, minute] = time.split(":").map(Number);
  const now = new Date();
  const next = new Date(now);
  const delta = (day - now.getDay() + 7) % 7 || 7;
  next.setDate(now.getDate() + delta);
  next.setHours(hour || 9, minute || 0, 0, 0);
  return next.toISOString();
}

function isDueTomorrow(value: string | null, day?: number) {
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  if (typeof day === "number" && tomorrow.getDay() === day) return true;
  if (!value) return false;
  const target = new Date(value);
  return target.toDateString() === tomorrow.toDateString();
}

function isDueToday(value: string | null, day?: number) {
  const today = new Date();
  if (typeof day === "number" && today.getDay() === day) return true;
  if (!value) return false;
  const target = new Date(value);
  return target.toDateString() === today.toDateString();
}

function withRecipientCount(schedule: RegulatoryNewsletterSchedule): RegulatoryNewsletterSchedule {
  return {
    ...schedule,
    recipient_count: Array.isArray(schedule.destinatarios) ? schedule.destinatarios.length : 0,
  };
}

function buildScheduleResponse(schedules: RegulatoryNewsletterSchedule[]) {
  const enriched = schedules.map(withRecipientCount);
  const dueSchedules = enriched.filter((schedule) => schedule.ativo && isDueToday(schedule.proximo_envio, schedule.dia_semana));
  return NextResponse.json({
    schedules: enriched,
    due_today: dueSchedules.length > 0,
    due_tomorrow: enriched.some((schedule) => schedule.ativo && isDueTomorrow(schedule.proximo_envio, schedule.dia_semana)),
    due_schedules: dueSchedules,
  });
}
