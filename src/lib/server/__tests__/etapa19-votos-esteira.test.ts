/**
 * Etapa 19 — esteira de votos alimentando a plataforma:
 * (V1) leitura da direção do voto ampliada + confiança com chave de dedup;
 * (V2) deriveNomeVariantes casa nome oficial completo × citação abreviada (fim das duplicatas);
 * (V4) roster NARRATIVO da ANM lido do preâmbulo (atas ANM passam a produzir voto).
 */
import { describe, it, expect } from "vitest";
import { parseAnttManualDocument } from "@/lib/server/antt-manual-parser";
import { deriveNomeVariantes, findBestMatch } from "@/lib/server/name-matcher";
import { extractPresentes, extractPresentesNarrativo } from "@/lib/server/nlp-extractor";

// ─── V1: direção do voto — lead-ins ampliados + varredura da cauda ───────────

function votoText(conclusao: string, extra = "") {
  return [
    "AGÊNCIA NACIONAL DE TRANSPORTES TERRESTRES - ANTT",
    "VOTO DFQ 043/2026",
    "RELATORIA: Diretoria Felipe Queiroz - DFQ",
    "PROCESSO: 50500.123456/2026-11",
    "OBJETO: Recurso administrativo.",
    conclusao,
    extra,
    "Documento assinado eletronicamente",
  ].join("\n");
}

describe("V1 — extractVoteConclusion ampliado (via parseAnttManualDocument)", () => {
  const casos: Array<[string, string | null]> = [
    ["Isto posto, voto pelo deferimento do pleito.", "Deferido"],
    ["Pelo exposto, voto por negar provimento ao recurso.", "Indeferido"],
    ["Em face do exposto, voto pela homologação do resultado.", "Ratificado"],
    ["Nestes termos, voto por autorizar a transferência.", "Autorizado"],
    ["Por todo o exposto, voto pela aprovação da minuta.", "Aprovado"],
  ];
  for (const [conclusao, esperado] of casos) {
    it(`"${conclusao.slice(0, 40)}…" → ${esperado}`, () => {
      const r = parseAnttManualDocument(votoText(conclusao), "Voto DFQ 043-2026.pdf");
      expect(r.fields.resultado ?? null).toBe(esperado);
    });
  }

  it("varredura da cauda: dispositivo sem lead-in explícito ainda é lido", () => {
    // Sem nenhuma fórmula de lead-in; o verbo do dispositivo está no fim do doc.
    const txt = votoText("Relatório e razões do voto seguem abaixo.", "defiro o pedido da concessionária.");
    const r = parseAnttManualDocument(txt, "Voto DFQ 043-2026.pdf");
    expect(r.fields.resultado).toBe("Deferido");
  });
});

describe("V1 — confiança com chave de dedup (voto sem processo alcança o corte)", () => {
  it("voto com relator + resultado + data (sem processo) → confiança ≥ 0.70", () => {
    const txt = [
      "AGÊNCIA NACIONAL DE TRANSPORTES TERRESTRES - ANTT",
      "VOTO DFQ 043/2026",
      "RELATORIA: Diretoria Felipe Queiroz - DFQ",
      "Brasília, 10/06/2026.",
      "Isto posto, voto pelo deferimento.",
      "Documento assinado eletronicamente",
    ].join("\n");
    const r = parseAnttManualDocument(txt, "Voto DFQ 043-2026.pdf");
    expect(r.fields.processo ?? null).toBeNull();       // sem processo
    expect(r.fields.resultado).toBe("Deferido");
    expect(r.confidenceBoost).toBeGreaterThanOrEqual(0.70); // antes ficava em 0.69
  });
});

// ─── V2: nome oficial completo × citação abreviada ───────────────────────────

describe("V2 — deriveNomeVariantes derruba o patronímico do meio", () => {
  it("gera a forma sem 'de Mendonça'", () => {
    const vs = deriveNomeVariantes("José Fernando de Mendonça Gomes Júnior");
    expect(vs).toContain("José Fernando Gomes Júnior");
  });

  it("findBestMatch casa ≥0.85 (não vira mais candidato/duplicata)", () => {
    // Cadastro tem o nome OFICIAL COMPLETO; o documento cita a forma curta.
    const diretores = [{ id: "d1", nome: "José Fernando de Mendonça Gomes Júnior", nome_variantes: [] }];
    const m = findBestMatch("José Fernando Gomes Júnior", diretores);
    expect(m.diretorId).toBe("d1");
    expect(m.needsReview).toBe(false);
    expect(m.score).toBeGreaterThanOrEqual(0.85);
  });

  it("acento-only continua casando 1.0", () => {
    const diretores = [{ id: "d1", nome: "Alex Antonio de Azevedo Cruz", nome_variantes: [] }];
    const m = findBestMatch("Alex Antônio de Azevedo Cruz", diretores);
    expect(m.diretorId).toBe("d1");
    expect(m.needsReview).toBe(false);
  });
});

// ─── V4: roster narrativo da ANM ─────────────────────────────────────────────

describe("V4 — extractPresentes lê o roster narrativo da ANM", () => {
  const anmPreambulo =
    "ATA DA 82ª REUNIÃO ORDINÁRIA DA DIRETORIA COLEGIADA DA AGÊNCIA NACIONAL DE MINERAÇÃO. " +
    "A sessão foi presidida pelo Diretor-Geral, Mauro Henrique Moreira Sousa, e contou com a presença " +
    "do Diretor Substituto Luiz Paniago Neves e do Diretor Caio Mário Trindade Seabra Filho. " +
    "1.1.3 PROCESSO Nº: 48403.831223/2005-28 VOTO: CONHECER E DAR PROVIMENTO. " +
    "DELIBERAÇÃO: Voto aprovado por unanimidade pelos diretores presentes.";

  it("captura os três diretores do preâmbulo (sem mesclar nomes adjacentes)", () => {
    const presentes = extractPresentesNarrativo(anmPreambulo);
    expect(presentes).toContain("Mauro Henrique Moreira Sousa");
    expect(presentes).toContain("Luiz Paniago Neves");
    expect(presentes).toContain("Caio Mário Trindade Seabra Filho");
    expect(presentes.length).toBe(3);
  });

  it("extractPresentes cai para o roster narrativo quando não há bloco Constituição:", () => {
    const presentes = extractPresentes(anmPreambulo);
    expect(presentes.length).toBeGreaterThanOrEqual(3);
  });

  it("ARTESP ('Constituição:') continua no caminho de bloco, sem regressão", () => {
    const artesp = "Constituição: Presidência-PRE - Diretor-Presidente André Isper Rodrigues Barnabé, Diretoria 2 - Diretor Diego Albert Zanatto.";
    const presentes = extractPresentes(artesp);
    expect(presentes).toContain("André Isper Rodrigues Barnabé");
    expect(presentes).toContain("Diego Albert Zanatto");
  });
});
