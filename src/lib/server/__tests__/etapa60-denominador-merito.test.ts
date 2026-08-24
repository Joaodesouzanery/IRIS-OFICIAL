/**
 * Etapa 60 — DENOMINADOR: separar o que foi DECIDIDO do que foi apenas PAUTADO.
 *
 * Dois defeitos de aritmética que atravessavam o produto inteiro:
 *
 * 1. **Nenhuma rota excluía do denominador o que não foi julgado.** `resultado` carrega duas coisas
 *    no mesmo campo — o desfecho ("Deferido") e o ANDAMENTO ("Retirado de Pauta"). Item retirado,
 *    item sem resultado extraído e não-conhecimento ficavam no divisor sem entrar em numerador
 *    nenhum: a `taxa_deferimento` caía por causa de itens que NINGUÉM julgou. E, desde a Fase 1,
 *    "não conhecer por intempestividade" era contado como jurisprudência.
 *
 * 2. **`!votos.some(v => v.is_divergente)` é `true` para array VAZIO.** Item com ZERO voto era
 *    contado como CONSENSUAL em todos os agregados — governança, mandatos, timeline, reuniões.
 *    "Consenso de 100%" podia significar, literalmente, "ninguém votou". E significava, para toda
 *    deliberação recém-coletada sem voto extraído.
 */

import { describe, it, expect } from "vitest";
import {
  decisionStatus,
  isDecidedOnMerits,
  hasVoteEvidence,
  isConsensual,
} from "@/lib/server/regulatory-documents";

describe("etapa60 · os quatro estados", () => {
  it.each([
    [{ resultado: "Deferido" }, "decidido"],
    [{ resultado: "Indeferido" }, "decidido"],
    [{ resultado: "Parcialmente Deferido" }, "decidido"],
    [{ resultado: "Aprovado por Unanimidade" }, "decidido"],
    [{ resultado: "Retirado de Pauta" }, "retirado"],
    [{ resultado: null }, "sem_resultado"],
    [{ resultado: undefined }, "sem_resultado"],
    [{ resultado: "Indeferido", juizo: "admissibilidade" }, "admissibilidade"],
  ])("%o → %s", (row, esperado) => {
    expect(decisionStatus(row as any)).toBe(esperado);
  });

  it("«Parcialmente Deferido» é MÉRITO — está no enum mas fora de RESULTADOS_POSITIVOS", () => {
    // Achado do mapeamento, fora do plano: ele evaporava dos DOIS numeradores enquanto ficava no
    // denominador. Como estado, é decisão; como numerador, não é deferimento cheio. Os dois fatos
    // convivem — e é por isso que o denominador precisa ser um conceito separado do numerador.
    expect(isDecidedOnMerits({ resultado: "Parcialmente Deferido" })).toBe(true);
  });

  it("admissibilidade VENCE o resultado — não conhecer não é julgar o pedido", () => {
    // O CHECK de `resultado` não comporta valor novo, então um não-conhecimento pode ter chegado
    // ao banco como "Indeferido". O `juizo` é o que o tira dos dois lados da taxa.
    expect(isDecidedOnMerits({ resultado: "Indeferido", juizo: "admissibilidade" })).toBe(false);
  });

  it("lê o juízo do JSON enquanto a coluna não existir (deploy antes da migration)", () => {
    // Entre o deploy da Fase 1 e a migration, `juizo` só existe em raw_extraction. Sem o fallback,
    // todo documento ingerido nesse intervalo cairia no balde de mérito — em silêncio.
    expect(decisionStatus({ resultado: "Indeferido", raw_extraction: { juizo: "admissibilidade" } }))
      .toBe("admissibilidade");
  });

  it("a COLUNA prevalece sobre o JSON quando as duas existem", () => {
    expect(decisionStatus({ resultado: "Deferido", juizo: "merito", raw_extraction: { juizo: "admissibilidade" } }))
      .toBe("decidido");
  });
});

