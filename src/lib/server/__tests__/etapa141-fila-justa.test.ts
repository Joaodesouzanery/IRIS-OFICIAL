/**
 * Etapa 141 (Fase 26, commit 3) — a fila de enfileiramento é justa por agência e por tipo.
 *
 * A janela única de 60 por `data_reuniao desc` deixava a ANM fora: 92 itens frescos da ANTT e as
 * 73 pautas da própria ANM enchiam a página antes das 3 atas — "detectadas e nunca baixadas".
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";
import { filaJusta, ordenarPorPrioridade, intercalar } from "@/lib/server/fila-justa";

const it_ = (agencia: string, tipo: string, n: number) => ({ id: `${agencia}-${tipo}-${n}`, agencia_id: agencia, tipo });

describe("etapa141 · a regra", () => {
  it("ata/deliberação/voto vêm antes de pauta, preservando a ordem (data desc) dentro do tipo", () => {
    const l = ordenarPorPrioridade([it_("ANM", "pauta", 1), it_("ANM", "pauta", 2), it_("ANM", "ata", 1), it_("ANM", "documento", 1), it_("ANM", "ata", 2)]);
    expect(l.map((x) => x.id)).toEqual(["ANM-ata-1", "ANM-ata-2", "ANM-documento-1", "ANM-pauta-1", "ANM-pauta-2"]);
  });

  it("round-robin: a agência com 3 itens não espera a que tem 60", () => {
    const antt = Array.from({ length: 60 }, (_, i) => it_("ANTT", "voto", i));
    const anm = [it_("ANM", "ata", 1), it_("ANM", "ata", 2), it_("ANM", "ata", 3)];
    const fila = filaJusta([...antt, ...anm]);
    const posAnm = fila.map((x, i) => (x.agencia_id === "ANM" ? i : -1)).filter((i) => i >= 0);
    expect(posAnm).toEqual([1, 3, 5]); // intercaladas nas primeiras seis posições
  });

  it("dentro da ANM, as atas passam na frente das 73 pautas", () => {
    const pautas = Array.from({ length: 73 }, (_, i) => it_("ANM", "pauta", i));
    const fila = filaJusta([...pautas, it_("ANM", "ata", 1), it_("ANM", "ata", 2), it_("ANM", "ata", 3)]);
    expect(fila.slice(0, 3).every((x) => x.tipo === "ata")).toBe(true);
  });

  it("intercalar preserva a ordem de cada lista", () => {
    expect(intercalar([[1, 3, 5], [2, 4], [6]])).toEqual([1, 2, 6, 3, 4, 5]);
  });
});

describe("etapa141 · a rota e o teto", () => {
  const RAIZ = join(__dirname, "../../../..");
  it("o enqueue monta uma janela POR agência colegiada e passa pela fila justa", () => {
    const rota = readFileSync(join(RAIZ, "src/app/api/v1/deliberacoes/enqueue-pdfs/route.ts"), "utf-8");
    expect(rota).toMatch(/const itens = filaJusta\(/);
    expect(rota).toMatch(/\.limit\(JANELA_POR_AGENCIA\)/);
    expect(rota).not.toMatch(/\.limit\(60\)/);
  });
  it("arquivar sem_pdf não consome o teto de vazão", () => {
    const run = readFileSync(join(RAIZ, "src/app/api/v1/pipeline/run/route.ts"), "utf-8");
    expect(run).toMatch(/const saldoTeto = TETO_ENQUEUE_POR_RODADA - enfileirados;/);
  });
});
