/**
 * Etapa 76 (Fase 11) — a esteira aprende a dizer "acabou".
 *
 * ═══ O bug (que EU introduzi na Fase 10) ═══
 * O commit da rodada planejada terminou com esta linha em `pipeline/run/route.ts`:
 *
 *     if (planoDaRodada.size < ORDEM_DOS_PASSOS.length) restantes = true;
 *
 * São 13 passos somando ~144s de reserva contra um orçamento de 50s: **o plano nunca cabe
 * inteiro**. Logo `restantes` é SEMPRE `true`, `desfecho: "drenou"` é inalcançável, a run nunca é
 * fechada, e o teto de 40 rodadas do cliente virou o único desfecho possível.
 *
 * Com a fila VAZIA a esteira ainda queimaria 40 rodadas. Foi o que o usuário viu e a pergunta que
 * ele fez — "por que gastaria 25 minutos para pegar poucos documentos?" — tem esta resposta
 * literal: não é o custo de processar, é o custo de não saber terminar.
 *
 * ═══ A distinção que faltava ═══
 * "Não coube tudo NESTA rodada" (sempre verdade, por aritmética) é coisa diferente de
 * "ainda HÁ trabalho". Só a segunda pode pedir outra rodada.
 *
 * ⚠️ E há um falso positivo à espreita do lado oposto: declarar "acabou" com trabalho na mesa.
 * Um passo que não foi TENTADO não sabe se tem fila — por isso existe uma fase limitada de
 * verificação, de uma rotação, em que a esteira insiste mesmo sem trabalho relatado. Rodada ociosa
 * é barata (cada passo custa um SELECT), então essa fase custa segundos, não minutos.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";
import { deveContinuar } from "@/lib/server/esteira-run";
import { ORDEM_DOS_PASSOS } from "@/lib/server/esteira-reservas";

const RAIZ = join(__dirname, "../../../..");
const RUN = readFileSync(join(RAIZ, "src/app/api/v1/pipeline/run/route.ts"), "utf-8");
/**
 * Fonte SEM comentários. O comentário que EXPLICA o conserto cita a linha removida — assertar
 * sobre a prosa faria o teste falhar justamente porque o conserto foi bem documentado.
 */
const CODIGO = RUN.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/\/\/.*$/gm, " ");

describe("etapa76 · deveContinuar separa «não coube» de «ainda há trabalho»", () => {
  const base = {
    trabalhoRelatado: false,
    passosPulados: 0,
    passosNaoTentados: 0,
    rodada: 99,
  };

  it("fila vazia, tudo verificado → ACABOU", () => {
    expect(deveContinuar(base)).toBe(false);
  });

  it("passo relatou fila → continua", () => {
    expect(deveContinuar({ ...base, trabalhoRelatado: true })).toBe(true);
  });

  it("passo ficou sem fatia → continua (ele TINHA orçamento bloqueado, não fila vazia)", () => {
    expect(deveContinuar({ ...base, passosPulados: 1 })).toBe(true);
  });

  it("GUARDA DE FALSO POSITIVO: passo não-tentado insiste por UMA rotação", () => {
    // Um passo fora do plano não sabe se tem fila. A esteira dá a ele a chance de ser oferecido.
    for (let rodada = 0; rodada < ORDEM_DOS_PASSOS.length; rodada++) {
      expect(deveContinuar({ ...base, passosNaoTentados: 3, rodada }), `rodada ${rodada}`).toBe(true);
    }
  });

  it("…mas a insistência é LIMITADA: passada a rotação, sem trabalho, acabou", () => {
    // Sem limite, "não coube tudo" viraria de novo um moinho infinito — o bug de origem.
    expect(deveContinuar({ ...base, passosNaoTentados: 3, rodada: ORDEM_DOS_PASSOS.length })).toBe(false);
    expect(deveContinuar({ ...base, passosNaoTentados: 3, rodada: 40 })).toBe(false);
  });

  it("trabalho relatado vence sempre, em qualquer rodada", () => {
    expect(deveContinuar({ trabalhoRelatado: true, passosPulados: 0, passosNaoTentados: 0, rodada: 500 })).toBe(true);
  });
});

describe("etapa76 · o orquestrador não força mais restantes por aritmética", () => {
  it("a linha que tornava «drenou» inalcançável NÃO existe mais", () => {
    // 13 passos, ~144s de reserva, 50s de orçamento: esta comparação é SEMPRE verdadeira.
    expect(CODIGO).not.toMatch(/planoDaRodada\.size < ORDEM_DOS_PASSOS\.length\) restantes = true/);
  });

  it("passo fora do plano é REGISTRADO, mas não força outra rodada sozinho", () => {
    // O registro continua (o usuário precisa ver que o passo não foi tentado); o que sai é o
    // `restantes = true` colado nele.
    expect(CODIGO).toMatch(/foraDoPlano\(/);
    expect(CODIGO).not.toMatch(/= foraDoPlano\([^)]*\); restantes = true;/);
  });

  it("o desfecho da rodada sai de deveContinuar, não de literais espalhados", () => {
    expect(CODIGO).toMatch(/deveContinuar\(/);
  });

  it("o resultado de deveContinuar é USADO — não calculado e jogado fora", () => {
    // Chamar a função e ignorar o retorno passaria numa asserção que só procura o nome dela.
    expect(CODIGO).toMatch(/const pedeOutraRodada = deveContinuar\(\{[\s\S]{0,220}?\}\);\s*restantes = pedeOutraRodada;/);
    // …e é `restantes` que viaja na resposta, que é o que o cliente lê para decidir se re-chama.
    expect(CODIGO).toMatch(/restantes,\s*\/\/|restantes,/);
  });

  it("foraDoPlano CONTA o passo não-tentado — senão a esteira declara «acabou» cedo demais", () => {
    // Sem o contador, `passosNaoTentados` fica 0, a fase de verificação nunca acontece, e um passo
    // com fila que ficou fora do plano é dado como inexistente.
    expect(CODIGO).toMatch(/const foraDoPlano = \(nome: string\): StepResult => \{[\s\S]{0,160}?passosNaoTentados\+\+/);
  });

  it("a extração e as derivadas fora do plano também são contadas", () => {
    // Os dois passos da cauda não passam por `foraDoPlano` (não têm ramo `else`): eles precisam
    // contar por conta própria, senão saem da conta e a verificação fica cega justamente para os
    // passos que mais importam.
    expect(CODIGO).toMatch(/if \(!planoDaRodada\.has\("extracao"\)\) passosNaoTentados\+\+/);
    expect(CODIGO).toMatch(/if \(!planoDaRodada\.has\("derivada"\)\) passosNaoTentados\+\+/);
  });
});