describe("etapa60 · item sem voto NÃO é consensual", () => {
  it("array vazio devolve null — desconhecido, não concordância", () => {
    expect(isConsensual([])).toBeNull();
    expect(isConsensual(null)).toBeNull();
    expect(isConsensual(undefined)).toBeNull();
    expect(hasVoteEvidence([])).toBe(false);
  });

  it("o bug literal: `!votos.some(...)` daria TRUE onde `isConsensual` dá null", () => {
    const votos: Array<{ is_divergente: boolean }> = [];
    expect(!votos.some((v) => v.is_divergente)).toBe(true); // o que o código fazia
    expect(isConsensual(votos)).toBeNull();                 // o que ele passa a fazer
  });

  it("com voto e sem divergência → consensual", () => {
    expect(isConsensual([{ is_divergente: false }, { is_divergente: false }])).toBe(true);
  });

  it("com voto e alguma divergência → NÃO consensual", () => {
    expect(isConsensual([{ is_divergente: false }, { is_divergente: true }])).toBe(false);
  });
});

describe("etapa60 · efeito nas taxas (aritmética do modo duplo)", () => {
  // 10 itens pautados: 5 decididos (3 deferidos, 2 indeferidos), 3 retirados, 1 sem resultado,
  // 1 não-conhecido. É a distribuição típica de uma ata da ANM.
  const itens = [
    { resultado: "Deferido" }, { resultado: "Deferido" }, { resultado: "Deferido" },
    { resultado: "Indeferido" }, { resultado: "Indeferido" },
    { resultado: "Retirado de Pauta" }, { resultado: "Retirado de Pauta" }, { resultado: "Retirado de Pauta" },
    { resultado: null },
    { resultado: "Indeferido", juizo: "admissibilidade" },
  ];

  it("a taxa de deferimento SOBE quando para de dividir por quem não foi julgado", () => {
    const pautado = itens.length;
    const decidido = itens.filter((i) => isDecidedOnMerits(i as any)).length;
    const deferidos = 3;
    expect(pautado).toBe(10);
    expect(decidido).toBe(5);
    // Antes: 3/10 = 30% — como se 5 itens não julgados fossem indeferimentos.
    expect(Math.round((deferidos / pautado) * 100)).toBe(30);
    // Depois: 3/5 = 60%. O número não "melhorou": ele parou de estar errado.
    expect(Math.round((deferidos / decidido) * 100)).toBe(60);
  });

  it("o pautado continua publicado — modo duplo, não substituição", () => {
    // O consumidor que lia `total` continua lendo a mesma coisa; quem quer o denominador honesto
    // agora tem `total_decidido` ao lado. Trocar o significado do campo antigo, em silêncio, seria
    // pior que o bug: mudaria todo painel sem ninguém perceber.
    const estados = itens.map((i) => decisionStatus(i as any));
    expect(estados.filter((e) => e === "decidido")).toHaveLength(5);
    expect(estados.filter((e) => e === "retirado")).toHaveLength(3);
    expect(estados.filter((e) => e === "sem_resultado")).toHaveLength(1);
    expect(estados.filter((e) => e === "admissibilidade")).toHaveLength(1);
    expect(estados).toHaveLength(10);
  });

  it("consenso: 2 itens com voto entre 5, um divergente → 50%, não 80%", () => {
    const delibs = [
      { votos: [{ is_divergente: false }] },
      { votos: [{ is_divergente: true }] },
      { votos: [] }, { votos: [] }, { votos: [] },
    ];
    const comVoto = delibs.filter((d) => isConsensual(d.votos) !== null).length;
    const consensuais = delibs.filter((d) => isConsensual(d.votos) === true).length;
    expect(comVoto).toBe(2);
    // Antes: (5 - 1) / 5 = 80% — os três itens sem voto entravam como concordância.
    expect(Math.round(((delibs.length - 1) / delibs.length) * 100)).toBe(80);
    // Depois: 1 / 2 = 50%, sobre a base que existe.
    expect(Math.round((consensuais / comVoto) * 100)).toBe(50);
  });

  it("base vazia não é consenso perfeito — nem 100%, nem 0%", () => {
    const delibs = [{ votos: [] }, { votos: [] }];
    expect(delibs.filter((d) => isConsensual(d.votos) !== null)).toHaveLength(0);
  });
});
