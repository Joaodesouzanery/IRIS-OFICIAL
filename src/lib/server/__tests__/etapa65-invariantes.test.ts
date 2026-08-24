/**
 * Etapa 65 — INVARIANTES GLOBAIS.
 *
 * O gabarito de certificação tem 153 expectativas em 16 documentos (~10 por documento) e cobre,
 * por construção, apenas o que soubemos prever. Expectativa NEGATIVA pega regressão sem exigir
 * previsão: não descreve o valor certo, descreve o que é impossível.
 *
 * A primeira invariante desta suíte — "nenhuma taxa acima de 100%" — já provou o ponto três vezes:
 * pegou os dois casos de assimetria numerador×denominador da revisão adversarial E a divergência
 * de `taxa_sancao` do `analytics-engine`, que nenhuma expectativa positiva procurava.
 */

import { describe, it, expect } from "vitest";
import type { Deliberacao } from "@/types";
import {
  computeOverview,
  computeMandatosAnalytics,
  computeMandatosStats,
  computeConsensoTimeline,
  computeMicrotemas,
  computeEmpresas,
  computeVotacaoDistribution,
  computeDiretoresOverview,
  computeReunioesList,
} from "@/lib/server/analytics-engine";
import { decisionStatus } from "@/lib/server/regulatory-documents";
import { buildVotoRows, type DiretorVoteRecord } from "@/lib/server/vote-inference";

// ─── Fábrica de deliberações ADVERSARIAIS ────────────────────────────────────
// Cada linha existe para violar uma suposição específica: item retirado que carrega microtema de
// sanção, item de admissibilidade com resultado positivo, item sem voto nenhum, item só com
// ausentes. São exatamente os estados que o denominador de mérito da etapa60 separou — e os que
// quebram a taxa quando numerador e divisor moram em universos diferentes.
let seq = 0;
function delib(over: Partial<Deliberacao> = {}): Deliberacao {
  seq += 1;
  return {
    id: `d${seq}`,
    agencia_id: "ag1",
    tipo_documento: "deliberacao",
    documento_pai_id: null,
    numero: `${seq}`,
    data_reuniao: "2026-03-10",
    resultado: "Deferido",
    microtema: null,
    interessado: "Empresa X",
    assunto: "assunto",
    extraction_confidence: 0.9,
    raw_extraction: null,
    votos: [],
    ...over,
  } as unknown as Deliberacao;
}

const CORPUS_ADVERSARIAL: Deliberacao[] = [
  // Mérito de verdade — a única linha que pode entrar num denominador de mérito.
  delib({ resultado: "Deferido" }),
  delib({ resultado: "Indeferido", microtema: "multa" }),
  // RETIRADO com microtema de sanção: numerador sobre `rows` + divisor sobre decididos ⇒ >100%.
  delib({ resultado: "Retirado de Pauta", microtema: "multa" }),
  delib({ resultado: "Retirado de Pauta", microtema: "multa" }),
  delib({ resultado: "Retirado de Pauta", microtema: "multa" }),
  // ADMISSIBILIDADE com resultado positivo: não é mérito, mas "Deferido" atrai numerador.
  delib({ resultado: "Deferido", raw_extraction: { juizo: "admissibilidade" } }),
  delib({ resultado: "Indeferido", microtema: "multa", raw_extraction: { juizo: "admissibilidade" } }),
  // SEM RESULTADO — lacuna de dado, não decisão.
  delib({ resultado: null, microtema: "multa" }),
  // Sem voto nenhum: base zero para consenso.
  delib({ resultado: "Deferido", votos: [] }),
  // Só AUSENTES: há linha de voto, mas ninguém votou — não é consenso de 100%.
  delib({
    resultado: "Deferido",
    votos: [
      { diretor_id: "x", tipo_voto: "Ausente", is_divergente: false, is_nominal: true },
      { diretor_id: "y", tipo_voto: "Ausente", is_divergente: false, is_nominal: true },
    ],
  } as Partial<Deliberacao>),
  // Divergência real.
  delib({
    resultado: "Deferido",
    votos: [
      { diretor_id: "x", tipo_voto: "Favoravel", is_divergente: false, is_nominal: true },
      { diretor_id: "y", tipo_voto: "Desfavoravel", is_divergente: true, is_nominal: true },
    ],
  } as Partial<Deliberacao>),
];

