import { describe, it, expect } from "vitest";
import { canAutoConfirm, type AutoConfirmDoc } from "@/lib/server/auto-confirm";

function docBase(over: Partial<AutoConfirmDoc> = {}, fields: Record<string, any> = {}): AutoConfirmDoc {
  return {
    id: "d1",
    status: "review_pending",
    tipo_documento: "deliberacao",
    extraction_confidence: 0.95,
    chars_per_page: 900,
    is_duplicate: false,
    agencia_id: "ag1",
    ata_items: null,
    campos_detectados: {
      preview: {
        filename: "x.pdf",
        import_counts_as_final: true,
        fields: {
          tipo_documento: "deliberacao",
          import_counts_as_final: true,
          votos_sugeridos: [{ diretor_id: "dir1", needs_review: false }],
          ...fields,
        },
      },
    },
    ...over,
  };
}

describe("canAutoConfirm — gate conservador de auto-confirmação", () => {
  it("APROVA doc final, alta confiança, não-escaneado, votos com match confiável", () => {
    expect(canAutoConfirm(docBase()).ok).toBe(true);
  });
  it("REPROVA confiança < 0.9", () => {
    expect(canAutoConfirm(docBase({ extraction_confidence: 0.8 })).ok).toBe(false);
  });
  it("REPROVA provável escaneado (chars_per_page baixo)", () => {
    expect(canAutoConfirm(docBase({ chars_per_page: 30 })).ok).toBe(false);
  });
  it("REPROVA tipo não-final (pauta)", () => {
    expect(canAutoConfirm(docBase({ tipo_documento: "pauta" }, { tipo_documento: "pauta" })).ok).toBe(false);
  });
  it("REPROVA duplicata", () => {
    expect(canAutoConfirm(docBase({ is_duplicate: true })).ok).toBe(false);
  });
  it("REPROVA voto sem match (sem diretor_id) ou com needs_review", () => {
    expect(canAutoConfirm(docBase({}, { votos_sugeridos: [{ diretor_id: null }] })).ok).toBe(false);
    expect(canAutoConfirm(docBase({}, { votos_sugeridos: [{ diretor_id: "d", needs_review: true }] })).ok).toBe(false);
  });
  it("REPROVA sem votos sugeridos", () => {
    expect(canAutoConfirm(docBase({}, { votos_sugeridos: [] })).ok).toBe(false);
  });
  it("ata: aprova só se todo item com voto tem match confiável E resultado", () => {
    const ok = docBase(
      { tipo_documento: "ata", ata_items: [{ votos_sugeridos: [{ diretor_id: "d1", needs_review: false }], resultado: "Aprovado" }] },
      { tipo_documento: "ata" },
    );
    expect(canAutoConfirm(ok).ok).toBe(true);
    const semMatch = docBase({ tipo_documento: "ata", ata_items: [{ votos_sugeridos: [{ diretor_id: null }], resultado: "Aprovado" }] }, { tipo_documento: "ata" });
    expect(canAutoConfirm(semMatch).ok).toBe(false);
    const semResultado = docBase({ tipo_documento: "ata", ata_items: [{ votos_sugeridos: [{ diretor_id: "d1", needs_review: false }] }] }, { tipo_documento: "ata" });
    expect(canAutoConfirm(semResultado).ok).toBe(false);
  });

  it("REPROVA com warning de QUALIDADE (consistência); warning informativo não bloqueia", () => {
    const comQuality = docBase({ warnings: ["Contradição: Fulano apareceu como favorável E contrário — votos removidos; revisar direção."] });
    expect(canAutoConfirm(comQuality).ok).toBe(false);
    const soInfo = docBase({ warnings: ["ANTT: documento tratado como pauta/ata revisável; votos não são criados automaticamente."] });
    expect(canAutoConfirm(soInfo).ok).toBe(true);
  });

  it("ata com itens passa mesmo com import_counts_as_final=false e confiança 0.72 (cap estrutural)", () => {
    const ata = docBase(
      {
        tipo_documento: "ata",
        extraction_confidence: 0.72,
        ata_items: [{ votos_sugeridos: [{ diretor_id: "d1", needs_review: false }], resultado: "Aprovado" }],
      },
      { tipo_documento: "ata", import_counts_as_final: false },
    );
    expect(canAutoConfirm(ata).ok).toBe(true);
    // Mas abaixo do limiar de ata (0.7) reprova.
    expect(canAutoConfirm({ ...ata, extraction_confidence: 0.6 }).ok).toBe(false);
    // E deliberação comum com flag false continua reprovada (regra só se abre p/ ata com itens).
    expect(canAutoConfirm(docBase({}, { import_counts_as_final: false })).ok).toBe(false);
  });
});
