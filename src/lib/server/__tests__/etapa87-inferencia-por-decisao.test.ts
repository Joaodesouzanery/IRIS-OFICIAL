/**
 * Etapa 87 (Fase 14, commit D) — inferência por DECISÃO: a escolha de produto do usuário.
 *
 * ═══ O número que motivou ═══
 * 136 das 160 deliberações finais da ANTT (85%) estavam SEM NENHUM voto — porque o item só
 * inferia com o token literal "unanimidade" no texto. A visão de produto, decidida pelo
 * usuário: "todos presentes, um voto de cada" — item APROVADO sem sinal de contestação e sem
 * dissidente nomeado infere Favorável para o roster, com proveniência própria
 * (`inferido_decisao`, que o schema já tinha e o buildVotoRows já atribui).
 *
 * ═══ O limite, também decidido ═══
 * "Por maioria"/"voto de qualidade"/"vencido" SEM nomes → continua 0 voto: inferir aí gravaria
 * Favorável para quem votou contra — chute de direção, a única coisa que este sistema nunca faz.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";
import { shouldInferVotesFromMandate, buildVotoRows } from "@/lib/server/vote-inference";

const RAIZ = join(__dirname, "../../../..");
const ler = (p: string) => readFileSync(join(RAIZ, p), "utf-8")
  .replace(/\/\*[\s\S]*?\*\//g, " ").replace(/\/\/[^\n]*/g, " ");

const BASE = {
  resultado: "Aprovado",
  tipo_documento: "ata",
  import_counts_as_final: true,
  unanimidadeDetectada: false, // ← SEM o token — o caso dos 136
  nomes: [] as string[],
  dataReuniao: "2026-04-10",
};

describe("etapa87 · o portão novo", () => {
  it("aprovado + sem token + sem dissenso + sem contestação → INFERE (o caso dos 136)", () => {
    expect(shouldInferVotesFromMandate({ ...BASE, sinaisContestacao: false })).toBe(true);
  });

  it("GUARDA: 'por maioria' sem nomes → NÃO infere (chute de direção)", () => {
    expect(shouldInferVotesFromMandate({ ...BASE, sinaisContestacao: true })).toBe(false);
  });

  it("GUARDA: quem não passa o sinal fica no comportamento antigo (conservador)", () => {
    // Chamador que não computa `sinaisContestacao` não ganha a inferência nova de graça —
    // undefined é tratado como "não sei se há contestação", e na dúvida não se infere.
    expect(shouldInferVotesFromMandate(BASE)).toBe(false);
  });

  it("unanimidade declarada continua inferindo, como sempre", () => {
    expect(shouldInferVotesFromMandate({ ...BASE, unanimidadeDetectada: true })).toBe(true);
  });

  it("sem data de reunião continua sem inferir — roster desconhecido", () => {
    expect(shouldInferVotesFromMandate({ ...BASE, sinaisContestacao: false, dataReuniao: null })).toBe(false);
  });

  it("dissidente NOMEADO continua no caminho de sempre (completa por mandato)", () => {
    expect(shouldInferVotesFromMandate({ ...BASE, nomesContra: ["Lucas Asfor"] })).toBe(true);
  });
});

describe("etapa87 · a proveniência distingue os dois modos", () => {
  const roster = [
    { id: "d1", nome: "Lucas Asfor", nome_variantes: [] },
    { id: "d2", nome: "Felipe Queiroz", nome_variantes: [] },
  ];

  it("inferido SEM unanimidade → `inferido_decisao`; COM → `inferido_unanimidade`", () => {
    const porDecisao = buildVotoRows({
      deliberacao_id: "x", nomes: [], nomesContra: [], diretoresList: roster,
      activeDiretoresList: roster, inferFromMandate: true, resultado: "Aprovado", unanime: false,
    });
    expect(porDecisao.length).toBe(2);
    for (const r of porDecisao) expect(r.proveniencia).toBe("inferido_decisao");

    const porUnanimidade = buildVotoRows({
      deliberacao_id: "x", nomes: [], nomesContra: [], diretoresList: roster,
      activeDiretoresList: roster, inferFromMandate: true, resultado: "Aprovado", unanime: true,
    });
    for (const r of porUnanimidade) expect(r.proveniencia).toBe("inferido_unanimidade");
  });
});

describe("etapa87 · os chamadores computam o sinal de contestação", () => {
  it("upload-analysis mede o sinal nos DOIS sítios (documento e item)", () => {
    // Contagem exata — asserção de presença deixou uma mutação passar (um sítio sem medir).
    const ua = ler("src/lib/server/upload-analysis.ts");
    const ocorrencias = ua.match(/sinaisContestacao: RE_CONTESTADO\.test\(/g) ?? [];
    expect(ocorrencias.length).toBe(2);
  });

  it("confirm e materializar passam o sinal ao portão genérico", () => {
    for (const arq of [
      "src/app/api/v1/upload/confirm/route.ts",
      "src/app/api/v1/admin/votos/materializar-faltantes/route.ts",
    ]) {
      expect(ler(arq), arq).toMatch(/sinaisContestacao: /);
    }
  });

  it("os DOIS ramos de item ANTT relaxam de 'unanimidade' para 'sem contestação'", () => {
    // É onde moram os 136 — e são dois bypasses (confirm p/ ingestão nova, materializar p/ o
    // estoque). A primeira bateria de mutação pegou o do confirm desprotegido.
    const mat = ler("src/app/api/v1/admin/votos/materializar-faltantes/route.ts");
    expect(mat).toMatch(/\(unanime \|\| !contestado\) && d\.resultado/);
    expect(mat).not.toMatch(/\? Boolean\(unanime && d\.resultado/);
    const conf = ler("src/app/api/v1/upload/confirm/route.ts");
    expect(conf).toMatch(/item\.unanimidade_detectada[\s\S]{0,120}?\|\| !RE_CONTESTADO\.test/);
    expect(conf).not.toMatch(/\? Boolean\(item\.unanimidade_detectada && item\.resultado/);
  });
});
