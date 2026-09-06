/**
 * Etapa 119 (Fase 20, commit 5) — o RODÍZIO DE PRIVILÉGIO: quem materializa deixa de ficar de fora.
 *
 * ═══ O que a medição mostrou ═══
 * Rodando o planejador REAL com o orçamento REAL (70s − 4s de folga = 66s), 24 rodadas sob
 * drenagem permanente (o cenário ARTESP: fila que nunca esvazia), o plano antigo dava:
 *
 *     extracao 24/24 · confirmLote **2/24** · enqueue **4/24** · coleta **2/24**
 *
 * A extração (23s de custo) era semeada e escolhia primeiro; os passos BARATOS enchiam o resto; e
 * os três passos CAROS — os que ENFILEIRAM, APROVAM e COLETAM — quase nunca cabiam. É a explicação
 * mecânica de "12 PDFs extraídos · 26 materializados": a esteira drenava o que já tinha e não
 * ingeria nem aprovava nada novo.
 *
 * ═══ Por que não é a inanição das Fases 7 e 10 ═══
 * Não é gate < reserva (Fase 7) nem fatia sem teto (Fase 10) — cada passo planejado recebe fatia
 * suficiente. É a COMPOSIÇÃO do plano: quem chega primeiro leva, e quem é caro nunca chega.
 *
 * ═══ Por que UM por rodada ═══
 * Semear os três junto com a extração custaria 23+18+25+28 e nada mais entraria — a mutação que a
 * salvaguarda da etapa94 já mata. O anel entrega o SEGUNDO lugar a um deles por vez: a extração
 * mantém 24/24 (a garantia da Fase 16 intacta) e cada faminto passa a entrar em 1/3 das rodadas.
 */

import { describe, it, expect } from "vitest";
import {
  planejarRodada, fatiaDoPasso, ORDEM_DOS_PASSOS, RESERVA, MARGEM_PARTIDA_MS,
  type PassoEsteira,
} from "@/lib/server/esteira-reservas";
import { HOBBY_BUDGET_MS } from "@/lib/server/time-budget";
import { readFileSync } from "fs";
import { join } from "path";

const RAIZ = join(__dirname, "../../../..");

/** O orçamento REAL de uma rodada: o da Hobby menos a folga que o orquestrador guarda. */
const ORCAMENTO = HOBBY_BUDGET_MS - 4_000;
const RODADAS = Array.from({ length: 24 }, (_, i) => i);

function frequencia(drenar: boolean): Record<string, number> {
  const c: Record<string, number> = {};
  for (const p of ORDEM_DOS_PASSOS) c[p] = 0;
  for (const r of RODADAS) for (const p of planejarRodada(r, ORCAMENTO, { drenar }).passos) c[p]++;
  return c;
}

describe("etapa119 · sob drenagem permanente, quem materializa entra", () => {
  const f = frequencia(true);

  // Tabular: o passo, e o piso que a MEDIÇÃO estabeleceu (antigo → novo).
  // Tabular: o passo, quantas rodadas ele tinha ANTES do anel, e o piso medido DEPOIS.
  // Os pisos são os valores medidos, não arredondados para baixo: `planejarRodada` é pura e
  // determinística, então uma barra frouxa não protegeria nada — e retunar o anel DEVE exigir
  // refazer a medição.
  const FAMINTOS: Array<[PassoEsteira, number, number]> = [
    ["confirmLote", 2, 5],
    ["enqueue", 4, 6],
    ["coleta", 2, 5],
  ];

  for (const [passo, antes, piso] of FAMINTOS) {
    it(`«${passo}» entra em ≥ ${piso}/24 rodadas (era ${antes}/24 — afogado pela drenagem)`, () => {
      expect(f[passo]).toBeGreaterThanOrEqual(piso);
    });
  }


  it("os passos que produzem VOTO não pagam a conta do anel", () => {
    // `reResultar` preenche `resultado`; `backfillVotos` o transforma em voto. Com o anel de 3
    // (só os caros) os dois caíam de 6/24 para 3/24 — o anel destravaria a ingestão cobrando
    // justamente do que esta fase existe para destravar. Por isso os dois são membros.
    expect(f.reResultar).toBeGreaterThanOrEqual(6);
    expect(f.backfillVotos).toBeGreaterThanOrEqual(5);
  });

  it("a primeira coleta da run não chega tarde (ela roda 1× por run — etapa93)", () => {
    const primeira = RODADAS.find((r) => planejarRodada(r, ORCAMENTO, { drenar: true }).passos.has("coleta"));
    expect(primeira).toBeLessThanOrEqual(4);
  });

  it("a extração NÃO paga a conta: segue em toda rodada (a garantia da Fase 16)", () => {
    expect(f.extracao).toBe(RODADAS.length);
  });

  it("NENHUM passo é afogado a zero — o rodízio redistribui, não troca uma inanição por outra", () => {
    const zerados = ORDEM_DOS_PASSOS.filter((p) => f[p] === 0);
    expect(zerados, `passos que nunca entram sob drenagem: ${zerados.join(", ")}`).toEqual([]);
  });

  it("a garantia-mãe continua: nenhum passo planejado nasce com fatia menor que a reserva", () => {
    for (const r of RODADAS) {
      const { passos, protecao } = planejarRodada(r, ORCAMENTO, { drenar: true });
      for (const p of passos) {
        expect(fatiaDoPasso(p, ORCAMENTO, protecao[p] ?? 0), `rodada ${r}, «${p}»`)
          .toBeGreaterThanOrEqual(RESERVA[p] + MARGEM_PARTIDA_MS);
      }
    }
  });

  it("sem fila, o rodízio não existe — ele é resposta à drenagem, não um plano novo", () => {
    for (const r of RODADAS) {
      const semOpcao = planejarRodada(r, ORCAMENTO);
      const explicito = planejarRodada(r, ORCAMENTO, { drenar: false });
      expect([...explicito.passos].sort()).toEqual([...semOpcao.passos].sort());
    }
  });
});

