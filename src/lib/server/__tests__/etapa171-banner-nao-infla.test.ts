/**
 * Etapa 171 (Fase 31, Bloco 2) — todo número do banner é entidade distinta, ou DIZ que não é.
 *
 * Três defeitos, no mesmo enunciado.
 *
 * ═══ (a) A dupla narrativa, provada por construção ═══
 * Em `materializar-faltantes/route.ts`:
 *   `:422-426` conta A = (contestado && !contestadoAntigo)  → `regex_divergente`
 *   `:428-431` conta B = (contestadoAntigo && !contestado)  → `regex_falso_positivo`
 *   `:435-438` conta (contestado !== contestadoAntigo) = A ∪ B → `itens_que_mudariam`
 * A e B são mutuamente exclusivos, logo **`itens_que_mudariam ≡ regex_divergente +
 * regex_falso_positivo`**, sempre. O banner enunciava o total E a decomposição, e quem lia somava
 * mentalmente 35 + 35.
 *
 * ═══ (b) O denominador errado ═══
 * "120 votos fabricados evitados EM 35 itens" usava `itens_que_mudariam` (A ∪ B) como base de um
 * numerador que só cresce num subconjunto restrito de A (`:479`, com `!inferFromMandate &&
 * rows.length === 0` por cima). O denominador honesto é `regex_divergente`.
 *
 * ═══ (c) Cinco chaves da janela ROTATIVA somadas como evento ═══
 * A janela é `janelaRotativa(semVoto.length, LOTE, Date.now()/60_000)` (`:294`) e gira com o
 * relógio: o MESMO item é reexaminado em rodadas diferentes da mesma run, e cada reexame
 * reincrementa. As cinco caíam no default "evento" por OMISSÃO — enquanto as irmãs do MESMO laço
 * (`sem_evidencia`, `roster_nao_conferivel`) já eram PARCIAL. Irmãos do mesmo laço com naturezas
 * diferentes era incoerência gritante.
 *
 * ⚠️ E `registrarRodada` somava CEGAMENTE no banco, criando uma SEGUNDA agregação incompatível com
 * a da tela — sobre contadores que são lidos por `/pipeline/status` e pela própria rodada.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";
import {
  naturezaDaChave, acumularChave, agregarEtapas, CHAVES_PARCIAIS, CHAVES_DE_ESTOQUE,
} from "@/lib/server/agregar-rodadas";

const RAIZ = join(__dirname, "../../../..");
const ler = (p: string) => readFileSync(join(RAIZ, p), "utf-8");
const semComentarios = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/\/\/[^\n]*/g, " ");

/** As cinco que a janela rotativa recontava, e que estavam no default por omissão. */
const DA_JANELA_ROTATIVA = [
  "votos_a_menos", "itens_que_mudariam", "regex_divergente", "regex_falso_positivo", "examinados",
] as const;

describe("etapa171 · as chaves da janela rotativa são PARCIAIS, não eventos", () => {
  it.each(DA_JANELA_ROTATIVA)("%s é parcial", (chave) => {
    expect(naturezaDaChave(chave)).toBe("parcial");
    expect(CHAVES_PARCIAIS.has(chave)).toBe(true);
  });

  it("⚠️ elas ficam ao lado das IRMÃS do mesmo laço — a incoerência era essa", () => {
    for (const irma of ["sem_evidencia", "roster_nao_conferivel"]) {
      expect(naturezaDaChave(irma)).toBe("parcial");
    }
  });

  it("parcial NÃO é estoque — elas somam, só não contam entidades distintas", () => {
    // Confundir os dois faria o número PARAR de crescer, que é um erro diferente e igualmente ruim.
    for (const chave of DA_JANELA_ROTATIVA) expect(CHAVES_DE_ESTOQUE.has(chave)).toBe(false);
    const totais: Record<string, number> = {};
    acumularChave(totais, "examinados", 20);
    acumularChave(totais, "examinados", 20);
    expect(totais.examinados, "parcial deixou de somar").toBe(40);
  });

  it("estoque continua valendo o ÚLTIMO — a natureza não se perdeu no caminho", () => {
    const totais: Record<string, number> = {};
    acumularChave(totais, "pendentes", 45);
    acumularChave(totais, "pendentes", 43);
    expect(totais.pendentes).toBe(43);
  });

  it("chave desconhecida continua sendo evento — o default não muda por omissão", () => {
    expect(naturezaDaChave("uma_chave_que_ninguem_declarou")).toBe("evento");
  });
});

