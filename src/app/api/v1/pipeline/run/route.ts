/**
 * POST|GET /api/v1/pipeline/run — a esteira ZERO-TOQUE inteira, server-side, numa rota.
 *
 * "Rodar tudo" da tela chama isto em loop até `restantes:false`. Encadeia (cada passo
 * budget-aware; reusa os handlers reais via request sintético — nenhuma lógica duplicada).
 *
 * ORDEM (Fase 7 — DRENAR antes de INGERIR; ver o bloco comentado dentro de `run`):
 *  1. auto-confirm (gate conservador, loop)
 *  2. confirm-lote (política zero-toque em camadas: duplicata exata→arquiva; semântica→merge
 *     idempotente; ilegível/sem agência→arquiva; resto→confirma)
 *  3. candidatos: recompute + aprovar-lote (≥0.8 + novos <0.6 com nome estrito)
 *  4. backfill de votos em deliberações finais já gravadas
 *  5. coleta leve (monitoramento/check)
 *  6. requeue dos mal classificados ("Voto DXX" preso como documento_apoio/? → re-analisa)
 *  7. enfileirar PDFs (enqueue-pdfs, loop, com teto de vazão) + processar fila (upload/process)
 *  8. dedup retroativo de deliberações (rede de segurança final)
 *  9. recuperação de ignorados — só quando esta rodada NÃO arquivou nada (senão é ping-pong)
 * 10. métricas derivadas (empresas, qualidade, mandatos, divergência) — quando a rodada
 *     materializou algo OU a fila drenou. É este passo que leva o resultado ao Observatório.
 * Admin ou cron. Idempotente: rodar 2× não cria nada novo (dedup em 4 barreiras).
 */

import { NextRequest, NextResponse } from "next/server";
import { isDemo } from "@/lib/server/is-demo";
import { isCronRequest, isDemoRequest, requireAdminOrCron } from "@/lib/server/request-guards";
import { hasBudget, msLeft, HOBBY_BUDGET_MS } from "@/lib/server/time-budget";
import { RESERVA, gateDoPasso, TETO_ENQUEUE_POR_RODADA } from "@/lib/server/esteira-reservas";
import { requeueDocument } from "@/lib/server/upload-queue";
import {
  buscarRunAtiva,
  deveAbrirDisjuntor,
  fecharRun,
  iniciarRun,
  reaparRunsOrfas,
  registrarRodada,
} from "@/lib/server/esteira-run";
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

/**
 * GET só EXECUTA para o cron (o Vercel Cron dispara GET). Fase 7 — antes, `GET` era um alias de
 * `POST`: qualquer prefetch do navegador, ou um admin abrindo a URL, disparava a esteira INTEIRA
 * sem que ninguém tivesse pedido. Para todo o resto, GET é leitura do estado.
 */
export async function GET(req: NextRequest) {
  if (isCronRequest(req)) return run(req, "cron");
  return NextResponse.json({
    aviso: "GET não executa a esteira (só o cron). Use POST para rodar, ou GET /api/v1/pipeline/status para ler o andamento.",
  });
}
export async function POST(req: NextRequest) {
  return run(req, isCronRequest(req) ? "cron" : "ui");
}

