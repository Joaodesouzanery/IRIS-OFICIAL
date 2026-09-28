/**
 * Etapa 206 (Fase 35, Bloco C) — a régua do placar estava frouxa, e o usuário achou o furo.
 *
 * ═══ O furo ═══
 * A régua da Fase 34 declara a reunião completa quando **cada diretor esperado tem ao menos UM voto
 * nela**. O QA de produção mostrou o que isso esconde: o José Fernando tem **1 voto em todo 2026** (o
 * Fábio tem 106), e ainda assim a 84ª da ANM o contava como votante — só faltavam outros dois nomes
 * para ela virar "quase completa". Na ANTT o mesmo: na 1.024ª o Severino tinha 6 votos e os outros
 * quatro tinham 7, e o placar por reunião não via a diferença.
 *
 * Ou seja: `67 de 80 (84%)` era um TETO, não um resultado. E é a pergunta original do projeto que
 * ficava sem resposta — *quantas vezes o diretor X votou, e em quais deliberações*.
 *
 * ═══ A régua ═══
 * PARES: cada deliberação final × cada diretor com mandato na data tem de ter linha em `votos` — voto
 * ou motivo. Ausência JUSTIFICADA é resposta; o que falta é a ausência de linha.
 *
 * ⚠️ As duas réguas convivem de propósito. `reunioes_completas` mantém a semântica antiga porque foi
 * com ela que o histórico de `esteira_runs.contadores` foi gravado — redefinir um número já publicado
 * tornaria as runs anteriores incomparáveis EM SILÊNCIO, e a distância entre as duas é justamente o
 * que o usuário pediu para ver.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";
import {
  medirReuniao,
  resumirPorAgencia,
  type ItemDaReuniao,
  type ReuniaoParaPlacar,
} from "@/lib/server/placar";
import type { MandatoJanela } from "@/lib/server/colegiado-na-data";

const RAIZ = join(__dirname, "../../../..");
const ler = (p: string) => readFileSync(join(RAIZ, p), "utf-8");
const semComentarios = (t: string) =>
  t.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/\/\/[^\n]*/g, " ");

/** Cinco diretores da ANM com mandato cobrindo 2026 — a FORMA do colegiado real. */
const COLEGIADO: MandatoJanela[] = [
  { diretor_id: "mauro", agencia_id: "anm", data_inicio: "2022-12-05", data_fim: "2028-12-04" },
  { diretor_id: "fabio", agencia_id: "anm", data_inicio: "2022-12-05", data_fim: "2028-12-04" },
  { diretor_id: "jose_fernando", agencia_id: "anm", data_inicio: "2025-09-01", data_fim: "2028-12-04" },
  { diretor_id: "luiz", agencia_id: "anm", data_inicio: "2022-12-05", data_fim: "2028-12-04" },
  { diretor_id: "caio", agencia_id: "anm", data_inicio: "2022-12-05", data_fim: "2028-12-04" },
];

const itens = (quantos: number, quemRespondeCada: (i: number) => string[]): ItemDaReuniao[] =>
  Array.from({ length: quantos }, (_, i) => ({ id: `item-${i + 1}`, respondido_por: quemRespondeCada(i) }));

const reuniao = (o: Partial<ReuniaoParaPlacar> & { itens: ItemDaReuniao[] }): ReuniaoParaPlacar => ({
  agencia: "ANM", serie: null, numero_reuniao: "84", data_reuniao: "2026-04-29",
  // `votantes` é a UNIÃO — o numerador do teto. Derivado dos itens para as duas réguas falarem do
  // MESMO dado: uma divergência entre eles seria bug de fixture disfarçado de achado.
  votantes: [...new Set(o.itens.flatMap((it) => it.respondido_por))],
  ...o,
});

describe("etapa206 · ⚠️ O CASO QUE O TETO ESCONDIA: um voto em 39 itens", () => {
  /**
   * A forma do caso medido em produção: a reunião tem 39 itens, o José Fernando respondeu em UM, e
   * todos os outros quatro responderam em todos.
   */
  const trintaENove = reuniao({
    itens: itens(39, (i) =>
      i === 0
        ? ["mauro", "fabio", "jose_fernando", "luiz", "caio"]
        : ["mauro", "fabio", "luiz", "caio"],
    ),
  });
  const m = medirReuniao(trintaENove, "anm", COLEGIADO);

  it("o TETO diz «completa» — é o defeito que o usuário apontou", () => {
    expect(m.classe, "se isto mudou, o teto deixou de ser reproduzível e a comparação com o histórico quebra")
      .toBe("completa");
    expect(m.faltando, "pelo teto ninguém falta: todos têm ≥1 voto").toEqual([]);
  });

  it("⚠️ a régua ESTRITA diz «defeito_nosso» — 38 itens sem resposta dele", () => {
    expect(m.classe_estrita).toBe("defeito_nosso");
  });

  it("e ela NOMEIA o caso com a contagem: 1 de 39", () => {
    const dele = m.cobertura.find((c) => c.diretor_id === "jose_fernando");
    expect(dele).toEqual({ diretor_id: "jose_fernando", respondidos: 1, de: 39 });
    expect(m.parciais.map((c) => c.diretor_id), "só ele é parcial; os outros quatro estão em todos")
      .toEqual(["jose_fernando"]);
  });

  it("os pares fecham: 5 diretores × 39 itens, com 38 buracos", () => {
    expect(m.itens_total).toBe(39);
    expect(m.pares_esperados).toBe(5 * 39);
    expect(m.pares_respondidos).toBe(4 * 39 + 1);
    expect(m.pares_esperados - m.pares_respondidos).toBe(38);
  });
});

