/**
 * Etapa 118 (Fase 20, commit 5) — a ANTT volta a coletar: reserva por LAÇO, não uma para tudo.
 *
 * ═══ O bug, em aritmética ═══
 * `ANTT_UNIT_RESERVE_MS = 25_000` era exigido nos QUATRO laços do coletor — inclusive para baixar
 * uma **listagem HTML** de 227 KB, que custa 1-3 s. A fatia real da coleta é 28 s
 * (`TETO_FATIA.coleta` = `RESERVA.coleta` = 25 s, mais `MARGEM_PARTIDA_MS` = 3 s).
 *
 * Um item da ANTT só nasce depois de DUAS unidades: a página de LISTAGEM e a página da REUNIÃO.
 * Com 25 s de reserva cabe UMA — a listagem consome, e o laço das reuniões quebra na primeira
 * iteração. Resultado medido em produção: **`itens_encontrados: 0`, `status: ok`**, rodada após
 * rodada, na única agência que nomina voto individual.
 *
 * ═══ Por que isso importa mais que qualquer outro ganho de velocidade ═══
 * ARTESP e ANM nunca nominam voto (a ata diz "aprovado por unanimidade dos presentes"); a ANTT
 * publica o voto de CADA diretor em PDF próprio. Enquanto a coleta dela devolve zero, o dado mais
 * escasso do corpus não entra — e nenhum conserto a jusante inventa o que não foi coletado.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";
import {
  ANTT_LISTAGEM_RESERVE_MS,
  ANTT_UNIT_RESERVE_MS,
} from "@/lib/server/antt-2026-collector";
import { RESERVA, TETO_FATIA, MARGEM_PARTIDA_MS } from "@/lib/server/esteira-reservas";

const RAIZ = join(__dirname, "../../../..");
const COLETOR = readFileSync(join(RAIZ, "src/lib/server/antt-2026-collector.ts"), "utf-8")
  .replace(/\/\*[\s\S]*?\*\//g, " ").replace(/\/\/.*$/gm, " ");

/** A fatia que o passo `coleta` recebe de verdade, com as constantes reais da esteira. */
const FATIA_DA_COLETA = TETO_FATIA.coleta + MARGEM_PARTIDA_MS;

describe("etapa118 · COMPORTAMENTO: a fatia comporta as DUAS unidades que um item exige", () => {
  it("com a reserva de listagem, cabem ≥ 2 buscas de HTML — que é o mínimo para nascer um item", () => {
    // Listagem + página da reunião. É a aritmética exata do "0 itens, status ok".
    expect(FATIA_DA_COLETA / ANTT_LISTAGEM_RESERVE_MS).toBeGreaterThanOrEqual(2);
  });

  it("…e com a reserva antiga cabia UMA — o bug, expresso em número", () => {
    expect(FATIA_DA_COLETA / ANTT_UNIT_RESERVE_MS).toBeLessThan(2);
  });

  it("a reserva de listagem é compatível com o custo real de um fetch de HTML", () => {
    // 227 KB pelo throttle de 800 ms: 1-3 s. 6 s dá folga de 2× sem ser generoso a ponto de
    // deixar um fetch travado consumir a rodada.
    expect(ANTT_LISTAGEM_RESERVE_MS).toBeGreaterThanOrEqual(4_000);
    expect(ANTT_LISTAGEM_RESERVE_MS).toBeLessThanOrEqual(10_000);
  });

  it("o DOWNLOAD continua caro — a separação é entre HTML e PDF, não um afrouxamento geral", () => {
    // Baixar PDF tem timeout de 20 s: rebaixar essa reserva reintroduziria o SIGKILL.
    expect(ANTT_UNIT_RESERVE_MS).toBeGreaterThanOrEqual(RESERVA.coleta);
  });
});

describe("etapa118 · cada laço usa a reserva do SEU custo", () => {
  it("os laços de LISTAGEM e de REUNIÃO (fetch de HTML) usam a reserva barata", () => {
    const listagem = COLETOR.slice(COLETOR.indexOf("while (listingQueue.length > 0"));
    expect(listagem.slice(0, 300)).toMatch(/hasBudget\(deadlineAt, ANTT_LISTAGEM_RESERVE_MS\)/);
    // O segundo laço — o que de fato produz `meetings` — também.
    expect((listagem.match(/ANTT_LISTAGEM_RESERVE_MS/g) ?? []).length).toBeGreaterThanOrEqual(2);
  });

  it("os laços que BAIXAM documento mantêm a reserva cara", () => {
    const coleta = COLETOR.slice(
      COLETOR.indexOf("for (const meeting of meetings)"),
      COLETOR.indexOf("while (listingQueue.length > 0"),
    );
    expect(coleta).toMatch(/hasBudget\(deadlineAt, ANTT_UNIT_RESERVE_MS\)/);
    expect(coleta).not.toMatch(/ANTT_LISTAGEM_RESERVE_MS/);
  });
});
