import { describe, it, expect } from "vitest";
import {
  extractFields,
  extractItemVotes,
  extractDivergentesNomeados,
  extractDiretorGeralName,
  buildRoleMap,
} from "@/lib/server/nlp-extractor";
import { splitAtaItems } from "@/lib/server/ata-splitter";

// PR-K (QA jul/2026) — voto de CADA diretor individualmente nas atas ANM. O QA robusto provou que
// "aprovado por maioria ... com divergência apresentada pelo Diretor X" e "voto de qualidade"
// (empate) NÃO eram reconhecidos: o dissidente virava Favorável (doc) ou o item ficava sem voto
// (ata). Estes testes travam a correção sobre o TEXTO REAL das atas 79ª/80ª/34ª.

const PREAMBULO_79 =
  "A sessão foi presidida pelo Diretor-Geral, Mauro Henrique Moreira Sousa, e contou com a " +
  "presença do Diretor Tasso Mendonça Júnior, do Diretor Roger Romão Cabral e do Diretor José " +
  "Fernando de Mendonça Gomes Júnior.";

// Item 3.5.1 real da 79ª ROP (CFEM municípios): divergência atribuída SÓ pelo cargo.
const ITEM_DIVERGENCIA_CARGO =
  "3.5. ASSUNTO: Recursos em 2ª instância do repasse de CFEM aos municípios. VOTO: Diante do " +
  "exposto, VOTO por: NEGAR PROVIMENTO aos recursos de segunda instância. DELIBERAÇÃO: Voto do " +
  "relator aprovado por maioria dos diretores, com divergência apresentada pelo Diretor-Geral em " +
  "relação ao não conhecimento dos recursos interpostos pelos municípios.";

// Item 4.2.1 real da 80ª ROP: divergência com nome INLINE ("Diretor Revisor José Fernando…").
const ITEM_DIVERGENCIA_INLINE =
  "DELIBERAÇÃO: Voto do relator, Diretor-Geral, aprovado por maioria dos diretores presentes com " +
  "divergência apresentada pelo Diretor Revisor José Fernando de Mendonça Gomes Júnior.";

describe("ANM — Diretor-Geral resolvido pelo preâmbulo [PR-K]", () => {
  it("extractDiretorGeralName lê 'presidida pelo Diretor-Geral, NOME'", () => {
    expect(extractDiretorGeralName(PREAMBULO_79)).toBe("Mauro Henrique Moreira Sousa");
  });
  it("buildRoleMap mapeia diretor-geral → nome", () => {
    expect(buildRoleMap(PREAMBULO_79)["diretor-geral"]).toBe("Mauro Henrique Moreira Sousa");
  });
});

describe("ANM — divergência NOMEADA atribuída ao diretor certo [PR-K]", () => {
  it("cargo ('pelo Diretor-Geral') resolve para o nome do preâmbulo", () => {
    const roleMap = { "diretor-geral": "Mauro Henrique Moreira Sousa" };
    expect(extractDivergentesNomeados(ITEM_DIVERGENCIA_CARGO, roleMap)).toContain(
      "Mauro Henrique Moreira Sousa",
    );
  });

  it("nome INLINE ('Diretor Revisor José Fernando…') — 'Revisor' é descartado", () => {
    const nomes = extractDivergentesNomeados(ITEM_DIVERGENCIA_INLINE, {});
    expect(nomes).toContain("José Fernando de Mendonça Gomes Júnior");
    expect(nomes.some((n) => /^Revisor/i.test(n))).toBe(false);
  });

  it("extractItemVotes: o Diretor-Geral vai para CONTRA (não some, não vira favor)", () => {
    const roleMap = buildRoleMap(PREAMBULO_79);
    const votes = extractItemVotes(ITEM_DIVERGENCIA_CARGO, roleMap);
    expect(votes.contra).toContain("Mauro Henrique Moreira Sousa");
    expect(votes.favor).not.toContain("Mauro Henrique Moreira Sousa");
  });

  it("doc único: extractFields joga o dissidente para nomes_votacao_contra", () => {
    const f = extractFields(`${PREAMBULO_79}\n${ITEM_DIVERGENCIA_CARGO}`);
    expect(f.nomes_votacao_contra).toContain("Mauro Henrique Moreira Sousa");
  });
});

describe("ANM — contestado sem atribuição NÃO fabrica unanimidade [PR-K]", () => {
  it("'voto de qualidade' sem dissidente nomeado → não grava todos como favoráveis", () => {
    // 79ª ROP item 1.4.1: empate resolvido por voto de qualidade; ninguém casa "divergência
    // apresentada pelo X" aqui → o item deve ir para REVISÃO (favor vazio), não todos-favor.
    const texto =
      `${PREAMBULO_79}\n1.4. ASSUNTO: Recurso contra não aprovação do RFP. DELIBERAÇÃO: Voto do ` +
      "Relator, Diretor-Geral, aprovado por maioria dos diretores presentes com cômputo do voto de " +
      "qualidade proferido pelo Diretor-Geral.";
    const f = extractFields(texto);
    expect(f.nomes_votacao_favor).toEqual([]);
    expect(f.nomes_votacao).toEqual([]);
  });
});

describe("ANM — sobrestado por pedido de vista → sem decisão final [PR-K]", () => {
  it("item com 'VOTO pela aprovação' MAS 'sobrestada em razão do pedido de vistas' = Retirado de Pauta", () => {
    const ata =
      "ATA 34ª REUNIÃO EXTRAORDINÁRIA PÚBLICA DA DIRC/ANM.\n" +
      "2.7. ASSUNTO: Emissão de Guia de Utilização.\n" +
      "2.7.1 PROCESSO Nº: 27205.851966/1992-13\n" +
      "INTERESSADO: Bravo Mineração Ltda.\n" +
      "VOTO: Pelo exposto, VOTO pela aprovação da Guia de Utilização requerida por BRAVO MINERAÇÃO LTDA.\n" +
      "DELIBERAÇÃO: Após voto favorável do Diretor Roger Romão Cabral, a deliberação foi sobrestada " +
      "em razão do pedido de vistas ao processo pelo Diretor José Fernando de Mendonça Gomes Júnior.\n" +
      "2.8. ASSUNTO: Recurso contra nulidade de alvará de pesquisa.\n" +
      "2.8.1 PROCESSO Nº: 48414.848285/2015-11\n" +
      "INTERESSADO: Miguel Domingos Costalonga.\n" +
      "VOTO: Diante do exposto VOTO por negar provimento.\n" +
      "DELIBERAÇÃO: Voto aprovado por unanimidade pelos diretores presentes.";
    const items = splitAtaItems(ata);
    const sobrestado = items.find((i) => i.item_numero === "2.7.1");
    expect(sobrestado?.resultado).toBe("Retirado de Pauta");
  });
});
