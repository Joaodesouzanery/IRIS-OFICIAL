import { describe, it, expect } from "vitest";
import { extractFields, hasUnanimidade } from "@/lib/server/nlp-extractor";
import { inferResultadoFromText, splitAtaItems } from "@/lib/server/ata-splitter";
import { parseAnttManualDocument } from "@/lib/server/antt-manual-parser";

// BLOCO 1 (auditoria da esteira, jul/2026) — confiabilidade da extração de votos. Cada bloco trava
// uma correção contra texto sintético determinístico (sem depender de PDF real).

// ── F1: item indeferido NÃO pode virar "Aprovado por Unanimidade" ────────────────────────────────
// inferResultadoFromText (matcher autoritativo dos itens de ata) só cobria o particípio
// "indeferid[oa]" → "indeferimento/indefere/indeferir/indeferiu" escapavam e caíam no ramo
// aprovado||unanimidade, INVERTENDO o resultado.
describe("F1 — indeferimento/indefere/indeferir → Indeferido (não Aprovado)", () => {
  it("substantivo/presente/infinitivo/pretérito do INDEFERIR (com unanimidade) → Indeferido", () => {
    expect(inferResultadoFromText("VOTO pelo indeferimento do pleito", true)).toBe("Indeferido");
    expect(inferResultadoFromText("A Diretoria INDEFERE o recurso", true)).toBe("Indeferido");
    expect(inferResultadoFromText("VOTO por indeferir o requerimento", true)).toBe("Indeferido");
    expect(inferResultadoFromText("o pedido restou indeferido", true)).toBe("Indeferido");
  });

  it("DEFERIR também é lido em presente/infinitivo/substantivo", () => {
    expect(inferResultadoFromText("pelo deferimento do pleito", true)).toBe("Deferido");
    expect(inferResultadoFromText("A Diretoria DEFERE o pedido", false)).toBe("Deferido");
  });

  it("sem verbo negativo, unanimidade segue Aprovado por Unanimidade", () => {
    expect(inferResultadoFromText("matéria aprovada pelos presentes", true)).toBe("Aprovado por Unanimidade");
  });

  it("integração splitAtaItems: item indeferido-por-unanimidade → Indeferido (regressão do bug)", () => {
    const ata =
      "ATA 90ª REUNIÃO ORDINÁRIA PÚBLICA DA DIRC/ANM.\n" +
      "1.2. ASSUNTO: Recurso administrativo.\n" +
      "1.2.1 PROCESSO Nº: 48400.123456/2024-11\n" +
      "INTERESSADO: Fulano Mineração Ltda.\n" +
      "VOTO: Diante do exposto, VOTO pelo indeferimento do recurso.\n" +
      "DELIBERAÇÃO: Voto do relator aprovado por unanimidade pelos diretores presentes.\n";
    const item = splitAtaItems(ata).find((i) => i.item_numero === "1.2.1");
    expect(item?.resultado).toBe("Indeferido");
    expect(item?.resultado).not.toBe("Aprovado por Unanimidade");
  });
});

// ── F2: default-favor duvidoso vai para revisão (não fabrica "Favorável") ─────────────────────────
const PRE =
  "A sessão foi presidida pelo Diretor-Geral, Mauro Henrique Moreira Sousa, e contou com a " +
  "presença do Diretor Tasso Mendonça Júnior e do Diretor Roger Romão Cabral.";
// Bloco de assinatura (nome em CAIXA ALTA + cargo na linha seguinte) → popula `signatarios`,
// que é a fonte do ramo de unanimidade em extractFields.
const SIG =
  "\nMAURO HENRIQUE MOREIRA SOUSA\nDiretor-Geral" +
  "\nTASSO MENDONCA JUNIOR\nDiretor" +
  "\nROGER ROMAO CABRAL\nDiretor";

