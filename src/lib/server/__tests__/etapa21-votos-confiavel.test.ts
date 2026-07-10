/**
 * Etapa 21 — esteira de votos confiável:
 * abreviação estrita (fim das duplicatas que rachavam o voto) + casamento
 * determinístico (nome oficial completo vence o duplicado curto).
 */
import { describe, it, expect } from "vitest";
import { isStrictAbbreviation, findBestMatch } from "@/lib/server/name-matcher";
import { extractPresentesNarrativo } from "@/lib/server/nlp-extractor";

describe("isStrictAbbreviation — funde só duplicata óbvia", () => {
  it("nome curto é abreviação estrita do completo", () => {
    expect(isStrictAbbreviation("Felipe Queiroz", "Felipe Fernandes Queiroz")).toBe(true);
    expect(isStrictAbbreviation("Guilherme Theo Sampaio", "Guilherme Theo Rodrigues da Rocha Sampaio")).toBe(true);
    expect(isStrictAbbreviation("Severino Medeiros", "Severino Medeiros Ramos Neto")).toBe(true);
  });

  it("NÃO funde pessoas distintas nem ordem invertida", () => {
    // primeiro nome igual, último diferente → não é a mesma pessoa
    expect(isStrictAbbreviation("Felipe Souza", "Felipe Fernandes Queiroz")).toBe(false);
    // o longo não é abreviação do curto
    expect(isStrictAbbreviation("Felipe Fernandes Queiroz", "Felipe Queiroz")).toBe(false);
    // nomes iguais (não é abreviação)
    expect(isStrictAbbreviation("Felipe Queiroz", "Felipe Queiroz")).toBe(false);
    // token do meio diferente com mesmo 1º+último ainda exige subconjunto
    expect(isStrictAbbreviation("Ana Paula Silva", "Ana Carla Silva")).toBe(false);
  });
});

describe("ANM roster narrativo — casa o colegiado completo (QA Etapa 21)", () => {
  // Preâmbulo real da ata ANM: "Diretor\nSubstituto" (quebra de linha) e nome de 6 tokens.
  const preambulo =
    "A sessão foi presidida pelo Diretor-Geral, Mauro Henrique Moreira Sousa, e contou com a " +
    "presença do Diretor\nSubstituto Luiz Paniago Neves, do Diretor Substituto Fábio Fernando Borges " +
    "e do Diretor José Fernando de Mendonça Gomes Júnior.";

  it("não vaza 'Substituto' para dentro do nome (quebra de linha)", () => {
    const presentes = extractPresentesNarrativo(preambulo);
    expect(presentes).toContain("Luiz Paniago Neves");
    expect(presentes.some((n) => /substitut/i.test(n))).toBe(false);
  });

  it("captura o nome longo de 6 tokens inteiro", () => {
    const presentes = extractPresentesNarrativo(preambulo);
    expect(presentes).toContain("José Fernando de Mendonça Gomes Júnior");
  });

  it("casa os 4 diretores contra o seed COMPLETO", () => {
    const seed = [
      { id: "mauro", nome: "Mauro Henrique Moreira Sousa", nome_variantes: [] },
      { id: "luiz", nome: "Luiz Paniago Neves", nome_variantes: [] },
      { id: "fabio", nome: "Fábio Fernando Borges", nome_variantes: [] },
      { id: "jose", nome: "José Fernando de Mendonça Gomes Júnior", nome_variantes: [] },
    ];
    const casados = extractPresentesNarrativo(preambulo)
      .map((n) => findBestMatch(n, seed))
      .filter((m) => m.diretorId && !m.needsReview);
    expect(casados.length).toBe(4); // antes só 2/4 casavam
  });
});

describe("casamento determinístico — voto não racha entre cadastros", () => {
  it("relator curto casa o cadastro OFICIAL COMPLETO quando a lista vem ordenada por nome longo", () => {
    // Simula a lista de diretores ordenada por nome mais longo primeiro (como o confirm faz).
    const diretores = [
      { id: "oficial", nome: "Felipe Fernandes Queiroz", nome_variantes: [] },
      { id: "duplicado", nome: "Felipe Queiroz", nome_variantes: [] },
    ].sort((a, b) => b.nome.length - a.nome.length);
    const m = findBestMatch("Felipe Queiroz", diretores);
    // Ambos casam 1.0; o `>` estrito do findBestMatch mantém o PRIMEIRO iterado (o oficial).
    expect(m.diretorId).toBe("oficial");
    expect(m.needsReview).toBe(false);
  });
});
