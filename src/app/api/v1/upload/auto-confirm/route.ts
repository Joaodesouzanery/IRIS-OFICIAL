/**
 * POST|GET /api/v1/upload/auto-confirm
 * Confirma automaticamente as deliberações de ALTA CONFIANÇA que hoje ficariam na fila
 * manual (reduz o gargalo "deliberações sem voto"). REUSA 100% o handler do /upload/confirm
 * (nenhuma lógica de gravação duplicada): seleciona os docs `review_pending` que passam no
 * gate conservador (canAutoConfirm) e envia o mesmo payload da UI ao confirm. Casos ambíguos
 * permanecem na fila. Admin ou cron (GET p/ Vercel Cron, que só faz GET com o CRON_SECRET).
 * Idempotente (o confirm faz upsert protegido dos votos). Cada deliberação criada leva
 * `raw_extraction.auto_confirmado=true` (trilha de auditoria: auto vs manual).
 */

import { NextRequest, NextResponse } from "next/server";
import { isDemo } from "@/lib/server/is-demo";
import { isDemoRequest, requireAdminOrCron } from "@/lib/server/request-guards";
import { canAutoConfirm, buildConfirmDelibFromDoc } from "@/lib/server/auto-confirm";
import { findBestMatch } from "@/lib/server/name-matcher";
import { POST as confirmPOST } from "../confirm/route";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

export async function GET(req: NextRequest) {
  // Vercel Cron só emite GET (com Authorization: Bearer CRON_SECRET automático).
  return run(req, { limit: 50 });
}

export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) as { limit?: number; agencia_id?: string };
  return run(req, body);
}

async function run(req: NextRequest, body: { limit?: number; agencia_id?: string }) {
  if (isDemo() || isDemoRequest(req)) {
    return NextResponse.json({ error: "Auto-confirmação indisponível em modo DEMO." }, { status: 403 });
  }
  const guard = await requireAdminOrCron(req, "upload/auto-confirm");
  if (guard) return guard;

  const limit = Math.min(100, Math.max(1, Number(body.limit ?? 50)));

  const { createSupabaseServerClient } = await import("@/lib/supabase/server");
  const db = createSupabaseServerClient();

  let query = db
    .from("documentos_regulatorios")
    .select("id, status, tipo_documento, extraction_confidence, chars_per_page, is_duplicate, agencia_id, ata_items, warnings, campos_detectados")
    .eq("status", "review_pending")
    .order("extraction_confidence", { ascending: false, nullsFirst: false })
    .limit(limit);
  if (body.agencia_id) query = query.eq("agencia_id", body.agencia_id);

  const { data: docs, error } = await query;
  if (error) return NextResponse.json({ error: "Falha ao listar documentos para auto-confirmação." }, { status: 500 });

  // Voto individual: verifica se o RELATOR casa ≥0.85 com diretor cadastrado
  // (exigência do gate — a rota tem o db; canAutoConfirm lê relator_match_ok).
  const diretoresCache = new Map<string, Array<{ id: string; nome: string; nome_variantes: string[] }>>();
  async function diretoresDe(agenciaId: string) {
    const cached = diretoresCache.get(agenciaId);
    if (cached) return cached;
    const { data } = await db.from("diretores").select("id, nome, nome_variantes").eq("agencia_id", agenciaId);
    const lista = (data ?? []).map((x: any) => ({
      id: x.id, nome: x.nome,
      nome_variantes: Array.isArray(x.nome_variantes) ? x.nome_variantes : [],
    }));
    diretoresCache.set(agenciaId, lista);
    return lista;
  }
  for (const doc of (docs ?? []) as any[]) {
    const fields = doc?.campos_detectados?.preview?.fields ?? {};
    const tipo = String(fields.tipo_documento ?? doc.tipo_documento ?? "");
    if (tipo === "voto_individual" && fields.relator && doc.agencia_id) {
      const match = findBestMatch(String(fields.relator), await diretoresDe(doc.agencia_id));
      doc.relator_match_ok = Boolean(match.diretorId) && !match.needsReview;
    }
  }

  const elegiveis: any[] = [];
  const pulados: Array<{ id: string; reason: string }> = [];
  for (const doc of docs ?? []) {
    const verdict = canAutoConfirm(doc as any);
    if (verdict.ok) elegiveis.push(doc);
    else pulados.push({ id: (doc as any).id, reason: verdict.reason });
  }

  if (elegiveis.length === 0) {
    return NextResponse.json({
      analisados: (docs ?? []).length,
      elegiveis: 0,
      pulados: pulados.length,
      exemplos_pulados: pulados.slice(0, 20),
      legal_notice: "Nenhum documento passou no gate conservador de auto-confirmação nesta rodada.",
    });
  }

  // REUSA o handler do confirm: mesmo payload da UI + Authorization encaminhado.
  // `auto_confirmado=true` fica em raw_extraction (trilha de auditoria auto vs manual).
  const deliberacoes = elegiveis.map((doc) => {
    const delib = buildConfirmDelibFromDoc(doc);
    const raw = (delib.extraction_raw && typeof delib.extraction_raw === "object") ? delib.extraction_raw as Record<string, unknown> : {};
    return { ...delib, extraction_raw: { ...raw, auto_confirmado: true, auto_confirmado_em: new Date().toISOString() } };
  });
  const syntheticReq = new NextRequest(new URL("/api/v1/upload/confirm", req.url), {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: req.headers.get("authorization") ?? "",
    },
    body: JSON.stringify({ agencia_id: body.agencia_id ?? null, deliberacoes }),
  });

  let confirm: unknown = null;
  try {
    const confirmRes = await confirmPOST(syntheticReq);
    confirm = await confirmRes.json().catch(() => ({}));
  } catch (err) {
    console.error("[upload/auto-confirm] Falha ao confirmar em lote:", err);
    return NextResponse.json({ error: "Falha ao confirmar em lote.", elegiveis: elegiveis.length }, { status: 502 });
  }

  return NextResponse.json({
    analisados: (docs ?? []).length,
    elegiveis: elegiveis.length,
    pulados: pulados.length,
    auto_confirmados_ids: elegiveis.map((d) => d.id),
    confirm,
    exemplos_pulados: pulados.slice(0, 20),
    legal_notice: "Auto-confirmação CONSERVADORA (doc final + confiança ≥0.9 + não-escaneado + votos com match ≥0.85). Ambíguos ficam na fila manual.",
  });
}
