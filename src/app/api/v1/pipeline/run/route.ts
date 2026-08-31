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
import {
  RESERVA,
  TETO_ENQUEUE_POR_RODADA,
  ORDEM_DOS_PASSOS,
  FOLGA_ORQUESTRADOR_MS,
  MARGEM_PARTIDA_MS,
  fatiaDoPasso,
  podeRodar,
  planejarRodada,
  type PassoEsteira,
} from "@/lib/server/esteira-reservas";
import { requeueDocument } from "@/lib/server/upload-queue";
import {
  buscarRunAtiva,
  deveContinuar,
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
import { POST as redatarPOST } from "../../admin/deliberacoes/redatar/route";
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
  /**
   * TRABALHO RELATADO: algum passo disse que sobrou fila. Fase 11 — este booleano NÃO é mais o
   * desfecho da rodada. "Não coube tudo nesta rodada" é outra coisa, e confundir os dois foi o que
   * tornou `desfecho: "drenou"` inalcançável: com 13 passos somando ~144s de reserva contra 50s de
   * orçamento, o plano NUNCA cabe inteiro. O desfecho agora sai de `deveContinuar`, no fim.
   */
  let restantes = false;
  /**
   * Passos TENTADOS nesta rodada (chamados de verdade — pulado não conta). Fase 16: o conjunto
   * persiste na run via contadores `tentou_<passo>`, e é ELE que decide "não tentado" — por RUN,
   * não por rodada. O plano só comporta 5-8 de 14 passos, então "não tentado nesta rodada" era
   * sempre > 0 e forçava ≥14 rodadas até com a fila vazia (~3-5min para nada).
   */
  const tentadosNaRodada = new Set<PassoEsteira>();

  /** Saldo REAL disponível para trabalho: o round-trip de auth e o flush acontecem fora dele. */
  const saldo = () => msLeft(deadlineAt) - FOLGA_ORQUESTRADOR_MS;

  /** Passos que pediram fatia e não couberam — a rodada não terminou, só não coube tudo nela. */
  let passosPulados = 0;

  /** O desfecho de uma chamada a sub-rota. `pulado` NÃO é falha: é a rodada que não coube. */
  type Resposta = { ok: boolean; status: number; pulado: boolean; body: any };

  /**
   * Passo deixado de fora do PLANO desta rodada — entra na próxima. Não é falha, e (Fase 11) não
   * é motivo suficiente para pedir outra rodada: ele é CONTADO, e `deveContinuar` decide.
   */
  const foraDoPlano = (nome: string): StepResult => {
    // Fase 16 — sem contador aqui: "não tentado" agora é derivado por RUN (ORDEM − tentados na
    // run), no fim da rodada. Contar por rodada era o que forçava ≥14 rodadas com fila vazia.
    return { fora_do_plano: `«${nome}» não entrou no plano desta rodada; entra numa próxima` };
  };

  // Handler sintético: chama a rota real com o MESMO Bearer (padrão auto-confirm→confirm).
  // QA ago/2026: cada sub-rota tinha orçamento PRÓPRIO de 50s — somados, estouravam o
  // SIGKILL de 60s do Hobby. Agora toda chamada leva `budget_ms` = fatia do saldo REAL.
  //
  // Fase 10 — a fatia deixa de ser "tudo o que sobrou". `maxSliceMs` era OPCIONAL e 7 das 11
  // chamadas o omitiam, então os passos da cabeça recebiam o orçamento inteiro e a cauda
  // (extração, derivadas) nunca alcançava o próprio portão: 26 rodadas, 0 PDF extraído, 0 métrica.
  // Agora o passo se IDENTIFICA e `fatiaDoPasso` decide — limitada pelo teto dele e pelo que a
  // cauda precisa depois.
  async function call(
    handler: (r: NextRequest) => Promise<NextResponse | Response>,
    path: string,
    passo: PassoEsteira,
    body?: unknown,
  ): Promise<Resposta> {
    const slice = Math.round(fatiaDoPasso(passo, saldo(), protecao[passo] ?? 0));
    // Chamar com menos que a reserva é o bug da Fase 7: o passo gasta o round-trip de auth e
    // devolve zero. E `budget_ms=0` é PIOR que não chamar — `budgetFromRequest` trata 0 como
    // ausente e a sub-rota abre um orçamento NOVO de 50s, fora de qualquer controle.
    if (slice < RESERVA[passo] + MARGEM_PARTIDA_MS) {
      // Fase 16 — a comparação exige a MARGEM: fatia == reserva era o terceiro lado da classe
      // (a sub-rota checa hasBudget(deadline, RESERVA) antes da 1ª unidade e falhava sempre).
      passosPulados++;
      return { ok: false, status: 0, pulado: true, body: null };
    }
    tentadosNaRodada.add(passo);
    const url = new URL(path, req.url);
    url.searchParams.set("budget_ms", String(slice));
    const synthetic = new NextRequest(url, {
      method: body === undefined ? "GET" : "POST",
      headers: { "content-type": "application/json", authorization: auth },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const res = await handler(synthetic);
    const corpo = await res.json().catch(() => ({}));
    // `res.status` NUNCA era olhado: `return await res.json()` engolia qualquer desfecho. Uma
    // sub-rota que respondia 403 virava `{}`, o passo era contabilizado como BEM-SUCEDIDO e o
    // disjuntor não via nada. O caso real: sob o cron diário, QUATRO passos respondiam 403 —
    // confirm-lote, dedup, recompute e aprovar-lote usavam `requireAdmin` em vez de
    // `requireAdminOrCron` — e o cron reportava sucesso todo dia sem materializar uma linha.
    return { ok: res.status >= 200 && res.status < 300, status: res.status, pulado: false, body: corpo };
  }

  /**
   * Anota o desfecho de um passo. Falha de HTTP vira `erro`, que é o que o disjuntor conta.
   *
   * ⚠️ GUARDA DE FALSO POSITIVO: passo que não foi TENTADO — fora do plano da rodada, ou sem
   * fatia — não é falha. Um passo que legitimamente não tinha trabalho também não é. Contá-los
   * como erro abriria o disjuntor numa esteira saudável, que é pior do que o bug original.
   */
  function anotar(r: Resposta, nome: string, campos: StepResult): StepResult {
    if (r.pulado) return { pulado: `sem fatia para «${nome}» nesta rodada` };
    if (!r.ok) return { ...campos, erro: `${nome} respondeu HTTP ${r.status}` };
    return campos;
  }

  /** O desfecho mais grave entre várias chamadas do MESMO passo: falha > pulado > ok. */
  const pior = (...rs: Resposta[]): Resposta =>
    rs.find((x) => !x.ok && !x.pulado) ?? rs.find((x) => x.pulado) ?? rs[rs.length - 1];

  const { createSupabaseServerClient } = await import("@/lib/supabase/server");
  const db = createSupabaseServerClient();

  // ═══ Fase 7 — EXECUÇÃO COM MEMÓRIA: retomar, travar, e o disjuntor ════════════
  // A rota era stateless; todo o estado do "Rodar tudo" vivia no navegador. Agora cada rodada
  // registra o avanço numa linha de execução: fechar a aba deixa de "perder tudo" (a tela reabre
  // e retoma), duas abas não disputam as mesmas linhas, e uma execução que está falhando PARA.
  // Se a migration ainda não foi aplicada, `run` é `null` e a esteira roda como antes.
  const corpo = (await req.json().catch(() => ({}))) as { run_id?: string; encerrar?: boolean; motivo?: string };
  await reaparRunsOrfas(db);

  // Fase 12 — ENCERRAR explicitamente. Quando o laço do cliente parava (teto de rodadas ou 2
  // falhas seguidas), ele só limpava o estado LOCAL: a run ficava `running` por 3 minutos até o
  // reaper de órfãs a marcar como erro — daí os dois banners contraditórios ("rodando agora" +
  // "parou no teto") e uma run fantasma com status errado a cada clique. Fechar uma run já
  // fechada é no-op (o UPDATE filtra por status), então o ramo é idempotente.
  if (corpo.encerrar && corpo.run_id) {
    await fecharRun(db, corpo.run_id, "concluido", corpo.motivo ?? "encerrado pelo cliente");
    return NextResponse.json({ encerrado: true, run_id: corpo.run_id });
  }

  const ativa = await buscarRunAtiva(db);
  if (ativa && corpo.run_id && ativa.id !== corpo.run_id) {
    // Outra execução está viva: recusar é melhor do que duas esteiras sobre as mesmas linhas.
    return NextResponse.json(
      { error: "Já existe uma execução da esteira em andamento.", run_id: ativa.id, rodadas: ativa.rodadas },
      { status: 409 },
    );
  }
  let execucao = ativa ?? (await iniciarRun(db, origem));

  // ═══ Fase 10 — PLANEJAR a rodada em vez de deixá-la ser devorada pela cabeça ══
  // A soma das reservas dos doze passos é ~128s contra 50s de orçamento: uma rodada nunca coube
  // inteira. O que faltava não era teto, era ESCOLHA — sem ela, quem vinha primeiro levava tudo e
  // a cauda (extração, derivadas) nunca alcançava o próprio portão: 26 rodadas, 0 PDF extraído,
  // 0 métrica, 62 documentos presos. O plano escolhe quem tenta esta rodada e quanto pode gastar,
  // girando a prioridade com o número da rodada para que nenhum passo fique de fora sempre.
  // Sem a migration de `esteira_runs`, `execucao` é null e a rodada 0 é sempre planejada — ainda
  // correto, só sem o giro.
  // Fase 12 — o planejador orça a MESMA moeda que o executor gasta. Planejar contra
  // HOBBY_BUDGET_MS quando `saldo()` nunca passa de HOBBY_BUDGET_MS − FOLGA criava passos que
  // entravam no plano, consumiam a reserva na soma e nasciam sem fatia: 36 vagas mortas em 40
  // rodadas (simulado com os números reais — o reaper morria em 4 das 20 rodadas dele).
  // Fase 16 — a rodada MEDE a fila antes de planejar (1 count head:true, ~50ms contra os ~40s
  // da rodada) e liga a DRENAGEM: com fila, a extração é semeada à frente em toda rodada. A
  // salvaguarda contra inanição da ingestão vive no planejador (e em teste): só a extração é
  // privilegiada; coleta/enqueue seguem no giro.
  let filaExtracao = 0;
  try {
    const { count } = await db
      .from("upload_jobs")
      .select("id", { count: "exact", head: true })
      .eq("status", "pending");
    filaExtracao = count ?? 0;
  } catch { /* tabela indisponível: sem viés, comportamento antigo */ }
  const { passos: planoDaRodada, protecao } = planejarRodada(
    execucao?.rodadas ?? 0,
    HOBBY_BUDGET_MS - FOLGA_ORQUESTRADOR_MS,
    { drenar: filaExtracao > 0 },
  );
  /** O passo está no plano E tem fatia para uma unidade de trabalho? */
  const cabe = (passo: PassoEsteira) =>
    planoDaRodada.has(passo) && podeRodar(passo, saldo(), protecao[passo] ?? 0);

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
  // E os gates deixaram de ser literais: vêm de `podeRodar()`, que calcula portão e fatia pela
  // MESMA função — foi a divergência entre os dois que criou as duas metades do bug.
  // usam como reserva interna. Um teste tabular falha se algum gate ficar abaixo da reserva.

  // 1 · Auto-confirm (gate conservador — o caminho de alta confiança primeiro).
  if (cabe("autoConfirm")) {
    const r = await call(autoConfirmPOST, "/api/v1/upload/auto-confirm", "autoConfirm", { limit: 50, loop: true });
    etapas.auto_confirm = anotar(r, "auto-confirm", {
      confirmados: r.body?.confirmados_total ?? 0,
      restantes: r.body?.restantes ?? false,
    });
    if (r.body?.restantes) restantes = true;
  } else { etapas.auto_confirm = foraDoPlano("auto-confirm"); }

  // 2 · Confirm-lote zero-toque (camadas + dedup auto-resolvida).
  if (cabe("confirmLote")) {
    const r = await call(confirmLotePOST, "/api/v1/upload/confirm-lote", "confirmLote", { todos: true });
    etapas.aprovacao = anotar(r, "confirm-lote", {
      materializados: r.body?.materializados ?? 0,
      ignorados_pauta_apoio: r.body?.ignorados ?? 0,
      duplicatas_arquivadas: r.body?.arquivados_duplicata_exata ?? 0,
      fundidos_semanticos: r.body?.fundidos_semanticos ?? 0,
      ilegiveis_arquivados: r.body?.arquivados_ilegiveis ?? 0,
      sem_agencia_arquivados: r.body?.arquivados_sem_agencia ?? 0,
      nao_deliberativos_arquivados: r.body?.arquivados_nao_deliberativos ?? 0,
      erros: r.body?.erros ?? 0,
    });
    if (r.body?.restantes) restantes = true;
  } else { etapas.aprovacao = foraDoPlano("confirm-lote"); }

  // 3 · Candidatos: recompute (auto-aprova ≥0.85 + mescla estritas) e aprovar-lote (0.8 + novos).
  if (cabe("candidatos")) {
    try {
      const rec = await call(recomputePOST, "/api/v1/admin/diretores/candidatos/recompute?dry_run=0", "candidatos", {});
      const r = await call(aprovarLotePOST, "/api/v1/diretores/candidatos/aprovar-lote", "candidatos", {
        min_confidence: 0.8,
        incluir_novos: true,
      });
      // Etapa67 — a MEDIÇÃO do auto-resolver: as quatro contagens sobem até o resumo do
      // "Rodar tudo". Se `sem_margem` for raro (hipótese: mandato resolve quase tudo), o
      // fallback fica como está; se for frequente, ganha visibilidade — com o número na mão.
      etapas.diretores = anotar(pior(rec, r), "candidatos", {
        aprovados: r.body?.aprovados ?? 0,
        excecoes: r.body?.pulados ?? 0,
        rejeitados_lixo: rec.body?.grupos_rejeitados_lixo ?? 0,
        resolvidos_por_mandato: r.body?.resolvidos_por_mandato ?? 0,
        resolvidos_por_margem: r.body?.resolvidos_por_margem ?? 0,
        resolvidos_sem_margem: r.body?.resolvidos_sem_margem ?? 0,
      });
      if (r.body?.restantes || rec.body?.restantes) restantes = true;
    } catch {
      etapas.diretores = { erro: "candidatos falharam nesta rodada" };
    }
  } else { etapas.diretores = foraDoPlano("candidatos"); }

  // 4 · Backfill de votos (QA ago/2026): deliberações finais já gravadas sem voto ganham
  // os votos que a evidência persistida sustenta (regras novas de inferência). Idempotente.
  if (cabe("backfillVotos")) {
    try {
      const r = await call(materializarPOST, "/api/v1/admin/votos/materializar-faltantes", "backfillVotos", { dry_run: false });
      etapas.backfill_votos = anotar(r, "backfill de votos", {
        deliberacoes: r.body?.materializaveis ?? 0,
        votos: r.body?.votos ?? 0,
      });
      if (r.body?.restantes) restantes = true;
    } catch {
      etapas.backfill_votos = { erro: "backfill falhou nesta rodada" };
    }
  } else { etapas.backfill_votos = foraDoPlano("backfill de votos"); }

  // ═══ INGESTÃO — só depois de drenar o que já estava em revisão ════════════════

  // 5 · Coleta leve (novidades do topo dos sites). Falha não derruba a pipeline.
  // A fatia era de 8s contra uma reserva interna de 25s: a coleta crawleava, gastava os 8s e
  // inseria ZERO itens em TODA rodada — o pior dos três descompassos, porque parecia funcionar
  // (gravava `ultimo_check`, e a tela mostrava "última captura" recente).
  // Fase 16 — coleta 1× por EXECUÇÃO. O check é crawl real de ~25s SEM caminho rápido: rodava
  // 12× por run (~5min) re-crawleando as mesmas listagens sem novidade nenhuma. `tentou_coleta`
  // acumulado nos contadores da run diz se esta execução já coletou; sem a migration de
  // esteira_runs (execucao null) o comportamento antigo permanece.
  const coletaJaFeitaNaRun = Number(execucao?.contadores?.["tentou_coleta"] ?? 0) > 0;
  if (cabe("coleta") && !coletaJaFeitaNaRun) {
    try {
      const r = await call(checkGET, "/api/v1/monitoramento/check", "coleta");
      etapas.coleta = anotar(r, "coleta", { novos_detectados: r.body?.novos_detectados ?? 0 });
    } catch {
      etapas.coleta = { erro: "coleta falhou nesta rodada" };
    }
  } else if (coletaJaFeitaNaRun) {
    etapas.coleta = { fora_do_plano: "coleta já rodou nesta execução — 1× por run" };
  } else { etapas.coleta = foraDoPlano("coleta"); }

  // 6 · Requeue dos mal classificados: "Voto DXX NNN-2026" preso como documento_apoio/agência "?"
  // (analisado antes do classificador por filename) → volta à fila e re-analisa com o código novo.
  // Fase 7: eram até 50 `requeueDocument` em SÉRIE, 3 round-trips cada, SEM nenhuma checagem de
  // saldo — quando tinha alvo, consumia a rodada inteira e todos os passos seguintes falhavam o
  // gate. Agora para graciosamente e reporta o que ficou.
  if (cabe("reclassificacao")) {
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
      // Fase 12 — chave PRÓPRIA. `reenfileirados` era gravada AQUI e no passo 9; o acumulador
      // soma toda chave numérica homônima, então o banner mostrava "97 reclassificado(s)"
      // somando reclassificação com desarquivamento — número falso que o usuário leu.
      etapas.reclassificacao = { reclassificados: requeued, ...(naoTentados > 0 ? { adiados: naoTentados } : {}) };
    } catch {
      etapas.reclassificacao = { erro: "requeue falhou nesta rodada" };
    }
  } else { etapas.reclassificacao = foraDoPlano("reclassificação"); }

  // 7 · Enfileirar PDFs + processar a fila (loops server-side).
  // QA ago/2026: o break antigo era `candidates===0`, que também dispara quando os 208
  // estão FORA da janela ou quando a rota morreu (json→{}). Agora: progresso = queued+
  // sem_pdf (a janela drena por status terminal); fila remanescente ⇒ restantes=true.
  let enfileirados = 0;
  let itensArquivados = 0;
  let tetoAtingido = false;
  /** Falha de HTTP na ingestão/extração: o laço para, mas o desfecho tem de sobreviver ao laço. */
  let falhaIngestao: Resposta | null = null;
  for (let i = 0; i < 10 && cabe("enqueue"); i++) {
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
      "enqueue",
      { limit: Math.min(20, saldoTeto), max_pdfs: saldoTeto },
    );
    if (!r.ok && !r.pulado) { falhaIngestao = r; restantes = true; break; }
    const q = Number(r.body?.queued ?? 0);
    const s = Number(r.body?.sem_pdf ?? 0);
    enfileirados += q;
    itensArquivados += s;
    if (r.body?.parcial || Number(r.body?.restantes ?? 0) > 0) restantes = true;
    if (!r.body || Number(r.body?.candidates ?? 0) === 0) break; // janela vazia (drena por status)
    if (q + s === 0) { restantes = true; break; }      // só erros transitórios — próxima rodada
  }
  // 7a · SOLTAR OS PRESOS — passo NOVO e barato (Fase 10).
  //
  // Os três reapers sempre existiram, mas moravam dentro de `processPendingDocuments`, cujo ÚNICO
  // chamador é a extração — o passo mais caro da rodada. Reparar custa ~2s por documento; extrair
  // custa até 20s. Enquanto foram o mesmo passo, os presos herdaram o preço do trabalho caro, e a
  // extração era justamente quem nunca alcançava o portão. Resultado medido em produção: 62
  // documentos em `queued` — os MESMOS — depois de 26 rodadas, com o PDF já baixado.
  //
  // Vem ANTES da extração porque o documento que o reaper solta volta para `pending` e ainda pode
  // ser extraído na MESMA rodada.
  let religados = 0;
  let reapados = 0;
  if (cabe("reaper")) {
    const r = await call(processPOST, "/api/v1/upload/process?apenas_reaper=1", "reaper", {});
    religados += Number(r.body?.religados ?? 0);
    reapados += Number(r.body?.reaped ?? 0);
    etapas.presos = anotar(r, "reaper", { religados, jobs_orfaos_recuperados: reapados });
    if (religados > 0) restantes = true; // o que voltou para a fila quer ser extraído
  } else { etapas.presos = foraDoPlano("reaper"); }

  let processados = 0;
  for (let i = 0; i < 10 && cabe("extracao"); i++) {
    const r = await call(processPOST, "/api/v1/upload/process?limit=20", "extracao", {});
    if (!r.ok && !r.pulado) { falhaIngestao = falhaIngestao ?? r; restantes = true; break; }
    const p = Number(r.body?.processed ?? 0);
    processados += p;
    // Os reapers soltam documento preso mesmo quando não há nada a extrair — a medição que o
    // orquestrador antes JOGAVA FORA. Sem ela, "0 extraídos" e "0 presos soltos" são o mesmo texto.
    religados += Number(r.body?.religados ?? 0);
    reapados += Number(r.body?.reaped ?? 0);
    if (p === 0) break;
    if (p >= 20) restantes = true; // lote cheio → provavelmente há mais fila
  }
  // A extração não rodar não significa que HÁ fila — significa que ela não coube ou não foi
  // oferecida. Quem sabe a diferença é `call()` (que conta `passosPulados`) e o plano.
  // Fase 16 — o auto-contador saiu: «não tentado» agora deriva de ORDEM − tentados na RUN.
  etapas.extracao = {
    enfileirados,
    processados,
    ...(religados > 0 ? { presos_religados: religados } : {}),
    ...(reapados > 0 ? { jobs_orfaos_recuperados: reapados } : {}),
    ...(falhaIngestao ? { erro: `ingestão/extração respondeu HTTP ${falhaIngestao.status}` } : {}),
    itens_sem_pdf_arquivados: itensArquivados,
    // Teto atingido não é falha: é a vazão desta rodada respeitando o limite. Reportar é o
    // que impede a leitura errada de "a esteira parou de achar coisas".
    ...(tetoAtingido ? { teto_por_rodada: TETO_ENQUEUE_POR_RODADA } : {}),
  };

  // 8 · Dedup retroativo de deliberações (rede final; funde qualquer par que escapou).
  if (cabe("dedup")) {
    try {
      const r = await call(dedupPOST, "/api/v1/admin/deliberacoes/dedup?dry_run=0", "dedup", {});
      etapas.dedup_final = anotar(r, "dedup", {
        fundidas: r.body?.deliberacoes_em_dobro ?? r.body?.fundidas ?? 0,
      });
    } catch {
      etapas.dedup_final = { erro: "dedup falhou nesta rodada" };
    }
  } else { etapas.dedup_final = foraDoPlano("dedup"); }

  // 10b · Re-derivação de datas (Fase 15) — o passivo que nenhum botão fechava: 32 deliberações
  // da ANM em 1996 (fallback sem âncora pescou a data da lei do preâmbulo) e 74 sem data nenhuma
  // (somem da listagem E inflam as agregações de todo ano). A rota existia desde a Fase 9 e
  // nunca foi chamada; passivo sem dono não fecha sozinho. Idempotente: ancorado-somente, NULL
  // só com marcador `precisa_revisao_data` — e quem foi marcado sai da janela.
  if (cabe("redatar")) {
    try {
      const r = await call(redatarPOST, "/api/v1/admin/deliberacoes/redatar?dry_run=0", "redatar", {});
      etapas.redatar = anotar(r, "re-derivação de datas", {
        redatadas: Number(r.body?.corrigidas ?? 0) + Number(r.body?.nulas_corrigidas ?? 0),
        datas_para_revisao:
          Number(r.body?.sem_data_recuperavel ?? 0) + Number(r.body?.nulas_marcadas_revisao ?? 0),
      });
      if (r.body?.restantes) restantes = true;
    } catch {
      etapas.redatar = { erro: "re-derivação de datas falhou nesta rodada" };
    }
  } else { etapas.redatar = foraDoPlano("redatar"); }

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
    Number((etapas.aprovacao as Record<string, number> | undefined)?.sem_agencia_arquivados ?? 0) +
    Number((etapas.aprovacao as Record<string, number> | undefined)?.nao_deliberativos_arquivados ?? 0);
  // Fase 12 — o guard significava "a aprovação NÃO arquivou nesta rodada"; com o plano da
  // rodada ele passou a disparar também quando a aprovação NEM FOI OFERECIDA (o contador sai 0
  // dos dois jeitos). Desarquivar rodava em 28 de 40 rodadas contra 12 do arquivador — o moinho
  // da Fase 7 de volta por outra porta. Agora o desarquivamento só roda quando o arquivador FOI
  // TENTADO nesta rodada e não arquivou nada.
  const aprovacaoFoiTentada = !("fora_do_plano" in (etapas.aprovacao ?? {})) &&
    !("pulado" in (etapas.aprovacao ?? {}));
  if (aprovacaoFoiTentada && arquivouAgora === 0 && cabe("recuperacao")) {
    try {
      const r = await call(reprocessIgnoradosPOST, "/api/v1/admin/upload/reprocess-ignorados?dry_run=0", "recuperacao", {});
      const reenfileirados = Number(r.body?.reenfileirados ?? r.body?.requeued ?? 0);
      etapas.recuperacao_ignorados = anotar(r, "recuperação de ignorados", { desarquivados: reenfileirados });
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
  if (cabe("reprocessarFalhados")) {
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
  } else { etapas.reprocesso_falhados = foraDoPlano("reprocesso de falhados"); }

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
      if (!cabe("derivada")) break;
      try {
        const r = await call(handler, path, "derivada", corpo);
        const b = r.body ?? {};
        const n = [b.atualizados, b.alterados, b.updated, b.deliberacoes_atualizadas, b.votos_alterados]
          .find((v: unknown) => typeof v === "number");
        etapas[nome] = anotar(r, nome, { ok: true, ...(typeof n === "number" ? { atualizados: n } : {}) });
        // As quatro derivadas passaram a honrar `budget_ms` e podem parar no meio: sem isto a
        // rodada "concluiria" com métrica pela metade.
        if (r.body?.restantes) restantes = true;
      } catch {
        etapas[nome] = { erro: `${nome} falhou nesta rodada` };
      }
    }
  }

  // ═══ Fase 11 — O DESFECHO DA RODADA ═════════════════════════════════════════
  // Aqui morava `if (planoDaRodada.size < ORDEM_DOS_PASSOS.length) restantes = true;` — uma
  // comparação SEMPRE verdadeira (13 passos, ~144s de reserva, 50s de orçamento). Ela tornava
  // `restantes` eternamente true: "drenou" inalcançável, run nunca fechada, e o teto de 40 rodadas
  // do cliente virou o único desfecho possível. Com a fila VAZIA a esteira ainda queimava 40
  // rodadas — o "por que 25 minutos para poucos documentos?".
  // Fase 16 — o conjunto de tentados persiste na run (registrarRodada soma campos numéricos das
  // etapas; a etapa sintética `_tentativas` vira `tentou_<passo>` nos contadores, e contarPassos
  // a ignora para o disjuntor não ganhar amostra falsa).
  if (tentadosNaRodada.size > 0) {
    etapas._tentativas = Object.fromEntries([...tentadosNaRodada].map((p) => [`tentou_${p}`, 1]));
  }
  const passosNaoTentadosNaRun = ORDEM_DOS_PASSOS.filter(
    (p) => !tentadosNaRodada.has(p) && (execucao?.contadores?.[`tentou_${p}`] ?? 0) === 0,
  ).length;
  const pedeOutraRodada = deveContinuar({
    trabalhoRelatado: restantes,
    passosPulados,
    passosNaoTentados: passosNaoTentadosNaRun,
    rodada: execucao?.rodadas ?? 0,
  });
  restantes = pedeOutraRodada;

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
    fila_extracao: filaExtracao,
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