describe("etapa206 · as duas réguas coincidem quando devem", () => {
  it("todos responderam em todos os itens: completa nas DUAS", () => {
    const m = medirReuniao(
      reuniao({ itens: itens(12, () => ["mauro", "fabio", "jose_fernando", "luiz", "caio"]) }),
      "anm", COLEGIADO,
    );
    expect(m.classe).toBe("completa");
    expect(m.classe_estrita).toBe("completa");
    expect(m.pares_respondidos).toBe(m.pares_esperados);
    expect(m.parciais).toEqual([]);
  });

  it("quem não respondeu NADA reprova nas duas — o teto já o via", () => {
    const m = medirReuniao(
      reuniao({ itens: itens(10, () => ["mauro", "fabio", "luiz", "caio"]) }),
      "anm", COLEGIADO,
    );
    expect(m.classe).toBe("defeito_nosso");
    expect(m.classe_estrita).toBe("defeito_nosso");
    expect(m.faltando).toEqual(["jose_fernando"]);
    // ⚠️ E ele NÃO é "parcial": zero não é parte. Contá-lo nas duas listas somaria o mesmo caso duas
    // vezes em qualquer relatório que juntasse `faltando` com `parciais`.
    expect(m.parciais).toEqual([]);
    /**
     * ⚠️ O DENOMINADOR VEM DO MANDATO, não de quem votou — e esta expectativa existe porque uma
     * mutação sobreviveu sem ela. Trocar `roster.length` por `votantes.length` em `pares_esperados`
     * fazia o diretor com ZERO votos sair do denominador: 40 de 40 = **100% de cobertura** numa
     * reunião em que um quinto do colegiado não respondeu nada. É o mesmo formato de mentira que a
     * Fase 17 mediu ("cobertura dizia completa com site=0"), e ele se esconde justamente nos casos em
     * que todos votaram — onde as duas contas coincidem.
     */
    expect(m.pares_esperados, "o denominador vem do MANDATO, não de quem apareceu").toBe(5 * 10);
    expect(m.pares_respondidos).toBe(4 * 10);
    expect(resumirPorAgencia([m]).ANM.cobertura_pct, "a cobertura tem de cair, não ficar em 100%").toBe(80);
  });

  it("uma reunião de UM item: as réguas são equivalentes por construção", () => {
    const m = medirReuniao(
      reuniao({ itens: itens(1, () => ["mauro", "fabio", "jose_fernando", "luiz", "caio"]) }),
      "anm", COLEGIADO,
    );
    expect(m.classe).toBe(m.classe_estrita);
  });
});

describe("etapa206 · ⚠️ ausência de dado NÃO pode virar cobertura perfeita", () => {
  it("reunião SEM itens dá 0 pares, e o resumo devolve 0%, nunca 100%", () => {
    const m = medirReuniao(reuniao({ itens: [] }), "anm", COLEGIADO);
    expect(m.pares_esperados).toBe(0);
    expect(m.pares_respondidos).toBe(0);
    const r = resumirPorAgencia([m]).ANM;
    expect(r.cobertura_pct, "0 de 0 virando 100% é a mentira da Fase 17 («completa com site=0»)").toBe(0);
  });

  it("roster desconhecido não produz cobertura — a classe diz que não se sabe", () => {
    const m = medirReuniao(
      reuniao({ data_reuniao: "2019-01-01", itens: itens(5, () => []) }),
      "anm", COLEGIADO,
    );
    expect(m.roster_conhecido).toBe(false);
    expect(m.classe_estrita).toBe("roster_desconhecido");
    expect(m.pares_esperados).toBe(0);
  });
});

