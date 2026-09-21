/**
 * Uma invocação por execução, por vez (Fase 29, consertada na Fase 30).
 *
 * ═══ Por que a Fase 29 fechou só METADE ═══
 * A cerca usa `esteira_runs.rodadas` como token de compare-and-set. Ela funciona contra o abort do
 * PRÓPRIO cliente: ele re-dispara com o token que já foi consumido, o CAS falha, 409 correto.
 *
 * Ela NÃO funcionava contra um TERCEIRO, e o terceiro era o caso comum. Duas portas, uma ao lado
 * da outra:
 *
 * 1. **`execucao = ativa ?? iniciarRun(...)`** — com `run_id` ausente no corpo, o guard de
 *    identidade é falso e a invocação nova ADOTA a run alheia. Não era caso raro: `runIdAtivo`
 *    nasce `null` na tela e nunca é semeado do `/pipeline/status`, então **toda aba nova manda
 *    corpo vazio**. O cron fazia o mesmo, por GET não ter corpo.
 * 2. **`tokenDaRodada = corpo.rodadas_vistas ?? execucao.rodadas`** — quem não manda token lê o
 *    valor CORRENTE do banco e por isso **sempre vence** o CAS.
 *
 * Em produção: a run `72b4534a` tinha 32 passos ok, ZERO erros e 42,8 s por rodada. Uma segunda
 * invocação entrou, venceu o claim, e a original tomou 409 até desistir. Os 32 passos são a soma
 * do trabalho das DUAS.
 *
 * ═══ ⚠️ A cerca é um SEQUENCIADOR, não uma tranca ═══
 * `rodadas` sobe no claim e não é tocado no fim da rodada. Logo **não existe valor que distinga
 * "rodada no ar" de "rodada terminada"**: durante e depois da rodada 6 o banco diz 6. Fazer o
 * cliente simplesmente adotar o token novo reabriria o roubo um round-trip depois.
 *
 * A peça que faltava é a LEASE: `registrarRodada` passa a escrever `contadores.rodadas_concluidas`,
 * e `rodadas > rodadas_concluidas` é a única coisa no sistema capaz de dizer "há uma rodada no ar".
 * Sem migration — `contadores` é jsonb e já é um mapa de contadores da run.
 */

/** O que a invocação recebe de volta. Cada caso pede uma ação DIFERENTE do cliente. */
export type VereditoDaCerca =
  /** Passou: esta invocação é dona da rodada `token`. */
  | { tipo: "reivindicada"; token: number }
  /** A tabela não existe (deploy antes da migration): roda sem cerca, como antes. */
  | { tipo: "sem_lock" }
  /** Há run ativa e quem chamou não se declarou dono dela. O cliente pode ADOTAR id+token. */
  | { tipo: "run_alheia"; runId: string; rodadas: number }
  /** Run preexistente e o chamador não trouxe token. Adotar o corrente e repetir. */
  | { tipo: "token_ausente"; runId: string; rodadas: number }
  /** O token já foi consumido e NÃO há rodada no ar: adotar o fresco e repetir na hora. */
  | { tipo: "token_vencido"; runId: string; rodadas: number }
  /** Há rodada em execução agora: esperar. Adotar aqui seria o roubo de novo. */
  | { tipo: "rodada_em_voo"; runId: string; rodadas: number }
  /** A run foi fechada por baixo: abrir uma nova. */
  | { tipo: "run_encerrada"; runId: string }
  /** O banco recusou a reserva. NÃO é concorrência — por isso responde 503, não 409. */
  | { tipo: "banco_indisponivel"; detalhe: string };

/** A chave da lease dentro de `contadores`. Escrita por `registrarRodada`. */
export const CHAVE_RODADAS_CONCLUIDAS = "rodadas_concluidas";

/**
 * Há uma rodada EM EXECUÇÃO nesta run?
 *
 * `rodadas` conta reivindicadas; `contadores.rodadas_concluidas` conta as que gravaram. Enquanto a
 * primeira estiver à frente, alguém está trabalhando. Run antiga, anterior à lease, não tem a
 * chave — e aí a resposta honesta é `false`: afirmar "há rodada no ar" sem base travaria a esteira.
 */
export function rodadaEmVoo(run: { rodadas?: number | null; contadores?: Record<string, unknown> | null }): boolean {
  const reivindicadas = Number(run.rodadas ?? 0);
  const bruto = (run.contadores ?? {})[CHAVE_RODADAS_CONCLUIDAS];
  if (typeof bruto !== "number") return false;
  return reivindicadas > bruto;
}

/** O status HTTP de cada veredito. Só `banco_indisponivel` não é concorrência. */
export function statusDoVeredito(v: VereditoDaCerca): number {
  if (v.tipo === "reivindicada" || v.tipo === "sem_lock") return 200;
  return v.tipo === "banco_indisponivel" ? 503 : 409;
}

/** A mensagem ao operador. Precisa dizer O QUE aconteceu, não só que deu errado. */
export function mensagemDoVeredito(v: VereditoDaCerca): string {
  switch (v.tipo) {
    case "run_alheia":
      return "Já existe uma execução da esteira em andamento, aberta por outra aba.";
    case "token_ausente":
      return "Esta execução já está em curso — recomece a partir da rodada atual.";
    case "token_vencido":
      return "A rodada que você tentou já foi executada. Continue a partir da atual.";
    case "rodada_em_voo":
      return "Outra invocação desta execução ainda está em andamento. Aguarde a rodada anterior terminar.";
    case "run_encerrada":
      return "Esta execução foi encerrada. Uma nova precisa ser aberta.";
    case "banco_indisponivel":
      return `O banco recusou a reserva da rodada: ${v.detalhe}`;
    default:
      return "";
  }
}

