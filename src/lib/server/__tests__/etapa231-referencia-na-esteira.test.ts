/**
 * Etapa 231 (Fase 39, passo 1) — a referência do site vira passo do Rodar Tudo.
 *
 * Decisão do usuário: a conferência roda na esteira (não em cron, não só no botão). As propriedades:
 *  · roda na SOBRA, antes do placar, e para de tentar quando as três agências ficam em dia;
 *  · cabe numa fatia: ARTESP/ANM primeiro, ANTT por último pulando o que a referência já sabe;
 *  · reunião pulada CONTA como enumerada (senão a ANTT nunca carimbaria a referência).
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";
import { gravarReferencia } from "../referencia-site";
import { naturezaDaChave } from "../agregar-rodadas";

const RAIZ = join(__dirname, "../../../..");
const semComentarios = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/\/\/[^\n]*/g, " ");
const RUN = semComentarios(readFileSync(join(RAIZ, "src/app/api/v1/pipeline/run/route.ts"), "utf-8"));
const COB = semComentarios(readFileSync(join(RAIZ, "src/app/api/v1/admin/cobertura-ao-vivo/route.ts"), "utf-8"));

describe("etapa231 · a referência na esteira", () => {
  it("roda ANTES do placar, para ele já ler a referência nova", () => {
    const iRef = RUN.indexOf("coberturaAoVivoGET,");
    const iPlacar = RUN.indexOf("placarGET,");
    expect(iRef).toBeGreaterThan(-1);
    expect(iRef).toBeLessThan(iPlacar);
  });

  it("na SOBRA (fora do plano de passos) e com teto", () => {
    expect(RUN).toMatch(/chamarComSobra\(\s*coberturaAoVivoGET,/);
    expect(RUN).toMatch(/Math\.min\(sobraParaReferencia, TETO_REFERENCIA_MS\)/);
    expect(RUN).toMatch(/sobraParaReferencia >= SOBRA_MINIMA_REFERENCIA_MS/);
  });

  it("1× por execução = até as TRÊS agências em dia, com teto de tentativas", () => {
    expect(RUN).toMatch(/referencia_conferida: emDia\.length >= 3 \? 1 : 0/);
    expect(RUN).toMatch(/execucao\?\.contadores\?\.\["referencia_conferida"\]/);
    expect(RUN).toMatch(/tentativasDeReferencia >= MAX_TENTATIVAS_REFERENCIA/);
  });

  it("os números da referência e do livro são RETRATO — somar tentativas diria '9 agências em dia'", () => {
    expect(naturezaDaChave("referencia_agencias_em_dia")).toBe("estoque");
    for (const s of ["anm", "antt", "artesp"]) {
      for (const k of ["livro_prontas_", "livro_total_", "livro_trabalho_nosso_", "livro_referencia_ok_"]) {
        expect(naturezaDaChave(`${k}${s}`), `${k}${s}`).toBe("estoque");
      }
    }
    expect(naturezaDaChave("referencia_tentativas")).toBe("evento");
  });
});

describe("etapa231 · a conferência cabe numa fatia", () => {
  it("honra `budget_ms` (era HOBBY_BUDGET_MS fixo — fora de qualquer fatia)", () => {
    expect(COB).toMatch(/const deadlineAt = Date\.now\(\) \+ budgetFromRequest\(req\)/);
    expect(COB).not.toMatch(/Date\.now\(\) \+ HOBBY_BUDGET_MS/);
  });

  it("ARTESP e ANM são buscadas ANTES da discovery da ANTT, que come o que sobrar", () => {
    const iPaginas = COB.indexOf("fetchTextSafe(ARTESP_URL");
    const iAntt = COB.indexOf("discoverAntt2026Meetings(");
    expect(iPaginas).toBeGreaterThan(-1);
    expect(iPaginas).toBeLessThan(iAntt);
  });

  it("a ANTT pula o que a referência já sabe, e as puladas contam como vistas", () => {
    expect(COB).toMatch(/skipMeetingUrls: new Set\(conhecidas\.keys\(\)\)/);
    expect(COB).toMatch(/itens: anttLinhas\.length \+ anttPuladas/);
    // O `site` da conferência também as inclui — senão viravam "extra" no banco.
    expect(COB).toMatch(/\.\.\.\[\.\.\.conhecidas\.values\(\)\]\.map\(String\)/);
  });

  it("enumeração com tudo pulado (0 linhas novas, N vistas) CARIMBA a referência e não grava linha", async () => {
    const chamadas: Array<{ tabela: string; payload: any }> = [];
    const db = {
      from(tabela: string) {
        const q: any = {
          select: () => q, eq: () => q, in: async () => ({ data: [], error: null }),
          upsert: async (payload: any) => { chamadas.push({ tabela, payload }); return { error: null }; },
        };
        return q;
      },
    };
    const r = await gravarReferencia(db, { agenciaId: "antt", linhas: [], tentativas: [{ fonte: "f", erro: null, parcial: false, itens: 30 }] });
    expect(r).toMatchObject({ gravada: true, linhas: 0, fontes_boas: 1, fontes: 1 });
    expect(chamadas.some((c) => c.tabela === "reunioes_referencia")).toBe(false);
    expect(chamadas.find((c) => c.tabela === "referencia_fontes")!.payload).toHaveProperty("ultima_boa_em");
  });

  it("a resposta diz quais agências ficaram EM DIA — é o que a esteira lê", () => {
    expect(COB).toMatch(/referencia_em_dia: Object\.entries\(referencia_gravada\)/);
    expect(COB).toMatch(/r\.fontes_boas === r\.fontes/);
  });
});
