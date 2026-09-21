/**
 * Etapa 159 (Fase 30, commit 2) — a porta da run, replayando o trace de produção.
 *
 * ═══ O que aconteceu com a run `72b4534a` ═══
 * `status: concluido`, 6 rodadas, **32 passos ok, ZERO erros, 42,8 s por rodada** — e mesmo assim
 * a tela disse "PAROU após 3 rodada(s) com erro". A run estava SAUDÁVEL quando parou.
 *
 * O mecanismo, em duas linhas da rota:
 *
 * 1. `if (ativa && corpo.run_id && ativa.id !== corpo.run_id)` — o guard só dispara quando o
 *    chamador MANDA um run_id divergente. Com corpo vazio ele é falso, e a linha seguinte,
 *    `execucao = ativa ?? iniciarRun(...)`, fazia a invocação **adotar a run alheia**. E corpo
 *    vazio era o caso COMUM: `runIdAtivo` nasce `null` na tela e nunca era semeado do
 *    `/pipeline/status`, então toda aba nova entrava assim — e o cron também, por GET não ter corpo.
 * 2. `tokenDaRodada = corpo.rodadas_vistas ?? execucao.rodadas` — quem não manda token lê o valor
 *    CORRENTE do banco, e por isso **vence sempre** o compare-and-set.
 *
 * Juntas: a aba B entra na run de A, vence o claim, e A — segurando o token que acabou de vencer —
 * toma 409 até desistir. Os 32 passos são a soma do trabalho das DUAS abas na mesma linha.
 *
 * ⚠️ Este arquivo NÃO é grep. Ele roda `abrirOuReivindicarRodada` contra um banco falso que
 * implementa o compare-and-set de verdade (UPDATE condicional em `rodadas` + `status`), porque a
 * etapa155 inteira é grep justamente por essa costura não existir antes.
 */

import { describe, it, expect } from "vitest";
import {
  abrirOuReivindicarRodada,
  rodadaEmVoo,
  CHAVE_RODADAS_CONCLUIDAS,
  type VereditoDaCerca,
} from "@/lib/server/cerca-da-run";

type Linha = {
  id: string;
  status: "running" | "concluido" | "abortado" | "erro";
  rodadas: number;
  contadores: Record<string, number>;
};

/**
 * O banco falso. `reivindicar` é o CAS REAL: só ganha quem trouxer o token corrente E encontrar a
 * run `running`. É esta função que separa este teste de uma tautologia — se ela fosse permissiva,
 * qualquer desenho passaria.
 */
function bancoFalso(linhas: Linha[]) {
  const estado = new Map(linhas.map((l) => [l.id, { ...l, contadores: { ...l.contadores } }]));
  let proximoId = 1;
  const chamadas = { iniciarRun: 0, reivindicarRodada: 0, relerRun: 0 };
  let indisponivel: string | null = null;
  let interferir: (() => void) | null = null;

  const deps = {
    buscarRunAtiva: async (): Promise<Linha | null> => {
      for (const l of estado.values()) if (l.status === "running") return { ...l };
      return null;
    },
    iniciarRun: async (_db: unknown, origem: "ui" | "cron"): Promise<Linha | null> => {
      chamadas.iniciarRun++;
      const nova: Linha = { id: `nova-${proximoId++}`, status: "running", rodadas: 0, contadores: { origem: 0 } };
      void origem;
      estado.set(nova.id, nova);
      return { ...nova };
    },
    reivindicarRodada: async (_db: unknown, runId: string, token: number) => {
      chamadas.reivindicarRodada++;
      // A corrida real: outra invocação reivindica ENTRE a leitura da run e o nosso CAS.
      if (interferir) { interferir(); interferir = null; }
      if (indisponivel) return { tipo: "indisponivel" as const, detalhe: indisponivel };
      const l = estado.get(runId);
      // O CAS, escrito como o UPDATE o escreve: id + status + rodadas.
      if (!l || l.status !== "running" || l.rodadas !== token) return { tipo: "perdeu" as const };
      l.rodadas = token + 1;
      return { tipo: "ganhou" as const, rodadas: l.rodadas };
    },
    relerRun: async (_db: unknown, runId: string) => {
      chamadas.relerRun++;
      const l = estado.get(runId);
      return l ? { ...l, contadores: { ...l.contadores } } : null;
    },
  };

  return {
    deps,
    chamadas,
    estado,
    /** O que `registrarRodada` faz à lease, no fim da rodada. */
    concluirRodada(runId: string, rodada: number) {
      const l = estado.get(runId)!;
      l.contadores = { ...l.contadores, [CHAVE_RODADAS_CONCLUIDAS]: rodada };
    },
    derrubarBanco(detalhe: string | null) {
      indisponivel = detalhe;
    },
    /** Agenda uma interferência para acontecer DENTRO do próximo CAS. */
    noMeioDoClaim(f: () => void) {
      interferir = f;
    },
  };
}

