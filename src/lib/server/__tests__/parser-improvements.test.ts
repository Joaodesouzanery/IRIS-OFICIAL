import { describe, it, expect } from "vitest";
import { extractFields, extractItemVotes } from "@/lib/server/nlp-extractor";
import { detectDocumentType, splitAtaItems } from "@/lib/server/ata-splitter";
import { parseAnttManualDocument } from "@/lib/server/antt-manual-parser";

// Suíte golden-set da Etapa 2 (otimização do parser). Cada bloco fixa um defeito
// confirmado pela auditoria adversarial, para não regredir.

describe("A5 — resultado pelo dispositivo, não pela prosa", () => {
  it("não inverte: prosa minúscula 'aprova/recomenda' não vence o dispositivo INDEFERIU", () => {
    const texto = `Considerando que a empresa aprova internamente seu plano e que o relator recomenda a leitura do parecer, a Diretoria, por maioria, INDEFERIU o pleito de reequilíbrio.`;
    expect(extractFields(texto).resultado).toBe("Indeferido");
  });

  it("escopa ao dispositivo: APROVA na fundamentação não conta quando há dispositivo", () => {
    const texto = `Considerando que a empresa APROVA o plano de negócios. Diante do exposto, a Diretoria INDEFERIU o pedido.`;
    expect(extractFields(texto).resultado).toBe("Indeferido");
  });

  it("reconhece pretérito APROVOU como decisão", () => {
    const texto = `Diante do exposto, a Diretoria APROVOU a minuta apresentada.`;
    expect(extractFields(texto).resultado).toBe("Aprovado");
  });
});

describe("A1/A2/A7/A8 — votos (ausência, traços, dissidência, adesão)", () => {
  it("A1: ausência com nome acentuado vai para ausente (não para favor)", () => {
    const f = extractFields(`O Diretor João Inácio de Sá esteve ausente da sessão.`);
    expect(f.nomes_votacao_ausente).toContain("João Inácio de Sá");
    expect(f.nomes_votacao_favor).not.toContain("João Inácio de Sá");
  });

  it("A2: em-dash como separador de voto contrário", () => {
    const f = extractFields(`Votação: Joana Ribeiro do Vale — Contrário`);
    expect(f.nomes_votacao_contra).toContain("Joana Ribeiro do Vale");
  });

  it("A7: 'restando vencido o Diretor X' e 'voto divergente do Diretor Y' → contra", () => {
    const f = extractFields(`Aprovado por maioria, restando vencido o Diretor Pedro Henrique Alves, e o voto divergente do Diretor Marcos Vinícius da Costa.`);
    expect(f.nomes_votacao_contra).toContain("Pedro Henrique Alves");
    expect(f.nomes_votacao_contra).toContain("Marcos Vinícius da Costa");
  });

  it("A8: 'acompanhou o relator' → favor; 'divergiu' → contra", () => {
    const f = extractFields(`O Diretor Ricardo Antonio Pereira acompanhou o voto do relator. O Diretor Paulo Sergio Lemos divergiu do relator.`);
    expect(f.nomes_votacao_favor).toContain("Ricardo Antonio Pereira");
    expect(f.nomes_votacao_contra).toContain("Paulo Sergio Lemos");
  });
});

describe("A3/A4/A9/A10 — campos", () => {
  it("A3: mês acentuado MARÇO no cabeçalho da deliberação", () => {
    const f = extractFields(`DELIBERAÇÃO ARTESP Nº 66, DE 5 DE MARÇO DE 2026\nAssunto: reajuste tarifário`);
    expect(f.data_reuniao).toBe("2026-03-05");
  });

  it("A4: relator rotulado captura o nome; prosa não", () => {
    const f = extractFields(`Assunto: X\nRelator: Conselheiro João Pedro de Almeida\nDecisão: Aprovado`);
    expect(f.relator).toBe("João Pedro de Almeida");
  });

  it("A9: interessado não é truncado em espaços duplos de PDF; preserva 'S.A.'", () => {
    const f = extractFields(`Interessado: Concessionária  Rodovias  do  Tietê S.A., que solicita reajuste tarifário`);
    expect(f.interessado).toBe("Concessionária Rodovias do Tietê S.A.");
  });

  it("A10: data de publicação sem âncora forte e igual à reunião é descartada", () => {
    const f = extractFields(`Reunião realizada em 05/03/2026. Deliberação sobre o tema. 05/03/2026.`);
    expect(f.data_publicacao).toBeNull();
  });

  it("A10: data de publicação com âncora forte (DOU) é capturada", () => {
    const f = extractFields(`DELIBERAÇÃO Nº 10, DE 5 DE MARÇO DE 2026. Publicado no DOU em 25/01/2026.`);
    expect(f.data_publicacao).toBe("2026-01-25");
  });
});