/** Toda string "12.3%" / número 0..100 que qualquer agregação publique. */
function pctsDe(valor: unknown, caminho = "$"): Array<{ caminho: string; pct: number }> {
  const out: Array<{ caminho: string; pct: number }> = [];
  const visita = (v: unknown, path: string) => {
    if (v == null) return;
    if (Array.isArray(v)) { v.forEach((x, i) => visita(x, `${path}[${i}]`)); return; }
    if (typeof v === "object") {
      for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
        const p = `${path}.${k}`;
        const ehTaxa = /^(taxa_|pct_|percentual|cobertura_|indice_)/.test(k) || /_pct$/.test(k);
        if (ehTaxa && typeof val === "string" && /^-?[\d.]+%$/.test(val)) {
          out.push({ caminho: p, pct: parseFloat(val) });
        } else if (ehTaxa && typeof val === "number") {
          out.push({ caminho: p, pct: val });
        } else {
          visita(val, p);
        }
      }
      return;
    }
  };
  visita(valor, caminho);
  return out;
}

const AGREGACOES: Array<[string, (d: Deliberacao[]) => unknown]> = [
  ["computeOverview", (d) => computeOverview(d)],
  ["computeMandatosAnalytics", (d) => computeMandatosAnalytics(d)],
  ["computeMandatosStats", (d) => computeMandatosStats(d)],
  ["computeConsensoTimeline", (d) => computeConsensoTimeline(d)],
  ["computeMicrotemas", (d) => computeMicrotemas(d)],
  ["computeEmpresas", (d) => computeEmpresas(d)],
  ["computeVotacaoDistribution", (d) => computeVotacaoDistribution(d)],
  ["computeDiretoresOverview", (d) => computeDiretoresOverview(d)],
];

describe("etapa65 · invariante 1 — nenhuma taxa pode exceder 100%", () => {
  it.each(AGREGACOES)("%s não publica taxa fora de [0, 100]", (_nome, fn) => {
    for (const { caminho, pct } of pctsDe(fn(CORPUS_ADVERSARIAL))) {
      expect(pct, `${caminho} = ${pct}% — numerador e divisor em universos diferentes`)
        .toBeLessThanOrEqual(100);
      expect(pct, `${caminho} = ${pct}% — taxa negativa`).toBeGreaterThanOrEqual(0);
    }
  });

  it("base VAZIA não produz taxa fora de faixa nem NaN", () => {
    for (const [nome, fn] of AGREGACOES) {
      for (const { caminho, pct } of pctsDe(fn([]))) {
        expect(Number.isFinite(pct), `${nome}${caminho} = ${pct}`).toBe(true);
        expect(pct).toBeGreaterThanOrEqual(0);
        expect(pct).toBeLessThanOrEqual(100);
      }
    }
  });
});

