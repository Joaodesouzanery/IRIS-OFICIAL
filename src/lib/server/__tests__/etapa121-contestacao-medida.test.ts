/**
 * Etapa 121 (Fase 20, commit 3a) — MEDIR antes de mexer num número público.
 *
 * Duas mudanças no materializador estão prontas e NENHUMA foi ligada, porque as duas derrubam a
 * contagem de votos exibida na plataforma:
 *
 *  1. ler `resumo_pleito` (onde o dispositivo do item de ata mora) ao detectar contestação;
 *  2. usar um predicado de contestação que reconheça "divergência" e "voto vencedor".
 *
 * A rota computa as duas e reporta o delta; o comportamento continua o antigo. Este teste garante
 * que a MEDIÇÃO é honesta — que a diferença entre os predicados é real e do tamanho declarado.
 *
 * ═══ A divergência que ninguém tinha visto ═══
 * Há DUAS implementações do predicado. A do `nlp-extractor` reconhece `divergência` e
 * `voto vencedor`; a do `consistency-checks` não. E é a do `consistency-checks` que decide se o
 * colegiado INTEIRO ganha voto inferido — a mais estreita está no lugar mais perigoso.
 */

import { describe, it, expect } from "vitest";
import { RE_CONTESTADO, RE_CONTESTADO_AMPLO } from "@/lib/server/consistency-checks";
import { RE_CONTESTADO_NLP } from "@/lib/server/nlp-extractor";

/** Dispositivos no formato em que as atas realmente escrevem. */
const CONTESTADOS = [
  "Aprovado por maioria, vencido o Diretor Relator",
  "Deliberação aprovada por maioria de votos",
  "Decidido pelo voto de qualidade do Diretor-Geral",
  "Houve divergência do Diretor Substituto quanto ao mérito",
  "Aprovado, restando vencida a proposta do relator",
  "Prevaleceu o entendimento do voto vencedor",
  "Empate na votação, resolvido na forma regimental",
];

const NAO_CONTESTADOS = [
  "Aprovado por unanimidade dos presentes",
  "Retirado de Pauta a pedido do Relator",
  "Convertido em diligência",
  "Aprovado nos termos do voto do Relator",
];

describe("etapa121 · o predicado AMPLO cobre as DUAS implementações", () => {
  for (const texto of CONTESTADOS) {
    it(`reconhece contestação em «${texto.slice(0, 42)}…»`, () => {
      expect(RE_CONTESTADO_AMPLO.test(texto)).toBe(true);
    });
  }

  it("é superconjunto de AMBAS — se qualquer uma ganhar termo novo, este teste cai", () => {
    // Transversal de propósito: comparar par a par deixaria a próxima divergência passar.
    for (const texto of CONTESTADOS) {
      if (RE_CONTESTADO.test(texto)) expect(RE_CONTESTADO_AMPLO.test(texto), texto).toBe(true);
      if (RE_CONTESTADO_NLP.test(texto)) expect(RE_CONTESTADO_AMPLO.test(texto), texto).toBe(true);
    }
  });

  it("não alarga para o que NÃO é contestação — senão o remédio vira o próximo defeito", () => {
    for (const texto of NAO_CONTESTADOS) {
      expect(RE_CONTESTADO_AMPLO.test(texto), texto).toBe(false);
    }
  });
});

describe("etapa121 · a divergência entre os dois predicados é REAL e nesta direção", () => {
  it("o predicado do MATERIALIZADOR não vê «divergência» — o do extrator vê", () => {
    const texto = "Houve divergência do Diretor Substituto quanto ao mérito";
    // Este é o caso concreto: item assim recebe hoje "Favorável" fabricado para todo o colegiado.
    expect(RE_CONTESTADO.test(texto)).toBe(false);
    expect(RE_CONTESTADO_NLP.test(texto)).toBe(true);
  });

  it("…e o do extrator não vê «vencido» solto — a assimetria vai nos DOIS sentidos", () => {
    const texto = "Aprovado, vencidos os Diretores que acompanharam o relator";
    expect(RE_CONTESTADO.test(texto)).toBe(true);
    expect(RE_CONTESTADO_NLP.test(texto)).toBe(false);
  });
});

describe("etapa121 · a rota MEDE sem mudar comportamento", () => {
  const ROTA = require("fs").readFileSync(
    require("path").join(__dirname, "../../../../src/app/api/v1/admin/votos/materializar-faltantes/route.ts"),
    "utf-8",
  ) as string;

  it("a decisão de inferir continua saindo do predicado VIGENTE, não do medido", () => {
    // `contestado` (regra vigente) é o que alimenta a inferência; `contestadoComPleito` e o
    // AMPLO só alimentam contadores. Se um dia isto inverter sem a medição publicada, cai aqui.
    expect(ROTA).toMatch(/const contestado = RE_CONTESTADO\.test\(textoDecisao\)/);
    expect(ROTA).toMatch(/sinaisContestacao: contestado,/);
    expect(ROTA).not.toMatch(/sinaisContestacao: contestadoComPleito/);
    expect(ROTA).not.toMatch(/sinaisContestacao: RE_CONTESTADO_AMPLO/);
  });

  it("e o delta chega ao payload — medição que ninguém lê não é medição", () => {
    expect(ROTA).toMatch(/delta_dispositivo: \{/);
    expect(ROTA).toMatch(/votos_a_menos:/);
    expect(ROTA).toMatch(/por_regex_divergente:/);
  });
});