async function run(req: NextRequest, origem: "ui" | "cron") {
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

  // ═══ Fase 7 — EXECUÇÃO COM MEMÓRIA: retomar, travar, e o disjuntor ════════════
  // A rota era stateless; todo o estado do "Rodar tudo" vivia no navegador. Agora cada rodada
  // registra o avanço numa linha de execução: fechar a aba deixa de "perder tudo" (a tela reabre
  // e retoma), duas abas não disputam as mesmas linhas, e uma execução que está falhando PARA.
  // Se a migration ainda não foi aplicada, `run` é `null` e a esteira roda como antes.
  const corpo = (await req.json().catch(() => ({}))) as { run_id?: string };
  await reaparRunsOrfas(db);
  const ativa = await buscarRunAtiva(db);
  if (ativa && corpo.run_id && ativa.id !== corpo.run_id) {
    // Outra execução está viva: recusar é melhor do que duas esteiras sobre as mesmas linhas.
    return NextResponse.json(
      { error: "Já existe uma execução da esteira em andamento.", run_id: ativa.id, rodadas: ativa.rodadas },
      { status: 409 },
    );
  }
  let execucao = ativa ?? (await iniciarRun(db, origem));

  // ═══ Fase 7 — A ORDEM DA RODADA MUDOU: APROVAR ANTES DE INGERIR ═══════════════
  //
  // A soma das reservas de todos os passos é ~140s contra um orçamento REAL de 50s: uma rodada
  // nunca coube inteira, e nunca vai caber. Isso não era o problema — `restantes` existe para
  // isso. O problema era a ORDEM: ingestão primeiro, aprovação por último. Com a fila cheia, a
  // coleta e a extração consumiam o saldo e a APROVAÇÃO — o único passo que transforma documento
  // em deliberação, isto é, em MÉTRICA — recebia um gate menor que a própria reserva e devolvia
  // zero. É a explicação mecânica de "174 PDF(s) extraído(s) · 0 materializado(s)" e de 20+
  // rodadas sem o número de Votos/Deliberações se mexer.
  //
  // Agora a rodada primeiro DRENA o que já está em revisão (aprovação → candidatos → votos) e só
  // depois puxa material novo. Quando não há o que aprovar, esses passos custam uma consulta
  // barata e a ingestão fica com o orçamento quase inteiro — auto-balanceado, sem modo explícito.
  // Todos os passos são idempotentes, então aprovar o que a rodada ANTERIOR extraiu é correto.
  //
  // E os gates deixaram de ser literais: vêm de `gateDoPasso()`, a mesma fonte que as sub-rotas
  // usam como reserva interna. Um teste tabular falha se algum gate ficar abaixo da reserva.

  // 1 · Auto-confirm (gate conservador — o caminho de alta confiança primeiro).
  if (hasBudget(deadlineAt, gateDoPasso("autoConfirm"))) {
    const r = await call(autoConfirmPOST, "/api/v1/upload/auto-confirm", { limit: 50, loop: true });
    etapas.auto_confirm = { confirmados: r?.confirmados_total ?? 0, restantes: r?.restantes ?? false };
    if (r?.restantes) restantes = true;
  } else restantes = true;

  // 2 · Confirm-lote zero-toque (camadas + dedup auto-resolvida).
  if (hasBudget(deadlineAt, gateDoPasso("confirmLote"))) {
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

  // 3 · Candidatos: recompute (auto-aprova ≥0.85 + mescla estritas) e aprovar-lote (0.8 + novos).
  if (hasBudget(deadlineAt, gateDoPasso("candidatos"))) {
    try {
      const rec = await call(recomputePOST, "/api/v1/admin/diretores/candidatos/recompute?dry_run=0", {});
      const r = await call(aprovarLotePOST, "/api/v1/diretores/candidatos/aprovar-lote", {
        min_confidence: 0.8,
        incluir_novos: true,
      });
      // Etapa67 — a MEDIÇÃO do auto-resolver: as quatro contagens sobem até o resumo do
      // "Rodar tudo". Se `sem_margem` for raro (hipótese: mandato resolve quase tudo), o
      // fallback fica como está; se for frequente, ganha visibilidade — com o número na mão.
      etapas.diretores = {
        aprovados: r?.aprovados ?? 0,
        excecoes: r?.pulados ?? 0,
        rejeitados_lixo: rec?.grupos_rejeitados_lixo ?? 0,
        resolvidos_por_mandato: r?.resolvidos_por_mandato ?? 0,
        resolvidos_por_margem: r?.resolvidos_por_margem ?? 0,
        resolvidos_sem_margem: r?.resolvidos_sem_margem ?? 0,
      };
    } catch {
      etapas.diretores = { erro: "candidatos falharam nesta rodada" };
    }
  } else restantes = true;

  // 4 · Backfill de votos (QA ago/2026): deliberações finais já gravadas sem voto ganham
  // os votos que a evidência persistida sustenta (regras novas de inferência). Idempotente.
  if (hasBudget(deadlineAt, gateDoPasso("backfillVotos"))) {
    try {
      const r = await call(materializarPOST, "/api/v1/admin/votos/materializar-faltantes", { dry_run: false });
      etapas.backfill_votos = { deliberacoes: r?.materializaveis ?? 0, votos: r?.votos ?? 0 };
      if (r?.restantes) restantes = true;
    } catch {
      etapas.backfill_votos = { erro: "backfill falhou nesta rodada" };
    }
  } else restantes = true;

  // ═══ INGESTÃO — só depois de drenar o que já estava em revisão ════════════════

  // 5 · Coleta leve (novidades do topo dos sites). Falha não derruba a pipeline.
  // A fatia era de 8s contra uma reserva interna de 25s: a coleta crawleava, gastava os 8s e
  // inseria ZERO itens em TODA rodada — o pior dos três descompassos, porque parecia funcionar
  // (gravava `ultimo_check`, e a tela mostrava "última captura" recente).
  if (hasBudget(deadlineAt, gateDoPasso("coleta"))) {
    try {
      const r = await call(checkGET, "/api/v1/monitoramento/check", undefined, RESERVA.coleta);
      etapas.coleta = { novos_detectados: r?.novos_detectados ?? 0 };
    } catch {
      etapas.coleta = { erro: "coleta falhou nesta rodada" };
    }
  } else restantes = true;

  // 6 · Requeue dos mal classificados: "Voto DXX NNN-2026" preso como documento_apoio/agência "?"
  // (analisado antes do classificador por filename) → volta à fila e re-analisa com o código novo.
  // Fase 7: eram até 50 `requeueDocument` em SÉRIE, 3 round-trips cada, SEM nenhuma checagem de
  // saldo — quando tinha alvo, consumia a rodada inteira e todos os passos seguintes falhavam o
  // gate. Agora para graciosamente e reporta o que ficou.
  if (hasBudget(deadlineAt, gateDoPasso("enqueue"))) {
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
      let naoTentados = 0;
      for (const d of alvo) {
        if (!hasBudget(deadlineAt, 3_000)) { naoTentados = alvo.length - requeued; restantes = true; break; }
        try { await requeueDocument(db, d.id as string); requeued++; } catch { /* segue */ }
      }
      etapas.reclassificacao = { reenfileirados: requeued, ...(naoTentados > 0 ? { adiados: naoTentados } : {}) };
    } catch {
      etapas.reclassificacao = { erro: "requeue falhou nesta rodada" };
    }
  } else restantes = true;

  // 7 · Enfileirar PDFs + processar a fila (loops server-side).
  // QA ago/2026: o break antigo era `candidates===0`, que também dispara quando os 208
  // estão FORA da janela ou quando a rota morreu (json→{}). Agora: progresso = queued+
  // sem_pdf (a janela drena por status terminal); fila remanescente ⇒ restantes=true.
  let enfileirados = 0;
  let itensArquivados = 0;
  let tetoAtingido = false;
  for (let i = 0; i < 10 && hasBudget(deadlineAt, gateDoPasso("enqueue")); i++) {
    // Teto de VAZÃO por rodada (Fase 7). Com o download em paralelo, o orçamento deixou de ser o
    // estrangulador — sem teto, uma rodada sob cron diário poderia puxar centenas de documentos
    // sem ninguém olhando. O que não couber fica na fila durável e entra na rodada seguinte.
    const saldoTeto = TETO_ENQUEUE_POR_RODADA - (enfileirados + itensArquivados);
    if (saldoTeto <= 0) { tetoAtingido = true; restantes = true; break; }
    const r = await call(
      enqueuePOST,
      "/api/v1/deliberacoes/enqueue-pdfs",
      // Fase 8 — `limit` conta ITENS, `max_pdfs` conta PDFs. O teto de vazão é de PDFs, e era
      // verificado só ENTRE chamadas: enquanto um item rendia 1-6 PDFs isso segurava por acaso,
      // mas com o teto de filhos em 12 uma única chamada de 20 itens poderia gravar 240 contra um
      // teto de 60. Agora o limite viaja na unidade que ele limita.
      { limit: Math.min(20, saldoTeto), max_pdfs: saldoTeto },
      RESERVA.enqueue + 3_000,
    );
    const q = Number(r?.queued ?? 0);
    const s = Number(r?.sem_pdf ?? 0);
    enfileirados += q;
    itensArquivados += s;
    if (r?.parcial || Number(r?.restantes ?? 0) > 0) restantes = true;
    if (!r || Number(r?.candidates ?? 0) === 0) break; // janela vazia de verdade (drena por status)
    if (q + s === 0) { restantes = true; break; }      // só erros transitórios — próxima rodada
  }
  let processados = 0;
  for (let i = 0; i < 10 && hasBudget(deadlineAt, gateDoPasso("extracao")); i++) {
    const r = await call(processPOST, "/api/v1/upload/process?limit=20", {});
    const p = Number(r?.processed ?? 0);
    processados += p;
    if (p === 0) break;
    if (p >= 20) restantes = true; // lote cheio → provavelmente há mais fila
  }
  if (!hasBudget(deadlineAt, gateDoPasso("extracao"))) restantes = true;
  etapas.extracao = {
    enfileirados,
    processados,
    itens_sem_pdf_arquivados: itensArquivados,
    // Teto atingido não é falha: é a vazão desta rodada respeitando o limite. Reportar é o
    // que impede a leitura errada de "a esteira parou de achar coisas".
    ...(tetoAtingido ? { teto_por_rodada: TETO_ENQUEUE_POR_RODADA } : {}),
  };

  // 8 · Dedup retroativo de deliberações (rede final; funde qualquer par que escapou).
  if (hasBudget(deadlineAt, gateDoPasso("dedup"))) {
    try {
      const r = await call(dedupPOST, "/api/v1/admin/deliberacoes/dedup?dry_run=0", {});
      etapas.dedup_final = { fundidas: r?.deliberacoes_em_dobro ?? r?.fundidas ?? 0 };
    } catch {
      etapas.dedup_final = { erro: "dedup falhou nesta rodada" };
    }
  } else restantes = true;

  // 9 · Recuperação de ignorados. Fase 7 — FIM DO PING-PONG.
  // Esta chamada re-enfileirava exatamente os documentos que o confirm-lote acabara de arquivar
  // na MESMA rodada (`status='ignored'` de voto_individual/ata), e ainda forçava `restantes=true`.
  // Era um moinho fechado e determinístico: aprovar → arquivar → desarquivar → aprovar…, o que
  // sustentava as 40 rodadas do cliente sem nenhum progresso real. Agora só entra quando a
  // aprovação NÃO arquivou nada nesta rodada — ou seja, quando os `ignored` que existem são
  // antigos, e desarquivá-los é de fato uma segunda chance, não desfazer o trabalho recém-feito.
  const arquivouAgora =
    Number((etapas.aprovacao as Record<string, number> | undefined)?.ignorados_pauta_apoio ?? 0) +
    Number((etapas.aprovacao as Record<string, number> | undefined)?.ilegiveis_arquivados ?? 0) +
    Number((etapas.aprovacao as Record<string, number> | undefined)?.sem_agencia_arquivados ?? 0);
  if (arquivouAgora === 0 && hasBudget(deadlineAt, gateDoPasso("derivada"))) {
    try {
      const r = await call(reprocessIgnoradosPOST, "/api/v1/admin/upload/reprocess-ignorados?dry_run=0", {}, 8_000);
      const reenfileirados = Number(r?.reenfileirados ?? r?.requeued ?? 0);
      etapas.recuperacao_ignorados = { reenfileirados };
      if (reenfileirados > 0) restantes = true;
    } catch {
      etapas.recuperacao_ignorados = { erro: "reprocesso falhou nesta rodada" };
    }
  } else if (arquivouAgora > 0) {
    etapas.recuperacao_ignorados = { adiado_por_arquivamento_nesta_rodada: arquivouAgora };
  }

  // 9b · REPROCESSAR OS `failed` — Fase 9, passo NOVO (e de propósito NÃO é o passo 9 ampliado).
  //
  // Produção: 17 documentos da ANTT em `failed` com `tipo_documento` NULL — falharam antes de
  // qualquer classificação. Nenhum passo os alcançava: o passo 6 filtra `review_pending` e o passo
  // 9 filtra `ignored` + tipo IN (voto_individual, ata) — um `failed` de tipo nulo erra os DOIS.
  //
  // ⚠️ Por que passo SEPARADO: ampliar o passo 9 arrastaria `failed` para debaixo do guard
  // anti-ping-pong (`arquivouAgora === 0`), e esse guard existe por um motivo que NÃO se aplica
  // aqui. `ignored` é uma DECISÃO que o confirm-lote acabou de tomar; desfazê-la na mesma rodada é
  // o moinho. `failed` não é decisão — nada na rodada o produz de propósito. Acoplá-los faria o
  // reprocesso de `failed` ser pulado em toda rodada em que a aprovação arquivasse uma pauta.
  if (hasBudget(deadlineAt, gateDoPasso("reprocessarFalhados"))) {
    try {
      const { data: falhados } = await db
        .from("documentos_regulatorios")
        .select("id, campos_detectados")
        .eq("status", "failed")
        .not("upload_job_id", "is", null)
        .limit(20);
      let reprocessados = 0;
      let desistidos = 0;
      for (const doc of ((falhados ?? []) as any[])) {
        if (!hasBudget(deadlineAt, 2_500)) { restantes = true; break; }
        // TETO DE TENTATIVAS: um PDF corrompido, de 0 bytes ou escaneado sem OCR falha idêntico
        // para sempre. Sem teto, o passo queima orçamento nos mesmos 17 documentos toda rodada.
        // O contador vive em `campos_detectados`, que o `requeueDocument` já escreve.
        const campos = (doc.campos_detectados ?? {}) as Record<string, unknown>;
        const ciclos = Number(campos.reprocessos_falha) || 0;
        if (ciclos >= 3) { desistidos++; continue; }
        try {
          await requeueDocument(db, doc.id as string);
          await db.from("documentos_regulatorios")
            .update({ campos_detectados: { ...campos, reprocessos_falha: ciclos + 1 } })
            .eq("id", doc.id);
          reprocessados++;
        } catch { /* o próximo documento não paga pelo erro deste */ }
      }
      etapas.reprocesso_falhados = {
        reprocessados,
        ...(desistidos > 0 ? { desistidos_apos_3_ciclos: desistidos } : {}),
      };
      if (reprocessados > 0) restantes = true;
    } catch {
      etapas.reprocesso_falhados = { erro: "reprocesso de falhados falhou nesta rodada" };
    }
  } else restantes = true;

  // 10 · MÉTRICAS DERIVADAS — Fase 7: saíram de trás do `if (!restantes)`.
  // Elas alimentam Empresas, Qualidade, Mandatos e a divergência dos votos: é este bloco que leva
  // o resultado da esteira ao Dashboard e ao Observatório da Regulação. Estar atrás de
  // `!restantes` significava, na prática, NUNCA rodar — porque toda rodada que fez trabalho de
  // verdade termina com `restantes = true`. Daí "o número de Votos e Deliberações não mudou".
  // Agora rodam quando a rodada MATERIALIZOU algo (há o que propagar) ou quando a fila drenou
  // (a passada final de consistência). Numa rodada que só ingeriu, continuam de fora — não há
  // métrica nova para derivar e o orçamento é melhor gasto ingerindo.
  const materializouAgora =
    Number((etapas.auto_confirm as Record<string, number> | undefined)?.confirmados ?? 0) +
    Number((etapas.aprovacao as Record<string, number> | undefined)?.materializados ?? 0) +
    Number((etapas.backfill_votos as Record<string, number> | undefined)?.votos ?? 0);
  if (materializouAgora > 0 || !restantes) {
    const derivadas: Array<[string, (r: NextRequest) => Promise<NextResponse | Response>, string, unknown]> = [
      ["empresas_backfill", empresasBackfillPOST, "/api/v1/empresas/backfill", {}],
      ["qualidade_derivadas", qualidadeDerivadasPOST, "/api/v1/qualidade-regulatoria/coletas/derivadas/run", {}],
      ["mandatos_percentual", mandatosRecalcularPOST, "/api/v1/mandatos/recalcular", {}],
      ["divergencia_votos", divergenciaPOST, "/api/v1/votos/recalcular-divergencia?apply=1", {}],
    ];
    for (const [nome, handler, path, corpo] of derivadas) {
      if (!hasBudget(deadlineAt, gateDoPasso("derivada"))) { restantes = true; break; }
      try {
        const r = await call(handler, path, corpo, RESERVA.derivada + 2_000);
        const n = [r?.atualizados, r?.alterados, r?.updated, r?.deliberacoes_atualizadas, r?.votos_alterados]
          .find((v: unknown) => typeof v === "number");
        etapas[nome] = { ok: true, ...(typeof n === "number" ? { atualizados: n } : {}) };
      } catch {
        etapas[nome] = { erro: `${nome} falhou nesta rodada` };
      }
    }
  }

  // ═══ Registro da rodada + DISJUNTOR ══════════════════════════════════════════
  // Contar erros não basta. Com a vazão do commit 7 e um cron diário, um erro sistemático (um
  // portal que muda de layout, uma migration faltando, o Storage fora do ar) deixaria de ser uma
  // rodada ruim e viraria centenas de documentos mal processados antes de alguém abrir a tela.
  // Quando mais da metade dos passos falha — com amostra suficiente para não ser ruído — a
  // execução PARA e diz por quê.
  let abortadoPeloDisjuntor = false;
  if (execucao) {
    execucao = (await registrarRodada(db, execucao, etapas)) ?? execucao;
    if (deveAbrirDisjuntor(execucao.passos_ok, execucao.passos_erro)) {
      abortadoPeloDisjuntor = true;
      restantes = false; // não peça outra rodada: o problema não é falta de tempo
      await fecharRun(
        db,
        execucao.id,
        "abortado",
        `Disjuntor: ${execucao.passos_erro} de ${execucao.passos_ok + execucao.passos_erro} passos falharam ` +
          `em ${execucao.rodadas} rodada(s). A esteira parou para não propagar um erro sistemático.`,
      );
    } else if (!restantes) {
      await fecharRun(db, execucao.id, "concluido", null);
    }
  }

  return NextResponse.json({
    etapas,
    restantes, // true = re-chamar para continuar (orçamento de tempo)
    materializados_nesta_rodada: materializouAgora,
    run_id: execucao?.id ?? null,
    rodadas: execucao?.rodadas ?? null,
    ...(abortadoPeloDisjuntor
      ? {
          abortado: true,
          motivo_parada: `Disjuntor aberto: ${execucao!.passos_erro} de ${execucao!.passos_ok + execucao!.passos_erro} passos falharam. Verifique os logs antes de rodar de novo.`,
        }
      : {}),
    legal_notice:
      "Pipeline zero-toque: aprovação em camadas do que já estava em revisão (dedup em 4 barreiras; direção de voto nunca chutada; ilegível não vira métrica) → diretores → votos → coleta/extração de material novo → dedup final → métricas derivadas (empresas, qualidade, mandatos, divergência). Idempotente.",
  });
}
