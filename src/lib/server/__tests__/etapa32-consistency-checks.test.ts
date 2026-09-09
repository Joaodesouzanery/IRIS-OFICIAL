import { describe, it, expect } from "vitest";
import { avisoUnanimidadeContestada, avisoAtaItensFaltando } from "@/lib/server/consistency-checks";

// Bloco 0 (QA ago/2026): 2 fechadores de confiabilidade. Ambos SÓ emitem aviso (→ revisão) —
// nunca destroem nem fabricam voto. Princípio null-não-chuta preservado.

describe("avisoUnanimidadeContestada [0.1]", () => {
  it("unanimidade + 'por maioria' sem contra nomeado → aviso", () => {
    const t = "A matéria foi aprovada por unanimidade. Registrou-se que a decisão anterior fora por maioria.";
    expect(avisoUnanimidadeContestada(t, true, 0)).toMatch(/contradit/i);
  });
  it("unanimidade + 'voto de qualidade' / 'vencido o Relator' sem contra → aviso", () => {
    expect(avisoUnanimidadeContestada("por unanimidade … voto de qualidade do presidente", true, 0)).toBeTruthy();
    expect(avisoUnanimidadeContestada("aprovado por unanimidade; vencido o Relator", true, 0)).toBeTruthy();
  });
  it("Fase 24 — 'vencido' SOLTO não é contestação: 'restou vencido o pleito' e 'taxa vencida' → null", () => {
    // A etapa124 mediu nas 16 fixtures reais: `vencido` solto tem ZERO acertos e DEZ erros — todos
    // "Taxa Anual por Hectare vencida em …" em ROPs da ANM, que este aviso segurava em revisão.
    // "restou vencido o pleito" é o PEDIDO que perdeu, não um diretor vencido: era o mesmo erro.
    expect(avisoUnanimidadeContestada("aprovado por unanimidade; restou vencido o pleito", true, 0)).toBeNull();
    expect(avisoUnanimidadeContestada("Aprovado por unanimidade. Taxa Anual por Hectare vencida em 29/07/2022.", true, 0)).toBeNull();
    // …e "divergência parcial" — que o antigo NÃO via — agora dispara.
    expect(avisoUnanimidadeContestada("aprovado por unanimidade, com divergência parcial ao voto do relator", true, 0)).toBeTruthy();
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
