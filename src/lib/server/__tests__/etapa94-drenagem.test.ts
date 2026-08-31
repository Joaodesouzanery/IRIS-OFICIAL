/**
 * Etapa 94 (Fase 16, commit B) — vazão de extração + drenagem condicional.
 *
 * ═══ A medição ═══
 * A run real: extração planejada em só 20 de 40 rodadas (alternância da cauda), ~11 docs por
 * rodada planejada, e ~29s de orçamento devolvidos SEM USO por rodada. 145 docs de backlog =
 * ~27 min. Simulado: teto de fatia da extração +30s ⇒ ~16 rodadas; com viés de drenagem ⇒ ~8-10.
 *
 * ═══ As três alavancas (e a que NÃO mexemos) ═══
 * 1. TETO_FATIA.extracao: RESERVA+10s → RESERVA+30s — converte o ocioso em extração; a fatia
 *    continua auto-limitada por `saldo − proteção`, então ninguém é canibalizado.
 * 2. Partida do processQueue: 12s → 9s; concorrência do lote da esteira: 3 → 4.
 * 3. Viés de DRENAGEM no planejador: com fila > 0 (1 count head:true, ~50ms), `extracao` é
 *    semeada À FRENTE em toda rodada — e SÓ ela: semear também autoConfirm+confirmLote custaria
 *    50s dos 66s e a coleta (28s de custo) nunca mais caberia — inanição da ingestão, simulada.
 * `limit=20` NÃO muda: hoje o orçamento corta antes dele (pinado nas etapas 72/73/74).
 *
 * ═══ Determinismo (lição C16) ═══
 * `planejarRodada` é pura; a simulação usa rodadas fixas 0..27, sem sorteio. Mutações exigidas:
 * reverter o viés derruba a asserção de frequência da extração; semear os três derruba a
 * salvaguarda de coleta/enqueue. Ambas verificadas manualmente antes do commit.
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
} from "@/lib/server/esteira-reservas";
import { HOBBY_BUDGET_MS } from "@/lib/server/time-budget";

const RAIZ = join(__dirname, "../../../..");
const ler = (p: string) => readFileSync(join(RAIZ, p), "utf-8");
const RUN = ler("src/app/api/v1/pipeline/run/route.ts");
const PIPELINE = ler("src/lib/server/pipeline.ts");
const CODIGO_RUN = RUN.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/\/\/.*$/gm, " ");
const ORCAMENTO = HOBBY_BUDGET_MS - FOLGA_ORQUESTRADOR_MS;
const RODADAS = Array.from({ length: 28 }, (_, i) => i);

describe("etapa94 · o teto da extração absorve o orçamento ocioso", () => {
  it("TETO_FATIA.extracao = reserva + 30s", () => {
    expect(TETO_FATIA.extracao).toBe(RESERVA.extracao + 30_000);
  });

  it("numa rodada de drenagem, a extração recebe fatia de verdade — não o mínimo", () => {
    const { passos, protecao } = planejarRodada(0, ORCAMENTO, { drenar: true });
    expect(passos.has("extracao")).toBe(true);
    const fatia = fatiaDoPasso("extracao", ORCAMENTO, protecao.extracao ?? 0);
    // Antes: teto RESERVA+10s = 30s. Agora ela pode ir bem além quando o plano da rodada deixa.
    expect(fatia).toBeGreaterThan(RESERVA.extracao + 10_000 + MARGEM_PARTIDA_MS);
  });
});

describe("etapa94 · drenagem condicional — extração à frente quando HÁ fila", () => {
  it("com fila, a extração entra em QUASE toda rodada (era ~metade, pela alternância)", () => {
    const comViés = RODADAS.filter((r) => planejarRodada(r, ORCAMENTO, { drenar: true }).passos.has("extracao"));
    expect(comViés.length).toBeGreaterThanOrEqual(24); // 28 rodadas; sem o viés dá ~14
  });

  it("SALVAGUARDA (fila que NUNCA esvazia): a ingestão não afoga", () => {
    // O cenário da ARTESP: 140 pendentes, drenagem permanente. A barra original ("≥ 1/4 das
    // rodadas") caiu na CALIBRAÇÃO: até o planejador NORMAL dá coleta 6/28 e enqueue 5/28 — a
    // barra reprovaria o baseline. E com a coleta 1× por RUN (etapa93), a frequência dela no
    // plano quase não importa; o que importa é (a) ela ser planejada CEDO — a única coleta da
    // run não pode esperar 20 rodadas — e (b) o enqueue manter piso, senão item novo nunca vira
    // job. Pisos medidos: drenagem dá coleta 3/28 (1ª na rodada 3) e enqueue 4/28; a MUTAÇÃO
    // "semear também autoConfirm+confirmLote" ZERA os dois — é ela que esta guarda mata.
    const planos = RODADAS.map((r) => planejarRodada(r, ORCAMENTO, { drenar: true }).passos);
    const comColeta = RODADAS.filter((r) => planos[r].has("coleta"));
    const comEnqueue = RODADAS.filter((r) => planos[r].has("enqueue"));
    expect(comColeta.length, "coleta afogada pela drenagem").toBeGreaterThanOrEqual(3);
    expect(comColeta[0], "a única coleta da run não pode chegar tarde").toBeLessThanOrEqual(4);
    expect(comEnqueue.length, "enqueue afogado pela drenagem").toBeGreaterThanOrEqual(4);
  });

  it("sem fila, o viés NÃO existe: drenar:false ≡ chamada sem opções, rodada a rodada", () => {
    for (const r of RODADAS) {
      const semOpcao = planejarRodada(r, ORCAMENTO);
      const explicito = planejarRodada(r, ORCAMENTO, { drenar: false });
      expect([...explicito.passos].sort()).toEqual([...semOpcao.passos].sort());
      expect(explicito.protecao).toEqual(semOpcao.protecao);
    }
  });

  it("a drenagem não quebra a garantia-mãe: nenhum passo planejado nasce sem fatia", () => {
    for (const r of RODADAS) {
      const { passos, protecao } = planejarRodada(r, ORCAMENTO, { drenar: true });
      for (const p of passos) {
        expect(fatiaDoPasso(p, ORCAMENTO, protecao[p] ?? 0), `rodada ${r}, «${p}»`)
          .toBeGreaterThanOrEqual(RESERVA[p] + MARGEM_PARTIDA_MS);
      }
    }
  });
});

describe("etapa94 · o orquestrador mede a fila e passa o viés", () => {
  it("1 count head:true de upload_jobs pending, ANTES do plano", () => {
    expect(CODIGO_RUN).toMatch(/from\("upload_jobs"\)[\s\S]{0,120}?count: "exact", head: true/);
    expect(CODIGO_RUN).toMatch(/drenar: filaExtracao > 0/);
  });

  it("a fila medida viaja na resposta — a tela pode dizer o que falta", () => {
    expect(CODIGO_RUN).toMatch(/fila_extracao: filaExtracao/);
  });
});

describe("etapa94 · partida e concorrência do lote", () => {
  it("iniciar um job exige 9s, não 12 — e a concorrência do lote da esteira é 4", () => {
    expect(PIPELINE).toMatch(/hasBudget\(deadlineAt, 9_000\)/);
    expect(PIPELINE).not.toMatch(/hasBudget\(deadlineAt, 12_000\)/);
    expect(PIPELINE).toMatch(/processQueue\(selected, 4, deadlineAt\)/);
  });

  it("o enfileiramento em background continua com concorrência 2 (pinado na etapa75)", () => {
    const ENQ = ler("src/app/api/v1/deliberacoes/enqueue-pdfs/route.ts");
    expect(ENQ).toMatch(/processQueue\(jobsToProcess\.slice\(0, MAX_PER_RUN\), 2, deadlineAt\)/);
  });
});
