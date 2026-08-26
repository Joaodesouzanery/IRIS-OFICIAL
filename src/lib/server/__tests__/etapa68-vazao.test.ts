/**
 * Etapa 68 (Fase 7) — vazão, com teto.
 *
 * O enfileiramento baixava PDFs em SÉRIE reservando 22s por item (o timeout de rede) contra uma
 * fatia de 25s: cabia UM item, e a rodada enfileirava 1 a 3 PDFs. Uma fila de centenas viravam
 * dezenas de rodadas de 50s — a "demora demais" relatada. O gargalo é REDE: o processo passava a
 * janela ociosa esperando o portal.
 *
 * Duas mudanças e um freio:
 *   · downloads concorrentes (a espera de rede passa a ser usada, não sofrida);
 *   · reserva ADAPTATIVA (para de assumir o pior caso quando as respostas chegam em 1-3s);
 *   · TETO por rodada — porque tirar o estrangulamento sob um cron diário transformaria um erro
 *     sistemático em centenas de documentos mal processados antes de alguém abrir a tela.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";
import { mapComConcorrencia, criarReservaAdaptativa } from "@/lib/server/concorrencia";
import { RESERVA, TETO_ENQUEUE_POR_RODADA } from "@/lib/server/esteira-reservas";

const RAIZ = join(__dirname, "../../../..");
const ler = (p: string) => readFileSync(join(RAIZ, p), "utf-8");

const espera = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe("etapa68 · mapComConcorrencia executa em paralelo, com limite", () => {
  it("nunca ultrapassa o limite de unidades em voo", async () => {
    let emVoo = 0;
    let pico = 0;
    const itens = Array.from({ length: 12 }, (_, i) => i);
    await mapComConcorrencia(itens, { concorrencia: 4, reservaMs: 0 }, async () => {
      emVoo++; pico = Math.max(pico, emVoo);
      await espera(5);
      emVoo--;
      return true;
    });
    expect(pico).toBeLessThanOrEqual(4);
    expect(pico, "sem paralelismo real o conserto não serve para nada").toBeGreaterThan(1);
  });

  it("processa TODOS os itens quando há saldo", async () => {
    const itens = [1, 2, 3, 4, 5, 6, 7];
    const r = await mapComConcorrencia(itens, { concorrencia: 3, reservaMs: 0 }, async (n) => n * 2);
    expect(r.concluidos).toHaveLength(7);
    expect(r.naoIniciados).toHaveLength(0);
    expect(r.concluidos.map((c) => c.valor).sort((a, b) => a - b)).toEqual([2, 4, 6, 8, 10, 12, 14]);
  });

  it("é MAIS RÁPIDO que a série — a espera de rede é sobreposta", async () => {
    const itens = Array.from({ length: 8 }, (_, i) => i);
    const t0 = Date.now();
    await mapComConcorrencia(itens, { concorrencia: 4, reservaMs: 0 }, async () => { await espera(20); return 1; });
    const decorrido = Date.now() - t0;
    // 8 × 20ms em série = 160ms; com 4 em voo, ~40ms. Margem larga para não ficar instável em CI.
    expect(decorrido).toBeLessThan(140);
  });

  it("sem saldo, NÃO inicia — e devolve o que ficou para a próxima rodada", async () => {
    const itens = [1, 2, 3, 4, 5];
    const jaEstourado = Date.now() - 1;
    const r = await mapComConcorrencia(
      itens,
      { concorrencia: 3, deadlineAt: jaEstourado, reservaMs: 1_000 },
      async (n) => n,
    );
    expect(r.concluidos).toHaveLength(0);
    expect(r.naoIniciados, "a fila é durável: o que não coube volta na próxima").toEqual(itens);
  });

  it("um erro na tarefa é da tarefa — a chamada nunca rejeita", async () => {
    // O contrato importa: a rota trata cada item e grava motivo por item; uma rejeição aqui
    // derrubaria a rodada inteira e perderia o progresso dos outros itens.
    const r = await mapComConcorrencia([1, 2, 3], { concorrencia: 2, reservaMs: 0 }, async (n) => {
      if (n === 2) return { ok: false as const };
      return { ok: true as const };
    });
    expect(r.concluidos).toHaveLength(3);
  });
});

describe("etapa68 · a reserva adaptativa para de assumir o pior caso", () => {
  it("sem amostra, é conservadora (o pior caso)", () => {
    const a = criarReservaAdaptativa(22_000);
    expect(a.reserva()).toBe(22_000);
  });

  it("com respostas rápidas, encolhe — é daí que vem a vazão", () => {
    const a = criarReservaAdaptativa(22_000, 4_000, 2.5);
    a.registrar(1_200);
    expect(a.reserva()).toBeLessThan(22_000);
    expect(a.reserva()).toBeGreaterThanOrEqual(4_000); // nunca abaixo do piso
  });

  it("com uma resposta LENTA, volta a ser conservadora — segurança antes de vazão", () => {
    const a = criarReservaAdaptativa(22_000);
    a.registrar(1_000);
    a.registrar(19_000);
    expect(a.reserva(), "o pior observado manda: trocar desperdício por SIGKILL seria pior").toBe(22_000);
  });

  it("nunca ultrapassa o pior caso original", () => {
    const a = criarReservaAdaptativa(22_000);
    a.registrar(60_000);
    expect(a.reserva()).toBe(22_000);
  });
});

describe("etapa68 · o teto de vazão por rodada", () => {
  const pipeline = ler("src/app/api/v1/pipeline/run/route.ts");

  it("existe, é um número finito e razoável", () => {
    expect(TETO_ENQUEUE_POR_RODADA).toBeGreaterThan(0);
    expect(TETO_ENQUEUE_POR_RODADA).toBeLessThanOrEqual(200);
  });

  it("o orquestrador respeita o teto e para o laço ao atingi-lo", () => {
    expect(pipeline).toMatch(/const saldoTeto = TETO_ENQUEUE_POR_RODADA - \(enfileirados \+ itensArquivados\)/);
    expect(pipeline).toMatch(/if \(saldoTeto <= 0\) \{ tetoAtingido = true; restantes = true; break; \}/);
  });

  it("atingir o teto é REPORTADO — senão lê-se como 'a esteira parou de achar coisas'", () => {
    expect(pipeline).toMatch(/teto_por_rodada: TETO_ENQUEUE_POR_RODADA/);
  });

  it("o teto não descarta trabalho: `restantes` continua verdadeiro", () => {
    expect(pipeline).toMatch(/tetoAtingido = true; restantes = true/);
  });
});

describe("etapa68 · o enfileiramento usa a concorrência de verdade", () => {
  const rota = ler("src/app/api/v1/deliberacoes/enqueue-pdfs/route.ts");

  it("baixa com mapComConcorrencia e reserva adaptativa", () => {
    expect(rota).toContain("mapComConcorrencia");
    expect(rota).toContain("criarReservaAdaptativa");
    expect(rota).toMatch(/concorrencia: CONCORRENCIA_DOWNLOAD/);
  });

  it("o laço em SÉRIE com reserva fixa não existe mais", () => {
    expect(rota).not.toMatch(/for \(const item of candidates\) \{/);
  });

  it("a concorrência é limitada — o portal da agência é serviço público", () => {
    const m = rota.match(/CONCORRENCIA_DOWNLOAD = (\d+)/);
    expect(m).toBeTruthy();
    const n = Number(m![1]);
    expect(n).toBeGreaterThan(1);
    expect(n, "acima disso é martelar o portal, não usar a espera").toBeLessThanOrEqual(8);
  });

  it("as GRAVAÇÕES continuam em série — o ganho é de rede", () => {
    // Serializar o banco preserva contadores, status terminal e a ordem de `results`, que outros
    // testes já travam. Paralelizar escrita seria mudar comportamento sem necessidade.
    expect(rota).toMatch(/for \(const \{ item, valor \} of colheita\.concluidos\)/);
  });

  it("o que não foi iniciado por falta de saldo entra em `restantes`", () => {
    expect(rota).toMatch(/restantes \+= colheita\.naoIniciados\.length/);
  });

  it("a reserva usada é a do passo de enfileiramento (fonte única)", () => {
    expect(rota).toMatch(/criarReservaAdaptativa\(RESERVA\.enqueue\)/);
    expect(RESERVA.enqueue).toBeGreaterThan(0);
  });
});
