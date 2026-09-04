/**
 * Etapa 109 (Fase 18, commit 2) — o alarme volta a EXISTIR, e passa a enxergar o que nenhum
 * percentual pega.
 *
 * ═══ A regressão (minha, de ontem) ═══
 * `monitoramento_alertas.item_id` é `UUID NOT NULL` (005:159) e o insert do alarme de fonte NÃO
 * manda `item_id` — alarme de FONTE não tem item. O Postgres devolve 23502, o supabase-js
 * devolve `{error}` em vez de lançar, eu descartei o retorno, e o `catch` não vê nada. Um alarme
 * perfeitamente calibrado que nunca escreveu uma linha. É a quarta vez que "capacidade sem
 * consumidor" aparece nesta série — desta vez o consumidor existia e quem faltou foi a escrita.
 *
 * ═══ Os dois cegamentos ═══
 * 1. `0 → 0` nunca dispara: o predicado compara com a run anterior, e `0 >= MIN` é falso. Uma
 *    fonte morta fica invisível a partir da SEGUNDA rodada — exatamente o caso da ANTT medido em
 *    produção (0 e 0, sem um alerta sequer).
 * 2. Queda de 26% (141 → 104, a ANM - Pautas das ROP) não dispara: o limiar exigia METADE.
 *
 * ═══ A regra da comparabilidade (a correção mais sutil desta fase) ═══
 * A tentação era "não alarmar em run truncada" — e isso criaria um ponto cego: se TODA run de
 * produção for truncada por orçamento (que é o caso comum), nenhuma comparação seria "justa" e o
 * alarme nunca dispararia. A regra certa não é completude, é COMPARABILIDADE: comparam-se runs
 * do mesmo TIPO DE GATILHO — a da esteira (fatia de ~28s) com outra da esteira, a do botão
 * (70s) com outra do botão. Duas runs truncadas do mesmo teto comparam normalmente; o que se
 * recusa é medir a de 28s contra a de 70s, porque aí `itens_encontrados` mede o ORÇAMENTO e não
 * a fonte.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";
import { avaliarSinaisDeFonte, MIN_ITENS_PARA_ALARME } from "@/lib/server/sinais-de-fonte";

const RAIZ = join(__dirname, "../../../..");
const ler = (p: string) => readFileSync(join(RAIZ, p), "utf-8");
const RUNNER = ler("src/lib/server/monitoring-runner.ts")
  .replace(/\/\*[\s\S]*?\*\//g, " ").replace(/\/\/.*$/gm, " ");
const MIGRATION = ler("supabase/migrations/20260905120000_alerta_de_fonte_sem_item.sql");

const base = {
  baseline: 141,
  atuais: 141,
  zerosSeguidos: 0,
  gatilho: "scheduled" as const,
  gatilhoBaseline: "scheduled" as const,
};

describe("etapa109 · COMPORTAMENTO: a queda que passava batido", () => {
  it("141 → 104 (−26%) DISPARA — antes precisaria cair a 70", () => {
    expect(avaliarSinaisDeFonte({ ...base, atuais: 104 })).toBe("queda_de_volume");
    // O limiar antigo (metade) deixava passar tudo acima de 70.
    expect(avaliarSinaisDeFonte({ ...base, atuais: 120 })).toBeNull();
  });

  it("fonte que sempre traz pouco NÃO vira ruído diário", () => {
    expect(avaliarSinaisDeFonte({ ...base, baseline: MIN_ITENS_PARA_ALARME - 1, atuais: 0 })).toBeNull();
  });
});

describe("etapa109 · COMPORTAMENTO: a ausência PERSISTENTE, que nenhum percentual pega", () => {
  it("0 → 0 → 0 dispara `fonte_muda` — o caso da ANTT medido em produção", () => {
    expect(avaliarSinaisDeFonte({ ...base, baseline: 284, atuais: 0, zerosSeguidos: 3 }))
      .toBe("fonte_muda");
  });

  it("o PRIMEIRO zero é queda, não mudez — a distinção importa para o texto do alerta", () => {
    expect(avaliarSinaisDeFonte({ ...base, baseline: 284, atuais: 0, zerosSeguidos: 1 }))
      .toBe("queda_de_volume");
  });

  it("mudez vence queda quando as duas valem — o sinal mais grave é o que aparece", () => {
    expect(avaliarSinaisDeFonte({ ...base, baseline: 284, atuais: 0, zerosSeguidos: 5 }))
      .toBe("fonte_muda");
  });
});

describe("etapa109 · COMPARABILIDADE (não completude) — a regra que fecha o ponto cego", () => {
  it("DUAS runs truncadas do MESMO gatilho comparam normalmente", () => {
    // Este é o caso que uma regra de "só compara run completa" mataria: em produção quase toda
    // run da esteira é truncada por orçamento. Se truncada não comparasse, o alarme nunca
    // dispararia — capacidade sem consumidor de novo, agora por excesso de zelo.
    expect(
      avaliarSinaisDeFonte({
        ...base, atuais: 104, truncada: true, truncadaBaseline: true,
      }),
    ).toBe("queda_de_volume");
  });

  it("run da ESTEIRA contra baseline do BOTÃO não compara — mediria orçamento, não fonte", () => {
    expect(
      avaliarSinaisDeFonte({ ...base, atuais: 10, gatilho: "scheduled", gatilhoBaseline: "manual" }),
    ).toBeNull();
  });

  it("…mas a MUDEZ atravessa gatilhos diferentes: zero é zero", () => {
    // Ausência persistente não é medida de volume — não depende de teto comparável.
    expect(
      avaliarSinaisDeFonte({
        ...base, baseline: 284, atuais: 0, zerosSeguidos: 3,
        gatilho: "scheduled", gatilhoBaseline: "manual",
      }),
    ).toBe("fonte_muda");
  });
});

describe("etapa109 · o alarme volta a ESCREVER", () => {
  it("a migration solta o NOT NULL de item_id — alerta de FONTE não tem item", () => {
    expect(MIGRATION).toMatch(/ALTER COLUMN item_id DROP NOT NULL/);
  });

  it("o insert PARA de engolir o erro — foi o silêncio que escondeu isto por um dia", () => {
    expect(RUNNER).toMatch(/const \{ error: erroAlerta \}/);
    expect(RUNNER).toMatch(/console\.warn/);
  });

  it("o runner usa o predicado puro — a regra não vive espalhada no meio do crawl", () => {
    expect(RUNNER).toMatch(/avaliarSinaisDeFonte\(/);
    expect(RUNNER).toMatch(/zerosSeguidos/);
  });

  it("o tipo do alerta vem do predicado, não de um literal fixo", () => {
    expect(RUNNER).toMatch(/tipo: sinal/);
  });
});
