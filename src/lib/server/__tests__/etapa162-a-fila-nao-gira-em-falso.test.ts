/**
 * Etapa 162 (Fase 30, fora do Bloco A/B) — a fila que girava para sempre.
 *
 * ═══ O QUE ACONTECEU EM PRODUÇÃO ═══
 * Depois do Bloco A, o "Rodar tudo" fez 24 rodadas em 25 min sem UM 409 — a cerca segurou. Mas
 * 4 rodadas morreram com "A requisição passou de 110s sem resposta", e 110 s × 4 = 440 s, quase
 * 30% da janela. Tirando-as, a rodada custa 44 s: exatamente a run saudável da Fase 29. Ou seja,
 * a rodada estava boa e havia UM caminho que pendurava a função.
 *
 * ═══ O MECANISMO, e por que nenhum teto desta base o pegava ═══
 * O laço de `processQueue` era:
 *
 *     while (queue.length > 0 || active.length > 0) {
 *       const permitidos = …jobsPermitidos(saldo)…            // 0 quando saldo < 13s
 *       while (active.length < permitidos && queue.length > 0) { …única saída mora aqui… }
 *       if (active.length > 0) await Promise.race(active);     // …e este é o único await
 *     }
 *
 * Com `permitidos === 0` e `active` vazio e `queue` cheia: o laço interno não roda (`0 < 0`), a
 * saída fica INALCANÇÁVEL, o `await` não acontece — e o externo gira. Sem `await`, o event loop
 * nunca cede: **medido em réplica isolada, 100 milhões de voltas em 8 s sem um `setTimeout`
 * disparar**. É a família da Fase 27 — event loop travado significa que NENHUM relógio funciona:
 * nem `fetch-com-teto`, nem `tetoDoParse`, nem o `maxDuration` consegue ser gracioso.
 *
 * Gatilho é o caso COMUM: a extração começa com saldo, dois jobs entram em voo, terminam depois
 * do saldo acabar, e sobra fila. Como o orquestrador chama `/upload/process` por `call()` (em
 * processo), o giro acontece DENTRO da requisição de `/api/v1/pipeline/run`.
 *
 * ⚠️ POR QUE O TESTE MEDE UMA FUNÇÃO PURA, e não o laço inteiro.
 * Um laço sem `await` também não deixa o timeout do vitest disparar: uma regressão testada
 * diretamente PENDURARIA A SUÍTE em vez de reprovar. A condição de saída virou
 * `decisaoDaFila` — pura — justamente para poder ser exaustiva sem esse risco. O caso
 * comportamental abaixo existe, mas é o que hoje termina em milissegundos.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";
import {
  decisaoDaFila,
  jobsPermitidos,
  processQueue,
  RESERVA_POR_JOB_MS,
  type DecisaoDaFila,
} from "@/lib/server/pipeline";

const semComentarios = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/\/\/[^\n]*/g, " ");
const PIPELINE = readFileSync(join(__dirname, "../pipeline.ts"), "utf-8");

describe("etapa162 · a decisão da fila cobre os TRÊS estados", () => {
  it.each([
    ["há vaga e há trabalho", { permitidos: 2, ativos: 0, pendentes: 3 }, "iniciar"],
    ["uma vaga livre de duas", { permitidos: 2, ativos: 1, pendentes: 3 }, "iniciar"],
    ["sem vaga, com gente em voo — esperar é legítimo", { permitidos: 2, ativos: 2, pendentes: 3 }, "esperar"],
    ["fila vazia, ainda drenando", { permitidos: 2, ativos: 1, pendentes: 0 }, "esperar"],
    ["acabou tudo", { permitidos: 2, ativos: 0, pendentes: 0 }, "parar"],
    ["⚠️ O CASO QUE GIRAVA: saldo zerado, nada em voo, fila cheia", { permitidos: 0, ativos: 0, pendentes: 3 }, "parar"],
    ["saldo zerado mas ainda há job em voo: espera quem já começou", { permitidos: 0, ativos: 1, pendentes: 3 }, "esperar"],
    ["concorrência 0 (defensivo) não vira laço quente", { permitidos: 0, ativos: 0, pendentes: 1 }, "parar"],
  ] as Array<[string, { permitidos: number; ativos: number; pendentes: number }, DecisaoDaFila]>)(
    "%s → %s", (_n, estado, esperado) => {
      expect(decisaoDaFila(estado)).toBe(esperado);
    },
  );

  it("⚠️ INVARIANTE: não existe estado que devolva «esperar» sem ter o que esperar", () => {
    // `esperar` sem nada em voo é o laço quente vestido de decisão: o `await Promise.race([])`
    // de uma lista vazia nunca resolve, e a função fica pendurada igual.
    for (let permitidos = 0; permitidos <= 4; permitidos++) {
      for (let pendentes = 0; pendentes <= 4; pendentes++) {
        const d = decisaoDaFila({ permitidos, ativos: 0, pendentes });
        expect(d, `permitidos=${permitidos} pendentes=${pendentes}`).not.toBe("esperar");
      }
    }
  });

  it("⚠️ INVARIANTE: com saldo zerado a fila SEMPRE progride para um estado terminal", () => {
    // Varre o espaço inteiro de estados alcançáveis com permitidos=0: nenhum pode pedir
    // "iniciar" (não há vaga), e os que não têm ninguém em voo têm de PARAR.
    for (let ativos = 0; ativos <= 4; ativos++) {
      for (let pendentes = 0; pendentes <= 20; pendentes++) {
        const d = decisaoDaFila({ permitidos: 0, ativos, pendentes });
        expect(d, `ativos=${ativos} pendentes=${pendentes}`).not.toBe("iniciar");
        if (ativos === 0) expect(d, `ativos=0 pendentes=${pendentes}`).toBe("parar");
      }
    }
  });
});