describe("etapa206 · o resumo pesa por PARES, não por média de percentuais", () => {
  it("⚠️ uma reunião grande pesa mais que uma pequena — média simples inverteria a leitura", () => {
    /**
     * Duas reuniões da mesma agência: uma de 1 item 100% coberta, outra de 99 itens com 0% de um dos
     * cinco diretores. A média dos percentuais por reunião daria ~90%; a cobertura por pares dá 80%,
     * que é a fração real de trabalho feito.
     */
    const pequena = medirReuniao(
      reuniao({ numero_reuniao: "85", itens: itens(1, () => ["mauro", "fabio", "jose_fernando", "luiz", "caio"]) }),
      "anm", COLEGIADO,
    );
    /**
     * ⚠️ CORREÇÃO DE UMA EXPECTATIVA MINHA. A primeira versão deste caso dava ZERO itens ao José
     * Fernando na reunião grande — e aí o TETO também reprova, porque o teto pede ≥1 voto. O caso
     * perdia o ponto: ele existe para mostrar reunião que PASSA no teto e reprova na estrita. Com 1
     * item de 99, o teto passa (ele votou) e a estrita reprova (faltam 98).
     */
    const grande = medirReuniao(
      reuniao({
        numero_reuniao: "86",
        itens: itens(99, (i) =>
          i === 0
            ? ["mauro", "fabio", "jose_fernando", "luiz", "caio"]
            : ["mauro", "fabio", "luiz", "caio"],
        ),
      }),
      "anm", COLEGIADO,
    );
    const r = resumirPorAgencia([pequena, grande]).ANM;
    expect(r.itens).toBe(100);
    expect(r.pares_esperados).toBe(500);
    // 5 da pequena + (5 no 1º item + 4 × 98) da grande.
    expect(r.pares_respondidos).toBe(5 + (5 + 98 * 4));
    // 402/500 = 80,4%. A média dos percentuais por reunião daria (100% + 80,2%)/2 ≈ 90%.
    expect(r.cobertura_pct).toBe(80);
    // E as duas contagens de reunião seguem publicadas, com a distância visível.
    expect(r.total).toBe(2);
    expect(r.completas, "pelo teto as duas passam").toBe(2);
    expect(r.completas_estrito, "pela estrita só a pequena").toBe(1);
  });

  it("a soma das classes continua fechando com o total", () => {
    const medidas = [
      medirReuniao(reuniao({ itens: itens(3, () => ["mauro", "fabio", "jose_fernando", "luiz", "caio"]) }), "anm", COLEGIADO),
      medirReuniao(reuniao({ numero_reuniao: "85", itens: itens(3, () => ["mauro"]) }), "anm", COLEGIADO),
    ];
    const r = resumirPorAgencia(medidas).ANM;
    expect(r.completas + r.defeito_nosso + r.cadastro_pendente + r.roster_desconhecido).toBe(r.total);
    expect(r.completas_estrito).toBeLessThanOrEqual(r.total);
    // ⚠️ A estrita NUNCA pode passar o teto: toda reunião completa na estrita é completa no teto.
    expect(r.completas_estrito).toBeLessThanOrEqual(r.completas);
  });
});

describe("etapa206 · a rota e a tela usam a régua nova", () => {
  const ROTA = semComentarios(ler("src/app/api/v1/admin/placar/route.ts"));
  const RUN = semComentarios(ler("src/app/api/v1/pipeline/run/route.ts"));
  const TELA = semComentarios(ler("src/app/dashboard/deliberacoes/votos-diretores/page.tsx"));

  it("a lista de trabalho é filtrada pela ESTRITA — pelo teto a 84ª sairia dela", () => {
    expect(ROTA).toMatch(/\.filter\(\(m\) => m\.classe_estrita !== "completa"\)/);
  });

  it("e ela carrega a contagem por diretor, que é a frase que o usuário pediu", () => {
    expect(ROTA).toMatch(/sem_voto_por_diretor/);
    expect(ROTA).toMatch(/sem_voto_em: c\.de - c\.respondidos/);
  });

  it("a rota monta UM item por deliberação — sem isso a régua estrita mede 0 de 0", () => {
    expect(ROTA).toMatch(/atual\.itens\.push\(\{ id: String\(d\.id\), respondido_por:/);
  });

  it("o passo publica a cobertura, e ela é recalculada dos TOTAIS (não média de percentuais)", () => {
    expect(RUN).toMatch(/cobertura_pct: coberturaPct/);
    expect(RUN).toMatch(/paresRespondidos \/ paresEsperados/);
    expect(RUN, "a régua antiga tem de continuar publicada, senão o histórico fica incomparável")
      .toMatch(/reunioes_completas: completas/);
    expect(RUN).toMatch(/reunioes_completas_estrito: completasEstrito/);
  });

  it("⚠️ a tela mostra a COBERTURA, e o teto aparece rotulado como teto", () => {
    expect(TELA).toMatch(/cobertura de voto:/);
    expect(TELA).toMatch(/totais\.cobertura_pct/);
    const i = TELA.indexOf("reunioes_completas_estrito");
    expect(i, "a linha da régua estrita não chegou à tela").toBeGreaterThan(-1);
    expect(TELA.slice(i, i + 400), "o número do teto tem de vir com a palavra teto ao lado")
      .toMatch(/teto/i);
  });

  it("e o caso parcial tem linha própria — é onde mora o trabalho que falta", () => {
    expect(TELA).toMatch(/totais\.diretores_com_voto_parcial/);
  });
});