const abrir = (b: ReturnType<typeof bancoFalso>, entrada: { origem?: "ui" | "cron"; runId?: string; rodadasVistas?: number }) =>
  abrirOuReivindicarRodada({}, b.deps, { origem: entrada.origem ?? "ui", runId: entrada.runId, rodadasVistas: entrada.rodadasVistas });

describe("etapa159 · o trace de produção, replayado", () => {
  it("⚠️ A reivindica 5→6; B com corpo vazio toma 409 e NÃO abre run; A continua e PASSA", async () => {
    const b = bancoFalso([{ id: "72b4534a", status: "running", rodadas: 5, contadores: { [CHAVE_RODADAS_CONCLUIDAS]: 5 } }]);

    // ── Passo 1: a aba A, dona da run, com o token que ela tem na mão.
    const a1 = await abrir(b, { runId: "72b4534a", rodadasVistas: 5 });
    expect(a1.veredito).toEqual({ tipo: "reivindicada", token: 5 });
    expect(b.estado.get("72b4534a")!.rodadas).toBe(6);

    // ── Passo 2: a aba B — corpo VAZIO, exatamente o que a tela mandava. Era aqui que ela
    // adotava a run e vencia o CAS lendo o valor corrente.
    const b1 = await abrir(b, {});
    expect(b1.veredito.tipo).toBe("run_alheia");
    expect(b1.veredito).toEqual({ tipo: "run_alheia", runId: "72b4534a", rodadas: 6 });
    // ⚠️ O coração: a porta fecha ANTES de qualquer escrita. Nem run nova, nem claim.
    expect(b.chamadas.iniciarRun, "abriu run nova por cima da ativa").toBe(0);
    expect(b.chamadas.reivindicarRodada, "chegou a tentar o CAS na run alheia").toBe(1);

    // ── Passo 3: A termina a rodada 6 e pede a 7. É o que quebrava: com B tendo mexido no token,
    // A tomava 409 e desistia. A retomada tem de sobreviver ao fechamento da porta.
    b.concluirRodada("72b4534a", 6);
    const a2 = await abrir(b, { runId: "72b4534a", rodadasVistas: 6 });
    expect(a2.veredito).toEqual({ tipo: "reivindicada", token: 6 });
    expect(b.estado.get("72b4534a")!.rodadas).toBe(7);
  });

  it("o cron por GET é o mesmo caso do corpo vazio — e também não entra", async () => {
    const b = bancoFalso([{ id: "r1", status: "running", rodadas: 2, contadores: {} }]);
    const v = await abrir(b, { origem: "cron" });
    expect(v.veredito.tipo).toBe("run_alheia");
    expect(b.chamadas.iniciarRun).toBe(0);
    expect(b.estado.get("r1")!.rodadas, "o token da run alheia foi mexido").toBe(2);
  });
});

describe("etapa159 · de onde o token pode vir", () => {
  it("sem run ativa: abre run nova e o token 0 vem do banco — a ÚNICA circunstância", async () => {
    const b = bancoFalso([]);
    const v = await abrir(b, {});
    expect(v.veredito).toEqual({ tipo: "reivindicada", token: 0 });
    expect(b.chamadas.iniciarRun).toBe(1);
  });

  it("⚠️ run PREEXISTENTE sem token não lê o corrente — era assim que se vencia sempre", async () => {
    const b = bancoFalso([{ id: "r1", status: "running", rodadas: 4, contadores: {} }]);
    // O chamador se declara dono (a porta deixa passar), mas não traz token.
    const v = await abrir(b, { runId: "r1" });
    expect(v.veredito).toEqual({ tipo: "token_ausente", runId: "r1", rodadas: 4 });
    expect(b.chamadas.reivindicarRodada, "leu o valor corrente e tentou o CAS").toBe(0);
    expect(b.estado.get("r1")!.rodadas).toBe(4);
  });

  it("sem a tabela de execuções a esteira roda como antes — degrade preservado", async () => {
    const b = bancoFalso([]);
    b.deps.iniciarRun = async () => null;
    const v = await abrir(b, {});
    expect(v.veredito).toEqual({ tipo: "sem_lock" });
    expect(v.execucao).toBeNull();
  });
});