describe("F2 — contestado sem dissidente atribuído → revisão", () => {
  it("NOVO termo 'prevaleceu' (sem 'por maioria') → não fabrica favor (pool esvaziado)", () => {
    const texto = `${PRE}\nASSUNTO: Recurso. DELIBERAÇÃO: prevaleceu o voto do relator, sem outra ressalva registrada.`;
    const f = extractFields(texto);
    expect(f.nomes_votacao_favor).toEqual([]);
    expect(f.nomes_votacao).toEqual([]);
  });

  it("SEGURANÇA: unanimidade legítima com 'sem divergência' NÃO é esvaziada (guarda só no ramo default)", () => {
    const texto = `Agência Nacional de Mineração\nASSUNTO: Recurso. DELIBERAÇÃO: Voto do relator aprovado por unanimidade, sem qualquer divergência entre os diretores presentes.${SIG}`;
    const f = extractFields(texto);
    expect(f.nomes_votacao_favor.length).toBeGreaterThan(0);
    expect(f.unanimidade_detectada).toBe(true);
  });
});

// ── F5: "não/sem unanimidade" NÃO conta como unânime ──────────────────────────────────────────────
describe("F5 — guarda de negação da unanimidade", () => {
  it("'não foi aprovado por unanimidade' → NÃO unânime", () => {
    expect(hasUnanimidade("a matéria não foi aprovada por unanimidade dos votos")).toBe(false);
    expect(extractFields("A proposta não foi aprovada por unanimidade.").unanimidade_detectada).toBe(false);
  });
  it("'sem unanimidade' → NÃO unânime", () => {
    expect(hasUnanimidade("decisão tomada sem unanimidade entre os diretores")).toBe(false);
  });
  it("'aprovado por unanimidade' legítimo → unânime", () => {
    expect(hasUnanimidade("Voto aprovado por unanimidade dos presentes")).toBe(true);
    expect(extractFields("Voto aprovado por unanimidade dos presentes.").unanimidade_detectada).toBe(true);
  });
  it("CONCESSIVO 'não obstante a unanimidade' AFIRMA a unanimidade (não é negação)", () => {
    expect(hasUnanimidade("Não obstante a unanimidade dos votos, o recurso foi provido em parte.")).toBe(true);
  });
});

// ── F3: atribuição ANTT só-por-iniciais gera warning de revisão ───────────────────────────────────
describe("F3 — voto ANTT com autor inferido SÓ pelas iniciais", () => {
  it("iniciais sem nome textual → warning de revisão (colisão DAA↔DAB)", () => {
    const text =
      "AGÊNCIA NACIONAL DE TRANSPORTES TERRESTRES - ANTT\n" +
      "VOTO DAB Nº 45/2026\n" +
      "Processo nº 50500.123456/2026-11\n" +
      "Objeto: recurso administrativo.\n" +
      "Diante do exposto, VOTO por negar provimento ao recurso.";
    const r = parseAnttManualDocument(text, "Voto_DAB_45-2026.pdf");
    expect(r.documentType).toBe("voto_individual");
    expect(r.warnings.some((w) => /iniciais/i.test(w))).toBe(true);
  });
});

// ── F4: fallback de cauda ANTT escopado ao dispositivo (não pesca verbo do RELATÓRIO) ──────────────
describe("F4 — dispositivo na cauda escopado + warning", () => {
  it("'indeferido' no RELATÓRIO NÃO vence o dispositivo (DECIDO defere) — escopo após a âncora", () => {
    // Sem escopo, o "indeferido" do relatório venceria por precedência (negativos primeiro) e
    // inverteria o resultado. Com escopo (região após 'DECIDO'), só o dispositivo positivo conta.
    const text =
      "AGÊNCIA NACIONAL DE TRANSPORTES TERRESTRES - ANTT\n" +
      "VOTO DAB Nº 7/2026\n" +
      "RELATÓRIO: o pedido foi indeferido pela área técnica em primeira instância, conforme os autos.\n" +
      "Segue a análise dos argumentos apresentados pela recorrente ao longo do processo.\n" +
      "DECIDO: dar provimento ao recurso e deferir o pleito da recorrente.";
    const r = parseAnttManualDocument(text, "Voto_DAB_7-2026.pdf");
    expect(r.documentType).toBe("voto_individual");
    expect(r.fields.resultado).toBe("Deferido");
    expect(r.fields.resultado).not.toBe("Indeferido");
    expect(r.warnings.some((w) => /cauda/i.test(w))).toBe(true);
  });
});
