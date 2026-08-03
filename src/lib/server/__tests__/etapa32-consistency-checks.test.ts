import { describe, it, expect } from "vitest";
import { avisoUnanimidadeContestada, avisoAtaItensFaltando } from "@/lib/server/consistency-checks";

// Bloco 0 (QA ago/2026): 2 fechadores de confiabilidade. Ambos SÓ emitem aviso (→ revisão) —
// nunca destroem nem fabricam voto. Princípio null-não-chuta preservado.

describe("avisoUnanimidadeContestada [0.1]", () => {
  it("unanimidade + 'por maioria' sem contra nomeado → aviso", () => {
    const t = "A matéria foi aprovada por unanimidade. Registrou-se que a decisão anterior fora por maioria.";
    expect(avisoUnanimidadeContestada(t, true, 0)).toMatch(/contradit/i);
  });
  it("unanimidade + 'voto de qualidade' / 'restou vencido' sem contra → aviso", () => {
    expect(avisoUnanimidadeContestada("por unanimidade … voto de qualidade do presidente", true, 0)).toBeTruthy();
    expect(avisoUnanimidadeContestada("aprovado por unanimidade; restou vencido o pleito", true, 0)).toBeTruthy();
  });
  it("unanimidade REAL (sem sinais de contestação) → null (não gera revisão à toa)", () => {
    expect(avisoUnanimidadeContestada("Aprovado por unanimidade dos presentes.", true, 0)).toBeNull();
  });
  it("'sem divergência' NÃO dispara (evita falso positivo)", () => {
    expect(avisoUnanimidadeContestada("Aprovado por unanimidade, sem divergência.", true, 0)).toBeNull();
  });
  it("já há contra nomeado → null (a purga/consistência existente cuida)", () => {
    expect(avisoUnanimidadeContestada("por unanimidade … por maioria", true, 1)).toBeNull();
  });
  it("não-unânime → null", () => {
    expect(avisoUnanimidadeContestada("Aprovado por maioria de votos.", false, 0)).toBeNull();
  });
});

describe("avisoAtaItensFaltando [0.2]", () => {
  const ata = (n: number) => Array.from({ length: n }, (_, i) => `Processo nº: 5000${i}/2026 Assunto ...`).join("\n");
  it("muito mais rótulos 'Processo' que itens parseados → aviso", () => {
    expect(avisoAtaItensFaltando(ata(6), 3)).toMatch(/não reconhecido/i);
  });
  it("rótulos ≈ itens (dentro da tolerância) → null", () => {
    expect(avisoAtaItensFaltando(ata(5), 5)).toBeNull();
    expect(avisoAtaItensFaltando(ata(6), 5)).toBeNull(); // gap 1 tolerado
  });
  it("texto sem 'Processo' → null", () => {
    expect(avisoAtaItensFaltando("Ata sem processos rotulados.", 0)).toBeNull();
  });
});
