import { NextRequest, NextResponse } from "next/server";
import type { BoletimSchedule } from "@/types";
import { isDemoRequest, requireAdmin } from "@/lib/server/request-guards";

const EMAIL_RE = /^[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}$/;
const STORAGE_KEY = "iris_boletim_schedules";

// ── Demo-mode helpers (server-side in-memory store per cold start) ─────────
// In production this would be Supabase. In demo (no Supabase env) we use
// a module-level Map which persists across requests within the same process.
const memoryStore = new Map<string, BoletimSchedule>();

function isDemoMode() {
  return !process.env.NEXT_PUBLIC_SUPABASE_URL;
}

// ── GET /api/v1/boletim/schedule ──────────────────────────────────────────

export async function GET(req: NextRequest) {
  if (isDemoMode() || isDemoRequest(req)) {
    return NextResponse.json({ schedules: [...memoryStore.values()] });
  }

  // Production: query Supabase boletim_schedules table
  try {
    const { createClient } = await import("@supabase/supabase-js");
    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );
    const { data, error } = await supabase
      .from("boletim_schedules")
      .select("*")
      .order("criado_em", { ascending: false });
    if (error) throw error;
    return NextResponse.json({ schedules: data ?? [] });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

// ── POST /api/v1/boletim/schedule ─────────────────────────────────────────

export async function POST(req: NextRequest) {
  const guard = await requireAdmin(req);
  if (guard) return guard;

  let body: Partial<BoletimSchedule>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "JSON inválido" }, { status: 400 });
  }

  // Validate destinatarios
  const destinatarios: string[] = Array.isArray(body.destinatarios) ? body.destinatarios : [];
  for (const email of destinatarios) {
    if (!EMAIL_RE.test(email)) {
      return NextResponse.json({ error: `E-mail inválido: ${email}` }, { status: 400 });
    }
  }

  if (!body.frequencia || !["semanal","quinzenal","mensal","personalizado"].includes(body.frequencia)) {
    return NextResponse.json({ error: "Frequência inválida" }, { status: 400 });
  }

  const schedule: BoletimSchedule = {
    id:            crypto.randomUUID(),
    frequencia:    body.frequencia,
    dia_semana:    body.dia_semana,
    dia_mes:       body.dia_mes,
    proximo_envio: body.proximo_envio ?? new Date().toISOString(),
    destinatarios,
    secoes:        Array.isArray(body.secoes) ? body.secoes : [],
    agencia_id:    body.agencia_id ?? null,
    ativo:         body.ativo ?? true,
    criado_em:     new Date().toISOString(),
  };

  if (isDemoMode()) {
    memoryStore.set(schedule.id, schedule);
    return NextResponse.json({ schedule }, { status: 201 });
  }

  // Production: insert into Supabase
  try {
    const { createClient } = await import("@supabase/supabase-js");
    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );
    const { data, error } = await supabase
      .from("boletim_schedules")
      .insert(schedule)
      .select()
      .single();
    if (error) throw error;
    return NextResponse.json({ schedule: data }, { status: 201 });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

// ── DELETE /api/v1/boletim/schedule?id=… ─────────────────────────────────

export async function DELETE(req: NextRequest) {
  const guard = await requireAdmin(req);
  if (guard) return guard;

  const id = req.nextUrl.searchParams.get("id");
  if (!id) return NextResponse.json({ error: "id obrigatório" }, { status: 400 });

  if (isDemoMode()) {
    memoryStore.delete(id);
    return NextResponse.json({ ok: true });
  }

  try {
    const { createClient } = await import("@supabase/supabase-js");
    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );
    const { error } = await supabase.from("boletim_schedules").delete().eq("id", id);
    if (error) throw error;
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
