/**
 * Etapa 140 (Fase 26, commit 2) — a extração não deixa documento em "processing" para sempre.
 *
 * ═══ Medido antes ═══
 * As 6 atas reais da ANM: ≤152 streams (guarda de 500 folgado) e `pdf-parse` em < 100 ms cada.
 * NÃO são as atas que travam. O que trava é o desenho: concorrência fixa (4) com checagem de
 * orçamento POR JOB — com 9s de saldo, quatro jobs começavam juntos, o SIGKILL vinha no meio e
 * deixava doc e job em "processing" (os "ANM: processing ×3" da tela). E o reprocesso desistia
 * na 3ª tentativa em silêncio.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";
import { jobsPermitidos, RESERVA_POR_JOB_MS } from "@/lib/server/pipeline";

describe("etapa140 · o saldo cobre CADA job em voo", () => {
  it.each([
    [50_000, 4, 4],   // fatia cheia: os 4
    [20_000, 4, 2],   // 20s / 9s → 2, não 4
    [9_000, 4, 1],    // exatamente uma reserva → 1
    [8_999, 4, 0],    // menos que uma reserva → nenhum
    [0, 4, 0],
    [-1_000, 4, 0],
    [100_000, 1, 1],  // concorrência é o teto
  ])("restante=%ims concorrência=%i → %i job(s)", (restante, conc, esperado) => {
    expect(jobsPermitidos(restante, conc)).toBe(esperado);
  });
  it("a reserva é a mesma da parada por job (uma fonte)", () => {
    expect(RESERVA_POR_JOB_MS).toBe(9_000);
  });
});

describe("etapa140 · o job que estoura a fatia vira `failed` com motivo, não `processing` eterno", () => {
  const RAIZ = join(__dirname, "../../../..");
  const pipeline = readFileSync(join(RAIZ, "src/lib/server/pipeline.ts"), "utf-8");
  it("a análise corre contra o deadline e o estouro cai no catch (que grava failed)", () => {
    expect(pipeline).toMatch(/Promise\.race\(\[\s*analyzeUploadPdf\(/);
    expect(pipeline).toMatch(/Excedeu a fatia de extração \(/);
    expect(pipeline).toMatch(/const permitidos = deadlineAt !== undefined \? jobsPermitidos\(/);
  });
  it("o abandono após 3 ciclos chega ao banner", () => {
    const tela = readFileSync(join(RAIZ, "src/app/dashboard/deliberacoes/votos-diretores/page.tsx"), "utf-8");
    expect(tela).toMatch(/totais\.desistidos_apos_3_ciclos/);
  });
});
