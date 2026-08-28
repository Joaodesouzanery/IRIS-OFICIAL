/**
 * Etapa 72 (Fase 10, commit 1) — a rodada passa a ser PLANEJADA.
 *
 * ═══ O bug ═══
 * A Fase 7 matou metade da classe: nenhum passo pode receber fatia MENOR que sua reserva. Faltava
 * a outra metade — **nenhum passo pode receber fatia SEM TETO**. `call()` fazia
 * `slice = msLeft − 4s` e `maxSliceMs` era OPCIONAL: 7 das 11 chamadas o omitiam, então quem vinha
 * primeiro levava o orçamento inteiro e a cauda nunca alcançava o próprio portão. Produção mediu:
 * **26 rodadas · 0 PDF extraído · 0 métrica**, com 62 documentos presos em `queued` — porque os
 * três reapers moram DENTRO da extração.
 *
 * ═══ Por que teto sozinho não bastava (e por que reservar a cauda era pior) ═══
 * A soma das reservas é ~128s contra 50s de orçamento: nenhum teto faz caber. E reservar a cauda
 * INVERTE o bug — simulado com os números reais, o `auto-confirm` toma o que sobra e o
 * `confirm-lote`, que é quem materializa, nunca roda.
 *
 * O que resolve é planejar: a rodada escolhe quem tenta, o privilégio da cauda ALTERNA, e a cabeça
 * gira com o número da rodada. A propriedade que importa não é um número — é **ninguém fica de
 * fora sempre**. Por isso o teste central abaixo SIMULA rodadas em vez de comparar constantes:
 * asserção que usa a própria constante mutada não pega mutação nenhuma (aconteceu aqui).
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";
import {
  RESERVA,
  TETO_FATIA,
  ORDEM_DOS_PASSOS,
  PASSOS_CAUDA,
  planejarRodada,
  fatiaDoPasso,
  podeRodar,
  type PassoEsteira,
} from "@/lib/server/esteira-reservas";
import { HOBBY_BUDGET_MS } from "@/lib/server/time-budget";

const RAIZ = join(__dirname, "../../../..");
const RUN = readFileSync(join(RAIZ, "src/app/api/v1/pipeline/run/route.ts"), "utf-8");
const PASSOS = Object.keys(RESERVA) as PassoEsteira[];

/** Executa uma rodada como o orquestrador executa: em ordem, cada passo tomando sua fatia. */
function simularRodada(rodada: number, orcamento: number) {
  const { passos, protecao } = planejarRodada(rodada, orcamento);
  let saldo = orcamento;
  const rodaram: PassoEsteira[] = [];
  const noPlanoMasSemSaldo: PassoEsteira[] = [];
  for (const passo of ORDEM_DOS_PASSOS) {
    if (!passos.has(passo)) continue;
    const prot = protecao[passo] ?? 0;
    if (!podeRodar(passo, saldo, prot)) { noPlanoMasSemSaldo.push(passo); continue; }
    saldo -= fatiaDoPasso(passo, saldo, prot);
    rodaram.push(passo);
  }
  return { rodaram, noPlanoMasSemSaldo, sobra: saldo };
}

