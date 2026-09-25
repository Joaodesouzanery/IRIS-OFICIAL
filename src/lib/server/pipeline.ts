/**
 * Pipeline de processamento de PDF.
 *
 * V1 assíncrona: o worker processa documentos brutos e os deixa em revisão.
 * Nenhuma deliberação final é criada aqui; isso só acontece em /upload/confirm.
 */

import { exigirEscrita } from "@/lib/server/escrita-checada";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { analyzeUploadPdf, markBatchDuplicates } from "@/lib/server/upload-analysis";
import { hasBudget } from "@/lib/server/time-budget";
import { RESERVA_POR_JOB_MS, tetoDoDownload, CUSTO_DE_GRAVACAO_MS } from "@/lib/server/orcamento-do-parse";
import { modoDoProcessamento, type ModoDoProcessamento } from "@/lib/server/modo-do-processamento";
import { protecaoDepoisDe } from "@/lib/server/orcamento-dos-reapers";
import { planejarReligacao, type JobConhecido } from "@/lib/server/religacao-da-fila";
// ⚠️ A janela do reaper mora em `estado-da-fila.ts`, e o import vai NESSA direção: aquele módulo
// é puro e é importado pela TELA, então ele não pode importar daqui (`@/lib/supabase/server`
// entraria no bundle do cliente). Antes era um literal `5 * 60_000` solto, e o banner que agora
// fala em "além dos 5min do reaper" precisa da MESMA janela, não de uma cópia.
import { REAPER_JANELA_MS } from "@/lib/server/estado-da-fila";

type QueueJob = { jobId: string; agenciaId?: string | null };