describe("etapa162 · a aritmética que produz `permitidos = 0`", () => {
  it("o saldo abaixo da reserva de UM job já zera as vagas — não é só saldo negativo", () => {
    expect(jobsPermitidos(RESERVA_POR_JOB_MS - 1, 2)).toBe(0);
    expect(jobsPermitidos(0, 2)).toBe(0);
    expect(jobsPermitidos(-5_000, 2)).toBe(0);
    // …e o estado que isso produz é justamente o que girava.
    expect(decisaoDaFila({ permitidos: jobsPermitidos(5_000, 2), ativos: 0, pendentes: 3 })).toBe("parar");
  });

  it("com saldo folgado as vagas voltam — a parada é do saldo, não um freio permanente", () => {
    expect(jobsPermitidos(RESERVA_POR_JOB_MS * 2, 2)).toBe(2);
    expect(decisaoDaFila({ permitidos: 2, ativos: 0, pendentes: 3 })).toBe("iniciar");
  });
});

describe("etapa162 · comportamento: a fila sem saldo RETORNA, e sem tocar em nenhum job", () => {
  it("⚠️ saldo abaixo da reserva + fila cheia → volta com 0 iniciado, em milissegundos", async () => {
    // Antes do conserto esta chamada NUNCA retornava — pendurava o processo. Nenhum job é
    // iniciado, então `processPdf` (e o Supabase) não são tocados: o caso é seguro por
    // construção, e é exatamente o cenário de produção.
    const t0 = Date.now();
    const iniciados = await processQueue(
      [{ jobId: "a" }, { jobId: "b" }, { jobId: "c" }],
      2,
      Date.now() + 5_000, // 5s de saldo contra 13s de reserva por job
    );
    expect(iniciados).toBe(0);
    expect(Date.now() - t0, "voltou devagar demais para ser a saída direta").toBeLessThan(1_000);
  });

  it("fila vazia é no-op — a guarda nova não introduziu trabalho", async () => {
    expect(await processQueue([], 2, Date.now() + 60_000)).toBe(0);
    expect(await processQueue([])).toBe(0);
  });
});

describe("etapa162 · a forma que travava não pode voltar", () => {
  const CODIGO = semComentarios(PIPELINE);

  it("⚠️ a saída não mora mais dentro de um laço aninhado inalcançável", () => {
    expect(CODIGO).not.toMatch(/while \(active\.length < permitidos/);
    expect(CODIGO).toMatch(/const decisao = decisaoDaFila\(/);
    expect(CODIGO).toMatch(/if \(decisao === "parar"\) break;/);
  });

  it("⚠️ todo caminho que NÃO para tem um `await` ou consome a fila — nenhum gira em falso", () => {
    // O ramo "esperar" aguarda; o ramo "iniciar" ou tira um job da fila (`queue.shift()`) ou a
    // zera (`queue.length = 0`). Sem uma dessas três, a volta seguinte seria idêntica à anterior:
    // é essa identidade que define o laço quente.
    const laco = CODIGO.slice(CODIGO.indexOf("for (;;)"), CODIGO.indexOf("return started;"));
    expect(laco).toMatch(/await Promise\.race\(active\)/);
    expect(laco).toMatch(/queue\.shift\(\)/);
    expect(laco).toMatch(/queue\.length = 0/);
    expect(laco).toMatch(/break;/);
  });

  it("`permitidos` é recalculado a cada volta — saldo velho decidiria sobre relógio novo", () => {
    const laco = CODIGO.slice(CODIGO.indexOf("for (;;)"), CODIGO.indexOf("return started;"));
    expect(laco).toMatch(/const permitidos = deadlineAt !== undefined/);
  });
});
