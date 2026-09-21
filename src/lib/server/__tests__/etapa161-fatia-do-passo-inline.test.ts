/**
 * Etapa 161 (Fase 30, commit 4) — os dois passos que furavam a própria fatia, e a rodada que
 * não se registrava.
 *
 * ═══ (a) O furo ═══
 * `reclassificacao` e `reprocessarFalhados` rodam INLINE, sem `call()` — e `call()` é quem monta a
 * fatia. Sem ele, os dois guardavam contra o `deadlineAt` da RODADA:
 *
 * - `reclassificacao`, rodada 0 sob drenagem: fatia devida de 11.000 ms, licença até
 *   `deadlineAt − 3.000` — **5,7× o próprio orçamento**, comendo os 41 s que protegem reaper,
 *   extração e derivadas.
 * - `reprocessarFalhados`: entrava com 2.501 ms de reserva para um item que faz **cinco**
 *   round-trips ao Supabase, de até 10 s cada → `deadline + 47,5 s ≈ t=117,5 s`, ACIMA dos 110 s
 *   em que o cliente aborta. Abort, re-disparo, 409 da cerca, duas falhas seguidas, run parada.
 *
 * ⚠️ Havia DOIS defeitos no mesmo guard, e consertar um só não fecha a conta: a fatia (contra
 * quem ele mede) e a reserva (quanto ele exige). A reserva de 2.500/3.000 ms autorizava uma
 * unidade de trabalho ~16× mais cara — a classe da Fase 7 em miniatura.
 *
 * ═══ (b) O registro mudo ═══
 * `registrarRodada` era a ÚNICA escrita do caminho quente fora de `escrita-checada.ts`, e engolia
 * o erro num `catch` mudo. Pior, a rota não reagia: `execucao = registrarRodada(...) ?? execucao`
 * seguia com o snapshot VELHO, avaliava o disjuntor com números de uma rodada atrás e podia
 * fechar como `concluido` uma run que não gravou nada.
 */

import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";
import {
  fatiaDoPasso,
  prazoDoPasso,
  RESERVA_DE_ITEM_MS,
  ROUND_TRIPS_POR_ITEM,
  FOLGA_ORQUESTRADOR_MS,
  TETO_FATIA,
  MARGEM_PARTIDA_MS,
  planejarRodada,
} from "@/lib/server/esteira-reservas";
import { HOBBY_BUDGET_MS, msLeft } from "@/lib/server/time-budget";
import { SUPABASE_RPC_TIMEOUT_MS } from "@/lib/supabase/fetch-com-teto";
import { timeoutDaRota } from "@/lib/api";
import { exigirEscritaComLinha } from "@/lib/server/escrita-checada";

const RAIZ = join(__dirname, "../../../..");
const ler = (p: string) => readFileSync(join(RAIZ, p), "utf-8");
const semComentarios = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/\/\/[^\n]*/g, " ");

const INLINE = ["reclassificacao", "reprocessarFalhados"] as const;