export async function processPdf(jobId: string, deadlineAt?: number): Promise<void> {
  const db = createSupabaseServerClient();

  await exigirEscrita(db
    .from("upload_jobs")
    .update({ status: "processing", updated_at: new Date().toISOString() })
    .eq("id", jobId), `job ${jobId} → processing`);

  let documentoId: string | null = null;

  try {
    const { data: job } = await db
      .from("upload_jobs")
      .select("id, filename, file_hash, agencia_id, storage_path, documento_id")
      .eq("id", jobId)
      .single();

    if (!job) throw new Error("Job nao encontrado");
    documentoId = (job.documento_id as string | null) ?? null;
    if (!job.storage_path) throw new Error("Job sem storage_path");

    // Fase 7 — a marcação de "processing" passa a DEVOLVER a linha, para colher a URL de origem
    // sem um round-trip novo. Ela é gravada em `metadata.source_url` pelo enfileiramento e, até
    // agora, morria ali: a deliberação nascia sem proveniência e o card de inspeção do detalhe
    // ficava sem "Fonte original".
    const docRow = await updateDocument(db, documentoId, {
      status: "processing",
      error_message: null,
      updated_at: new Date().toISOString(),
    }, true);
    const docMeta = (docRow?.metadata ?? {}) as Record<string, unknown>;
    const sourceUrl = typeof docMeta.source_url === "string" ? docMeta.source_url : null;

    // Fase 26 — um job que estoura a fatia da função não pode ficar em "processing" até o
    // SIGKILL (aí só o reaper de 5min o resgata, sem motivo). Se há deadline, o trabalho corre
    // contra ele e, estourando, cai no `catch` com motivo — reprocessável, e o 3º ciclo mostra
    // "grande/escaneado" em vez de silêncio.
    // ═══ Fase 29 — o download entra no relógio ═══════════════════════════════
    // Ele era baixado SEM teto e FORA da corrida abaixo, e o `restanteMs` do race era medido
    // AQUI, antes dele. O timer então disparava em `deadlineAt + D − 1.500`: a ultrapassagem do
    // deadline era exatamente a duração do download, ilimitada, e com 4 jobs em voo o atraso
    // ACUMULAVA por onda. Se o download travasse, nada cortava — nem o race (ainda não começou),
    // nem o worker do parser (só cobre o parse), nem o client Supabase (agora cobre, mas com o
    // piso de 10s, que é largo demais para caber numa fatia).
    //
    // O download NÃO entra no `Promise.race`: o race não cancelaria o fetch, só deixaria de
    // esperá-lo. Ele precisa de AbortSignal, que cancela de verdade.
    const tetoDownload = tetoDoDownload(deadlineAt);
    if (tetoDownload <= 0) {
      throw new Error("Excedeu a fatia de extração antes de baixar — reprocessável na próxima rodada.");
    }
    const abortarDownload = new AbortController();
    const relogioDoDownload = setTimeout(() => abortarDownload.abort(), tetoDownload);
    let fileData: Blob | null = null;
    try {
      const baixado = await db.storage.from("pdfs").download(job.storage_path, {}, { signal: abortarDownload.signal });
      if (baixado.error || !baixado.data) throw new Error(`Download falhou: ${baixado.error?.message ?? "sem arquivo"}`);
      fileData = baixado.data as Blob;
    } catch (err) {
      if (abortarDownload.signal.aborted) {
        // Motivo PRESERVADO: o QA distingue "o download estourou" de "o parser travou" e de
        // "a função morreu". Silêncio aqui seria o reaper marcando SIGKILL sem causa.
        throw new Error(`Download do PDF excedeu ${Math.round(tetoDownload / 1000)}s — reprocessável na próxima rodada.`);
      }
      throw err;
    } finally {
      clearTimeout(relogioDoDownload);
    }

    const buffer = Buffer.from(await fileData.arrayBuffer());
    const { data: agencias } = await db.from("agencias").select("id, sigla").eq("ativo", true);

    // ⚠️ A medição do race vem AQUI, depois do download e do SELECT de agências — não antes deles.
    // Medida antes, ela cronometrava um trecho de tempo que ainda não tinha acontecido. O literal
    // `1_500` virou `CUSTO_DE_GRAVACAO_MS` (2.000): é o que as três escritas e o flush exigem
    // depois que a análise termina, e agora tem nome e mora com os irmãos.
    const restanteMs = deadlineAt !== undefined ? deadlineAt - Date.now() - CUSTO_DE_GRAVACAO_MS : null;

    const analysis = await (restanteMs === null
      ? analyzeUploadPdf({
      file: {
        name: job.filename,
        buffer,
        source_archive: null,
        size: buffer.length,
      },
      agencias: agencias ?? [],
      db,
      currentDocumentoId: documentoId,
      currentUploadJobId: job.id,
      // Fase 17 — o orçamento da rodada chega até o OCR. Sem ele, um PDF escaneado podia gastar
      // 400s numa função de 70s (SIGKILL incatchável, levando a run e os jobs concorrentes).
      deadlineAt,
    })
      : Promise.race([
          analyzeUploadPdf({
      file: {
        name: job.filename,
        buffer,
        source_archive: null,
        size: buffer.length,
      },
      agencias: agencias ?? [],
      db,
      currentDocumentoId: documentoId,
      currentUploadJobId: job.id,
      // Fase 17 — o orçamento da rodada chega até o OCR. Sem ele, um PDF escaneado podia gastar
      // 400s numa função de 70s (SIGKILL incatchável, levando a run e os jobs concorrentes).
      deadlineAt,
    }),
          new Promise<never>((_, reject) => setTimeout(
            () => reject(new Error(`Excedeu a fatia de extração (${Math.round(restanteMs / 1000)}s) — reprocessável; se repetir 3×, o PDF é grande ou escaneado: reenviar dividido.`)),
            restanteMs,
          )),
        ]));

    if (analysis.status === "error") {
      throw new Error(analysis.error ?? "Falha ao analisar PDF");
    }

    let duplicateDocumentoId: string | null = null;
    if (analysis.semantic_duplicate_key) {
      const { data: duplicateDoc } = await db
        .from("documentos_regulatorios")
        .select("id")
        .eq("semantic_duplicate_key", analysis.semantic_duplicate_key)
        .eq("status", "confirmed")
        .neq("id", documentoId)
        .limit(1)
        .maybeSingle();
      duplicateDocumentoId = (duplicateDoc?.id as string | null) ?? null;
    }

    await updateDocument(db, documentoId, {
      status: "review_pending",
      // Fase 17 — `?? job.agencia_id`: a análise pode não detectar agência (um PDF escaneado não tem
      // texto). Sobrescrever com `null` apagava a agência que a ESTEIRA já conhecia (o item de
      // monitoramento sabe de que site o documento veio) e o documento era arquivado como
      // `sem_agencia` — diagnóstico falso, que contamina a medição das outras frentes.
      //
      // ⚠️ CORREÇÃO DE COMENTÁRIO (Fase 31, Bloco 3): a frase original dizia que "a análise só
      // detecta agência a partir do TEXTO". Isso deixou de ser verdade quando o filename entrou na
      // detecção (`upload-analysis.ts:185`, `detectAgenciaSigla(`${file.name}\n${texto}`)`). A
      // distinção importa porque a INFERÊNCIA tem precedência sobre o valor que a FONTE já sabia, e
      // a fonte é evidência forte: o portal da ARTESP serve documento da ARTESP. Inverter essa
      // precedência é mudança de atribuição em massa e não entra aqui — fica registrado em
      // `docs/PENDENCIAS.md`. O que ESTA fase consertou foi o override da ANTT, que fazia uma
      // MENÇÃO no nome do arquivo vencer a contagem de siglas (ver `upload-analysis.ts:186`).
      agencia_id: analysis.agencia_id_detected ?? job.agencia_id,
      agencia_sigla_detected: analysis.agencia_sigla_detected,
      tipo_documento: analysis.fields.tipo_documento,
      documento_subtipo: analysis.documento_subtipo ?? null,
      semantic_duplicate_key: analysis.semantic_duplicate_key ?? null,
      is_duplicate: Boolean(analysis.is_duplicate || duplicateDocumentoId),
      duplicate_documento_id: duplicateDocumentoId,
      extraction_confidence: analysis.confidence,
      page_count: analysis.page_count,
      chars_per_page: analysis.chars_per_page,
      texto_extraido: String(analysis.extraction_raw?.raw_text ?? ""),
      campos_detectados: previewToJson(analysis, sourceUrl),
      ata_items: analysis.ata_items ?? null,
      warnings: analysis.warnings ?? [],
      error_message: null,
      processed_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });

    // ⚠️ Fase 31, Bloco 3 — `?? job.agencia_id`, igual à linha do documento acima.
    //
    // Sem o fallback, esta linha APAGAVA a agência que o job já tinha: `agencia_id_detected` é `null`
    // quando a análise não resolve (PDF escaneado não tem texto), e o `update` gravava esse `null`
    // por cima do valor que a ESTEIRA conhecia (o item de monitoramento sabe de que site o documento
    // veio). O documento acima é salvo pelo `??` na linha 172; o JOB não era.
    //
    // E a perda não ficava só no job: `upload-queue.ts:143` (`agenciaId ?? existingJob.agencia_id`)
    // lê justamente esse campo quando um documento é criado a partir de job já existente — num
    // reenvio do mesmo PDF sem escolher agência, o documento novo nascia com `agencia_id` NULL. É um
    // dos três caminhos que produzem os 15 documentos de agência `?` medidos em produção.
    await exigirEscrita(db
      .from("upload_jobs")
      .update({
        status: "done",
        agencia_id: analysis.agencia_id_detected ?? job.agencia_id,
        updated_at: new Date().toISOString(),
      })
      .eq("id", jobId), `job ${jobId} → done`);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[pipeline] Job ${jobId} falhou:`, message);

    await exigirEscrita(db
      .from("upload_jobs")
      .update({
        status: "failed",
        error_message: message.slice(0, 500),
        updated_at: new Date().toISOString(),
      })
      .eq("id", jobId), `job ${jobId} → failed`);

    await updateDocument(db, documentoId, {
      status: "failed",
      error_message: message.slice(0, 500),
      updated_at: new Date().toISOString(),
    });
  }
}

/**
 * Reserva de partida de UM job (download + parse + gravação).
 *
 * Fase 28 — 9s → 13s, e a constante mudou de casa. Ela e o teto do parser são a MESMA aritmética
 * (a fatia precisa cobrir a reserva interna que o passo exige, CLAUDE.md/Fase 7) e estavam em
 * arquivos diferentes, divergindo em silêncio: a reserva era 9s para um parse de teto 25s. Agora
 * vivem juntas em `orcamento-do-parse.ts`, com as duas desigualdades que as fixam.
 */
export { RESERVA_POR_JOB_MS };

/**
 * Quantos jobs podem estar em voo com o saldo que resta (Fase 26).
 *
 * A concorrência era fixa (4) e a checagem de orçamento era por job: com 9s de saldo, QUATRO
 * jobs começavam ao mesmo tempo, cada um "cabendo" nos mesmos 9s. O SIGKILL vinha no meio e
 * deixava doc e job em "processing" — os "ANM: processing ×3" da tela, para sempre. A regra: o
 * saldo tem de cobrir a reserva de CADA job em voo, não de um só.
 */
export function jobsPermitidos(restanteMs: number, concurrency: number, reservaMs = RESERVA_POR_JOB_MS): number {
  if (restanteMs <= 0) return 0;
  return Math.max(0, Math.min(concurrency, Math.floor(restanteMs / reservaMs)));
}

/** O que a fila faz nesta volta. Três estados, e um deles FALTAVA. */
export type DecisaoDaFila = "iniciar" | "esperar" | "parar";

/**
 * ⚠️ Fase 30 — A DECISÃO DA FILA, extraída porque a versão anterior TRAVAVA A FUNÇÃO.
 *
 * ═══ O laço que girava para sempre ═══
 * O laço externo era `while (queue.length > 0 || active.length > 0)`, e a ÚNICA saída para
 * "acabou o saldo" morava DENTRO do laço interno `while (active.length < permitidos && …)`.
 * Com `permitidos === 0` — que é o que `jobsPermitidos` devolve assim que o saldo cai abaixo de
 * RESERVA_POR_JOB_MS (13s) — a condição `0 < 0` é falsa, o laço interno NUNCA roda, a saída fica
 * inalcançável, e `if (active.length > 0)` também é falso: **nenhum `await` no caminho**.
 *
 * Resultado: um laço quente, sem I/O, que não cede o event loop. Medido: **100 milhões de voltas
 * em 8 segundos** sem um único `setTimeout` disparar. Não é lentidão — é a função inteira parada
 * de pé, e é a mesma família do achado da Fase 27 (event loop travado = nenhum relógio funciona,
 * então NENHUM dos tetos desta base salva).
 *
 * Gatilho, que é o caso comum e não a borda: a extração começa com saldo, dois jobs entram em
 * voo, eles terminam DEPOIS do saldo acabar, e sobra fila. `active` esvazia, `permitidos` é 0,
 * `queue` não é 0 → gira. Como o orquestrador chama `/upload/process` por `call()` (em processo),
 * o giro acontece DENTRO da requisição de `/api/v1/pipeline/run`: o cliente aborta aos 110s.
 * É a explicação das 4 rodadas com "A requisição passou de 110s sem resposta".
 *
 * A decisão vira função PURA de propósito: o defeito existia porque a condição de saída era
 * implícita na forma de dois laços aninhados. Explícita, ela é testável sem risco — testar o laço
 * de verdade contra a regressão penduraria a suíte, já que um laço sem `await` também não deixa
 * o timeout do vitest disparar.
 */
export function decisaoDaFila(estado: { permitidos: number; ativos: number; pendentes: number }): DecisaoDaFila {
  // Há vaga e há trabalho: começa mais um.
  if (estado.pendentes > 0 && estado.ativos < estado.permitidos) return "iniciar";
  // Sem vaga, mas há gente trabalhando: esperar é legítimo — alguém vai terminar e liberar.
  if (estado.ativos > 0) return "esperar";
  // Nada em voo e nada pode começar. Insistir aqui é o laço quente: PARA.
  // Os jobs não iniciados seguem `pending` e a próxima rodada os pega — nada órfão, nada perdido.
  return "parar";
}

export async function processQueue(jobs: QueueJob[], concurrency = 2, deadlineAt?: number): Promise<number> {
  const queue = [...jobs];
  const active: Promise<void>[] = [];
  let started = 0;

  for (;;) {
    // Recalculado a cada volta (antes era uma vez por lote): com o relógio andando, a decisão
    // seguinte é tomada sobre o saldo de AGORA, nunca sobre o de quando o lote começou.
    const permitidos = deadlineAt !== undefined ? jobsPermitidos(deadlineAt - Date.now(), concurrency) : concurrency;
    const decisao = decisaoDaFila({ permitidos, ativos: active.length, pendentes: queue.length });
    if (decisao === "parar") break;
    if (decisao === "esperar") {
      await Promise.race(active);
      continue;
    }

    // Orçamento (QA ago/2026): um PDF escaneado custa até ~65s (pdf-parse 25s + OCR
    // 40s) — sem esta parada o lote de 20 estourava sozinho o SIGKILL de 60s do
    // Hobby. Nunca INICIA um job sem saldo; os não iniciados seguem 'pending' e a
    // próxima rodada os pega (progresso preservado, nada órfão).
    // Fase 16 — 12s → 9s: com fatias de 21-30s, a reserva de partida comia ~47% da janela
    // útil da extração. 9s ainda cobre o PDF típico; o escaneado extremo (~65s) estoura
    // qualquer reserva realista e é o caso do reaper, não desta parada.
    if (deadlineAt !== undefined && !hasBudget(deadlineAt, RESERVA_POR_JOB_MS)) {
      queue.length = 0;
      continue; // a volta seguinte decide: esperar quem está em voo, ou parar.
    }
    const job = queue.shift()!;
    started++;
    const p = processPdf(job.jobId, deadlineAt)
      .catch((err) => console.error(`[queue] Job ${job.jobId} falhou:`, err))
      .then(() => {
        const idx = active.indexOf(p);
        if (idx !== -1) active.splice(idx, 1);
      });
    active.push(p);
  }
  return started;
}

export async function processPendingDocuments(
  limit = 5,
  deadlineAt?: number,
  opcoes?: {
    /**
     * Rodar SÓ os três reapers e voltar (Fase 10).
     *
     * Soltar um documento preso custa ~2s; extrair um custa até 20s. Enquanto os dois moraram no
     * mesmo passo, o preço da extração era o preço do reaper — e como a extração é o passo mais
     * caro da rodada, ela ficava sem orçamento e os reapers iam junto. Produção: 62 documentos em
     * `queued`, os MESMOS, depois de 26 rodadas. Separados, o reaper cabe num passo barato que
     * roda cedo, e o documento que ele solta ainda pode ser extraído na MESMA rodada.
     */
    apenasReaper?: boolean;
    /**
     * Fase 29 — o modo OPOSTO, que faltava. Sem ele, a chamada de extração repetia os quatro
     * reapers (eles rodavam antes do early-return) e pagava 33-58 round-trips da PRÓPRIA fatia.
     * Medido em produção: a extração iniciou 2 jobs em 10 rodadas.
     */
    apenasExtracao?: boolean;
  },
): Promise<{ processed: number; job_ids: string[]; reaped: number; religados: number; reconciliados_importado: number; reconciliados_ignorado: number; reconciliados_novo: number; reconciliados_de_volta: number }> {
  const db = createSupabaseServerClient();
  const plano = modoDoProcessamento({ apenasReaper: opcoes?.apenasReaper, apenasExtracao: opcoes?.apenasExtracao });
  const modo: ModoDoProcessamento = plano.modo;

  let reaped = 0;
  let religados = 0;
  let reconciliadosImportado = 0;
  let reconciliadosIgnorado = 0;
  let reconciliadosNovo = 0;
  let reconciliadosDeVolta = 0;

  // ═══ Fase 29 — os reapers só rodam no modo que os pede ═══════════════════════
  // Eles rodavam INCONDICIONALMENTE e o early-return do modo reaper vinha DEPOIS. Como a esteira
  // chama esta rota duas vezes por rodada (o passo `reaper` e a extração), o reparo era feito
  // duas vezes e a segunda saía da fatia da EXTRAÇÃO. Ver `modo-do-processamento.ts`.
  if (plano.reparar) {
    // Reaper oportunista de órfãos: um job/doc preso em "processing" só é possível se o
    // SIGKILL (60s do Hobby) matou o background (waitUntil) ENTRE marcar "processing" e
    // gravar "done"/"failed". Como nenhum processamento legítimo dura minutos, todo job
    // "processing" com updated_at > 5min é órfão → volta para "pending" e é reprocessado
    // aqui mesmo (o processPdf sobrescreve o doc preso). Sem isto ficavam presos p/ sempre
    // (o select abaixo só lê "pending"). Espelha o reaper de monitoramento_runs.
    const staleCutoff = new Date(Date.now() - REAPER_JANELA_MS).toISOString();
    const { data: reapedRows } = await db
      .from("upload_jobs")
      .update({ status: "pending", updated_at: new Date().toISOString() })
      .eq("status", "processing")
      .lt("updated_at", staleCutoff)
      .select("id");
    reaped = reapedRows?.length ?? 0;

    // Reaper do DOCUMENTO preso em "processing" (QA ago/2026): quando o job morreu de vez
    // (foi a 'failed' sem conseguir atualizar o doc, ou nunca conheceu o documento_id), o
    // doc ficava 'processing' PARA SEMPRE — invisível e fora de qualquer fila. Vira 'failed'
    // com motivo (aparece no diagnóstico e é reprocessável); se o job correspondente ainda
    // for reprocessado, o processPdf sobrescreve o status normalmente.
    await exigirEscrita(db
      .from("documentos_regulatorios")
      .update({
        status: "failed",
        error_message: "Processamento interrompido (timeout/SIGKILL) — reprocessável.",
        updated_at: new Date().toISOString(),
      })
      .eq("status", "processing")
      .lt("updated_at", staleCutoff), "reaper: doc preso em processing → failed");

    // ═══ Fase 9 — o TERCEIRO reaper: documento preso em "queued" ════════════════
    // O select logo abaixo lê SÓ `upload_jobs.status='pending'`, e os dois reapers acima conhecem
    // apenas "processing". Um documento em `queued` cujo job já foi a `done`/`failed` não está em
    // fila NENHUMA e não aparece como falha — some para sempre. Produção: 35 `voto_individual` da
    // ANTT nesse estado, PDF baixado e nunca extraído.
    //
    // Dois caminhos medidos produzem isso, ambos consertados junto (upload-queue.ts): o
    // `requeueDocument` gravava o DOCUMENTO primeiro e o JOB depois, em UPDATEs não-transacionais e
    // sem checar o erro do segundo; e o job que nunca soube o `documento_id` fazia o `updateDocument`
    // desistir em silêncio e ir a `done` sem tocar no documento.
    //
    // ⚠️ Diferente dos outros dois, este NÃO pode ser um UPDATE cego: documento `queued` com job
    // `pending` está legitimamente na fila. Por isso lê antes, com teto — reaper não é varredura de
    // tabela — e cede o saldo à extração, que é o trabalho de verdade.
    // ⚠️ E NÃO seleciona `metadata`: etapa68-proveniencia proíbe (a proveniência tem de vir do
    // UPDATE que marca "processing", sem SELECT extra na parte quente).
    const { data: presosNaFila } = await db
      .from("documentos_regulatorios")
      .select("id, upload_job_id, file_hash, storage_path, agencia_id")
      .eq("status", "queued")
      .lt("updated_at", staleCutoff)
      .limit(50);

    // Fase 29 — a decisão sai do laço. Eram DUAS consultas por documento (candidato por
    // `file_hash` e status do job vinculado): com os 25 da ARTESP presos, ~26 round-trips por
    // passada, duas passadas por rodada. Agora são DUAS consultas no total, e `planejarReligacao`
    // decide em memória. Ver `religacao-da-fila.ts` para o caso do hash ambíguo, que tem de
    // continuar NÃO adotando.
    const docsPresos = ((presosNaFila ?? []) as any[]).map((d) => ({
      id: String(d.id),
      upload_job_id: (d.upload_job_id as string | null) ?? null,
      file_hash: (d.file_hash as string | null) ?? null,
      storage_path: d.storage_path as string | null,
      agencia_id: d.agencia_id as string | null,
    }));
    if (docsPresos.length > 0) {
      const idsDeJob = [...new Set(docsPresos.map((d) => d.upload_job_id).filter(Boolean))] as string[];
      const hashes = [...new Set(docsPresos.filter((d) => !d.upload_job_id).map((d) => d.file_hash).filter(Boolean))] as string[];
      const [porIdRes, porHashRes] = await Promise.all([
        idsDeJob.length
          ? db.from("upload_jobs").select("id, status, documento_id").in("id", idsDeJob)
          : Promise.resolve({ data: [] as any[] }),
        hashes.length
          ? db.from("upload_jobs").select("id, status, documento_id, file_hash").in("file_hash", hashes)
          : Promise.resolve({ data: [] as any[] }),
      ]);
      const jobsPorId = new Map<string, JobConhecido>(
        ((porIdRes.data ?? []) as any[]).map((j) => [String(j.id), { id: String(j.id), status: String(j.status), documento_id: j.documento_id ?? null }]),
      );
      const jobsPorHash = new Map<string, JobConhecido[]>();
      for (const j of ((porHashRes.data ?? []) as any[])) {
        const h = String(j.file_hash);
        jobsPorHash.set(h, [...(jobsPorHash.get(h) ?? []), { id: String(j.id), status: String(j.status), documento_id: j.documento_id ?? null }]);
      }

      const porId = new Map(docsPresos.map((d) => [d.id, d]));
      for (const p of planejarReligacao(docsPresos, jobsPorId, jobsPorHash)) {
        // ⚠️ O guard era `2_000` — o custo de UMA iteração, não o de quem vem depois. Sair do laço
        // com 2.001 ms deixava `jobsPermitidos(2_001, 4) = 0`: a extração rodava e devolvia zero.
        if (!hasBudget(deadlineAt, protecaoDepoisDe("religacao", modo))) break;
        if (p.desfecho === "segue") continue;
        const agora = new Date().toISOString();
        const doc = porId.get(p.doc.id)!;

        if (p.desfecho === "falhar") {
          // Ficar em `queued` é o único destino proibido: é o estado invisível. O motivo vai junto.
          await exigirEscrita(db.from("documentos_regulatorios").update({
            status: "failed",
            error_message: `Documento na fila sem upload_job utilizável (${p.motivo}) — reenviar o PDF.`,
            updated_at: agora,
          }).eq("id", doc.id), `doc ${doc.id} sem job → failed`);
          continue;
        }

        if (p.desfecho === "adotar") {
          const { error } = await db.from("documentos_regulatorios")
            .update({ upload_job_id: p.jobId, updated_at: agora }).eq("id", doc.id);
          if (error) continue;
        }

        const { error: jobErr } = await db.from("upload_jobs").update({
          status: "pending",
          documento_id: doc.id, // ← o elo que o requeueDocument nunca gravava
          error_message: null,
          storage_path: doc.storage_path,
          agencia_id: doc.agencia_id,
          updated_at: agora,
        }).eq("id", p.jobId);
        if (jobErr) {
          console.warn(`[pipeline] reaper queued: job ${p.jobId} não voltou p/ pending: ${jobErr.message}`);
          continue;
        }
        religados++;
      }
    }

    // ═══ Fase 16 — o QUARTO reaper: o poço `em_revisao` de monitoramento_itens ═══
    // Nenhuma query do repo lê `em_revisao`: a fila só olha `novo`, o retry só olha `ignorado`, o
    // confirm não toca a tabela. Todo item que o auto-enqueue marcou `em_revisao` congelava ali —
    // com o doc já `confirmed` (funil mentindo) ou `ignored` (item morto). Produção: a pauta da
    // 87ª ROP e 4 "Voto DFQ" da ANTT, meses parados. A reconciliação espelha o destino TERMINAL
    // do doc no item; doc em trânsito fica para a esteira. E ela é CONTADA — o poço se formou em
    // silêncio porque nada o expunha; o contador por rodada é o alarme de recorrência.
    /**
     * Fase 17 — carimbar exige UPDATE por item (o `metadata` difere: `meeting_url`, `prioridade`),
     * e supabase-js substitui o jsonb inteiro. O contrato "reaper é barato" continua valendo —
     * muda a forma de honrá-lo: teto explícito + orçamento, em vez de um UPDATE cego em lote.
     * O que não couber fica para a rodada seguinte; o poço agora É drenado.
     */
    const TETO_CARIMBO_POR_RODADA = 25;
    if (hasBudget(deadlineAt, protecaoDepoisDe("carimbo", modo))) {
      const { data: poco } = await db
        .from("monitoramento_itens")
        .select("id, documento_id, metadata")
        .eq("status", "em_revisao")
        // Sem ordem, a janela de 50 podia travar sempre nos mesmos itens em trânsito
        // (head-of-line) e nunca alcançar os que já têm destino terminal.
        .order("first_seen_at", { ascending: true })
        .limit(50);
      const itensPoco = (poco ?? []) as Array<{ id: string; documento_id: string | null; metadata: Record<string, unknown> | null }>;
      if (itensPoco.length > 0) {
        const docIds = [...new Set(itensPoco.map((i) => i.documento_id).filter(Boolean))] as string[];
        const { data: docsPoco } = docIds.length
          ? await db.from("documentos_regulatorios").select("id, status, tipo_documento, campos_detectados").in("id", docIds)
          : { data: [] as any[] };
        const docPorId = new Map(((docsPoco ?? []) as any[]).map((d) => [d.id as string, d]));

        const paraImportado: string[] = [];
        const paraIgnorado: Array<{ item: (typeof itensPoco)[number]; doc: any }> = [];
        const paraNovo: string[] = [];
        for (const item of itensPoco) {
          // Doc apagado (FK ON DELETE SET NULL) ou id inexistente: órfão → volta ao começo.
          const doc = item.documento_id ? docPorId.get(item.documento_id) : undefined;
          if (!doc) paraNovo.push(item.id);
          else if (doc.status === "confirmed") paraImportado.push(item.id);
          else if (doc.status === "ignored") paraIgnorado.push({ item, doc });
          // queued/review_pending/failed/processing: em trânsito — a esteira move o doc.
        }
        const agora = new Date().toISOString();
        if (paraImportado.length) {
          const { error } = await db.from("monitoramento_itens")
            .update({ status: "importado", tentativas: 0, proxima_tentativa_em: null, last_seen_at: agora })
            .in("id", paraImportado);
          if (!error) reconciliadosImportado = paraImportado.length;
        }
        for (const { item, doc } of paraIgnorado) {
          if (reconciliadosIgnorado >= TETO_CARIMBO_POR_RODADA) break;
          if (!hasBudget(deadlineAt, protecaoDepoisDe("carimbo", modo))) break;
          // O motivo vem do DOCUMENTO (`campos_detectados.arquivado_motivo`, gravado pelo confirm e
          // pelo confirm-lote); sem ele, a CLASSE pelo tipo; nunca NULL — motivo ausente põe o item
          // fora dos DOIS filtros do retry e nenhuma migration futura o alcança.
          const motivoDoArquivamento = String(
            (doc.campos_detectados as Record<string, unknown> | null)?.["arquivado_motivo"] ??
              (["pauta", "documento_apoio", "voto_individual"].includes(String(doc.tipo_documento ?? ""))
                ? "apoio_nao_final"
                : "documento_arquivado"),
          );
          const { error } = await db.from("monitoramento_itens")
            .update({
              status: "ignorado",
              proxima_tentativa_em: null,
              last_seen_at: agora,
              metadata: {
                ...(item.metadata ?? {}),
                enqueue_motivo: motivoDoArquivamento,
                enqueue_motivo_origem: "reaper4",
              },
            })
            .eq("id", item.id);
          if (!error) reconciliadosIgnorado++;
        }
        if (paraNovo.length) {
          const { error } = await db.from("monitoramento_itens")
            .update({ status: "novo", upload_job_id: null, enfileirado_em: null, last_seen_at: agora })
            .in("id", paraNovo);
          if (!error) reconciliadosNovo = paraNovo.length;
        }
      }
    }

    // ═══ Fase 17 — a reconciliação deixa de ser de MÃO ÚNICA ═══════════════════
    // O passo 9 da esteira desarquiva documento (a tela mostrou "14 desarquivado(s)"), mas o item
    // que a reconciliação automática arquivou ficava para trás. Escopo ESTREITO de propósito: só
    // itens que carregam `enqueue_motivo_origem` — isto é, arquivados por reconciliação, seja pelo
    // reaper ou pela migration de rotulagem. Casar o VALOR "reaper4" deixaria os 95 antigos numa
    // classe permanentemente inferior. Varrer todo `ignorado` seria o ping-pong da Fase 7
    // (upload-queue.ts:337-348), que custou 40 rodadas em vão.
    if (hasBudget(deadlineAt, protecaoDepoisDe("reconciliacao", modo))) {
      const { data: carimbados } = await db
        .from("monitoramento_itens")
        .select("id, documento_id")
        .eq("status", "ignorado")
        .not("metadata->>enqueue_motivo_origem", "is", null)
        .not("documento_id", "is", null)
        .limit(25);
      const itensCarimbados = (carimbados ?? []) as Array<{ id: string; documento_id: string }>;
      if (itensCarimbados.length > 0) {
        const ids = [...new Set(itensCarimbados.map((i) => i.documento_id))];
        const { data: docsVolta } = await db
          .from("documentos_regulatorios").select("id, status").in("id", ids);
        const confirmados = new Set(
          ((docsVolta ?? []) as any[]).filter((d) => d.status === "confirmed").map((d) => d.id as string),
        );
        const deVolta = itensCarimbados.filter((i) => confirmados.has(i.documento_id)).map((i) => i.id);
        if (deVolta.length) {
          const { error } = await db.from("monitoramento_itens")
            .update({ status: "importado", last_seen_at: new Date().toISOString() })
            .in("id", deVolta);
          if (!error) reconciliadosDeVolta = deVolta.length;
        }
      }
    }
  }

  // Os quatro reapers acabaram. Quem só queria reparar para por aqui — sem tocar na fila `pending`,
  // que é o trabalho caro.
  if (!plano.extrair) return { processed: 0, job_ids: [], reaped, religados, reconciliados_importado: reconciliadosImportado, reconciliados_ignorado: reconciliadosIgnorado, reconciliados_novo: reconciliadosNovo, reconciliados_de_volta: reconciliadosDeVolta };

  const normalizedLimit = Math.min(20, Math.max(1, limit));
  const { data: jobs } = await db
    .from("upload_jobs")
    .select("id, agencia_id")
    .eq("status", "pending")
    .order("created_at", { ascending: true })
    .limit(normalizedLimit);

  const selected = (jobs ?? []).map((job) => ({
    jobId: job.id as string,
    agenciaId: job.agencia_id as string | null,
  }));

  let processed = 0;
  if (selected.length > 0) {
    // Fase 7 — 2 → 3. Cada job faz download do Storage (I/O), pdf-parse (CPU), às vezes OCR
    // (rede) e escritas no banco (I/O): há espera de sobra para sobrepor. Subir MUITO não
    // ajudaria — o pdf-parse é CPU-bound e satura cedo — e custaria memória no runtime da
    // função. 3 é o passo conservador; o número honesto sai da medição em produção.
    processed = await processQueue(selected, 4, deadlineAt);
  }

  return { processed, job_ids: selected.map((job) => job.jobId), reaped, religados , reconciliados_importado: reconciliadosImportado, reconciliados_ignorado: reconciliadosIgnorado, reconciliados_novo: reconciliadosNovo, reconciliados_de_volta: reconciliadosDeVolta };
}

/** Quanto do texto lido viaja junto com a deliberação, para conferência a olho. */
const TRECHO_MAX_CHARS = 4_000;

/**
 * Fase 7 — PROVENIÊNCIA.
 *
 * O `raw_text` (até 50k) continua fora daqui de propósito: ele já vive inteiro na coluna
 * `documentos_regulatorios.texto_extraido`, e duplicá-lo no JSONB inflaria a tabela de
 * deliberações (todo consumidor downstream copia este objeto). O que entra no lugar é o mínimo
 * que torna a decisão AUDITÁVEL sem abrir o banco:
 *   · `source_url`    — de qual URL o PDF veio (o card "Fonte original" do detalhe estava vazio);
 *   · `texto_trecho`  — o começo do texto realmente lido, para bater o olho contra o PDF;
 *   · `extracao_metodo` — pdf-parse ou OCR, que era calculado e jogado fora.
 * Os três nomes são explícitos: `texto_trecho` não se disfarça de texto completo.
 */
function previewToJson(
  analysis: Awaited<ReturnType<typeof analyzeUploadPdf>>,
  sourceUrl: string | null,
) {
  const raw = analysis.extraction_raw ?? {};
  const { raw_text: rawText, ...rawWithoutText } = raw;
  const trecho = typeof rawText === "string" ? rawText.slice(0, TRECHO_MAX_CHARS) : null;
  return {
    preview: {
      ...analysis,
      extraction_raw: {
        ...rawWithoutText,
        ...(sourceUrl ? { source_url: sourceUrl } : {}),
        ...(trecho ? { texto_trecho: trecho } : {}),
      },
    },
  };
}

async function updateDocument(
  db: any,
  documentoId: string | null,
  patch: Record<string, unknown>,
  devolverLinha = false,
): Promise<Record<string, unknown> | null> {
  if (!documentoId) return null;
  const q = db.from("documentos_regulatorios").update(patch).eq("id", documentoId);
  // `.select()` no UPDATE devolve a linha na MESMA ida ao banco — é assim que a proveniência
  // sai de graça, sem um SELECT extra por PDF na parte quente da esteira.
  const { data, error } = devolverLinha ? await q.select("metadata").maybeSingle() : await q;
  if (error) console.warn("[pipeline] Falha ao atualizar documento:", error.message);
  return (data as Record<string, unknown> | null) ?? null;
}

export { markBatchDuplicates };
