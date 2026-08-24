/**
 * Etapa 56 — Retirada: o OBJETO vem de lista fechada, e quem retirou fica registrado.
 *
 * Dois defeitos opostos, em quatro sítios que divergiram ao longo do tempo:
 *
 *  FALSO NEGATIVO — só "de pauta" era reconhecido. A ANTT também escreve "retirado da REUNIÃO" e
 *  "retirado da SESSÃO". O item seguia para a inferência de resultado como se tivesse sido
 *  decidido, e o vetor pior é o já conhecido: processo retirado cujo ASSUNTO cita "indeferiu"
 *  acabava gravado como Indeferido — errado e silencioso.
 *
 *  FALSO POSITIVO — o parser da ANTT testava `includes("retir") && includes("pauta")`, SEM
 *  adjacência. Bastavam as duas palavras existirem em qualquer ponto do item: uma "retirada de
 *  interferências" num processo cujo assunto mencionasse a pauta virava processo retirado.
 *
 * E o que não existia: QUEM retirou e COM QUE BASE (art. 55 do Regimento Interno).
 */

import { describe, it, expect } from "vitest";
import { RE_RETIRADA, RE_SUSPENSAO, inferResultadoFromText } from "@/lib/server/ata-splitter";
import { extractFields, extractRetirada } from "@/lib/server/nlp-extractor";
import { parseAnttManualDocument } from "@/lib/server/antt-manual-parser";

describe("etapa56 · o objeto da retirada", () => {
  it.each([
    "Processo retirado de pauta pelo Relator.",
    "Processo retirado da reunião pelo Relator.",
    "Processo retirado da sessão de julgamento.",
    "Matéria retirada da ordem do dia.",
    "O Relator decidiu retirar de pauta o presente processo.",
  ])("«%s» é retirada", (t) => {
    expect(RE_RETIRADA.test(t)).toBe(true);
    expect(inferResultadoFromText(t, false)).toBe("Retirado de Pauta");
  });

  it.each([
    "Trata-se de pedido de retirada de interferências na faixa de domínio.",
    "A concessionária promoveu a retirada de material da pista, conforme a pauta técnica.",
    "Determina-se a retirada do equipamento instalado irregularmente.",
  ])("«%s» NÃO é retirada de pauta", (t) => {
    expect(RE_RETIRADA.test(t)).toBe(false);
  });

  it("o falso positivo do parser ANTT, com as duas palavras distantes", () => {
    // Era exatamente este o caso: `includes("retir") && includes("pauta")` casava.
    const t =
      "Assunto: retirada de interferências. O processo consta da pauta da 1.036ª Reunião " +
      "Deliberativa. Diante do exposto, VOTO por dar provimento ao recurso.";
    expect(RE_RETIRADA.test(t)).toBe(false);
    const r = parseAnttManualDocument(`VOTO DAB 002/2026\nPROCESSO: 50500.123456/2026-11\n${t}`, "Voto DAB 002-2026.pdf");
    expect(r.fields.resultado).toBe("Deferido");
  });

  it("o falso NEGATIVO: retirado da reunião + assunto que cita «indeferiu»", () => {
    // Vetor real: sem reconhecer "da reunião", o item caía na inferência e o "indeferiu" do
    // histórico do assunto virava o resultado — um processo NÃO decidido gravado como Indeferido.
    const t =
      "Assunto: recurso contra decisão da Superintendência que indeferiu o pleito. " +
      "DELIBERAÇÃO: processo retirado da reunião pelo Relator.";
    expect(inferResultadoFromText(t, false)).toBe("Retirado de Pauta");
    expect(extractFields(`Diante do exposto, RESOLVE: ${t}`).resultado).toBe("Retirado de Pauta");
  });

  it("sobrestamento e pedido de vista continuam suspendendo", () => {
    expect(RE_SUSPENSAO.test("Deliberação sobrestada pelo pedido de vistas.")).toBe(true);
    expect(RE_SUSPENSAO.test("O Diretor pediu vista do processo.")).toBe(true);
  });
});

describe("etapa56 · autor e fundamento da retirada", () => {
  it("captura quem retirou e o artigo do Regimento Interno", () => {
    const r = extractRetirada(
      "DELIBERAÇÃO: processo retirado de pauta pelo Diretor Tasso Mendonça Jr., nos termos do " +
        "art. 55 do Regimento Interno da Agência.",
    );
    expect(r?.autor).toBe("Tasso Mendonça Jr");
    expect(r?.fundamento).toBe("art. 55 do Regimento Interno");
  });

  it("funciona com a frase quebrada pelo PDF (roda sobre a janela achatada)", () => {
    const r = extractRetirada(
      "DELIBERAÇÃO: processo retirado da\nreunião pelo Diretor Roger Romão\nCabral, nos termos do\nart. 55 do Regimento Interno.",
    );
    expect(r?.autor).toBe("Roger Romão Cabral");
    expect(r?.fundamento).toBe("art. 55 do Regimento Interno");
  });

  it("retirada sem autor nomeado devolve a retirada com autor null — não inventa nome", () => {
    const r = extractRetirada("DELIBERAÇÃO: processo retirado de pauta.");
    expect(r).not.toBeNull();
    expect(r?.autor).toBeNull();
    expect(r?.fundamento).toBeNull();
  });

  it("sem retirada não há objeto nenhum", () => {
    expect(extractRetirada("DELIBERAÇÃO: Voto aprovado por unanimidade.")).toBeNull();
    expect(extractRetirada("Pedido de retirada de interferências.")).toBeNull();
  });

  it("prosa não vira autor da retirada", () => {
    const r = extractRetirada("Processo retirado de pauta pelo Diretor relator da matéria.");
    expect(r?.autor).toBeNull();
  });
});
