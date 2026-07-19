import { describe, it, expect } from "vitest";
import { extractSignatariosInline, extractPresentes, extractFields } from "@/lib/server/nlp-extractor";

// QA jul/2026 (PR-E): as DELIBERAÇÕES ARTESP não têm bloco "Constituição:" nem preâmbulo
// narrativo — o único roster no documento é o rodapé de assinaturas INLINE numa linha
// corrida ("Nome Cargo Nome Cargo"). Antes, signatarios=[] e os votos dependiam 100% do
// seed de mandato. O extrator inline tira dessa dependência, validando cada nome.

const RODAPE_INLINE =
  "André Isper Garbellini Ribeiro Diretor-Presidente Diego Albert Zanatto Diretor " +
  "Antonio Carlos Esbízaro de França Diretor Milton Roberto Persoli Diretor";

describe("roster inline ARTESP (rodapé Nome Cargo Nome Cargo) [PR-E]", () => {
  it("extrai cada diretor do rodapé corrido, sem engolir o cargo como nome", () => {
    const nomes = extractSignatariosInline(RODAPE_INLINE);
    expect(nomes).toEqual([
      "André Isper Garbellini Ribeiro",
      "Diego Albert Zanatto",
      "Antonio Carlos Esbízaro de França",
      "Milton Roberto Persoli",
    ]);
  });

  it("nenhum cargo vaza como nome (não há 'Diretor …' na lista)", () => {
    for (const n of extractSignatariosInline(RODAPE_INLINE)) {
      expect(n).not.toMatch(/^Diretor/i);
      expect(n.split(/\s+/).length).toBeGreaterThanOrEqual(2);
    }
  });

  it("não inventa nome a partir de prosa sem par Nome+Cargo adjacente", () => {
    // "conforme parecer do Diretor Substituto, a matéria foi analisada" — sem NOME antes
    // do cargo em title-case colado, não deve capturar nada.
    expect(extractSignatariosInline("Em face do exposto, a Diretoria RESOLVE aprovar a matéria.")).toEqual([]);
  });

  it("NÃO captura 'Conselho Diretor' (instituição) como nome — falso-positivo real da pauta 1201", () => {
    // "Pauta da 1201ª Reunião Ordinária do Conselho Diretor" pegava "Reunião Ordinária do
    // Conselho" + "Diretor" e gerava 1 voto numa pauta (sem_votos). O filtro institucional barra.
    expect(extractSignatariosInline("Pauta da 1201ª Reunião Ordinária do Conselho Diretor")).toEqual([]);
  });

  it("extractPresentes cai no rodapé inline quando não há bloco nem narrativo (ARTESP)", () => {
    const texto = `DELIBERAÇÃO ARTESP Nº 15, DE 13 DE JANEIRO DE 2026\n` +
      `1177ª Reunião Ordinária. INDEFERE o pleito. Aprovado por unanimidade.\n` +
      RODAPE_INLINE;
    const presentes = extractPresentes(texto);
    expect(presentes).toContain("André Isper Garbellini Ribeiro");
    expect(presentes).toContain("Diego Albert Zanatto");
  });

  it("NÃO faz hijack do roster narrativo ANM (preâmbulo tem prioridade sobre o inline)", () => {
    const ataAnm =
      "ATA 1ª REUNIÃO ORDINÁRIA. Reunião presidida pelo Diretor-Geral Mauro Henrique " +
      "Moreira Sousa e contou com a presença do Diretor Guilherme Santana Lopes Gomes.";
    const presentes = extractPresentes(ataAnm);
    expect(presentes).toContain("Mauro Henrique Moreira Sousa");
    expect(presentes.some((n) => /^Diretor/i.test(n))).toBe(false);
  });

  it("deliberação ARTESP completa com rodapé inline → signatarios preenchidos (confiança +0.06)", () => {
    const texto = `DELIBERAÇÃO ARTESP Nº 15, DE 13 DE JANEIRO DE 2026\n` +
      `1177ª Reunião Ordinária do Conselho Diretor. Processo SEI! nº 134.00023965/2023-12.\n` +
      `INDEFERE o pleito de desequilíbrio. Houve aprovação por unanimidade de votos.\n` +
      RODAPE_INLINE;
    const f = extractFields(texto);
    expect(f.signatarios.length).toBeGreaterThanOrEqual(3);
    expect(f.signatarios).toContain("André Isper Garbellini Ribeiro");
  });
});