describe("etapa65 · invariante 2 — denominador nunca menor que numerador", () => {
  it("os quatro estados somam o pautado, e o decidido nunca excede o total", () => {
    const a = computeMandatosAnalytics(CORPUS_ADVERSARIAL);
    expect(a.total_decidido).toBeLessThanOrEqual(a.total_deliberacoes);
    expect(a.total_com_voto).toBeLessThanOrEqual(a.total_deliberacoes);
  });

  it("na timeline, consensuais + divergentes = com_voto, e com_voto ≤ total", () => {
    for (const m of computeConsensoTimeline(CORPUS_ADVERSARIAL)) {
      expect(m.consensuais + m.divergentes, `período ${m.period}`).toBe(m.total_com_voto);
      expect(m.total_com_voto, `período ${m.period}`).toBeLessThanOrEqual(m.total_itens);
    }
  });

  it("os quatro estados de decisão são mutuamente exclusivos e cobrem tudo", () => {
    const contagem = { decidido: 0, admissibilidade: 0, retirado: 0, sem_resultado: 0 };
    for (const d of CORPUS_ADVERSARIAL) contagem[decisionStatus(d as never)] += 1;
    const soma = Object.values(contagem).reduce((s, n) => s + n, 0);
    expect(soma).toBe(CORPUS_ADVERSARIAL.length);
    expect(contagem.retirado).toBeGreaterThan(0);
    expect(contagem.admissibilidade).toBeGreaterThan(0);
  });
});

describe("etapa65 · invariante 3 — item RETIRADO não carrega juízo de mérito", () => {
  it("estado e juízo são ortogonais: retirado nunca é decidido", () => {
    for (const d of CORPUS_ADVERSARIAL) {
      if ((d as { resultado?: string }).resultado === "Retirado de Pauta") {
        expect(decisionStatus(d as never), "retirado não pode ser mérito").not.toBe("decidido");
      }
    }
  });

  it("admissibilidade com resultado POSITIVO continua fora do mérito", () => {
    expect(decisionStatus({ resultado: "Deferido", raw_extraction: { juizo: "admissibilidade" } }))
      .toBe("admissibilidade");
  });
});

// ─── Invariantes sobre as LINHAS DE VOTO produzidas (não sobre as agregações) ─────────────────
describe("etapa65 · invariante 4 — impedido NUNCA tem voto diferente de Ausente", () => {
  const diretores: DiretorVoteRecord[] = [
    { id: "a", nome: "Ana Ribeiro Lopes", nome_variantes: [] },
    { id: "b", nome: "Bruno Cardoso Melo", nome_variantes: [] },
    { id: "c", nome: "Carla Duarte Pinto", nome_variantes: [] },
  ];

  it("impedido não vira Favoravel nem quando a inferência por mandato está ligada", () => {
    const rows = buildVotoRows({
      deliberacao_id: "d1",
      nomes: ["Ana Ribeiro Lopes", "Bruno Cardoso Melo"],
      nomesContra: [],
      nomesImpedido: ["Carla Duarte Pinto"],
      diretoresList: diretores,
      activeDiretoresList: diretores,
      inferFromMandate: true,
      resultado: "Deferido",
      unanime: true,
    });
    const carla = rows.filter((r) => r.diretor_id === "c");
    for (const r of carla) {
      expect(r.tipo_voto, "impedido só pode figurar como Ausente").toBe("Ausente");
      expect(r.is_divergente, "impedido não diverge — ele não votou").toBe(false);
    }
  });

  it("impedido declarado TAMBÉM como favorável não sobrevive como voto", () => {
    // Precedência máxima do impedimento: se a ata cita o nome nos dois lugares, quem não votou
    // não pode aparecer votando — é assim que se fabrica voto de agente público.
    const rows = buildVotoRows({
      deliberacao_id: "d1",
      nomes: ["Ana Ribeiro Lopes", "Carla Duarte Pinto"],
      nomesContra: ["Carla Duarte Pinto"],
      nomesImpedido: ["Carla Duarte Pinto"],
      diretoresList: diretores,
      activeDiretoresList: diretores,
      inferFromMandate: false,
      resultado: "Deferido",
    });
    for (const r of rows.filter((r) => r.diretor_id === "c")) {
      expect(r.tipo_voto).toBe("Ausente");
    }
  });
});

