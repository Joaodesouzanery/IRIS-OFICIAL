import { describe, it, expect } from "vitest";
import { isStrictPersonName } from "@/lib/server/name-matcher";

// QA ago/2026: os regex de divergência pescavam PROSA como nome de dissidente na ata 32 da ANM
// ("voto por", "Diretoria Colegiada da ANM pode" gravados como contra junto dos reais). Como
// contra grava VOTO, o nome passa por validação ESTRITA (Capitalizado + partículas/sufixos).

describe("isStrictPersonName [QA ago/2026]", () => {
  it("aceita os dissidentes REAIS da ata 32 da ANM", () => {
    expect(isStrictPersonName("Tasso Mendonça Jr")).toBe(true);
    expect(isStrictPersonName("Caio Mario Seabra Filho")).toBe(true);
    expect(isStrictPersonName("Tasso Mendonça Júnior")).toBe(true);
    expect(isStrictPersonName("José Fernando de Mendonça Gomes Júnior")).toBe(true);
  });
  it("rejeita a PROSA que o QA flagrou virando 'contra'", () => {
    expect(isStrictPersonName("voto por")).toBe(false);
    expect(isStrictPersonName("Diretoria Colegiada da ANM pode")).toBe(false);
  });
  it("rejeita outros fragmentos comuns", () => {
    expect(isStrictPersonName("pelo indeferimento do pedido")).toBe(false);
    expect(isStrictPersonName("a Diretoria decide")).toBe(false);
    expect(isStrictPersonName("Processo em pauta")).toBe(false);
    expect(isStrictPersonName("Retirado de Pauta")).toBe(false);
  });
});
