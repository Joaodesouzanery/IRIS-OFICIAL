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
 *  8. materialização final, só com a fila drenada: recuperação de ignorados + métricas
 *     derivadas (empresas/backfill, qualidade derivadas, mandatos percentual, divergência)
 * Admin ou cron. Idempotente: rodar 2× não cria nada novo (dedup em 4 barreiras).
 */

import { NextRequest, NextResponse } from "next/server";
import { isDemo } from "@/lib/server/is-demo";
import { isDemoRequest, requireAdminOrCron } from "@/lib/server/request-guards";
import { hasBudget, msLeft, HOBBY_BUDGET_MS } from "@/lib/server/time-budget";
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
import { POST as reprocessIgnoradosPOST } from "../../admin/upload/reprocess-ignorados/route";
import { POST as empresasBackfillPOST } from "../../empresas/backfill/route";
import { POST as qualidadeDerivadasPOST } from "../../qualidade-regulatoria/coletas/derivadas/run/route";
import { POST as mandatosRecalcularPOST } from "../../mandatos/recalcular/route";
import { POST as divergenciaPOST } from "../../votos/recalcular-divergencia/route";

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

  // QA ago/2026: era 100s, mas no Hobby o SIGKILL vem aos 60s (o maxDuration 120 só vale
  // no Pro) — a função morria sem responder, o loop do cliente abortava na 1ª rodada e a
  // extração NUNCA rodava ("208 detectados / 0 processados"). Orçamento honesto: 50s.
  const deadlineAt = Date.now() + HOBBY_BUDGET_MS;
  const auth = req.headers.get("authorization") ?? "";
  const etapas: Record<string, StepResult> = {};
  let restantes = false;

  // Handler sintético: chama a rota real com o MESMO Bearer (padrão auto-confirm→confirm).
  // QA ago/2026: cada sub-rota tinha orçamento PRÓPRIO de 50s — somados, estouravam o
  // SIGKILL de 60s do Hobby. Agora toda chamada leva `budget_ms` = fatia do saldo REAL
  // desta função (menos 4s de flush), e as sub-rotas respeitam (budgetFromRequest).
  async function call(
    handler: (r: NextRequest) => Promise<NextResponse | Response>,
    path: string,
    body?: unknown,
    maxSliceMs?: number,
  ): Promise<any> {
    const saldo = Math.max(3_000, msLeft(deadlineAt) - 4_000);
    const slice = Math.round(maxSliceMs !== undefined ? Math.min(saldo, maxSliceMs) : saldo);
    const url = new URL(path, req.url);
    url.searchParams.set("budget_ms", String(slice));
    const synthetic = new NextRequest(url, {
      method: body === undefined ? "GET" : "POST",
      headers: { "content-type": "application/json", authorization: auth },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const res = await handler(synthetic);
    return await res.json().catch(() => ({}));
  }

  const { createSupabaseServerClient } = await import("@/lib/supabase/server");
  const db = createSupabaseServerClient();

  // Reservas calibradas para o orçamento REAL de 50s (QA ago/2026): coleta ganha uma
  // fatia CURTA (a descoberta pesada é do "Buscar todas"); a prioridade da rodada é
  // extração→aprovação. Rodadas se auto-balanceiam: com fila cheia, enqueue/process
  // consomem o saldo e os passos finais reportam restantes; com fila vazia, os passos
  // finais ganham o orçamento. O cliente re-chama enquanto restantes=true.

  // 1 · Coleta leve (novidades do topo dos sites). Falha não derruba a pipeline.
  if (hasBudget(deadlineAt, 42_000)) {
    try {
      const r = await call(checkGET, "/api/v1/monitoramento/check", undefined, 8_000);
      etapas.coleta = { novos_detectados: r?.novos_detectados ?? 0 };
    } catch {
      etapas.coleta = { erro: "coleta falhou nesta rodada" };
    }
  } else restantes = true;

  // 2 · Requeue dos mal classificados: "Voto DXX NNN-2026" preso como documento_apoio/agência "?"
  // (analisado antes do classificador por filename) → volta à fila e re-analisa com o código novo.
  if (hasBudget(deadlineAt, 36_000)) {
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
  // QA ago/2026: o break antigo era `candidates===0`, que também dispara quando os 208
  // estão FORA da janela ou quando a rota morreu (json→{}). Agora: progresso = queued+
  // sem_pdf (a janela drena por status terminal); fila remanescente ⇒ restantes=true.
  let enfileirados = 0;
  let itensArquivados = 0;
  for (let i = 0; i < 10 && hasBudget(deadlineAt, 28_000); i++) {
    const r = await call(enqueuePOST, "/api/v1/deliberacoes/enqueue-pdfs", { limit: 10 }, 25_000);
    const q = Number(r?.queued ?? 0);
    const s = Number(r?.sem_pdf ?? 0);
    enfileirados += q;
    itensArquivados += s;
    if (r?.parcial || Number(r?.restantes ?? 0) > 0) restantes = true;
    if (!r || Number(r?.candidates ?? 0) === 0) break; // janela vazia de verdade (drena por status)
    if (q + s === 0) { restantes = true; break; }      // só erros transitórios — próxima rodada
  }
  let processados = 0;
  for (let i = 0; i < 10 && hasBudget(deadlineAt, 20_000); i++) {
    const r = await call(processPOST, "/api/v1/upload/process?limit=20", {});
    const p = Number(r?.processed ?? 0);
    processados += p;
    if (p === 0) break;
    if (p >= 20) restantes = true; // lote cheio → provavelmente há mais fila
  }
  if (!hasBudget(deadlineAt, 20_000)) restantes = true;
  etapas.extracao = { enfileirados, processados, itens_sem_pdf_arquivados: itensArquivados };

  // 4 · Auto-confirm (gate conservador — o caminho de alta confiança primeiro).
  if (hasBudget(deadlineAt, 14_000)) {
    const r = await call(autoConfirmPOST, "/api/v1/upload/auto-confirm", { limit: 50, loop: true });
    etapas.auto_confirm = { confirmados: r?.confirmados_total ?? 0, restantes: r?.restantes ?? false };
    if (r?.restantes) restantes = true;
  } else restantes = true;

  // 5 · Confirm-lote zero-toque (camadas + dedup auto-resolvida).
  if (hasBudget(deadlineAt, 11_000)) {
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
  if (hasBudget(deadlineAt, 8_000)) {
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
  if (hasBudget(deadlineAt, 6_000)) {
    try {
      const r = await call(materializarPOST, "/api/v1/admin/votos/materializar-faltantes", { dry_run: false });
      etapas.backfill_votos = { deliberacoes: r?.materializaveis ?? 0, votos: r?.votos ?? 0 };
      if (r?.restantes) restantes = true;
    } catch {
      etapas.backfill_votos = { erro: "backfill falhou nesta rodada" };
    }
  } else restantes = true;

  // 7 · Dedup retroativo de deliberações (rede final; funde qualquer par que escapou).
  if (hasBudget(deadlineAt, 5_000)) {
    try {
      const r = await call(dedupPOST, "/api/v1/admin/deliberacoes/dedup?dry_run=0", {});
      etapas.dedup_final = { fundidas: r?.deliberacoes_em_dobro ?? r?.fundidas ?? 0 };
    } catch {
      etapas.dedup_final = { erro: "dedup falhou nesta rodada" };
    }
  } else restantes = true;

  // 8 · MATERIALIZAÇÃO FINAL ("Rodar tudo = tudo", ago/2026): roda quando a fila DRENOU
  // (restantes ainda false) — recuperação de ignorados + métricas derivadas que antes
  // dependiam de botões/rotas órfãs (Qualidade e Empresas estagnavam). Se faltar saldo,
  // restantes=true e a PRÓXIMA rodada (fila vazia = passos 1-7 baratos) chega aqui com folga.
  if (!restantes) {
    if (hasBudget(deadlineAt, 10_000)) {
      try {
        // 8a · Ignorados recuperáveis voltam à fila (se voltou algo, há trabalho → re-rodar).
        const r = await call(reprocessIgnoradosPOST, "/api/v1/admin/upload/reprocess-ignorados?dry_run=0", {}, 8_000);
        const reenfileirados = Number(r?.reenfileirados ?? r?.requeued ?? 0);
        etapas.recuperacao_ignorados = { reenfileirados };
        if (reenfileirados > 0) restantes = true;
      } catch {
        etapas.recuperacao_ignorados = { erro: "reprocesso falhou nesta rodada" };
      }
    } else restantes = true;

    // 8b-8e · Métricas derivadas (todas idempotentes; fatias curtas).
    const derivadas: Array<[string, (r: NextRequest) => Promise<NextResponse | Response>, string, unknown]> = [
      ["empresas_backfill", empresasBackfillPOST, "/api/v1/empresas/backfill", {}],
      ["qualidade_derivadas", qualidadeDerivadasPOST, "/api/v1/qualidade-regulatoria/coletas/derivadas/run", {}],
      ["mandatos_percentual", mandatosRecalcularPOST, "/api/v1/mandatos/recalcular", {}],
      ["divergencia_votos", divergenciaPOST, "/api/v1/votos/recalcular-divergencia?apply=1", {}],
    ];
    for (const [nome, handler, path, corpo] of derivadas) {
      if (!hasBudget(deadlineAt, 6_000)) { restantes = true; break; }
      try {
        const r = await call(handler, path, corpo, 8_000);
        const n = [r?.atualizados, r?.alterados, r?.updated, r?.deliberacoes_atualizadas, r?.votos_alterados]
          .find((v: unknown) => typeof v === "number");
        etapas[nome] = { ok: true, ...(typeof n === "number" ? { atualizados: n } : {}) };
      } catch {
        etapas[nome] = { erro: `${nome} falhou nesta rodada` };
      }
    }
  }

  return NextResponse.json({
    etapas,
    restantes, // true = re-chamar para continuar (orçamento de tempo)
    legal_notice:
      "Pipeline zero-toque: coleta → reclassificação → extração → aprovação em camadas (dedup em 4 barreiras; direção de voto nunca chutada; ilegível não vira métrica) → diretores → dedup final → materialização (empresas, qualidade, mandatos, divergência). Idempotente.",
  });
}