describe("etapa159 · os quatro desfechos de quem PERDE o compare-and-set", () => {
  it("token vencido e nenhuma rodada no ar → adotar o FRESCO e repetir na hora", async () => {
    const b = bancoFalso([{ id: "r1", status: "running", rodadas: 9, contadores: { [CHAVE_RODADAS_CONCLUIDAS]: 9 } }]);
    const v = await abrir(b, { runId: "r1", rodadasVistas: 7 });
    expect(v.veredito).toEqual({ tipo: "token_vencido", runId: "r1", rodadas: 9 });
    // ⚠️ O 409 carrega o valor FRESCO (9), não o que foi lido antes do CAS. Responder o velho
    // faria o cliente adotar um número já vencido e tomar 409 de novo, para sempre.
    expect(b.chamadas.relerRun).toBe(1);
  });

  it("⚠️ com rodada NO AR o CAS NEM É TENTADO — e o dono legítimo, que venceria, também espera", async () => {
    // O caso que separa "lease relatada no 409" de "lease que TRANCA". Rodada 7 no ar significa
    // rodadas = 7 e rodadas_concluidas = 6. Quem trouxer o token 7 — o dono, voltando do próprio
    // abort de 110 s — VENCERIA o compare-and-set, porque o UPDATE só compara `rodadas`, e
    // reivindicaria a rodada 8 por cima de uma rodada em execução. Checar a lease só depois do
    // CAS deixaria o servidor abençoar exatamente o roubo que esta fase conserta.
    const b = bancoFalso([{ id: "r1", status: "running", rodadas: 7, contadores: { [CHAVE_RODADAS_CONCLUIDAS]: 6 } }]);
    const v = await abrir(b, { runId: "r1", rodadasVistas: 7 });
    expect(v.veredito).toEqual({ tipo: "rodada_em_voo", runId: "r1", rodadas: 7 });
    expect(b.chamadas.reivindicarRodada, "tentou o CAS com uma rodada no ar — e teria ganhado").toBe(0);
    expect(b.estado.get("r1")!.rodadas, "o token foi consumido por cima da rodada em execução").toBe(7);

    // E a trava SOLTA quando a rodada grava: é lease, não cadeado.
    b.concluirRodada("r1", 7);
    const depois = await abrir(b, { runId: "r1", rodadasVistas: 7 });
    expect(depois.veredito).toEqual({ tipo: "reivindicada", token: 7 });
  });

  it("⚠️ R3 — quem PERDE o CAS para um terceiro lê a lease na releitura, não «token vencido»", async () => {
    // A corrida que a guarda pré-CAS não cobre: na leitura não havia rodada no ar, e outra
    // invocação reivindicou no intervalo. Os dois desfechos pedem ações OPOSTAS do cliente —
    // `token_vencido` manda repetir na hora, `rodada_em_voo` manda esperar — e chamar o segundo
    // de primeiro é o que reabre o roubo.
    const b = bancoFalso([{ id: "r1", status: "running", rodadas: 7, contadores: { [CHAVE_RODADAS_CONCLUIDAS]: 7 } }]);
    b.noMeioDoClaim(() => {
      const l = b.estado.get("r1")!;
      l.rodadas = 8; // o terceiro reivindicou a rodada 8, e ela está NO AR (concluidas segue 7)
    });
    const v = await abrir(b, { runId: "r1", rodadasVistas: 7 });
    expect(v.veredito).toEqual({ tipo: "rodada_em_voo", runId: "r1", rodadas: 8 });
    expect(b.chamadas.relerRun, "classificou sem reler: o retrato pré-CAS não sabe da corrida").toBe(1);
  });

  it("…e a MESMA corrida, com o terceiro já tendo terminado, é `token_vencido` — repetir na hora", async () => {
    const b = bancoFalso([{ id: "r1", status: "running", rodadas: 7, contadores: { [CHAVE_RODADAS_CONCLUIDAS]: 7 } }]);
    b.noMeioDoClaim(() => {
      const l = b.estado.get("r1")!;
      l.rodadas = 8;
      l.contadores = { ...l.contadores, [CHAVE_RODADAS_CONCLUIDAS]: 8 };
    });
    const v = await abrir(b, { runId: "r1", rodadasVistas: 7 });
    expect(v.veredito).toEqual({ tipo: "token_vencido", runId: "r1", rodadas: 8 });
  });

  it("run já encerrada por baixo → abrir uma nova, não insistir nesta", async () => {
    const b = bancoFalso([{ id: "r1", status: "concluido", rodadas: 3, contadores: {} }]);
    // `buscarRunAtiva` não a devolve (não está `running`), então a porta não a vê: o chamador que
    // se declara dono dela abre uma run NOVA. O caso `run_encerrada` é o do fechamento ENTRE a
    // leitura e o CAS.
    b.deps.buscarRunAtiva = async () => ({ ...b.estado.get("r1")! });
    const v = await abrir(b, { runId: "r1", rodadasVistas: 3 });
    expect(v.veredito).toEqual({ tipo: "run_encerrada", runId: "r1" });
  });

  it("⚠️ banco recusando o UPDATE não é concorrência — é 503, e o cliente NÃO espera", async () => {
    const b = bancoFalso([{ id: "r1", status: "running", rodadas: 2, contadores: {} }]);
    b.derrubarBanco("connection terminated unexpectedly");
    const v = await abrir(b, { runId: "r1", rodadasVistas: 2 });
    expect(v.veredito).toEqual({ tipo: "banco_indisponivel", detalhe: "connection terminated unexpectedly" });
    // Não relê: não há o que reler, e mascarar isso de 409 fazia o operador ler
    // "outra invocação em andamento" quando o problema era o Supabase.
    expect(b.chamadas.relerRun).toBe(0);
  });
});