describe("etapa161 · (a) o prazo do passo nunca ultrapassa o da rodada", () => {
  it.each(INLINE)("«%s» — prazo ≤ deadlineAt − FOLGA, para qualquer saldo", (passo) => {
    const agora = Date.now();
    const deadlineAt = agora + HOBBY_BUDGET_MS;
    // Varre a rodada inteira, de 0 a 70 s consumidos: a invariante vale em todo instante, não só
    // no começo, porque o passo é o 14º da ordem e entra com a rodada já gasta.
    for (let gasto = 0; gasto <= HOBBY_BUDGET_MS; gasto += 1_000) {
      const saldo = HOBBY_BUDGET_MS - gasto - FOLGA_ORQUESTRADOR_MS;
      const prazo = prazoDoPasso(passo, saldo);
      expect(prazo - agora, `saldo ${saldo}`).toBeLessThanOrEqual(deadlineAt - agora - FOLGA_ORQUESTRADOR_MS);
    }
  });

  it.each(INLINE)("«%s» — prazo e fatia saem do MESMO cálculo (instante ≡ duração)", (passo) => {
    const antes = Date.now();
    const prazo = prazoDoPasso(passo, 40_000, 5_000);
    const fatia = fatiaDoPasso(passo, 40_000, 5_000);
    expect(prazo - antes).toBeGreaterThanOrEqual(fatia - 50);
    expect(prazo - antes).toBeLessThanOrEqual(fatia + 50);
  });

  it.each(INLINE)("⚠️ «%s» — a PROTEÇÃO encurta o prazo; ignorá-la é comer a fatia dos seguintes", (passo) => {
    // Medir prazo contra `fatiaDoPasso` com a MESMA proteção esconde o defeito: os dois lados se
    // mexem juntos. O que separa é comparar o prazo COM e SEM proteção, num saldo apertado o
    // bastante para a proteção morder (acima do teto da fatia, o `min` decide e a proteção some).
    const saldoApertado = TETO_FATIA[passo] + MARGEM_PARTIDA_MS - 1_000;
    const t0 = Date.now();
    const semProtecao = prazoDoPasso(passo, saldoApertado, 0) - t0;
    const comProtecao = prazoDoPasso(passo, saldoApertado, 5_000) - t0;
    expect(semProtecao - comProtecao).toBeGreaterThan(4_000);
  });

  it("⚠️ a licença antiga era 5,7× a fatia — o número que justifica o commit", () => {
    // Rodada 0 sob drenagem, o cenário medido: quanto o passo PODIA gastar contra o `deadlineAt`
    // da rodada, dividido pelo que lhe era devido.
    const { protecao } = planejarRodada(0, HOBBY_BUDGET_MS - FOLGA_ORQUESTRADOR_MS, { drenar: true });
    const saldoNaEntrada = HOBBY_BUDGET_MS - FOLGA_ORQUESTRADOR_MS;
    const devida = fatiaDoPasso("reclassificacao", saldoNaEntrada, protecao.reclassificacao ?? 0);
    const licencaAntiga = HOBBY_BUDGET_MS - 3_000; // `hasBudget(deadlineAt, 3_000)`
    expect(devida).toBeGreaterThan(0);
    expect(licencaAntiga / devida).toBeGreaterThan(4);
  });
});

describe("etapa161 · (a) a reserva de item cobre a unidade de trabalho que ela autoriza", () => {
  /** O pior caso REAL de um item: cinco round-trips, cada um no teto do client Supabase. */
  const PIOR_ITEM_MS = ROUND_TRIPS_POR_ITEM * SUPABASE_RPC_TIMEOUT_MS;

  it("⚠️ a reserva antiga (2.500/3.000 ms) era ordens de grandeza menor que o item", () => {
    expect(PIOR_ITEM_MS).toBeGreaterThan(3_000 * 10);
    expect(RESERVA_DE_ITEM_MS).toBeGreaterThan(3_000);
  });

  it("⚠️ PISO — abaixo dele o passo volta a terminar depois do abort de 110 s", () => {
    // `HOBBY_BUDGET_MS − FOLGA − R + PIOR_ITEM < TIMEOUT` ⟺ R > 70 − 4 + 50 − 110 = 6 s.
    const piso = HOBBY_BUDGET_MS - FOLGA_ORQUESTRADOR_MS + PIOR_ITEM_MS - timeoutDaRota("/pipeline/run");
    expect(piso).toBeGreaterThan(0);
    expect(RESERVA_DE_ITEM_MS).toBeGreaterThan(piso);
  });

  it("⚠️ TETO — reserva ≥ fatia é a Fase 16: o passo entra, falha a 1ª checagem e devolve zero", () => {
    // A MENOR fatia máxima entre os dois passos inline. Empatar com ela já basta para matar o
    // passo, então a comparação é estrita.
    const menorFatiaMaxima = Math.min(...INLINE.map((p) => TETO_FATIA[p] + MARGEM_PARTIDA_MS));
    expect(RESERVA_DE_ITEM_MS).toBeLessThan(menorFatiaMaxima);
  });

  it("⚠️ A CONTA QUE FECHA: mesmo no pior caso absoluto o passo termina ANTES do abort de 110 s", () => {
    // O último item só pode COMEÇAR enquanto sobra `RESERVA_DE_ITEM_MS` da fatia, e a fatia
    // termina, no máximo, em `HOBBY_BUDGET_MS − FOLGA`. Daí ele pode estourar até `PIOR_ITEM_MS`.
    const fimDaFatiaNoMaximo = HOBBY_BUDGET_MS - FOLGA_ORQUESTRADOR_MS;
    const ultimoItemComeca = fimDaFatiaNoMaximo - RESERVA_DE_ITEM_MS;
    const fimNoPiorCaso = ultimoItemComeca + PIOR_ITEM_MS;
    expect(fimNoPiorCaso).toBeLessThan(timeoutDaRota("/pipeline/run"));
    // …e o número antigo NÃO fechava: era esta diferença que produzia o t≈117,5 s.
    const fimAntigo = HOBBY_BUDGET_MS - 2_500 + PIOR_ITEM_MS;
    expect(fimAntigo).toBeGreaterThan(timeoutDaRota("/pipeline/run"));
  });

  it("reservar o pior caso INTEIRO não é opção — nenhuma fatia comporta, e o passo morreria", () => {
    // Justifica a escolha de um teto de round-trip em vez dos 50 s: trocar estouro por passo
    // morto em silêncio é a mesma família de erro, do outro lado.
    for (const passo of INLINE) {
      expect(TETO_FATIA[passo] + MARGEM_PARTIDA_MS).toBeLessThan(PIOR_ITEM_MS);
      // …mas a fatia COMPORTA a reserva escolhida: o passo continua podendo fazer trabalho.
      expect(TETO_FATIA[passo] + MARGEM_PARTIDA_MS).toBeGreaterThan(RESERVA_DE_ITEM_MS);
      // E a reserva NÃO cobre um round-trip travado — declarado, não escondido: o que fecha a
      // conta é o fim do passo contra o abort do cliente, não o custo de uma chamada.
      expect(RESERVA_DE_ITEM_MS).toBeLessThan(SUPABASE_RPC_TIMEOUT_MS);
    }
  });
});

