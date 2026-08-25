/**
 * Etapa 67 — a RELATORIA como métrica.
 *
 * O dado (`deliberacoes.relator`) é extraído e persistido nas três agências desde a migration 015
 * — e tinha ZERO consumidores de métrica. É o único eixo NOMINAL em 100% dos itens: com ele, o
 * perfil do diretor nasce PREENCHIDO mesmo em agência com 0% de cobertura de dissenso.
 * (Ordem desta fase decidida pelo usuário: relatoria ANTES das famílias, exatamente para que a
 * família "Carga e desfecho" não nasça vazia para ANTT/ARTESP.)
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { computeRelatoria, contarRelatoriasPorDiretor, limparRelator } from "@/lib/server/relatoria";
import { parseAnttMeetingPage } from "@/lib/server/antt-2026-collector";

const fixturesAntt = join(dirname(fileURLToPath(import.meta.url)), "fixtures/antt");

const DIRETOR = { id: "d1", nome: "Felipe Fernandes Queiroz", nome_variantes: ["Felipe Queiroz"] };

describe("etapa67 · limparRelator — o cargo colado não pode derrubar o match", () => {
  it.each([
    ["DIRETOR-GERAL MAURO HENRIQUE MOREIRA SOUSA", "MAURO HENRIQUE MOREIRA SOUSA"],
    ["Diretor Substituto Fábio Fernando Borges", "Fábio Fernando Borges"],
    ["Relator: Roger Romão Cabral", "Roger Romão Cabral"],
    ["DIRETOR FELIPE QUEIROZ", "FELIPE QUEIROZ"],
  ])("«%s» → «%s»", (bruto, esperado) => {
    expect(limparRelator(bruto)).toBe(esperado);
  });

  it("«Diretoria DIR-RC» (ARTESP) não é pessoa — devolve null em vez de atribuir", () => {
    expect(limparRelator("Diretoria DIR-RC")).toBeNull();
    expect(limparRelator("DIR-RC")).toBeNull();
    expect(limparRelator(null)).toBeNull();
  });
});

describe("etapa67 · computeRelatoria — disciplina de denominador (etapa60)", () => {
  const delibs = [
    { relator: "DIRETOR FELIPE QUEIROZ", resultado: "Aprovado" },
    { relator: "DIRETOR FELIPE QUEIROZ", resultado: "Indeferido" },
    { relator: "DIRETOR FELIPE QUEIROZ", resultado: "Retirado de Pauta" },
    // Admissibilidade com resultado positivo: NÃO entra em nenhum lado da taxa.
    { relator: "DIRETOR FELIPE QUEIROZ", resultado: "Deferido", juizo_raw: "admissibilidade" },
    { relator: "DIRETOR ALESSANDRO BAUMGARTNER", resultado: "Aprovado" }, // de OUTRO relator
  ];

  it("conta relatadas, separa os estados, e a taxa divide pelo MÉRITO", () => {
    const r = computeRelatoria(delibs, DIRETOR);
    expect(r.relatadas).toBe(4);
    expect(r.decididas, "retirado e admissibilidade fora do denominador").toBe(2);
    expect(r.deferidas).toBe(1);
    expect(r.retiradas).toBe(1);
    expect(r.taxa_deferimento).toBe(50);
  });

  it("sem base decidida, a taxa é null — nunca 0 fabricado", () => {
    const r = computeRelatoria([{ relator: "DIRETOR FELIPE QUEIROZ", resultado: "Retirado de Pauta" }], DIRETOR);
    expect(r.relatadas).toBe(1);
    expect(r.taxa_deferimento).toBeNull();
  });

  it("a VARIANTE casa: «Felipe Queiroz» atribui ao cadastro completo", () => {
    const r = computeRelatoria([{ relator: "Diretor Felipe Queiroz", resultado: "Aprovado" }], DIRETOR);
    expect(r.relatadas).toBe(1);
  });

  it("relator distante NÃO é atribuído — abaixo de 0.85 não se chuta", () => {
    const r = computeRelatoria([{ relator: "DIRETOR JOSÉ ROBERTO CAMPOS", resultado: "Aprovado" }], DIRETOR);
    expect(r.relatadas).toBe(0);
  });
});

describe("etapa67 · contarRelatoriasPorDiretor — uma matéria, UM relator", () => {
  it("atribui ao MELHOR match, nunca a dois diretores ao mesmo tempo", () => {
    const dirs = [
      DIRETOR,
      { id: "d2", nome: "Felipe Fernandes de Queiroz Santos", nome_variantes: [] },
    ];
    const contagem = contarRelatoriasPorDiretor(
      [{ relator: "DIRETOR FELIPE FERNANDES QUEIROZ", resultado: "Aprovado" }],
      dirs,
    );
    const total = [...contagem.values()].reduce((s, n) => s + n, 0);
    expect(total, "a mesma matéria contada para dois relatores infla o volume").toBe(1);
  });
});

describe("etapa67 · contra a FIXTURE REAL — a 1036ª RD da ANTT tem relator por item", () => {
  it("os relatores nominais da página real são atribuíveis", () => {
    const html = readFileSync(join(fixturesAntt, "reuniao-1036-diretoria.html"), "utf-8");
    const m = parseAnttMeetingPage(html, "https://portal.antt.gov.br/reuniao/x",
      "1036ª Reunião de Diretoria", "https://portal.antt.gov.br/", "<html></html>");
    const relatores = (m?.processos ?? []).map((p) => p.relator).filter(Boolean) as string[];
    expect(relatores.length, "a fixture tem relator por item").toBeGreaterThan(4);

    // O que o parser extrai ("DIRETOR-GERAL GUILHERME SAMPAIO", "DIRETOR FELIPE QUEIROZ") vira
    // relatoria atribuível depois do limparRelator + match com o cadastro real da ANTT.
    const cadastro = [
      { id: "g", nome: "Guilherme Theo Sampaio", nome_variantes: ["Guilherme Sampaio"] },
      { id: "f", nome: "Felipe Fernandes Queiroz", nome_variantes: ["Felipe Queiroz"] },
      { id: "a", nome: "Alessandro Baumgartner", nome_variantes: [] },
    ];
    const contagem = contarRelatoriasPorDiretor(
      relatores.map((r) => ({ relator: r, resultado: "Aprovado" })),
      cadastro,
    );
    const atribuidas = [...contagem.values()].reduce((s, n) => s + n, 0);
    expect(atribuidas, "relatoria real da ANTT não pode se perder no match").toBeGreaterThanOrEqual(5);
  });
});