describe("etapa171 · ⚠️ o banco deixa de ter uma agregação PRÓPRIA", () => {
  const ESTEIRA = semComentarios(ler("src/lib/server/esteira-run.ts"));

  it("`registrarRodada` usa a MESMA regra da tela", () => {
    expect(ESTEIRA).toMatch(/acumularChave\(contadores, k, v\)/);
    // A soma cega não pode voltar: ela corrompia os retratos dentro de `esteira_runs.contadores`.
    expect(ESTEIRA).not.toMatch(/contadores\[k\] = \(contadores\[k\] \?\? 0\) \+ v/);
  });

  it("e a regra é UMA função, não duas cópias que divergem", () => {
    const AGREGAR = semComentarios(ler("src/lib/server/agregar-rodadas.ts"));
    expect(AGREGAR).toMatch(/export function acumularChave\(/);
    // `agregarEtapas` passou a chamá-la em vez de repetir o if/else.
    expect(AGREGAR).toMatch(/acumularChave\(totais, chave, valor\)/);
  });

  it("o retrato persistido para de ser somatório — três rodadas com 45 dão 45", () => {
    const totais: Record<string, number> = {};
    for (let i = 0; i < 3; i++) agregarEtapas(totais, { backfill_votos: { pendentes: 45, votos: 2 } });
    expect(totais.pendentes, "o retrato virou 135").toBe(45);
    expect(totais.votos, "o evento parou de somar").toBe(6);
  });
});

describe("etapa171 · ⚠️ a dupla narrativa, e o denominador", () => {
  const TELA = ler("src/app/dashboard/deliberacoes/votos-diretores/page.tsx");
  const frase = () => {
    const i = TELA.indexOf("regra do dispositivo (vigente)");
    expect(i, "a frase sumiu da tela").toBeGreaterThan(-1);
    return TELA.slice(i, i + 500);
  };

  it("`itens_que_mudariam` não é mais enunciado — ele É a união dos outros dois", () => {
    expect(frase(), "o total e a decomposição voltaram a conviver").not.toMatch(/itens_que_mudariam/);
  });

  it("o denominador de `votos_a_menos` passou a ser `regex_divergente`", () => {
    // Os votos evitados vêm de um subconjunto de A; usar A ∪ B como base contava itens que não
    // produziram nenhum dos votos.
    expect(frase()).toMatch(/regex_divergente/);
    expect(frase()).toMatch(/votos_a_menos/);
    const iDivergente = frase().indexOf("regex_divergente");
    const iVotos = frase().indexOf("votos_a_menos");
    expect(iDivergente, "os votos evitados vêm ANTES do seu denominador").toBeLessThan(iVotos);
  });

  it("⚠️ a frase carrega o rótulo de repetição — os números são de janela rotativa", () => {
    expect(frase()).toMatch(/ROTULO_PARCIAL/);
  });

  it("o rótulo é UMA constante, não literal repetido em cada linha", () => {
    // Repetido, os dois textos divergiriam com o tempo — e o rótulo é justamente o que não pode
    // divergir, porque é ele que avisa o leitor de que o número repete.
    expect(TELA).toMatch(/const ROTULO_PARCIAL = "ocorrências nos lotes, com repetição";/);
    // ⚠️ A contagem roda sobre o CÓDIGO sem comentários. Medir o texto cru contaria a frase que
    // aparece na prosa explicando a decisão — foi esse o erro que eu já cometi duas vezes nesta
    // fase, e ele reprova a própria justificativa.
    expect((semComentarios(TELA).match(/ocorrências nos lotes, com repetição/g) ?? []).length,
      "o rótulo foi copiado em vez de reusado").toBe(1);
  });

  it("⚠️ a identidade que justifica tudo, medida no CÓDIGO que a produz", () => {
    // A primeira versão deste caso tinha um laço com `expect(a + b).toBe(a + b)` — asserção vazia,
    // exatamente o que este arquivo existe para não deixar passar. O que prova a identidade não é
    // aritmética inventada aqui: são as TRÊS condições em materializar-faltantes:422-438.
    const ROTA = semComentarios(ler("src/app/api/v1/admin/votos/materializar-faltantes/route.ts"));
    const iA = ROTA.indexOf("if (contestado && !contestadoAntigo)");
    const iB = ROTA.indexOf("if (contestadoAntigo && !contestado)");
    const iUniao = ROTA.indexOf("if (contestadoComPleito !== contestadoRef)");
    expect(iA, "o ramo A sumiu").toBeGreaterThan(-1);
    expect(iB, "o ramo B sumiu").toBeGreaterThan(-1);
    expect(iUniao, "o ramo da união sumiu").toBeGreaterThan(-1);
    // A e B são mutuamente exclusivos (as condições se negam), e a união é `!==` — que é
    // exatamente `A ou B`. Logo `itens_que_mudariam ≡ regex_divergente + regex_falso_positivo`.
    expect(iA).toBeLessThan(iB);
    expect(iB).toBeLessThan(iUniao);

    // E a simulação da regra, sobre o espaço INTEIRO dos dois booleanos — isto, sim, mede algo:
    // nenhum par cai em A e B ao mesmo tempo, e a união é a soma dos dois.
    let a = 0, b = 0, uniao = 0;
    for (const contestado of [true, false]) {
      for (const antigo of [true, false]) {
        if (contestado && !antigo) a++;
        if (antigo && !contestado) b++;
        if (contestado !== antigo) uniao++;
      }
    }
    expect(uniao, "a união não é A + B").toBe(a + b);
    expect(a).toBe(1);
    expect(b).toBe(1);
  });
});