describe("etapa65 · invariante 5 — nenhum voto para quem não estava no mandato", () => {
  const todos: DiretorVoteRecord[] = [
    { id: "a", nome: "Ana Ribeiro Lopes", nome_variantes: [] },
    { id: "b", nome: "Bruno Cardoso Melo", nome_variantes: [] },
    { id: "z", nome: "Zeno Antigo Ferraz", nome_variantes: [] }, // fora do mandato na data
  ];
  const ativos = todos.filter((d) => d.id !== "z");

  it("a inferência por mandato só alcança quem está ATIVO na data", () => {
    const rows = buildVotoRows({
      deliberacao_id: "d1",
      nomes: [],
      nomesContra: [],
      diretoresList: todos,
      activeDiretoresList: ativos,
      inferFromMandate: true,
      resultado: "Deferido",
      unanime: true,
    });
    const ativosIds = new Set(ativos.map((d) => d.id));
    for (const r of rows) {
      expect(ativosIds.has(r.diretor_id), `voto para ${r.diretor_id}, fora do mandato`).toBe(true);
    }
  });

  it("nome CITADO na ata continua valendo mesmo fora da lista de ativos — é voto em autos, não fabricação", () => {
    // A exceção legítima: a ata NOMEIA o diretor. Aí a evidência é o documento, não a inferência.
    const rows = buildVotoRows({
      deliberacao_id: "d1",
      nomes: ["Zeno Antigo Ferraz"],
      nomesContra: [],
      nomesEmAutos: ["Zeno Antigo Ferraz"],
      diretoresList: todos,
      activeDiretoresList: ativos,
      inferFromMandate: false,
      resultado: "Deferido",
    });
    expect(rows.some((r) => r.diretor_id === "z"), "voto nominal em autos não pode sumir").toBe(true);
  });
});

describe("etapa65 · invariante 6 — consenso exige base de voto", () => {
  it("deliberação sem voto NÃO conta como consensual", () => {
    const so_sem_voto = [delib({ votos: [] }), delib({ votos: [] })];
    const a = computeMandatosAnalytics(so_sem_voto);
    expect(a.total_com_voto, "sem voto não há base de consenso").toBe(0);
  });

  it("sem base, o consenso é `null` — NUNCA 0 — em TODA agregação que o publica", () => {
    // A decisão existia só em `governanca-agencias`; `consenso-timeline` e três agregações do
    // engine ainda publicavam 0. A inconsistência fazia a MESMA reunião aparecer com "0% consenso"
    // num painel e "—" no outro. Aqui a regra é medida, não descrita num comentário.
    const semBase = [delib({ votos: [] }), delib({ votos: [] })];
    for (const m of computeConsensoTimeline(semBase)) {
      expect(m.total_com_voto, "pré-condição: não há base").toBe(0);
      expect(m.pct_consenso, "sem base o consenso é null, não 0").toBeNull();
    }
    for (const r of computeReunioesList(semBase)) {
      expect(r.pct_consenso, "sem base o consenso é null, não 0").toBeNull();
    }
  });

  it("com base, o consenso volta a ser número — o `null` não engoliu o caminho feliz", () => {
    const comBase = [
      delib({
        votos: [
          { diretor_id: "x", tipo_voto: "Favoravel", is_divergente: false, is_nominal: true },
          { diretor_id: "y", tipo_voto: "Favoravel", is_divergente: false, is_nominal: true },
        ],
      } as Partial<Deliberacao>),
    ];
    for (const m of computeConsensoTimeline(comBase)) {
      expect(m.pct_consenso).toBe(100);
    }
  });

  it("array só de AUSENTES não vira consenso de 100%", () => {
    const so_ausentes = [
      delib({
        votos: [
          { diretor_id: "x", tipo_voto: "Ausente", is_divergente: false, is_nominal: true },
          { diretor_id: "y", tipo_voto: "Ausente", is_divergente: false, is_nominal: true },
        ],
      } as Partial<Deliberacao>),
    ];
    const a = computeMandatosAnalytics(so_ausentes);
    expect(a.total_com_voto, "ninguém votou — não há base").toBe(0);
  });
});