describe("etapa161 · (a) os dois guards inline usam o prazo do passo", () => {
  const ROTA = semComentarios(ler("src/app/api/v1/pipeline/run/route.ts"));

  it("nenhum guard inline mede contra o `deadlineAt` da rodada", () => {
    expect(ROTA).toMatch(/hasBudget\(prazoReclassificacao, RESERVA_DE_ITEM_MS\)/);
    expect(ROTA).toMatch(/hasBudget\(prazoReprocesso, RESERVA_DE_ITEM_MS\)/);
    // As formas antigas não podem voltar.
    expect(ROTA).not.toMatch(/hasBudget\(deadlineAt, 3_000\)/);
    expect(ROTA).not.toMatch(/hasBudget\(deadlineAt, 2_500\)/);
  });

  it("o prazo é tirado UMA vez, na entrada do passo — não a cada item", () => {
    // Recalcular por item faria a fatia andar junto com o relógio e nunca acabar: a fatia é um
    // ORÇAMENTO, e orçamento que se renova sozinho é o bug que ela existe para matar.
    expect((ROTA.match(/prazoDoPasso\("reclassificacao"/g) ?? []).length).toBe(1);
    expect((ROTA.match(/prazoDoPasso\("reprocessarFalhados"/g) ?? []).length).toBe(1);
  });

  it("o prazo respeita a PROTEÇÃO do plano — senão come a fatia dos passos seguintes", () => {
    expect(ROTA).toMatch(/prazoDoPasso\("reclassificacao", saldo\(\), protecao\.reclassificacao \?\? 0\)/);
    expect(ROTA).toMatch(/prazoDoPasso\("reprocessarFalhados", saldo\(\), protecao\.reprocessarFalhados \?\? 0\)/);
  });
});

describe("etapa161 · (b) a rodada que não se registra PARA, e diz por quê", () => {
  const ROTA = ler("src/app/api/v1/pipeline/run/route.ts");
  const ESTEIRA = ler("src/lib/server/esteira-run.ts");

  it("`registrarRodada` passou a usar o helper checado — o `catch` mudo morreu", () => {
    const registrar = ESTEIRA.slice(ESTEIRA.indexOf("export async function registrarRodada"), ESTEIRA.indexOf("export async function fecharRun"));
    expect(registrar).toMatch(/exigirEscritaComLinha<EsteiraRun>\(/);
    expect(semComentarios(registrar)).not.toMatch(/catch \{/);
  });

  it("⚠️ a rota REAGE: fecha como erro e não pede outra rodada", () => {
    // ⚠️ `lastIndexOf`: `return NextResponse.json({` aparece várias vezes antes (demo, guard,
    // encerrar). Ancorar no primeiro devolvia uma fatia VAZIA e o teste passaria por vacuidade.
    const bloco = ROTA.slice(ROTA.indexOf("let abortadoPeloDisjuntor"), ROTA.lastIndexOf("return NextResponse.json({"));
    expect(bloco.length, "fatia vazia: a âncora do bloco não casou").toBeGreaterThan(200);
    expect(bloco).toMatch(/if \(!registrada\)/);
    expect(bloco).toMatch(/restantes = false;/);
    expect(bloco).toMatch(/fecharRun\([\s\S]{0,120}?"erro"/);
    // A forma antiga seguia com o snapshot velho e avaliava o disjuntor com números vencidos.
    expect(semComentarios(bloco)).not.toMatch(/execucao = \(await registrarRodada\([\s\S]{0,80}?\) \?\? execucao;/);
  });

  it("o corpo da resposta declara a parada — e o cliente NÃO pinta verde", () => {
    expect(ROTA).toMatch(/registro_da_rodada_falhou: true/);
    const TELA = ler("src/app/dashboard/deliberacoes/votos-diretores/page.tsx");
    // Sem este ramo, `restantes: false` seria lido como "drenou": banner verde numa execução que
    // parou sem saber o que fez. É o "pior formato de zero" da Fase 20, de novo.
    expect(TELA).toMatch(/if \(res\.registro_da_rodada_falhou\)/);
    const iFalhou = TELA.indexOf("if (res.registro_da_rodada_falhou)");
    const iDrenou = TELA.indexOf('if (!res.restantes) { desfecho = "drenou"');
    expect(iFalhou).toBeGreaterThan(-1);
    expect(iFalhou, "o ramo tem de vir ANTES da leitura de `restantes`").toBeLessThan(iDrenou);
  });
});

describe("etapa161 · (b) `exigirEscritaComLinha` de fato checa — não é só regex alargado", () => {
  const promessa = <T,>(r: { data: T | null; error: { message?: string } | null }) => Promise.resolve(r);

  it("erro do Supabase vira null, e o contexto vai para o log", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      expect(await exigirEscritaComLinha(promessa({ data: { id: "x" }, error: { message: "boom" } }), "ctx")).toBeNull();
      expect(String(spy.mock.calls[0]?.[0])).toContain("ctx");
      expect(String(spy.mock.calls[0]?.[0])).toContain("boom");
    } finally {
      spy.mockRestore();
    }
  });

  it("⚠️ sem erro e sem linha TAMBÉM é REPORTADO — é o silêncio com cara de sucesso", async () => {
    // ⚠️ Asserção que eu escrevi errado da primeira vez: `toBeNull()` passa mesmo SEM o ramo,
    // porque o `data` já é null — o teste concordava consigo. O que distingue é o LOG: sem ele,
    // uma escrita que não pegou nenhuma linha volta indistinguível de uma que pegou.
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      expect(await exigirEscritaComLinha(promessa({ data: null, error: null }), "registrar rodada 3")).toBeNull();
      expect(spy).toHaveBeenCalledTimes(1);
      expect(String(spy.mock.calls[0]?.[0])).toContain("registrar rodada 3");
      expect(String(spy.mock.calls[0]?.[0])).toMatch(/nenhuma linha/);
    } finally {
      spy.mockRestore();
    }
  });

  it("a promessa que LANÇA não escapa — `supabase-js` devolve {error}, mas a rede não", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      expect(await exigirEscritaComLinha(Promise.reject(new Error("ECONNRESET")) as never, "t")).toBeNull();
      expect(String(spy.mock.calls[0]?.[0])).toContain("ECONNRESET");
    } finally {
      spy.mockRestore();
    }
  });

  it("o caminho feliz devolve a linha e NÃO loga — senão o log vira ruído e ninguém o lê", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      expect(await exigirEscritaComLinha(promessa({ data: { id: "x" }, error: null }), "t")).toEqual({ id: "x" });
      expect(spy).not.toHaveBeenCalled();
    } finally {
      spy.mockRestore();
    }
  });
});

describe("etapa161 · o relógio da rodada não foi afrouxado de lado nenhum", () => {
  it("o orçamento e a folga seguem sendo os medidos — a correção é de FATIA, não de teto", () => {
    expect(HOBBY_BUDGET_MS).toBe(70_000);
    expect(FOLGA_ORQUESTRADOR_MS).toBe(4_000);
    expect(msLeft(Date.now() + 5_000)).toBeGreaterThan(4_000);
  });
});
