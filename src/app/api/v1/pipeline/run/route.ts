/**
 * POST|GET /api/v1/pipeline/run — a esteira ZERO-TOQUE inteira, server-side, numa rota.
 *
 * "Rodar tudo" da tela chama isto em loop até `restantes:false`. Encadeia (cada passo
 * budget-aware; reusa os handlers reais via request sintético — nenhuma lógica duplicada):
 *  1. coleta leve (monitoramento/check)
 *  2. requeue dos mal classificados ("Voto DXX" preso como documento_apoio/? → re-analisa)
 *  3. enfileirar PDFs (enqueue-pdfs, loop) + processar fila (upload/process, loop)
 *  4. auto-confirm (gate conservador, loop)
 *  5. confirm-lote (política zero-toque em camadas: duplicata exata→arquiva; semântica→merge
 *     idempotente; ilegível/sem agência→arquiva; resto→confirma)
 *  6. candidatos: recompute + aprovar-lote (≥0.8 + novos <0.6 com nome estrito)
 *  7. dedup retroativo de deliberações (rede de segurança final)
 * Admin ou cron. Idempotente: rodar 2× não cria nada novo (dedup em 4 barreiras).
 */

import { NextRequest, NextResponse } from "next/server";
import { isDemo } from "@/lib/server/is-demo";
import { isDemoRequest, requireAdminOrCron } from "@/lib/server/request-guards";
import { hasBudget } from "@/lib/server/time-budget";
import { requeueDocument } from "@/lib/server/upload-queue";
import { GET as checkGET } from "../../monitoramento/check/route";
import { POST as enqueuePOST } from "../../deliberacoes/enqueue-pdfs/route";
import { POST as processPOST } from "../../upload/process/route";
import { POST as autoConfirmPOST } from "../../upload/auto-confirm/route";
import { POST as confirmLotePOST } from "../../upload/confirm-lote/route";
import { POST as recomputePOST } from "../../admin/diretores/candidatos/recompute/route";
import { POST as aprovarLotePOST } from "../../diretores/candidatos/aprovar-lote/route";
import { POST as dedupPOST } from "../../admin/deliberacoes/dedup/route";
import { POST as materializarPOST } from "../../admin/votos/materializar-faltantes/route";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 120;

const RE_VOTO_FILENAME_SQL = "voto[ _-]+(vista[ _-]+)?d[a-z]{1,2}[ _-]*[0-9]";

type StepResult = Record<string, unknown>;

export async function GET(req: NextRequest) {
  return run(req);
}
export async function POST(req: NextRequest) {
  return run(req);
}