describe("etapa72 · o plano da rodada", () => {
  it.each([50_000, 100_000, 240_000])("NINGUÉM fica de fora sempre — orçamento %ims", (orcamento) => {
    // A asserção central, e a única que não pode ser satisfeita mexendo numa constante.
    const vistos = new Set<PassoEsteira>();
    for (let r = 0; r < ORDEM_DOS_PASSOS.length * 2; r++) {
      for (const p of simularRodada(r, orcamento).rodaram) vistos.add(p);
    }
    const nunca = PASSOS.filter((p) => !vistos.has(p));
    expect(nunca, `passos que nunca rodam em ${ORDEM_DOS_PASSOS.length * 2} rodadas`).toEqual([]);
  });

  it.each([50_000, 100_000])("a CAUDA roda em pelo menos um terço das rodadas — orçamento %ims", (orcamento) => {
    // Era zero em 26 rodadas de produção. O número é fixo de propósito: derivá-lo do próprio
    // mecanismo faria o teste concordar com qualquer regressão.
    const total = 12;
    for (const passo of PASSOS_CAUDA) {
      let vezes = 0;
      for (let r = 0; r < total; r++) if (simularRodada(r, orcamento).rodaram.includes(passo)) vezes++;
      expect(vezes, `«${passo}» rodou ${vezes}/${total}`).toBeGreaterThanOrEqual(Math.ceil(total / 3));
    }
  });

  it.each([50_000, 100_000])("quem entra no plano CONSEGUE rodar — orçamento %ims", (orcamento) => {
    // Se um passo planejado fica sem saldo, é porque um anterior comeu a reserva dele: é
    // exatamente o bug, só que dentro do plano.
    for (let r = 0; r < 12; r++) {
      expect(simularRodada(r, orcamento).noPlanoMasSemSaldo, `rodada ${r}`).toEqual([]);
    }
  });

  it("o plano nunca promete mais reserva do que o orçamento comporta", () => {
    for (const orcamento of [20_000, 50_000, 100_000, 240_000]) {
      for (let r = 0; r < 12; r++) {
        const { passos } = planejarRodada(r, orcamento);
        const soma = [...passos].reduce((s, p) => s + RESERVA[p], 0);
        expect(soma, `rodada ${r} @ ${orcamento}ms`).toBeLessThanOrEqual(orcamento);
      }
    }
  });

  it("ORDEM_DOS_PASSOS cobre todos os passos com reserva — nenhum passo órfão", () => {
    // Um passo em RESERVA fora da ORDEM nunca seria planejado: código morto silencioso.
    expect([...ORDEM_DOS_PASSOS].sort()).toEqual([...PASSOS].sort());
  });
});

describe("etapa72 · nenhum passo recebe fatia sem teto", () => {
  it.each(PASSOS)("a fatia de «%s» nunca passa do teto dele", (passo) => {
    for (const saldo of [0, 10_000, HOBBY_BUDGET_MS, 300_000, 10_000_000]) {
      expect(fatiaDoPasso(passo, saldo)).toBeLessThanOrEqual(TETO_FATIA[passo]);
    }
  });

  it.each(PASSOS)("o teto de «%s» não é menor que a reserva dele", (passo) => {
    // Teto abaixo da reserva seria a Fase 7 de volta pela porta nova: o passo NUNCA rodaria.
    expect(TETO_FATIA[passo]).toBeGreaterThanOrEqual(RESERVA[passo]);
  });

  it("a proteção é respeitada: o passo não invade o que vem depois dele", () => {
    for (const passo of PASSOS) {
      for (const [saldo, prot] of [[50_000, 26_000], [30_000, 26_000], [100_000, 6_000]] as const) {
        const fatia = fatiaDoPasso(passo, saldo, prot);
        if (fatia > 0) expect(fatia + prot).toBeLessThanOrEqual(saldo);
      }
    }
  });

  it("podeRodar é falso exatamente quando a fatia não paga uma unidade de trabalho", () => {
    for (const passo of PASSOS) {
      for (const saldo of [0, 5_000, 20_000, 40_000, HOBBY_BUDGET_MS, 200_000]) {
        expect(podeRodar(passo, saldo)).toBe(fatiaDoPasso(passo, saldo) >= RESERVA[passo]);
      }
    }
  });

  it("saldo zero ou negativo não vira fatia positiva", () => {
    for (const passo of PASSOS) {
      expect(fatiaDoPasso(passo, 0)).toBe(0);
      expect(fatiaDoPasso(passo, -50_000)).toBe(0);
      expect(podeRodar(passo, 0)).toBe(false);
    }
  });
});

