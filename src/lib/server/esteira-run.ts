/**
 * Estado da execução da esteira — retomar, travar, e o DISJUNTOR (Fase 7).
 *
 * Três problemas que este módulo resolve, todos consequência de `/pipeline/run` ser stateless:
 *
 *  1. **"Se eu sair da aba, ele perde tudo."** O trabalho de cada rodada sempre foi commitado no
 *     banco — o que se perdia era o LAÇO e a noção de progresso, que viviam num `useMutation` do
 *     navegador. Com uma linha de execução, a tela reabre e retoma de onde parou.
 *  2. **Sem lock.** Duas abas (ou o cron somado a uma aba) rodavam a esteira sobre as mesmas
 *     linhas ao mesmo tempo, disputando os mesmos documentos.
 *  3. **Sem disjuntor.** Com a vazão do commit 7 e um cron diário, um erro sistemático deixaria de
 *     ser uma rodada ruim e viraria centenas de documentos mal processados antes de alguém abrir
 *     a tela. Registrar o erro não basta: é preciso PARAR.
 *
 * ⚠️ Tudo aqui degrada em silêncio se a migration `20260826130000_esteira_runs` ainda não foi
 * aplicada: sem a tabela, a esteira volta a se comportar como antes (roda, não lembra) em vez de
 * quebrar. É o padrão de deploy-antes-da-migration do projeto.
 */

import { ORDEM_DOS_PASSOS } from "@/lib/server/esteira-reservas";

type Db = {
  from: (t: string) => any;
};

export interface EsteiraRun {
  id: string;
  status: "running" | "concluido" | "abortado" | "erro";
  origem: string;
  rodadas: number;
  contadores: Record<string, number>;
  passos_ok: number;
  passos_erro: number;
  motivo_parada: string | null;
  iniciado_em: string;
  atualizado_em: string;
  concluido_em: string | null;
}

/**
 * Quanto tempo sem notícias antes de considerar uma execução ABANDONADA.
 *
 * O SIGKILL de 60s do Hobby mata a função sem rodar `finally`, então uma execução pode morrer sem
 * fechar a própria linha. Sem este reaper, um único SIGKILL travaria a esteira para sempre — o
 * lock viraria um cadeado sem chave. 3 minutos é folgado: uma rodada dura no máximo ~60s.
 */
export const RUN_ORFAO_MS = 3 * 60_000;

/** ─── DISJUNTOR ────────────────────────────────────────────────────────────
 * Aborta a execução quando a taxa de erro dos PASSOS cruza o limite. Duas condições, porque
 * qualquer uma sozinha erra: só a taxa dispararia em "1 de 1 falhou" (ruído); só o volume
 * deixaria passar uma execução longa em que quase tudo falha.
 */
export const DISJUNTOR_MIN_PASSOS = 8;
export const DISJUNTOR_TAXA_ERRO = 0.5;

export function deveAbrirDisjuntor(passosOk: number, passosErro: number): boolean {
  const total = passosOk + passosErro;
  if (total < DISJUNTOR_MIN_PASSOS) return false;
  return passosErro / total > DISJUNTOR_TAXA_ERRO;
}

/**
 * A rodada deve pedir OUTRA? — a distinção que faltava (Fase 11).
 *
 * ═══ O bug que originou esta função ═══
 * A Fase 10 fez a rodada ser PLANEJADA: dos 13 passos, só cabe um subconjunto por rodada (a soma
 * das reservas é ~144s contra um orçamento de 50s). Aí veio a linha errada:
 *
 *     if (planoDaRodada.size < ORDEM_DOS_PASSOS.length) restantes = true;
 *
 * Essa comparação é **sempre verdadeira, por aritmética**. Com ela, `restantes` nunca ficava
 * falso: `desfecho: "drenou"` era inalcançável, a run nunca era fechada, e o teto de 40 rodadas do
 * cliente virou o único desfecho possível. Com a fila VAZIA a esteira ainda queimava 40 rodadas —
 * e é a resposta literal para "por que gastaria 25 minutos para pegar poucos documentos?".
 *
 * ═══ A regra ═══
 * "Não coube tudo NESTA rodada" (sempre verdade) NÃO é "ainda HÁ trabalho". Só pedem outra rodada:
 *
 *  · `trabalhoRelatado` — algum passo disse que sobrou fila. É o sinal forte, e vence sempre.
 *  · `passosPulados` — o passo foi planejado e não conseguiu fatia. Não é fila vazia: é orçamento
 *    bloqueado, e na próxima rodada ele pode caber.
 *  · `passosNaoTentados`, mas SÓ durante uma rotação. Um passo fora do plano não sabe se tem fila,
 *    então a esteira insiste até que todos tenham tido a vez — o giro de `planejarRodada` garante
 *    isso em `ORDEM_DOS_PASSOS.length` rodadas. Rodada ociosa é barata (cada passo custa um
 *    SELECT), então essa verificação custa segundos.
 *
 * ⚠️ O limite da terceira condição é o que impede o moinho de voltar por outra porta: sem ele,
 * "não coube tudo" pediria rodada para sempre — exatamente o bug de origem.
 */
