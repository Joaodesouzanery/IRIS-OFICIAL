import { describe, it, expect } from "vitest";
import { extractFields, hasUnanimidade } from "@/lib/server/nlp-extractor";

// Certificação complementar (ago/2026) com TRECHOS LITERAIS de documentos oficiais reais
// enviados pelo usuário (atas ANM 34ª REP/79ª ROP e Voto DAB 002/2026 da ANTT). Os PDFs
// binários não estão versionados — estes trechos cobrem os casos raros que o golden-set
// ainda não tinha: voto de qualidade (empate), deliberação sobrestada por pedido de vistas
// e voto de indeferimento em cumprimento judicial.

// Ata 79ª ROP DIRC/ANM, item 1.4.1 (Marcos Vieira Secchin) — empate + voto de qualidade.
const ATA79_ITEM_141 = `
Antes da deliberação, os Diretores apresentaram ponderações sobre o caso. O Diretor Roger Romão
Cabral ressaltou a elevada defasagem temporal entre a negativa do Relatório Final de Pesquisa e o
julgamento do recurso, optando, assim, por divergir do relator e dar provimento ao recurso. O
Diretor Tasso Mendonça Júnior também se posicionou pelo provimento do recurso. O Diretor José
Fernando de Mendonça Gomes Júnior acompanhou o voto do Relator, Diretor-Geral, que votou por negar
provimento ao recurso. Diante do empate formado, o Diretor-Geral proferiu o voto de desempate,
ratificando a posição inicial posta em seu voto para negar provimento ao recurso.
DELIBERAÇÃO: Voto do Relator, Diretor-Geral, aprovado por maioria dos diretores presentes com
cômputo do voto de qualidade proferido pelo Diretor-Geral.
`;

// Ata 34ª REP DIRC/ANM, item 2.1 — deliberação SOBRESTADA por pedido de vistas.
const ATA34_ITEM_21 = `
DELIBERAÇÃO: Após voto favorável do Diretor Roger Romão Cabral, a deliberação foi sobrestada em
razão do pedido de vistas ao processo pelo Diretor-Geral.
`;

// Voto DAB 002/2026 (ANTT) — indeferimento em cumprimento de decisão judicial.
const VOTO_DAB_002 = `
VOTO DAB
RELATORIA: Diretoria Alessandro Baumgartner - DAB
4.1. Ante ao exposto, em cumprimento ao comando judicial proferido nos autos do Mandado de
Segurança nº 1113200-11.2025.4.01.3400, VOTO pelo indeferimento do pedido de emissão de Termo de
Autorização à empresa VIAÇÃO AMARELINHO TRANSPORTE DE PASSAGEIROS LTDA., CNPJ nº 33.698.981/0001-41.
`;

describe("Ata 79ª ROP ANM — empate + voto de qualidade [etapa47]", () => {
  it("NÃO fabrica unanimidade (item contestado) e detecta a adesão nominal", () => {
    expect(hasUnanimidade(ATA79_ITEM_141)).toBe(false);
    const f = extractFields(ATA79_ITEM_141);
    expect(f.unanimidade_detectada).toBe(false);
    // Adesão real: "José Fernando de Mendonça Gomes Júnior acompanhou o voto do Relator".
    expect(f.nomes_votacao_favor).toContain("José Fernando de Mendonça Gomes Júnior");
    // Nenhuma prosa vira nome ("Diante do empate formado" etc.).
    for (const nome of f.nomes_votacao) {
      expect(nome.split(/\s+/).length).toBeLessThanOrEqual(7);
      expect(/\b(?:empate|deliberação|qualidade|provimento)\b/i.test(nome)).toBe(false);
    }
  });
});

describe("Ata 34ª REP ANM — sobrestada por pedido de vistas [etapa47]", () => {
  it("não vira unanimidade nem voto contra fabricado", () => {
    const f = extractFields(ATA34_ITEM_21);
    expect(f.unanimidade_detectada).toBe(false);
    expect(f.nomes_votacao_contra).toEqual([]);
  });
});

describe("Voto DAB 002/2026 ANTT — indeferimento judicial [etapa47]", () => {
  it("resultado normaliza para Indeferido e nada de nome-lixo", () => {
    const f = extractFields(VOTO_DAB_002);
    expect(String(f.resultado ?? "")).toMatch(/indefer/i);
    for (const nome of [...f.nomes_votacao, ...(f.diretores_detectados ?? [])]) {
      expect(/\b(?:mandado|segurança|termo|autorização|cumprimento)\b/i.test(nome)).toBe(false);
    }
  });
});
