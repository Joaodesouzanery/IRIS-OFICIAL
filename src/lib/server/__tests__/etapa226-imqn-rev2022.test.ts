/**
 * Etapa 226 — o módulo Qualidade Regulatória contra a planilha IMQN rev2022.
 *
 * A planilha oficial (`docs/metodologia/Matriz Qualidade Normativa_rev2022.xlsx`) foi extraída UMA
 * vez para `fixtures/imqn/planilha-rev2022.json` — textos com espaços normalizados, nada reescrito.
 * Estas expectativas conferem que o dado de produção (`src/lib/server/imqn/rev2022.json`) e o motor
 * (`imqn.ts`) reproduzem a planilha: os 10 critérios, os pesos, os valores de nível, cada condição
 * palavra por palavra, e a fórmula da aba INDICADOR.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";
import {
  IMQN_REV2022,
  classificacaoDoCriterio,
  condicoesPublicas,
  fracoesPelasCondicoes,
  imqnPelasCondicoes,
  imqnPorFracoes,
  notaComprovadaEMaxima,
  validarFracoes,
  type CriterioImqn,
} from "../imqn";

const PLANILHA = JSON.parse(readFileSync(join(__dirname, "fixtures/imqn/planilha-rev2022.json"), "utf-8"));
const M = IMQN_REV2022;
const criterio = (codigo: string) =>
  M.dimensoes.flatMap((d) => d.criterios).find((c) => c.codigo === codigo) as CriterioImqn;
const todas = () => new Set(M.dimensoes.flatMap((d) => d.criterios.flatMap((c) => c.condicoes.map((x) => x.id))));

describe("etapa226 · ① AIR e ARR têm subcritérios 30/35/35 — 10 critérios, não 6", () => {
  it("10 critérios no total", () => {
    expect(M.dimensoes.flatMap((d) => d.criterios)).toHaveLength(10);
  });

  it("AIR e ARR: Capacitação 0,30 · Metodologia 0,35 · Processo 0,35 — os valores da planilha", () => {
    for (const cod of ["AIR", "ARR"]) {
      const dim = M.dimensoes.find((d) => d.codigo === cod)!;
      expect(dim.criterios.map((c) => c.nome)).toEqual(["Capacitação", "Metodologia", "Processo"]);
      expect(dim.criterios.map((c) => c.peso_na_dimensao)).toEqual(PLANILHA.pesos_subcriterio[cod]);
    }
  });

  it("dentro de cada dimensão os pesos somam 1", () => {
    for (const d of M.dimensoes) {
      const s = d.criterios.reduce((x, c) => x + c.peso_na_dimensao, 0);
      expect(Math.abs(s - 1), d.codigo).toBeLessThan(1e-9);
    }
  });

  it("pesos das dimensões = planilha (25/15/20/15/10/15, soma 100), ids 1..6 do módulo", () => {
    expect(M.dimensoes.map((d) => d.peso)).toEqual([25, 15, 20, 15, 10, 15]);
    expect(M.dimensoes.reduce((s, d) => s + d.peso, 0)).toBe(100);
    expect(M.dimensoes.map((d) => d.id)).toEqual([1, 2, 3, 4, 5, 6]);
  });
});

describe("etapa226 · ② nível = conjunto de condições; a nota se distribui entre níveis (Σ = 1)", () => {
  it("valores de nível = planilha (1 / 0,7 / 0,35 / 0)", () => {
    expect(M.valores_nivel).toEqual(PLANILHA.valores_nivel);
  });

  it("⚠️ CADA condição é o texto da planilha, palavra por palavra", () => {
    let conferidas = 0;
    for (const crit of M.dimensoes.flatMap((d) => d.criterios)) {
      for (const nivel of ["inicial", "gerenciado", "melhoria_continua"] as const) {
        const nossas = crit.condicoes.filter((c) => c.nivel === nivel).map((c) => c.texto);
        expect(nossas, `${crit.codigo} ${nivel}`).toEqual(PLANILHA.condicoes[crit.codigo][nivel]);
        conferidas += nossas.length;
      }
    }
    expect(conferidas, "a planilha tem 73 condições").toBe(73);
  });

  it("o resumo dos 4 níveis de cada critério é a aba MATRIZ", () => {
    for (const crit of M.dimensoes.flatMap((d) => d.criterios)) {
      const chave = Object.keys(PLANILHA.resumo_niveis).find((k) => k.startsWith(`${crit.coluna_planilha}:`))!;
      expect(crit.resumo_niveis, crit.codigo).toEqual(PLANILHA.resumo_niveis[chave]);
    }
  });

  it("validarFracoes recusa Σ ≠ 1, fração negativa e > 1", () => {
    expect(validarFracoes({ gerenciado: 0.5, inicial: 0.5 }).ok).toBe(true);
    expect(validarFracoes({ gerenciado: 0.5, inicial: 0.4 }).ok).toBe(false);
    expect(validarFracoes({ gerenciado: 1.2, inicial: -0.2 }).ok).toBe(false);
    expect(validarFracoes({}).ok, "nenhuma fração não soma 1").toBe(false);
  });

  it("⚠️ fração inválida LANÇA — não vira nota acima de 100 num ranking público", () => {
    expect(() => classificacaoDoCriterio(M, { melhoria_continua: 1, gerenciado: 1 })).toThrow(/Σ/);
  });

  it("a fórmula da aba INDICADOR: Σ valor × fração", () => {
    expect(classificacaoDoCriterio(M, { melhoria_continua: 1 })).toBe(1);
    expect(classificacaoDoCriterio(M, { gerenciado: 1 })).toBeCloseTo(0.7, 12);
    expect(classificacaoDoCriterio(M, { gerenciado: 0.5, inicial: 0.5 })).toBeCloseTo(0.525, 12);
    // 85 do CURATED_NOTES antigo = metade MC, metade Gerenciado — válido no modelo distribuído
    expect(classificacaoDoCriterio(M, { melhoria_continua: 0.5, gerenciado: 0.5 })).toBeCloseTo(0.85, 12);
  });

  it("IMQN: AIR = 0,30·Cap + 0,35·Met + 0,35·Proc, vezes 25 pontos", () => {
    const r = imqnPorFracoes(M, {
      AIR_CAP: { melhoria_continua: 1 }, AIR_MET: { inexistente: 1 }, AIR_PROC: { inexistente: 1 },
    });
    expect(r.por_dimensao[0].nota).toBeCloseTo(0.3 * 25, 9);
    expect(r.total).toBeCloseTo(7.5, 9);
  });

  it("tudo em Melhoria Contínua = 100; nada avaliado = 0", () => {
    const tudo: Record<string, { melhoria_continua: number }> = {};
    for (const c of M.dimensoes.flatMap((d) => d.criterios)) tudo[c.codigo] = { melhoria_continua: 1 };
    expect(imqnPorFracoes(M, tudo).total).toBeCloseTo(100, 9);
    expect(imqnPorFracoes(M, {}).total).toBe(0);
  });
});

describe("etapa226 · das condições para as frações (cascata cumulativa, convenção declarada)", () => {
  const ps = criterio("PS");
  const ids = (n: string) => ps.condicoes.filter((c) => c.nivel === n).map((c) => c.id);

  it("nada atendido = inexistente", () => {
    expect(fracoesPelasCondicoes(ps, new Set())).toEqual({ inexistente: 1 });
  });

  it("Inicial completo e 2 de 4 do Gerenciado = metade/metade (0,525)", () => {
    const f = fracoesPelasCondicoes(ps, new Set([...ids("inicial"), ...ids("gerenciado").slice(0, 2)]));
    expect(f).toEqual({ inicial: 0.5, gerenciado: 0.5 });
    expect(classificacaoDoCriterio(M, f)).toBeCloseTo(0.525, 12);
  });

  it("⚠️ maturidade não pula degrau: Gerenciado inteiro sem o Inicial não vale Gerenciado", () => {
    const f = fracoesPelasCondicoes(ps, new Set(ids("gerenciado")));
    expect(f).toEqual({ inexistente: 1 });
  });

  it("todos os níveis completos = Melhoria Contínua", () => {
    expect(fracoesPelasCondicoes(ps, new Set(ps.condicoes.map((c) => c.id)))).toEqual({ melhoria_continua: 1 });
  });

  it("toda saída da cascata é uma distribuição válida (Σ = 1), para qualquer subconjunto", () => {
    for (const crit of M.dimensoes.flatMap((d) => d.criterios)) {
      for (let k = 0; k <= crit.condicoes.length; k++) {
        const f = fracoesPelasCondicoes(crit, new Set(crit.condicoes.slice(0, k).map((c) => c.id)));
        expect(validarFracoes(f).ok, `${crit.codigo} k=${k}`).toBe(true);
      }
    }
  });
});

describe("etapa226 · ③ pública / parcial / interna, e nota comprovada × máxima possível", () => {
  it("todo critério tem verificabilidade, e ela DERIVA das condições (não é afirmada à parte)", () => {
    for (const c of M.dimensoes.flatMap((d) => d.criterios)) {
      const vs = new Set(c.condicoes.map((x) => x.verificabilidade));
      const esperado = vs.size === 1 ? (vs.has("publica") ? "publica" : "interna") : "parcial";
      expect(c.verificabilidade, c.codigo).toBe(esperado);
    }
  });

  it("toda condição INTERNA diz por quê", () => {
    for (const c of M.dimensoes.flatMap((d) => d.criterios.flatMap((x) => x.condicoes))) {
      if (c.verificabilidade === "interna") expect(c.motivo, c.id).toBeTruthy();
    }
  });

  it("Capacitação (AIR e ARR) é interna; Metodologia (AIR e ARR) é pública", () => {
    expect(criterio("AIR_CAP").verificabilidade).toBe("interna");
    expect(criterio("ARR_CAP").verificabilidade).toBe("interna");
    expect(criterio("AIR_MET").verificabilidade).toBe("publica");
    expect(criterio("ARR_MET").verificabilidade).toBe("publica");
  });

  it("⚠️ a máxima verificável por fonte pública fica ABAIXO de 100 — e é publicada", () => {
    const r = notaComprovadaEMaxima(M, new Set());
    expect(r.comprovada).toBe(0);
    expect(r.maxima_teorica).toBe(100);
    expect(r.maxima_verificavel_publica).toBeGreaterThan(0);
    expect(r.maxima_verificavel_publica).toBeLessThan(100);
    /**
     * Calculado À MÃO, dimensão a dimensão, antes de o motor existir:
     *  AIR 25·(0,30·0 + 0,35·1 + 0,35·0,5833) = 13,85 · PS 15·0,525 = 7,875 · Estoque 20·0,85 = 17
     *  Agenda 15·0,525 = 7,875 · Processo 10·0,7 = 7 · ARR 15·(0 + 0,35 + 0,35·0,525) = 8,006
     *  Σ = 61,61 — fontes públicas conseguem provar no máximo ~62% da escala.
     */
    expect(r.maxima_verificavel_publica).toBeCloseTo(61.61, 2);
    expect(r.cobertura_verificavel_pct).toBe(r.maxima_verificavel_publica);
  });

  it("tudo comprovado = 100, e a comprovada pode passar a máxima pública (evidência do órgão)", () => {
    expect(notaComprovadaEMaxima(M, todas()).comprovada).toBeCloseTo(100, 6);
  });

  it("só as públicas comprovadas = exatamente a máxima verificável", () => {
    const r = notaComprovadaEMaxima(M, condicoesPublicas(M));
    expect(r.comprovada).toBe(r.maxima_verificavel_publica);
  });

  it("id de condição desconhecido é ignorado — não infla a nota", () => {
    expect(notaComprovadaEMaxima(M, new Set(["NAO.EXISTE.I"])).comprovada).toBe(0);
  });

  it("a soma por dimensão fecha com o total", () => {
    const r = imqnPelasCondicoes(M, condicoesPublicas(M));
    expect(r.por_dimensao.reduce((s, d) => s + d.nota, 0)).toBeCloseTo(r.total, 9);
  });
});

describe("etapa226 · ⑤ base legal por dimensão, marcada como NÃO conferida", () => {
  it("toda dimensão tem base legal e o flag de conferência", () => {
    for (const d of M.dimensoes) {
      expect(d.base_legal, d.codigo).toBeTruthy();
      expect(d.base_legal_conferida, `${d.codigo}: só o usuário confere base legal`).toBe(false);
    }
  });

  it("a mudança na base legal da Participação Social está DECLARADA", () => {
    const ps = M.dimensoes.find((d) => d.codigo === "PS")!;
    expect(ps.nota_base_legal).toMatch(/ALTERADO/);
  });

  it("a versão é rev2022", () => {
    expect(M.versao).toBe("rev2022");
  });
});
