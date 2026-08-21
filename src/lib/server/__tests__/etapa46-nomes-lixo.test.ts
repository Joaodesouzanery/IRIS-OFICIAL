import { describe, it, expect } from "vitest";
import { extractFields } from "@/lib/server/nlp-extractor";
import { isStrictPersonName } from "@/lib/server/name-matcher";

// QA ago/2026 — diagnóstico em produção (ANM) mostrou "diretores" aprovados que eram prosa:
// frases capitalizadas ("Acesso Externo Com") e nomes reais colados com a frase seguinte
// ("José Fernando … Restituiu-lhe A Presidência Da Sessão"). Este teste fixa as 3 camadas:
// (1) os regexes de voto não casam prosa minúscula; (2) headings cortam a prosa do fim do nome;
// (3) isStrictPersonName rejeita todo o lixo real do diagnóstico e aceita os diretores reais.

// Lixo REAL aprovado em produção (Title-Case exatamente como ficou no banco).
const LIXO_REAL = [
  "Acesso Externo Com",
  "Avaliação Da Nota Técnica",
  "Convidando Obrigatoriamente Os",
  "Elaborar Relatório Bimestral De",
  "Em Dois",
  "Em Participar Da Sessão Pública Deve",
  "Esta Nota Técnica",
  "Nota Técnica Aborde Ao Menos Os",
  "Os Titulares E Seus Representantes Poderão",
  "Ou Acesse Os",
  "José Fernando De Mendonça Gomes Júnior Restituiu-lhe A Presidência Da Sessão",
  "Luiz Paniago Neves Para A Relatoria Da Matéria Por Ele Pautada: Matéria",
];

const REAIS = [
  "Mauro Henrique Moreira Sousa",
  "José Fernando de Mendonça Gomes Júnior",
  "Luiz Paniago Neves",
  "Fábio Fernando Borges",
  "Caio Mário Trivellato Seabra Filho",
  "Tasso Mendonça Júnior",
  "Alessandro Baumgartner",
];

describe("isStrictPersonName contra o lixo real do diagnóstico [etapa46]", () => {
  it.each(LIXO_REAL)("rejeita %s", (nome) => {
    expect(isStrictPersonName(nome)).toBe(false);
  });
  it.each(REAIS)("aceita %s", (nome) => {
    expect(isStrictPersonName(nome)).toBe(true);
  });
});

describe("regexes de voto não casam prosa minúscula [etapa46]", () => {
  it("'ou acesse os seguintes pontos' não vira nome de votação", () => {
    const f = extractFields(
      "O sistema permite acesso externo com certificado digital. " +
        "Para tanto, ou acesse os seguintes pontos do portal, " +
        "convidando obrigatoriamente os titulares e seus representantes poderão " +
        "elaborar relatório bimestral de acompanhamento das ações.",
    );
    expect(f.nomes_votacao).toEqual([]);
    expect(f.nomes_votacao_favor).toEqual([]);
    expect(f.nomes_votacao_contra).toEqual([]);
  });

  it("adesão REAL continua detectada com direção", () => {
    const f = extractFields("O Diretor Felipe Fernandes Queiroz acompanhou o relator.");
    expect(f.nomes_votacao_favor).toContain("Felipe Fernandes Queiroz");
  });

  it("divergência verbal REAL continua detectada", () => {
    const f = extractFields("O Diretor Roger Romão Cabral divergiu do relator.");
    expect(f.nomes_votacao_contra).toContain("Roger Romão Cabral");
  });
});

describe("headings cortam a prosa do fim do nome [etapa46]", () => {
  it("'DIRETOR … NEVES PARA A RELATORIA…' vira só o nome", () => {
    const f = extractFields(
      "2. DIRETOR SUBSTITUTO LUIZ PANIAGO NEVES PARA A RELATORIA DA MATÉRIA POR ELE PAUTADA: MATÉRIA REGULATÓRIA\n",
    );
    expect(f.diretores_detectados).toContain("LUIZ PANIAGO NEVES");
    expect(f.diretores_detectados.some((n) => /RELATORIA|PAUTADA|MAT[EÉ]RIA/i.test(n))).toBe(false);
  });

  it("heading limpo segue inteiro", () => {
    const f = extractFields("1. DIRETOR-GERAL MAURO HENRIQUE MOREIRA SOUSA\n");
    expect(f.diretores_detectados).toContain("MAURO HENRIQUE MOREIRA SOUSA");
  });
});