async function run(req: NextRequest) {
  if (isDemo() || isDemoRequest(req)) {
    return NextResponse.json({ error: "Pipeline indisponível em modo DEMO." }, { status: 403 });
  }
  const guard = await requireAdminOrCron(req, "pipeline/run");
  if (guard) return guard;

  const deadlineAt = Date.now() + 100_000; // maxDuration 120s; margem p/ responder
  const auth = req.headers.get("authorization") ?? "";
  const etapas: Record<string, StepResult> = {};
  let restantes = false;

  // Handler sintético: chama a rota real com o MESMO Bearer (padrão auto-confirm→confirm).
  async function call(
    handler: (r: NextRequest) => Promise<NextResponse | Response>,
    path: string,
    body?: unknown,
  ): Promise<any> {
    const synthetic = new NextRequest(new URL(path, req.url), {
      method: body === undefined ? "GET" : "POST",
      headers: { "content-type": "application/json", authorization: auth },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const res = await handler(synthetic);
    return await res.json().catch(() => ({}));
  }

  const { createSupabaseServerClient } = await import("@/lib/supabase/server");
  const db = createSupabaseServerClient();

  // 1 · Coleta leve (novidades do topo dos sites). Falha não derruba a pipeline.
  if (hasBudget(deadlineAt, 60_000)) {
    try {
      const r = await call(checkGET, "/api/v1/monitoramento/check");
      etapas.coleta = { novos_detectados: r?.novos_detectados ?? 0 };
    } catch {
      etapas.coleta = { erro: "coleta falhou nesta rodada" };
    }
  } else restantes = true;

  // 2 · Requeue dos mal classificados: "Voto DXX NNN-2026" preso como documento_apoio/agência "?"
  // (analisado antes do classificador por filename) → volta à fila e re-analisa com o código novo.
  if (hasBudget(deadlineAt, 45_000)) {
    try {
      const { data: presos } = await db
        .from("documentos_regulatorios")
        .select("id, filename, tipo_documento, agencia_id, upload_job_id")
        .eq("status", "review_pending")
        .not("upload_job_id", "is", null)
        .limit(300);
      const alvo = ((presos ?? []) as any[])
        .filter((d) => (d.tipo_documento === "documento_apoio" || !d.agencia_id))
        .filter((d) => new RegExp(RE_VOTO_FILENAME_SQL, "i").test(String(d.filename ?? "")))
        .slice(0, 50);
      let requeued = 0;
      for (const d of alvo) {
        try { await requeueDocument(db, d.id as string); requeued++; } catch { /* segue */ }
      }
      etapas.reclassificacao = { reenfileirados: requeued };
    } catch {
      etapas.reclassificacao = { erro: "requeue falhou nesta rodada" };
    }
  } else restantes = true;

  // 3 · Enfileirar PDFs + processar a fila (loops server-side).
  let enfileirados = 0;
  for (let i = 0; i < 30 && hasBudget(deadlineAt, 40_000); i++) {
    const r = await call(enqueuePOST, "/api/v1/deliberacoes/enqueue-pdfs", { limit: 10 });
    enfileirados += Number(r?.enfileirados ?? r?.queued ?? 0);
    if (!r || Number(r?.candidates ?? r?.candidatos ?? 0) === 0) break;
  }
  let processados = 0;
  for (let i = 0; i < 30 && hasBudget(deadlineAt, 35_000); i++) {
    const r = await call(processPOST, "/api/v1/upload/process?limit=20", {});
    const p = Number(r?.processed ?? 0);
    processados += p;
    if (p === 0) break;
  }
  if (!hasBudget(deadlineAt, 35_000)) restantes = true;
  etapas.extracao = { enfileirados, processados };

  // 4 · Auto-confirm (gate conservador — o caminho de alta confiança primeiro).
  if (hasBudget(deadlineAt, 30_000)) {
    const r = await call(autoConfirmPOST, "/api/v1/upload/auto-confirm", { limit: 50, loop: true });
    etapas.auto_confirm = { confirmados: r?.confirmados_total ?? 0, restantes: r?.restantes ?? false };
    if (r?.restantes) restantes = true;
  } else restantes = true;

  // 5 · Confirm-lote zero-toque (camadas + dedup auto-resolvida).
  if (hasBudget(deadlineAt, 25_000)) {
    const r = await call(confirmLotePOST, "/api/v1/upload/confirm-lote", { todos: true });
    etapas.aprovacao = {
      materializados: r?.materializados ?? 0,
      ignorados_pauta_apoio: r?.ignorados ?? 0,
      duplicatas_arquivadas: r?.arquivados_duplicata_exata ?? 0,
      fundidos_semanticos: r?.fundidos_semanticos ?? 0,
      ilegiveis_arquivados: r?.arquivados_ilegiveis ?? 0,
      sem_agencia_arquivados: r?.arquivados_sem_agencia ?? 0,
      erros: r?.erros ?? 0,
    };
    if (r?.restantes) restantes = true;
  } else restantes = true;

  // 6 · Candidatos: recompute (auto-aprova ≥0.85 + mescla estritas) e aprovar-lote (0.8 + novos).
  if (hasBudget(deadlineAt, 18_000)) {
    try {
      await call(recomputePOST, "/api/v1/admin/diretores/candidatos/recompute?dry_run=0", {});
      const r = await call(aprovarLotePOST, "/api/v1/diretores/candidatos/aprovar-lote", {
        min_confidence: 0.8,
        incluir_novos: true,
      });
      etapas.diretores = { aprovados: r?.aprovados ?? 0, excecoes: r?.pulados ?? 0 };
    } catch {
      etapas.diretores = { erro: "candidatos falharam nesta rodada" };
    }
  } else restantes = true;

  // 6b · Backfill de votos (QA ago/2026): deliberações finais já gravadas sem voto ganham
  // os votos que a evidência persistida sustenta (regras novas de inferência). Idempotente.
  if (hasBudget(deadlineAt, 15_000)) {
    try {
      const r = await call(materializarPOST, "/api/v1/admin/votos/materializar-faltantes", { dry_run: false });
      etapas.backfill_votos = { deliberacoes: r?.materializaveis ?? 0, votos: r?.votos ?? 0 };
      if (r?.restantes) restantes = true;
    } catch {
      etapas.backfill_votos = { erro: "backfill falhou nesta rodada" };
    }
  } else restantes = true;

  // 7 · Dedup retroativo de deliberações (rede final; funde qualquer par que escapou).
  if (hasBudget(deadlineAt, 12_000)) {
    try {
      const r = await call(dedupPOST, "/api/v1/admin/deliberacoes/dedup?dry_run=0", {});
      etapas.dedup_final = { fundidas: r?.deliberacoes_em_dobro ?? r?.fundidas ?? 0 };
    } catch {
      etapas.dedup_final = { erro: "dedup falhou nesta rodada" };
    }
  } else restantes = true;

  return NextResponse.json({
    etapas,
    restantes, // true = re-chamar para continuar (orçamento de tempo)
    legal_notice:
      "Pipeline zero-toque: coleta → reclassificação → extração → aprovação em camadas (dedup em 4 barreiras; direção de voto nunca chutada; ilegível não vira métrica) → diretores → dedup final. Idempotente.",
  });
}
