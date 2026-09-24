/**
 * "Fila drenada" só quando os QUATRO contadores forem zero (Fase 31, Tarefa 1).
 *
 * ═══ O defeito, medido em produção ═══
 * O banner disse **"Esteira zero-toque concluída (fila drenada)"** com **8 documentos em
 * `processing`**, carimbados 11:39–11:40 — dentro da própria run.
 *
 * Ele não estava mentindo por acaso: era transcrição literal de um booleano sobre o PLANO.
 * `desfecho === "drenou"` vem de `!res.restantes`, que vem de `deveContinuar`
 * (`esteira-run.ts:93-106`) — três condições sobre *passos da rodada*, nenhuma sobre o banco.
 *
 * E a rota **já media** `upload_jobs.pending` (`pipeline/run/route.ts:313-321`) e jogava o número
 * fora: `fila_extracao` viajava na resposta sem um único consumidor. `processing` não era medido
 * em lugar nenhum do caminho quente, e o reaper só toca o que passou de 5 min — um documento em
 * `processing` há 40 segundos ficava num ponto cego perfeito: nenhum reaper o tocava, nenhuma
 * medição o via, nenhum passo o relatava.
 *
 * ⚠️ ESTE MÓDULO É PURO E É IMPORTADO PELO CLIENTE. Zero import de servidor, zero Supabase — é
 * por isso que `REAPER_JANELA_MS` nasce AQUI e o `pipeline.ts` a importa, e não o contrário:
 * `pipeline.ts` importa `@/lib/supabase/server`, e a direção inversa arrastaria código
 * server-only para o bundle da tela.
 */

/** A janela do reaper de órfãos. Era um literal `5 * 60_000` solto em `pipeline.ts:349`. */
export const REAPER_JANELA_MS = 5 * 60_000;
const MINUTOS_DA_JANELA = Math.round(REAPER_JANELA_MS / 60_000);

export type EstadoDaFila =
  /** Os quatro contadores em zero. É a única situação que autoriza a palavra "drenada". */
  | "drenada"
  /** Há trabalho em voo, mas dentro da janela do reaper — é normal, não é problema. */
  | "entregue_aguardando"
  /** Há item preso além da janela: o reaper deveria ter agido e não agiu. */
  | "com_ressalva"
  /** ⚠️ A medição FALHOU. Não é zero, e afirmar qualquer um dos outros três seria inventar. */
  | "nao_medida";

export interface ContagensDaFila {
  pending: number;
  jobsProcessing: number;
  queued: number;
  docsProcessing: number;
  /** Idade do item em `processing` mais ANTIGO. `null` = nada em processamento. */
  maisAntigoProcessingMs: number | null;
  /**
   * ⚠️ Alguma das leituras falhou. Sem este campo, `{error}` do supabase-js viraria `0` e o
   * banner diria "drenada" justamente quando não sabe — trocando uma mentira por outra.
   */
  medicaoFalhou: boolean;
}

/** Quantos itens estão em PROCESSAMENTO. É este o número que a janela do reaper governa. */
export function emProcessamento(c: ContagensDaFila): number {
  return c.jobsProcessing + c.docsProcessing;
}

/** Quantos itens a fila tem ao todo — em processamento ou esperando vez. */
export function totalNaFila(c: ContagensDaFila): number {
  return c.pending + c.jobsProcessing + c.queued + c.docsProcessing;
}

/**
 * O estado real da fila.
 *
 * ⚠️ `medicaoFalhou` é a PRIMEIRA guarda, e ela recebe o flag em vez de o chamador lembrar de
 * checá-lo. Deixar a decisão do lado de fora seria reabrir a falha silenciosa por outra porta: a
 * função devolveria "drenada" para contagens que ninguém conseguiu ler.
 *
 * ⚠️ E idade desconhecida COM item em processamento assume o PIOR (`com_ressalva`). O contrário —
 * tratar "não sei há quanto tempo" como "é recente" — é exatamente o otimismo que produziu o
 * banner mentiroso.
 */
export function classificarFila(c: ContagensDaFila): EstadoDaFila {
  if (c.medicaoFalhou) return "nao_medida";
  if (totalNaFila(c) <= 0) return "drenada";
  if (emProcessamento(c) > 0) {
    if (c.maisAntigoProcessingMs === null) return "com_ressalva";
    if (c.maisAntigoProcessingMs > REAPER_JANELA_MS) return "com_ressalva";
  }
  return "entregue_aguardando";
}