export function deveContinuar(input: {
  /** Algum passo relatou fila remanescente nesta rodada. */
  trabalhoRelatado: boolean;
  /** Passos que entraram no plano e não conseguiram fatia. */
  passosPulados: number;
  /** Passos que nem foram oferecidos nesta rodada. */
  passosNaoTentados: number;
  /** Número da rodada dentro desta execução (0-based). */
  rodada: number;
}): boolean {
  if (input.trabalhoRelatado) return true;
  if (input.passosPulados > 0) return true;
  return input.passosNaoTentados > 0 && input.rodada < ORDEM_DOS_PASSOS.length;
}

/** Conta passos bem-sucedidos × falhos a partir do mapa de etapas de UMA rodada. */
export function contarPassos(etapas: Record<string, Record<string, unknown>>): { ok: number; erro: number } {
  let ok = 0;
  let erro = 0;
  for (const [chave, etapa] of Object.entries(etapas)) {
    // Fase 16 — etapas sintéticas (prefixo "_", ex.: `_tentativas`, que persiste o conjunto de
    // passos tentados na run) não são passos: contá-las como `ok` diluiria a taxa do disjuntor.
    if (chave.startsWith("_")) continue;
    if (!etapa || typeof etapa !== "object") { ok++; continue; }
    // Fase 10 — passo NÃO-TENTADO não entra na conta, nem como acerto nem como falha. A rodada
    // agora é planejada: nem todos os doze passos são oferecidos em toda rodada, e um passo que
    // ficou de fora não diz nada sobre a saúde da esteira. Contá-lo como `ok` diluiria a taxa de
    // erro e o disjuntor demoraria a abrir; contá-lo como erro o abriria numa esteira saudável.
    if (typeof etapa.pulado === "string" || typeof etapa.fora_do_plano === "string") continue;
    if (typeof etapa.erro === "string") erro++;
    else ok++;
  }
  return { ok, erro };
}

/** A execução em andamento, se houver uma viva (não órfã). */
export async function buscarRunAtiva(db: Db): Promise<EsteiraRun | null> {
  try {
    const corte = new Date(Date.now() - RUN_ORFAO_MS).toISOString();
    const { data, error } = await db
      .from("esteira_runs")
      .select("*")
      .eq("status", "running")
      .gt("atualizado_em", corte)
      .order("atualizado_em", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) return null; // tabela ausente ou indisponível: degrada
    return (data as EsteiraRun | null) ?? null;
  } catch {
    return null;
  }
}

/**
 * Fecha execuções `running` que pararam de dar notícias. Oportunista, como o reaper de
 * `monitoramento_runs` — roda junto com o início da próxima e não precisa de agendamento.
 */
export async function reaparRunsOrfas(db: Db): Promise<number> {
  try {
    const corte = new Date(Date.now() - RUN_ORFAO_MS).toISOString();
    const { data } = await db
      .from("esteira_runs")
      .update({
        status: "erro",
        motivo_parada: "Execução interrompida (timeout/SIGKILL) — nenhuma notícia desde a última rodada.",
        concluido_em: new Date().toISOString(),
      })
      .eq("status", "running")
      .lt("atualizado_em", corte)
      .select("id");
    return (data as unknown[] | null)?.length ?? 0;
  } catch {
    return 0;
  }
}

/** Abre uma execução nova. `null` se a tabela ainda não existe (a esteira roda sem lembrar). */
export async function iniciarRun(db: Db, origem: "ui" | "cron"): Promise<EsteiraRun | null> {
  try {
    const { data, error } = await db
      .from("esteira_runs")
      .insert({ origem, status: "running" })
      .select("*")
      .single();
    if (error) return null;
    return data as EsteiraRun;
  } catch {
    return null;
  }
}

/** Soma os contadores desta rodada aos da execução e registra o avanço. */
export async function registrarRodada(
  db: Db,
  run: EsteiraRun,
  etapas: Record<string, Record<string, unknown>>,
): Promise<EsteiraRun | null> {
  const { ok, erro } = contarPassos(etapas);
  const contadores: Record<string, number> = { ...(run.contadores ?? {}) };
  for (const etapa of Object.values(etapas)) {
    for (const [k, v] of Object.entries(etapa ?? {})) {
      if (typeof v === "number") contadores[k] = (contadores[k] ?? 0) + v;
    }
  }
  try {
    const { data, error } = await db
      .from("esteira_runs")
      .update({
        rodadas: (run.rodadas ?? 0) + 1,
        contadores,
        passos_ok: (run.passos_ok ?? 0) + ok,
        passos_erro: (run.passos_erro ?? 0) + erro,
        atualizado_em: new Date().toISOString(),
      })
      .eq("id", run.id)
      .select("*")
      .single();
    if (error) return null;
    return data as EsteiraRun;
  } catch {
    return null;
  }
}

/** Fecha a execução com um desfecho explícito. */
export async function fecharRun(
  db: Db,
  runId: string,
  status: "concluido" | "abortado" | "erro",
  motivo: string | null,
): Promise<void> {
  try {
    await db
      .from("esteira_runs")
      .update({
        status,
        motivo_parada: motivo,
        atualizado_em: new Date().toISOString(),
        concluido_em: new Date().toISOString(),
      })
      .eq("id", runId);
  } catch {
    /* degrada: sem a tabela, não há o que fechar */
  }
}
