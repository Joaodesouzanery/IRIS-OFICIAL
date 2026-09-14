/**
 * Etapa 146 (Fase 27, commit 3) — pauta de ano encerrado não entra na fila.
 *
 * qa-fase26 ④: dos 10 documentos presos no parser, SETE eram pautas da ANM de 2023-2024 (52ª,
 * 53ª, 54ª, 59ª, 61ª ROP; 26ª REP; 27ª ROP). Pauta é agenda — o `ata-splitter` proíbe
 * materializar item de pauta e o confirm a arquiva como apoio: baixar, parsear e travar a rodada
 * produzia exatamente nada. Só PAUTA; ata/deliberação/voto de qualquer ano continuam entrando.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";
import { pautaForaDoAno, anoNoTexto } from "@/lib/server/pauta-fora-do-ano";

const ANO = 2026;

describe("etapa146 · a regra", () => {
  it("pauta com data de ano encerrado → fora", () => {
    expect(pautaForaDoAno({ tipo: "pauta", data_reuniao: "2023-07-26" }, ANO)).toBe(true);
  });
  it("pauta do ano corrente (ou futuro) → entra", () => {
    expect(pautaForaDoAno({ tipo: "pauta", data_reuniao: "2026-04-10" }, ANO)).toBe(false);
    expect(pautaForaDoAno({ tipo: "pauta", data_reuniao: "2027-01-05" }, ANO)).toBe(false);
  });
  it("sem data: o ano do TÍTULO decide — os nomes reais dos presos", () => {
    expect(pautaForaDoAno({ tipo: "pauta", titulo: "52-ROP-26-07-2023-Pauta-RETIFICADA" }, ANO)).toBe(true);
    expect(pautaForaDoAno({ tipo: "pauta", titulo: "PAUTA-DA-53-ROP-05-09-2023 atualizado em 31-10-2024" }, ANO)).toBe(true);
    expect(pautaForaDoAno({ tipo: "pauta", url_item: "https://gov.br/anm/pauta-2024-rop.pdf" }, ANO)).toBe(true);
  });
  it("sem data e SEM ano nenhum → entra (na dúvida, processa)", () => {
    expect(pautaForaDoAno({ tipo: "pauta", titulo: "pauta-59a-rop.pdf" }, ANO)).toBe(false);
  });
  it("ATA, deliberação e voto de 2023 CONTINUAM entrando — acervo não é agenda", () => {
    for (const tipo of ["ata", "deliberacao", "voto", "documento"]) {
      expect(pautaForaDoAno({ tipo, data_reuniao: "2023-07-26" }, ANO), tipo).toBe(false);
    }
  });
  it("o ano lido é o MAIOR do texto (título retificado carrega dois)", () => {
    expect(anoNoTexto("52-ROP-26-07-2023 atualizado em 31-10-2024")).toBe(2024);
    expect(anoNoTexto("sem ano aqui")).toBeNull();
  });
});

describe("etapa146 · o enqueue arquiva antes de baixar, e o número chega ao banner", () => {
  const RAIZ = join(__dirname, "../../../..");
  const ler = (p: string) => readFileSync(join(RAIZ, p), "utf-8");
  it("a rota arquiva com motivo próprio e tira o item dos candidatos", () => {
    const rota = ler("src/app/api/v1/deliberacoes/enqueue-pdfs/route.ts");
    expect(rota).toMatch(/enqueue_motivo: "pauta_fora_do_ano"/);
    expect(rota).toMatch(/\.filter\(\(it: any\) => !idsForaDoAno\.has\(String\(it\.id\)\)\)/);
    // Antes do laço de download: o ponto todo é não baixar.
    expect(rota.indexOf("pauta_fora_do_ano")).toBeLessThan(rota.indexOf("const novosCandidatos"));
  });
  it("pipeline e tela leem o contador", () => {
    expect(ler("src/app/api/v1/pipeline/run/route.ts")).toMatch(/pautasForaDoAno \+= Number\(r\.body\?\.pautas_fora_do_ano/);
    expect(ler("src/app/dashboard/deliberacoes/votos-diretores/page.tsx")).toMatch(/totais\.pautas_fora_do_ano/);
  });
});
