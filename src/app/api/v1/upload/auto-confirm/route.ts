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
import { hasBudget, budgetFromRequest } from "@/lib/server/time-budget";
import { POST as confirmPOST } from "../confirm/route";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

export async function GET(req: NextRequest) {
  // Vercel Cron só emite GET. Loop ligado para materializar tudo que passa no gate
  // numa única execução diária (o cron não roda frequente no plano grátis).
  return run(req, { limit: 50, loop: true });
}

export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) as { limit?: number; agencia_id?: string; loop?: boolean };
  return run(req, body);
}

async function run(req: NextRequest, body: { limit?: number; agencia_id?: string; loop?: boolean }) {
  if (isDemo() || isDemoRequest(req)) {
    return NextResponse.json({ error: "Auto-confirmação indisponível em modo DEMO." }, { status: 403 });
  }
  const guard = await requireAdminOrCron(req, "upload/auto-confirm");
  if (guard) return guard;

  const limit = Math.min(100, Math.max(1, Number(body.limit ?? 50)));
  // LOOP até esvaziar (não só 1 rodada de ≤50) — destrava os "N que já passariam"
  // num clique, sem depender do cron (que não roda no plano grátis). Orçamento de
  // tempo Hobby-safe (~50s); o cliente re-chama enquanto `restantes` > 0.
  const loop = body.loop === true;
  const deadlineAt = Date.now() + Math.min(budgetFromRequest(req), 50_000);

  const { createSupabaseServerClient } = await import("@/lib/supabase/server");
  const db = createSupabaseServerClient();

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

  // Ordenação ESTÁVEL (confiança desc + id asc), sempre a partir do início: confirmados
  // saem do result set (status muda) e inelegíveis também (auto_skip persistido) — a
  // história do bug antigo (offset por inelegíveis, `.not(id,in)` estourando URL) está
  // no git; o skip persistente tornou tudo isso desnecessário.
  let puladosTotal = 0;
  let analisados = 0;
  let confirmadosTotal = 0;
  let rodadas = 0;
  let restantes = false;
  const confirmDetalhes: unknown[] = [];
  const ultimosPulados: Array<{ id: string; reason: string }> = [];

  const maxRodadas = loop ? 30 : 1;
  while (rodadas < maxRodadas) {
    if (loop && !hasBudget(deadlineAt, 15_000)) { restantes = true; break; }

    let query = db
      .from("documentos_regulatorios")
      .select("id, status, tipo_documento, extraction_confidence, chars_per_page, is_duplicate, agencia_id, ata_items, warnings, campos_detectados")
      .eq("status", "review_pending")
      // Perf (QA ago/2026): inelegível crônico ganha campos_detectados.auto_skip na 1ª
      // avaliação e SAI das rodadas seguintes — antes o mesmo backlog de pauta/apoio era
      // re-baixado e re-avaliado toda rodada antes de alcançar os confirmáveis. O requeue
      // limpa campos_detectados → doc re-analisado volta a ser candidato. O confirm-lote
      // (zero-toque) NÃO filtra auto_skip — nada deixa de ser drenado.
      .is("campos_detectados->auto_skip", null)
      .order("extraction_confidence", { ascending: false, nullsFirst: false })
      .order("id", { ascending: true })
      .range(0, limit - 1);
    if (body.agencia_id) query = query.eq("agencia_id", body.agencia_id);

    const { data: docs, error } = await query;
    if (error) return NextResponse.json({ error: "Falha ao listar documentos para auto-confirmação." }, { status: 500 });
    if (!docs || docs.length === 0) break; // passamos do fim → varremos tudo
    rodadas++;
    analisados += docs.length;

    for (const doc of docs as any[]) {
      const fields = doc?.campos_detectados?.preview?.fields ?? {};
      const tipo = String(fields.tipo_documento ?? doc.tipo_documento ?? "");
      if (tipo === "voto_individual" && fields.relator && doc.agencia_id) {
        const match = findBestMatch(String(fields.relator), await diretoresDe(doc.agencia_id));
        doc.relator_match_ok = Boolean(match.diretorId) && !match.needsReview;
      }
    }

    const elegiveis: any[] = [];
    for (const doc of docs) {
      const verdict = canAutoConfirm(doc as any);
      if (verdict.ok) elegiveis.push(doc);
      else {
        puladosTotal++;
        if (ultimosPulados.length < 20) ultimosPulados.push({ id: (doc as any).id, reason: verdict.reason });
        // Marca o motivo — este doc não volta ao auto-confirm (só ao confirm-lote/requeue).
        await db
          .from("documentos_regulatorios")
          .update({ campos_detectados: { ...((doc as any).campos_detectados ?? {}), auto_skip: verdict.reason } })
          .eq("id", (doc as any).id);
      }
    }

    // Com o auto_skip persistido, TANTO confirmados (status muda) QUANTO inelegíveis
    // (auto_skip marcado) saem do result set — a próxima página é sempre range(0, limit).
    // (O offset por inelegíveis do fix de ago/2026 ficou obsoleto com o skip persistente.)
    const paginaCheia = docs.length === limit;

    if (elegiveis.length === 0) {
      // Rodada sem elegível NÃO significa fim (o bug antigo): só avança a página.
      if (!loop || !paginaCheia) {
        if (!loop && paginaCheia) restantes = true;
        break;
      }
      continue;
    }

    const deliberacoes = elegiveis.map((doc) => {
      const delib = buildConfirmDelibFromDoc(doc);
      const raw = (delib.extraction_raw && typeof delib.extraction_raw === "object") ? delib.extraction_raw as Record<string, unknown> : {};
      return { ...delib, extraction_raw: { ...raw, auto_confirmado: true, auto_confirmado_em: new Date().toISOString() } };
    });
    const syntheticReq = new NextRequest(new URL("/api/v1/upload/confirm", req.url), {
      method: "POST",
      headers: { "content-type": "application/json", authorization: req.headers.get("authorization") ?? "" },
      body: JSON.stringify({ agencia_id: body.agencia_id ?? null, deliberacoes }),
    });
    try {
      const confirmRes = await confirmPOST(syntheticReq);
      confirmDetalhes.push(await confirmRes.json().catch(() => ({})));
    } catch (err) {
      console.error("[upload/auto-confirm] Falha ao confirmar em lote:", err);
      return NextResponse.json({ error: "Falha ao confirmar em lote.", confirmados_total: confirmadosTotal }, { status: 502 });
    }
    confirmadosTotal += elegiveis.length;

    if (!loop) {
      if (paginaCheia) restantes = true; // 1 rodada só, mas ainda há fila
      break;
    }
  }

  // Esgotou as rodadas com página cheia = provavelmente ainda há fila → re-chamar.
  if (loop && rodadas >= maxRodadas) restantes = true;

  return NextResponse.json({
    rodadas,
    analisados,
    confirmados_total: confirmadosTotal,
    restantes, // true = parou por orçamento/rodadas; re-chamar para continuar
    pulados: puladosTotal,
    exemplos_pulados: ultimosPulados,
    confirm: confirmDetalhes.length === 1 ? confirmDetalhes[0] : confirmDetalhes,
    legal_notice: "Auto-confirmação CONSERVADORA em loop (doc final + confiança ok + votos com match ≥0.85). Ambíguos ficam na fila manual.",
  });
}
