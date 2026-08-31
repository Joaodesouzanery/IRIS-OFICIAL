/**
 * Etapa 93 (Fase 16, commit A) — a esteira que TERMINA.
 *
 * ═══ O defeito central (medido em produção: 27min ÷ 40 rodadas = 40,5s/rodada num orçamento
 * de 70s — ~20min de orçamento devolvidos sem uso POR RUN) ═══
 *
 * É a TERCEIRA variação da mesma classe:
 *   · Fase 7  — fatia MENOR que a reserva (gate 8s × reserva 25s): zero itens por rodada;
 *   · Fase 10 — fatia SEM TETO: a cabeça comia a rodada e a cauda nunca alcançava o portão;
 *   · Fase 16 — fatia IGUAL à reserva: o plano enche o orçamento até a borda (64,3s de 66s) e a
 *     proteção entrega à aprovação exatamente RESERVA. A sub-rota checa
 *     `hasBudget(deadline, RESERVA)` ANTES da primeira unidade — com milissegundos já gastos, a
 *     checagem falha na primeira iteração: confirmados=0, materializados=0, restantes=true, todo
 *     round-trip pago. `restantes` nunca vira falso, a run nunca declara "drenou", e o que para
 *     é o teto de 25min do cliente.
 *
 * `MARGEM_PARTIDA_MS` fecha o terceiro lado: o custo de planejar um passo é RESERVA+MARGEM, a
 * fatia entregue é no mínimo RESERVA+MARGEM, e a primeira checagem interna da sub-rota passa.
 *
 * ═══ Os outros dois consertos deste commit ═══
 * · Coleta 1× por RUN: `monitoramento/check` é crawl real de ~25s SEM caminho rápido — rodava
 *   12× por run (~5min) mesmo sem novidade nenhuma. Com `tentou_coleta` acumulado nos
 *   contadores, a mesma execução não re-crawleia.
 * · "Não tentado" é por RUN, não por rodada: o plano só comporta 5-8 de 14 passos, então
 *   "não tentado NESTA rodada" força ≥14 rodadas até com tudo vazio (~3-5min para nada). O
 *   conjunto de tentados agora acumula na run (`tentou_<passo>`), e a fase de verificação acaba
 *   quando TODOS já tiveram a vez — ~3-4 rodadas numa run vazia.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";
import {
  RESERVA,
  TETO_FATIA,
  MARGEM_PARTIDA_MS,
  FOLGA_ORQUESTRADOR_MS,
  planejarRodada,
  fatiaDoPasso,
  podeRodar,
  ORDEM_DOS_PASSOS,
  type PassoEsteira,
} from "@/lib/server/esteira-reservas";
import { contarPassos } from "@/lib/server/esteira-run";
import { HOBBY_BUDGET_MS } from "@/lib/server/time-budget";

const RAIZ = join(__dirname, "../../../..");
const RUN = readFileSync(join(RAIZ, "src/app/api/v1/pipeline/run/route.ts"), "utf-8");
const CODIGO = RUN.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/\/\/.*$/gm, " ");
const ORCAMENTO = HOBBY_BUDGET_MS - FOLGA_ORQUESTRADOR_MS;

describe("etapa93 · fatia NUNCA é igual à reserva — o terceiro lado da classe", () => {
  it("MARGEM_PARTIDA existe e é maior que o custo real de partida (~1-3s de auth+import)", () => {
    expect(MARGEM_PARTIDA_MS).toBeGreaterThanOrEqual(2_000);
    expect(MARGEM_PARTIDA_MS).toBeLessThanOrEqual(FOLGA_ORQUESTRADOR_MS);
  });

  it("REPRODUÇÃO do bug: em 28 rodadas simuladas, todo passo planejado recebe fatia ESTRITAMENTE maior que a reserva", () => {
    // Antes do conserto, o plano enchia o orçamento e `saldo − proteção` caía EXATAMENTE em
    // RESERVA para os passos do meio (confirmLote recebia 15000 cravado na maioria das rodadas).
    for (let rodada = 0; rodada < 28; rodada++) {
      const { passos, protecao } = planejarRodada(rodada, ORCAMENTO);
      for (const p of passos) {
        const fatia = fatiaDoPasso(p, ORCAMENTO, protecao[p] ?? 0);
        expect(fatia, `rodada ${rodada}, passo «${p}»: fatia ${fatia} == reserva ${RESERVA[p]}`)
          .toBeGreaterThanOrEqual(RESERVA[p] + MARGEM_PARTIDA_MS);
      }
    }
  });

  it("podeRodar e a fatia saem da MESMA régua — com a margem dos dois lados", () => {
    for (const p of Object.keys(RESERVA) as PassoEsteira[]) {
      // Saldo exatamente na reserva: NÃO pode rodar (rodar seria o bug).
      expect(podeRodar(p, RESERVA[p], 0), `«${p}» com saldo==reserva`).toBe(false);
      // Saldo com a margem: pode.
      expect(podeRodar(p, RESERVA[p] + MARGEM_PARTIDA_MS, 0), `«${p}» com margem`).toBe(true);
    }
  });

  it("o guard interno do call() também exige a margem", () => {
    expect(CODIGO).toMatch(/if \(slice < RESERVA\[passo\] \+ MARGEM_PARTIDA_MS\)/);
  });

  it("o TETO continua sendo o teto de TRABALHO — a margem é entregue por cima dele", () => {
    // TETO_FATIA.coleta === RESERVA.coleta (etapa68) continua verdadeiro; a margem vive em
    // fatiaDoPasso, não numa reescrita de todos os tetos.
    expect(TETO_FATIA.coleta).toBe(RESERVA.coleta);
    expect(fatiaDoPasso("coleta", 1_000_000, 0)).toBe(TETO_FATIA.coleta + MARGEM_PARTIDA_MS);
  });
});

describe("etapa93 · coleta roda UMA vez por execução", () => {
  it("o gate lê `tentou_coleta` dos contadores da run", () => {
    expect(CODIGO).toMatch(/tentou_coleta/);
    expect(CODIGO).toMatch(/cabe\("coleta"\) && !coletaJaFeitaNaRun/);
  });

  it("quando pula, DIZ por quê — não some do relatório", () => {
    expect(RUN).toMatch(/coleta (?:já rodou|1× por)/i);
  });
});

describe("etapa93 · «não tentado» é por RUN — a verificação acaba quando todos tiveram a vez", () => {
  it("call() registra o passo tentado da rodada", () => {
    expect(CODIGO).toMatch(/tentadosNaRodada\.add\(passo\)/);
  });

  it("o conjunto persiste na run via contadores `tentou_<passo>`", () => {
    expect(CODIGO).toMatch(/etapas\._tentativas/);
    expect(CODIGO).toMatch(/`tentou_\$\{/);
  });

  it("naoTentados = ORDEM − (tentados nesta rodada ∪ tentados na run)", () => {
    expect(CODIGO).toMatch(/ORDEM_DOS_PASSOS\.filter\(\s*\(p\) =>\s*!tentadosNaRodada\.has\(p\) && \(execucao\?\.contadores\?\.\[`tentou_\$\{p\}`\] \?\? 0\) === 0/);
    expect(CODIGO).toMatch(/passosNaoTentados: passosNaoTentadosNaRun/);
  });

  it("contarPassos IGNORA a etapa sintética — o disjuntor não ganha amostra falsa", () => {
    expect(contarPassos({ _tentativas: { tentou_coleta: 1, tentou_extracao: 1 } })).toEqual({ ok: 0, erro: 0 });
    // E o comportamento para etapas reais continua o mesmo.
    expect(contarPassos({ a: { ok: true }, _tentativas: { tentou_coleta: 1 } })).toEqual({ ok: 1, erro: 0 });
  });
});