/**
 * ⚠️ Mantida por compatibilidade com a Fase 29 e usada pela tabela de teste: dado o que o banco
 * diz e o token trazido, o token é o da vez? A decisão COMPLETA (porta, lease, erro de banco) é
 * de `abrirOuReivindicarRodada`, porque depende de I/O.
 */
export function tokenEhDaVez(input: { rodadasNoBanco: number | null; token: number | null }): boolean {
  if (input.rodadasNoBanco === null || input.token === null) return false;
  return input.rodadasNoBanco === input.token;
}

/**
 * Abre ou reivindica a rodada. É aqui que a PORTA fica fechada.
 *
 * As três regras, nesta ordem:
 *
 * **R1 — o servidor nunca adota por omissão.** Run ativa + chamador que não se declara dono →
 * `run_alheia`. Run nova só quando não há ativa. A adoção continua possível, mas é o CLIENTE quem
 * a pede, com o id na mão.
 *
 * **R2 — o token só pode ser lido do banco por quem ACABOU de criar a linha.** É a única
 * circunstância em que "não sei em que rodada estou" não significa "eu ganho sempre": numa run
 * recém-aberta `rodadas` é 0 por construção e ninguém mais conhece o id.
 *
 * **R3 — o 409 carrega o valor FRESCO.** Antes ele respondia o `rodadas` lido ANTES do CAS, então
 * o cliente adotaria um número já vencido e tomaria 409 de novo. A releitura custa 1 SELECT e só
 * acontece no caminho de falha — e é ela que traz o `status`, de onde sai `run_encerrada`.
 */
export async function abrirOuReivindicarRodada(
  db: any,
  deps: {
    buscarRunAtiva: (db: any) => Promise<any | null>;
    iniciarRun: (db: any, origem: "ui" | "cron") => Promise<any | null>;
    reivindicarRodada: (db: any, runId: string, token: number) => Promise<
      { tipo: "ganhou"; rodadas: number } | { tipo: "perdeu" } | { tipo: "indisponivel"; detalhe: string }
    >;
    relerRun: (db: any, runId: string) => Promise<any | null>;
  },
  entrada: { origem: "ui" | "cron"; runId?: string; rodadasVistas?: number },
): Promise<{ veredito: VereditoDaCerca; execucao: any | null }> {
  const ativa = await deps.buscarRunAtiva(db);

  // R1 — a porta. Quem não se declara dono da run ativa não entra nela.
  if (ativa && entrada.runId !== ativa.id) {
    return {
      veredito: { tipo: "run_alheia", runId: String(ativa.id), rodadas: Number(ativa.rodadas ?? 0) },
      execucao: null,
    };
  }

  const recemAberta = !ativa;
  const execucao = ativa ?? (await deps.iniciarRun(db, entrada.origem));
  // Sem a tabela `esteira_runs`: a esteira roda como antes, sem cerca.
  if (!execucao) return { veredito: { tipo: "sem_lock" }, execucao: null };

  // R2 — de onde vem o token.
  let token: number;
  if (typeof entrada.rodadasVistas === "number") token = entrada.rodadasVistas;
  else if (recemAberta) token = Number(execucao.rodadas ?? 0);
  else {
    return {
      veredito: { tipo: "token_ausente", runId: String(execucao.id), rodadas: Number(execucao.rodadas ?? 0) },
      execucao,
    };
  }

  // ⚠️ R2.5 — A LEASE É CHECADA ANTES DO CAS, e não só relatada no corpo do 409.
  //
  // Descoberto ao desenhar o cliente do Commit 3: sem esta linha, o token que o 409 devolve é um
  // convite ao roubo. Rodada 7 no ar significa `rodadas = 7` e `rodadas_concluidas = 6`; quem
  // adotasse o 7 VENCERIA o compare-and-set (o UPDATE só compara `rodadas`) e reivindicaria a 8
  // por cima de uma rodada em execução — exatamente o que a Fase 30 existe para impedir, só que
  // agora com a bênção do servidor.
  //
  // É também o diagnóstico honesto do abort do PRÓPRIO cliente: ele volta com o token certo, a
  // rodada anterior ainda está rodando no servidor, e antes disso ele lia "token vencido".
  //
  // ⚠️ Custo conhecido: uma rodada que morra sem gravar (SIGKILL, ou `registrarRodada` falhando —
  // Commit 4) deixa a lease atrasada e trava a run em `rodada_em_voo` até o reaper de órfãs, 3
  // min. É o lado certo do erro: afirmar "não há ninguém rodando" sem base é o que custou a run
  // `72b4534a`.
  if (rodadaEmVoo(execucao)) {
    return {
      veredito: { tipo: "rodada_em_voo", runId: String(execucao.id), rodadas: Number(execucao.rodadas ?? 0) },
      execucao,
    };
  }

  const r = await deps.reivindicarRodada(db, String(execucao.id), token);
  if (r.tipo === "ganhou") return { veredito: { tipo: "reivindicada", token }, execucao };
  if (r.tipo === "indisponivel") {
    return { veredito: { tipo: "banco_indisponivel", detalhe: r.detalhe }, execucao };
  }

  // R3 — perdeu o CAS. A releitura diz POR QUÊ.
  const fresca = (await deps.relerRun(db, String(execucao.id))) ?? execucao;
  if (String(fresca.status) !== "running") {
    return { veredito: { tipo: "run_encerrada", runId: String(fresca.id) }, execucao: fresca };
  }
  const tipo = rodadaEmVoo(fresca) ? "rodada_em_voo" : "token_vencido";
  return {
    veredito: { tipo, runId: String(fresca.id), rodadas: Number(fresca.rodadas ?? 0) },
    execucao: fresca,
  };
}