describe("etapa159 · a lease, isolada", () => {
  it.each([
    ["reivindicada à frente da concluída: há rodada no ar", 7, 6, true],
    ["em dia: a rodada terminou", 7, 7, false],
    ["⚠️ run anterior à lease (sem a chave): responde FALSE, senão travaria a esteira", 7, undefined, false],
    ["chave presente mas não numérica: não afirma o que não sabe", 7, "6" as unknown as number, false],
  ] as Array<[string, number, number | undefined, boolean]>)("%s", (_n, rodadas, concluidas, esperado) => {
    const contadores = concluidas === undefined ? {} : { [CHAVE_RODADAS_CONCLUIDAS]: concluidas };
    expect(rodadaEmVoo({ rodadas, contadores })).toBe(esperado);
  });

  it("a lease é escrita no MESMO UPDATE de `registrarRodada` — sem migration", async () => {
    const { readFileSync } = await import("fs");
    const { join } = await import("path");
    const ESTEIRA = readFileSync(join(__dirname, "../esteira-run.ts"), "utf-8");
    const registrar = ESTEIRA.slice(ESTEIRA.indexOf("export async function registrarRodada"));
    expect(registrar).toMatch(/contadores\[CHAVE_RODADAS_CONCLUIDAS\] = rodadaConcluida;/);
    // ⚠️ Ela tem de ser gravada DEPOIS da soma das etapas: uma etapa que um dia emitisse esta
    // chave somaria por cima da lease e a esteira passaria a se declarar em voo para sempre.
    const iSoma = registrar.indexOf("contadores[k] = (contadores[k] ?? 0) + v");
    const iLease = registrar.indexOf("contadores[CHAVE_RODADAS_CONCLUIDAS] =");
    expect(iSoma).toBeGreaterThan(-1);
    expect(iLease).toBeGreaterThan(iSoma);
  });

  it("⚠️ a lease vem do token REIVINDICADO, não do retrato lido antes do claim", async () => {
    const { readFileSync } = await import("fs");
    const { join } = await import("path");
    const ROTA = readFileSync(join(__dirname, "../../../app/api/v1/pipeline/run/route.ts"), "utf-8");
    // `run.rodadas` é o valor PRÉ-claim: usá-lo deixaria `rodadas` uma unidade à frente da lease
    // para sempre, e toda rodada seguinte tomaria `rodada_em_voo`. A run nunca mais andaria.
    expect(ROTA).toMatch(/registrarRodada\(db, execucao, etapas, rodadaReivindicada/);
    expect(ROTA).toMatch(/rodadaReivindicada = veredito\.tipo === "reivindicada" \? veredito\.token \+ 1 : null/);
  });
});

describe("etapa159 · o corpo do 409 permite AGIR, não só desistir", () => {
  it("cada desfecho carrega o que o cliente precisa para o próximo passo", async () => {
    const casos: Array<[VereditoDaCerca["tipo"], () => Promise<{ veredito: VereditoDaCerca }>]> = [
      ["run_alheia", () => abrir(bancoFalso([{ id: "r1", status: "running", rodadas: 3, contadores: {} }]), {})],
      ["token_ausente", () => abrir(bancoFalso([{ id: "r1", status: "running", rodadas: 3, contadores: {} }]), { runId: "r1" })],
      ["token_vencido", () => abrir(bancoFalso([{ id: "r1", status: "running", rodadas: 3, contadores: {} }]), { runId: "r1", rodadasVistas: 1 })],
    ];
    for (const [tipo, executar] of casos) {
      const { veredito } = await executar();
      expect(veredito.tipo).toBe(tipo);
      // Sem `runId` + `rodadas` frescos o cliente só pode desistir — que é o que ele fazia.
      expect(veredito).toMatchObject({ runId: "r1", rodadas: 3 });
    }
  });
});
