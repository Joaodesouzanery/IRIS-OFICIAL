import { describe, it, expect } from "vitest";
import { extractPresentes, extractFields } from "@/lib/server/nlp-extractor";

// PR-F (QA jul/2026) — certificação da extração das ATAS ANM com TEXTO REAL dos PDFs enviados
// (34ª REP, 79ª/80ª/81ª/83ª ROP). O caminho base já está no golden-set (anm-ata-32/anm-ata-82);
// aqui travamos o que esses documentos têm de específico: (a) a MUDANÇA DE COMPOSIÇÃO da DIRC a
// partir da 80ª (entram os Diretores SUBSTITUTOS Luiz Paniago Neves e Fábio Fernando Borges no
// lugar de Tasso Mendonça Júnior e Roger Romão Cabral) e (b) o artefato de OCR real "presençado"
// (presença+do colados). O roster narrativo é a ÚNICA fonte de quem votou nas atas ANM.

// Preâmbulo REAL da Ata 34ª REP e 79ª ROP (composição antiga: 4 diretores efetivos).
const PREAMBULO_79 =
  "Aos vinte e seis dias do mês de novembro de dois mil e vinte e cinco, teve início a 79ª Reunião " +
  "Ordinária Pública da Diretoria Colegiada da Agência Nacional de Mineração - ANM. A sessão foi " +
  "presidida pelo Diretor-Geral, Mauro Henrique Moreira Sousa, e contou com a presença do Diretor " +
  "Tasso Mendonça Júnior, do Diretor Roger Romão Cabral e do Diretor José Fernando de Mendonça " +
  "Gomes Júnior. Também estiveram presentes o Procurador-Chefe, Thiago de Freitas Benevenuto, " +
  "representando a Procuradoria Federal Especializada junto à ANM - PFE/ANM, o Ouvidor interino, " +
  "André Elias Marques e o Secretário-Geral, Caio Vasconcelos de Azevedo, da Secretaria Geral - SG.";

// Preâmbulo REAL da Ata 80ª ROP: composição NOVA (substitutos) + OCR "presençado" (colado).
const PREAMBULO_80 =
  "Aos dezessete de dezembro de dois mil e vinte e cinco teve início a 80ª Reunião Ordinária " +
  "Pública da Diretoria Colegiada da Agência Nacional de Mineração - ANM. A sessão foi presidida " +
  "pelo Diretor-Geral, Mauro Henrique Moreira Sousa, e contou com a presençado Diretor Substituto " +
  "Luiz Paniago Neves, do Diretor Substituto Fábio Fernando Borges e do Diretor José Fernando de " +
  "Mendonça Gomes Júnior. Também estiveram presentes o Procurador-Chefe, Thiago de Freitas " +
  "Benevenuto, representando a Procuradoria Federal Especializada junto à ANM - PFE/ANM, a Ouvidora " +
  "interina substituta, Glória Lorena Sousa Sena e o Secretário-Geral, Caio Vasconcelos de Azevedo.";

describe("ANM — roster narrativo (composição antiga) [PR-F]", () => {
  it("extrai os 4 diretores efetivos e NÃO pega Procurador/Ouvidor/Secretário", () => {
    const roster = extractPresentes(PREAMBULO_79);
    expect(roster).toContain("Mauro Henrique Moreira Sousa");
    expect(roster).toContain("Tasso Mendonça Júnior");
    expect(roster).toContain("Roger Romão Cabral");
    expect(roster).toContain("José Fernando de Mendonça Gomes Júnior");
    // Não-diretores presentes não entram no roster de voto.
    expect(roster).not.toContain("Thiago de Freitas Benevenuto"); // Procurador-Chefe
    expect(roster).not.toContain("André Elias Marques"); // Ouvidor
    expect(roster).not.toContain("Caio Vasconcelos de Azevedo"); // Secretário-Geral
  });
});

describe("ANM — mudança de composição + OCR 'presençado' [PR-F]", () => {
  it("Ata 80ª: lê os Diretores SUBSTITUTOS mesmo com 'presença do' colado ('presençado')", () => {
    const roster = extractPresentes(PREAMBULO_80);
    expect(roster).toContain("Mauro Henrique Moreira Sousa");
    expect(roster).toContain("Luiz Paniago Neves");
    expect(roster).toContain("Fábio Fernando Borges");
    expect(roster).toContain("José Fernando de Mendonça Gomes Júnior");
    // A composição antiga NÃO pode vazar (Tasso/Roger saíram — mandatos encerrados).
    expect(roster).not.toContain("Tasso Mendonça Júnior");
    expect(roster).not.toContain("Roger Romão Cabral");
    expect(roster.some((n) => /Glória|Benevenuto|Azevedo/.test(n))).toBe(false);
  });
});

describe("ANM — unanimidade e verbo de resultado [PR-F]", () => {
  it("item unânime (súmula CFEM da 34ª REP): resultado positivo + unanimidade detectada", () => {
    const texto =
      "3.1. ASSUNTO: Proposta de Súmula Administrativa. VOTO: Diante do exposto, VOTO por APROVAR " +
      "a edição de Súmula, conforme proposta. DELIBERAÇÃO: Voto aprovado por unanimidade pelos " +
      "diretores presentes.";
    const f = extractFields(texto);
    expect(f.unanimidade_detectada).toBe(true);
    expect(f.resultado).not.toBeNull();
    expect(f.resultado).not.toBe("Indeferido");
  });

  it("indeferimento real da ANM (NEGAR PROVIMENTO) não vira aprovação", () => {
    const texto =
      "VOTO: Diante do exposto e acompanhando a manifestação técnica, VOTO por conhecer e, no " +
      "mérito, NEGAR PROVIMENTO ao recurso. DELIBERAÇÃO: Voto aprovado por unanimidade pelos " +
      "diretores presentes.";
    const f = extractFields(texto);
    // O verbo do dispositivo é "NEGAR PROVIMENTO" — o resultado não pode ser um deferimento.
    expect(f.resultado).not.toBe("Deferido");
    expect(f.resultado).not.toBe("Aprovado por Unanimidade"); // não confundir com o dispositivo
  });
});

describe("ANM — divergência real (maioria / voto de qualidade) NÃO é unanimidade [PR-F]", () => {
  it("'aprovado por MAIORIA com divergência' não é marcado como unânime", () => {
    // 79ª ROP, item 3.5.1 (CFEM municípios): DG divergiu do relator.
    const texto =
      "DELIBERAÇÃO: Voto do relator aprovado por maioria dos diretores, com divergência apresentada " +
      "pelo Diretor-Geral em relação ao não conhecimento dos recursos interpostos pelos municípios.";
    expect(extractFields(texto).unanimidade_detectada).toBe(false);
  });

  it("empate resolvido por VOTO DE QUALIDADE também não é unanimidade", () => {
    // 79ª ROP, item 1.4.1 (RFP): empate, DG proferiu o voto de qualidade.
    const texto =
      "DELIBERAÇÃO: Voto do Relator, Diretor-Geral, aprovado por maioria dos diretores presentes com " +
      "cômputo do voto de qualidade proferido pelo Diretor-Geral.";
    expect(extractFields(texto).unanimidade_detectada).toBe(false);
  });
});