describe("etapa119 · reparar ANTES de materializar", () => {
  it("`reResultar` vem antes de `backfillVotos` na ordem dos passos", () => {
    const ordem = [...ORDEM_DOS_PASSOS];
    // `reResultar` preenche `resultado`; `backfillVotos` exige `documento_pai_id && resultado`
    // para gerar voto. Na ordem antiga (4º × 13º) o item reparado só virava voto na rodada
    // SEGUINTE — uma rodada inteira de latência por item, com 232 itens da ANM na fila.
    expect(ordem.indexOf("reResultar")).toBeLessThan(ordem.indexOf("backfillVotos"));
  });

  it("…e depois de `confirmLote`, que é quem CRIA o filho a reparar", () => {
    const ordem = [...ORDEM_DOS_PASSOS];
    expect(ordem.indexOf("reResultar")).toBeGreaterThan(ordem.indexOf("confirmLote"));
  });
});

/**
 * ═══ A terceira parte do commit: o passo que roda INLINE também se registra ═══
 *
 * `call()` registra a tentativa; dois passos (`reclassificacao` e `reprocessarFalhados`) não
 * passam por `call()` — rodam direto contra o banco. Ficavam eternamente "não tentados", então
 * `passosNaoTentadosNaRun` nunca chegava a zero e `deveContinuar` pedia rodada extra em TODA
 * execução, inclusive na vazia. Era o piso de 15 rodadas que o usuário via como "25 minutos para
 * poucos documentos".
 *
 * O teste é TRANSVERSAL de propósito: varre TODOS os blocos `cabe("…")` da rota e cobra registro
 * de cada um. Um passo inline novo que esquecer de se registrar cai aqui — a classe, não os dois
 * casos de hoje.
 */
describe("etapa119 · todo passo planejado se REGISTRA como tentado", () => {
  const ROTA = readFileSync(join(RAIZ, "src/app/api/v1/pipeline/run/route.ts"), "utf-8");

  /** O corpo de cada bloco `if (cabe("X"))`, até o próximo bloco (ou o fim). */
  const blocos: Array<{ passo: string; corpo: string }> = [];
  const abrituras = [...ROTA.matchAll(/if \(cabe\("([a-zA-Z]+)"\)/g)];
  for (let i = 0; i < abrituras.length; i++) {
    const inicio = abrituras[i].index ?? 0;
    const fim = i + 1 < abrituras.length ? (abrituras[i + 1].index ?? ROTA.length) : ROTA.length;
    blocos.push({ passo: abrituras[i][1], corpo: ROTA.slice(inicio, fim) });
  }

  it("a rota tem blocos de passo para varrer (o teste não pode passar por vacuidade)", () => {
    expect(blocos.length).toBeGreaterThanOrEqual(10);
  });

  for (const { passo, corpo } of blocos) {
    it(`«${passo}» registra a tentativa — por call() ou explicitamente`, () => {
      const porCall = new RegExp(`await call\\([^)]*"${passo}"`, "s").test(corpo);
      const explicito = corpo.includes(`tentadosNaRodada.add("${passo}")`);
      expect(
        porCall || explicito,
        `«${passo}» roda mas nunca entra em tentadosNaRodada: deveContinuar vai pedir rodada extra para sempre`,
      ).toBe(true);
    });
  }
});