/**
 * O texto do banner para cada estado.
 *
 * ⚠️ "drenada" mantém o texto ORIGINAL, byte a byte. A mudança desta tarefa não é escrever bonito:
 * é parar de dizer essa frase quando ela é falsa.
 */
export function cabecalhoDoEstadoDaFila(estado: EstadoDaFila, c: ContagensDaFila): string {
  switch (estado) {
    case "drenada":
      return "Esteira zero-toque concluída (fila drenada)";
    case "entregue_aguardando":
      // ⚠️ O número é `emProcessamento`, não `totalNaFila`: somar `pending` e `queued` aqui diria
      // "N em processamento" contando itens que não estão processando nada — o mesmo tipo de
      // número inflado que esta tarefa existe para matar. Os que esperam vez vão em cláusula própria.
      return `Esteira entregue — aguardando ${emProcessamento(c)} processamento(s)` +
        (c.pending + c.queued > 0 ? `, com ${c.pending + c.queued} item(ns) na fila` : "") +
        ` (dentro da janela do reaper, ${MINUTOS_DA_JANELA}min)`;
    case "com_ressalva":
      return `⚠️ Esteira entregue COM RESSALVA — ${emProcessamento(c)} item(ns) preso(s) em ` +
        `processamento além dos ${MINUTOS_DA_JANELA}min do reaper; confira antes de rodar de novo`;
    case "nao_medida":
      return "Esteira entregue — não foi possível medir a fila (a leitura do banco falhou)";
  }
}

/** O que a medição precisa do banco, sem acoplar este módulo a Supabase. */
export interface DepsDeMedicaoDaFila {
  /** `null` significa FALHOU — nunca zero. É a distinção que o `?? 0` apagaria. */
  contar(tabela: "upload_jobs" | "documentos_regulatorios", status: string): Promise<number | null>;
  /** `updated_at` ISO do item em `processing` mais antigo, ou `null` se não há (ou falhou). */
  maisAntigoProcessing(tabela: "upload_jobs" | "documentos_regulatorios"): Promise<string | null>;
}

/**
 * Mede os quatro contadores. Quatro `count exact head` custam ~50 ms cada, no mesmo ponto em que
 * a rota já media um.
 *
 * ⚠️ A idade só é buscada quando HÁ algo em processamento — no caso comum (fila drenada) não se
 * paga round-trip nenhum a mais.
 */
export async function medirFila(deps: DepsDeMedicaoDaFila, agora = Date.now()): Promise<ContagensDaFila> {
  const [pending, jobsProcessing, queued, docsProcessing] = await Promise.all([
    deps.contar("upload_jobs", "pending"),
    deps.contar("upload_jobs", "processing"),
    deps.contar("documentos_regulatorios", "queued"),
    deps.contar("documentos_regulatorios", "processing"),
  ]);
  const falhouAlgumaContagem = [pending, jobsProcessing, queued, docsProcessing].some((n) => n === null);
  const c: ContagensDaFila = {
    pending: pending ?? 0,
    jobsProcessing: jobsProcessing ?? 0,
    queued: queued ?? 0,
    docsProcessing: docsProcessing ?? 0,
    maisAntigoProcessingMs: null,
    medicaoFalhou: falhouAlgumaContagem,
  };
  if (c.jobsProcessing + c.docsProcessing <= 0) return c;

  const carimbos = await Promise.all([
    c.jobsProcessing > 0 ? deps.maisAntigoProcessing("upload_jobs") : Promise.resolve(null),
    c.docsProcessing > 0 ? deps.maisAntigoProcessing("documentos_regulatorios") : Promise.resolve(null),
  ]);
  const idades = carimbos
    .filter((x): x is string => typeof x === "string")
    .map((iso) => agora - new Date(iso).getTime())
    .filter((ms) => Number.isFinite(ms));
  // ⚠️ O PIOR carimbo, não o primeiro nem a média: basta UM item preso além da janela para o
  // reaper ter falhado, e é isso que a ressalva precisa dizer.
  c.maisAntigoProcessingMs = idades.length ? Math.max(...idades) : null;
  return c;
}
