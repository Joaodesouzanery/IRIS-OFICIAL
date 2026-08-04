import { describe, it, expect } from "vitest";
import { isAnttVotoFilename, parseAnttManualDocument } from "@/lib/server/antt-manual-parser";
import { classifyRegulatoryDocument } from "@/lib/server/regulatory-documents";

// QA ago/2026 (Bloco A2): "Voto DFQ 035-2026.pdf" (upload manual do SEI, sem a string "ANTT"
// no nome nem no início do texto) virava "? · documento_apoio" → voto REAL do diretor perdido.
// O sinal de FILENAME (iniciais da tabela + número/ano) agora liga o parser ANTT. Aditivo:
// a direção do voto continua nunca sendo chutada.

describe("isAnttVotoFilename [A2]", () => {
  it("reconhece os padrões reais de upload manual e de crawler", () => {
    expect(isAnttVotoFilename("Voto DFQ 035-2026.pdf")).toBe(true);
    expect(isAnttVotoFilename("Voto DFQ 039-2026.pdf")).toBe(true);
    expect(isAnttVotoFilename("Voto-DLA-37-2026-pdf-1031-Reunia-o-de-Diretoria.pdf")).toBe(true);
    expect(isAnttVotoFilename("voto_dab_12_2026.pdf")).toBe(true);
    expect(isAnttVotoFilename("Voto Vista DSM 7-2026.pdf")).toBe(true);
  });
  it("iniciais fora da tabela ou sem número/ano NÃO ligam o parser (sem falso positivo)", () => {
    expect(isAnttVotoFilename("Voto XYZ 035-2026.pdf")).toBe(false); // XYZ não é diretor ANTT
    expect(isAnttVotoFilename("Voto DFQ.pdf")).toBe(false); // sem número/ano
    expect(isAnttVotoFilename("ata-82-rop.pdf")).toBe(false);
    expect(isAnttVotoFilename("deliberacao-487-artesp.pdf")).toBe(false);
  });
});

describe("parseAnttManualDocument com filename-only [A2]", () => {
  it("'Voto DFQ 035-2026.pdf' sem texto (escaneado) liga o parser ANTT", () => {
    const r = parseAnttManualDocument("", "Voto DFQ 035-2026.pdf");
    expect(r.isAntt).toBe(true);
  });
  it("texto sem 'ANTT' + filename de voto → parser ligado e tipo voto_individual", () => {
    const texto = "RELATORIA: Diretor Felipe Queiroz. NÚMERO: 035/2026. PROCESSO: 50500.123456/2026-01. Voto pelo deferimento do pedido.";
    const r = parseAnttManualDocument(texto, "Voto DFQ 035-2026.pdf");
    expect(r.isAntt).toBe(true);
    expect(r.documentType).toBe("voto_individual");
  });
  it("não-ANTT continua não-ANTT (deliberação ARTESP não vira ANTT)", () => {
    const r = parseAnttManualDocument("DELIBERAÇÃO ARTESP Nº 15, de 13 de janeiro de 2026", "delib-15.pdf");
    expect(r.isAntt).toBe(false);
  });
});

describe("classifyRegulatoryDocument — rede de segurança por filename [A2]", () => {
  const base = { text: "conteúdo qualquer", tipo_documento: "documento_apoio" as const, documento_antt_tipo: null };
  it("'Voto DFQ 035-2026.pdf' → voto_individual (antes só DAA hardcoded)", () => {
    const c = classifyRegulatoryDocument({ ...base, filename: "Voto DFQ 035-2026.pdf" });
    expect(c.tipo_documento).toBe("voto_individual");
    expect(c.import_counts_as_final).toBe(false); // voto nunca é decisão final
  });
  it("'Voto DAA 3-2026.pdf' continua funcionando (sem regressão)", () => {
    const c = classifyRegulatoryDocument({ ...base, filename: "Voto DAA 3-2026.pdf" });
    expect(c.tipo_documento).toBe("voto_individual");
  });
});