describe("etapa72 · o orquestrador não pode mais omitir o teto", () => {
  /**
   * Fonte SEM comentários e com espaços colapsados. Tirar os comentários primeiro não é
   * preciosismo — há explicação ENTRE os argumentos de uma das chamadas.
   */
  const PLANO = RUN.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/\/\/.*$/gm, " ").replace(/\s+/g, " ");

  /** Cada sub-rota chamada e o passo a que ela DEVE pertencer. Trocar um pelo outro é erro. */
  const ESPERADO: ReadonlyArray<readonly [string, PassoEsteira]> = [
    ["/api/v1/upload/auto-confirm", "autoConfirm"],
    ["/api/v1/upload/confirm-lote", "confirmLote"],
    ["/api/v1/admin/diretores/candidatos/recompute", "candidatos"],
    ["/api/v1/diretores/candidatos/aprovar-lote", "candidatos"],
    ["/api/v1/admin/votos/materializar-faltantes", "backfillVotos"],
    ["/api/v1/monitoramento/check", "coleta"],
    ["/api/v1/deliberacoes/enqueue-pdfs", "enqueue"],
    ["/api/v1/upload/process?apenas_reaper=1", "reaper"],
    ["/api/v1/upload/process?limit=20", "extracao"],
    ["/api/v1/admin/deliberacoes/dedup", "dedup"],
    ["/api/v1/admin/upload/reprocess-ignorados", "recuperacao"],
  ];

  it.each(ESPERADO)("«%s» é chamada como o passo «%s»", (rota, passo) => {
    // Validar só que o passo EXISTE deixaria passar trocar `dedup` por `derivada` — que é uma
    // chave legítima e a fatia errada. A rota tem de casar com o passo dela.
    // A query entra no casamento: `/upload/process` é chamada DUAS vezes, com passos diferentes
    // (`?apenas_reaper=1` → reaper, `?limit=20` → extracao). Casar só até o `?` pegaria a primeira.
    const escapada = rota.replace(/[/?=]/g, (c) => `\\${c}`);
    const re = new RegExp(`call\\( ?[A-Za-z]+, ?"${escapada}[^"]*", ?"([a-zA-Z]+)"`);
    const m = re.exec(PLANO);
    expect(m, `chamada a ${rota} não encontrada`).not.toBeNull();
    expect(m![1]).toBe(passo);
  });

  it("TODA chamada a call() declara um passo — não há mais fatia implícita", () => {
    const totalCalls = (PLANO.match(/await call\(/g) ?? []).length;
    const comPasso = [...PLANO.matchAll(/await call\( ?[A-Za-z]+, ?("[^"]*"|[A-Za-z]+), ?"([a-zA-Z]+)"/g)];
    expect(totalCalls).toBeGreaterThan(8);
    expect(comPasso.length, "há call() sem passo declarado").toBe(totalCalls);
    for (const m of comPasso) expect(PASSOS).toContain(m[2] as PassoEsteira);
  });

  it("o parâmetro de passo é OBRIGATÓRIO na assinatura", () => {
    // Enquanto foi opcional (`maxSliceMs?: number`), esquecê-lo era o padrão silencioso.
    expect(RUN).toMatch(/passo: PassoEsteira,/);
    expect(RUN).not.toMatch(/maxSliceMs\?: number/);
  });

  it("call() recusa fatia abaixo da reserva em vez de mandar budget_ms=0", () => {
    // `budgetFromRequest` trata 0 como ausente e a sub-rota abre um orçamento NOVO de 50s —
    // pior que não chamar.
    expect(RUN).toMatch(/if \(slice < RESERVA\[passo\]\) \{[\s\S]{0,160}?pulado: true/);
    // Fase 11 — `passosPulados` deixou de virar `restantes` numa linha solta: ele agora ALIMENTA
    // `deveContinuar`, junto com o trabalho relatado e os passos não-tentados. A propriedade
    // vigiada é a mesma: passo sem fatia tem de pedir outra rodada.
    expect(RUN).toMatch(/passosPulados,/);
    expect(RUN).toMatch(/deveContinuar\(\{/);
  });

  it("o que ficou fora do plano pede outra rodada", () => {
    expect(RUN).toMatch(/planoDaRodada\.size < ORDEM_DOS_PASSOS\.length\) restantes = true/);
  });

  it("todo passo passa pelo plano — nenhum gate solto", () => {
    expect(RUN).toMatch(/planejarRodada\(execucao\?\.rodadas \?\? 0, HOBBY_BUDGET_MS\)/);
    expect(RUN).toMatch(/planoDaRodada\.has\(passo\) && podeRodar\(passo, saldo\(\), protecao\[passo\] \?\? 0\)/);
    expect(RUN).not.toMatch(/Math\.max\(3_000, msLeft\(deadlineAt\) - 4_000\)/);
  });
});