describe("C1 — extractItemVotes (votos explícitos por item)", () => {
  it("'Votaram a favor os Diretores X e Y' + 'Votou contra o Diretor Z'", () => {
    const v = extractItemVotes(`Votaram a favor os Diretores Ana Lima e Pedro Souza. Votou contra o Diretor Carlos Mendes.`);
    expect(v.favor).toEqual(expect.arrayContaining(["Ana Lima", "Pedro Souza"]));
    expect(v.contra).toContain("Carlos Mendes");
    expect(v.favor).not.toContain("Carlos Mendes");
  });

  it("tabular com em-dash e abstenção", () => {
    const v = extractItemVotes(`Mariana Costa Lima — Abstenção`);
    expect(v.abstencao).toContain("Mariana Costa Lima");
  });
});

describe("B1/B2/B4 — ata-splitter", () => {
  it("B2: 'ATA DA 5ª REUNIÃO' é ata", () => {
    expect(detectDocumentType("ATA DA 5ª REUNIÃO ORDINÁRIA DA DIRETORIA COLEGIADA")).toBe("ata");
  });

  it("B2: 'DELIBERAÇÃO Nº X ... ata da 5ª reunião' é deliberação (atos numerados primeiro)", () => {
    expect(detectDocumentType("DELIBERAÇÃO Nº 12, referente à ata da 5ª reunião ordinária")).toBe("deliberacao");
  });

  it("B1: 'aprovado o voto que NEGA provimento' resolve como Indeferido", () => {
    const itens = splitAtaItems(`I- Processo: 27214.848248/2014\nAssunto: Recurso\nVoto: Aprovado o voto no sentido de negar provimento ao recurso e indeferir o pleito.`);
    expect(itens.length).toBeGreaterThan(0);
    expect(itens[0].resultado).toBe("Indeferido");
  });

  it("B4: marcador romano sem rótulo de campo ('I. Considerando') não abre item", () => {
    const itens = splitAtaItems(`I. Considerando que o processo administrativo tramita regularmente perante a agência.\nII- Processo: 11111.222222/2026\nAssunto: Outorga\nDecisão: Deferido`);
    expect(itens.every((i) => i.item_numero !== "I")).toBe(true);
    expect(itens.some((i) => i.processo?.includes("11111"))).toBe(true);
  });
});

describe("D1/D2 — ANTT", () => {
  it("D2: 'Processo n°' (sinal de grau) é normalizado e o processo é extraído", () => {
    const texto = `ATA DA 423ª REUNIÃO DELIBERATIVA ELETRÔNICA DA ANTT\n1.1.1 Processo n° 50500.123456/2026-11\nInteressado: Concessionária Rodovia X\nAssunto: Reajuste tarifário\nDecisão: Aprovado por unanimidade.`;
    const r = parseAnttManualDocument(texto, "ata-antt.pdf");
    expect(r.isAntt).toBe(true);
    expect(r.fields.processo).toContain("50500.123456/2026-11");
  });

  it("D1: RDE (reunião deliberativa eletrônica) tem resultado, não null", () => {
    const texto = `423ª REUNIÃO DELIBERATIVA ELETRÔNICA DA ANTT\n1.1.1 Processo nº 50500.111111/2026-22\nInteressado: Empresa Y\nAssunto: Outorga\nDecisão: Aprovado por unanimidade pela diretoria.`;
    const r = parseAnttManualDocument(texto, "rde-antt.pdf");
    expect(r.documentType).toBe("reuniao_deliberativa_eletronica");
    expect(r.fields.resultado).toBe("Aprovado");
  });
});
