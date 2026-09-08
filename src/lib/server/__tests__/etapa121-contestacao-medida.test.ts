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
  "Aprovado, vencidos os Diretores que acompanharam o relator",
  // Trecho REAL da 34ª REP (item 2.1.1): só o extrator via isto; o vigente fabricava consenso.
  "ocupado pelo Diretor Guilherme Santana Lopes Gomes, com divergência parcial ao voto do relator",
  "Prevaleceu o entendimento do voto vencedor",
  "Empate na votação, resolvido na forma regimental",
];

const NAO_CONTESTADOS = [
  "Aprovado por unanimidade dos presentes",
  // Trecho REAL da 79ª ROP (itens 3.1.1-3.1.6), medido na etapa124: o vigente casa "vencida" aqui
  // e suprime o voto de um item unânime. Dez ocorrências no corpus, zero acertos.
  "lavrada em face do não pagamento da Taxa Anual por Hectare vencida em 29/07/2022, relativa ao primeiro ano de vigência. Voto aprovado por unanimidade pelos diretores presentes.",
  "Retirado de Pauta a pedido do Relator",
  "Convertido em diligência",
  "Aprovado nos termos do voto do Relator",
];

describe("etapa121 · o predicado CORRIGIDO cobre o que é contestação de verdade", () => {
  for (const texto of CONTESTADOS) {
    it(`reconhece contestação em «${texto.slice(0, 42)}…»`, () => {
      expect(RE_CONTESTADO_AMPLO.test(texto)).toBe(true);
    });
  }

  it("é superconjunto do EXTRATOR — se ele ganhar termo novo, este teste cai", () => {
    // Não é superconjunto do vigente de propósito: a medição (etapa124) provou que o `vencido`
    // solto dele tem zero acertos e dez erros no corpus. Herdá-lo seria herdar os erros.
    for (const texto of CONTESTADOS) {
      if (RE_CONTESTADO_NLP.test(texto)) expect(RE_CONTESTADO_AMPLO.test(texto), texto).toBe(true);
    }
  });

  it("o vigente marca «taxa vencida» como contestação — o falso positivo que a medição achou", () => {
    const taxa = NAO_CONTESTADOS[1];
    expect(RE_CONTESTADO.test(taxa)).toBe(true);        // o defeito, caracterizado
    expect(RE_CONTESTADO_AMPLO.test(taxa)).toBe(false); // o conserto
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
