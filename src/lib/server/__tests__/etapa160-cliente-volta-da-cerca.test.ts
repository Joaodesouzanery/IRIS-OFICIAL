/**
 * Etapa 160 (Fase 30, commit 3) — o cliente que consegue VOLTAR da cerca.
 *
 * ═══ Por que o retry era estruturalmente inútil ═══
 * O laço tratava todo 409 igual: esperar 10 s e repetir **com o mesmo token**. E `rodadas` é
 * monotônico — o token que perdeu o compare-and-set nunca mais bate. Três esperas, desfecho
 * "erros", numa esteira saudável.
 *
 * E a aritmética da espera estava errada por construção, não por azar: a rodada legítima mais
 * longa é ~85 s (HOBBY_BUDGET_MS 70 s + auth ≤10 s + flush). 3 × 10 s = 30 s, então o cliente
 * desistia com a rodada AINDA NO AR, sempre.
 *
 * Havia ainda dois defeitos de contagem no mesmo laço:
 * - `tentativasDeCerca` tinha crédito VITALÍCIO: só zerava num HTTP 500, então uma rodada boa não
 *   o limpava e três 409 espalhados por 20 min fechavam a esteira — enquanto um erro de servidor,
 *   que deveria ser mais grave, o zerava.
 * - `rodada--` anulava o `rodada++` do `for`, e o teto de 300 deixava de ser teto.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";
import {
  decidirAposCerca,
  ESPERAS_DA_CERCA,
  TETO_DE_ADOCOES,
  type AcaoDaCerca,
} from "@/lib/server/cerca-do-cliente";
import { HOBBY_BUDGET_MS } from "@/lib/server/time-budget";

const RAIZ = join(__dirname, "../../../..");
const ler = (p: string) => readFileSync(join(RAIZ, p), "utf-8");
/**
 * ⚠️ Asserção NEGATIVA sobre código-fonte tem de rodar sem comentários. As formas antigas que
 * este arquivo proíbe (`tentativasDeCerca`, `rodada--`) estão CITADAS nos comentários que
 * explicam por que morreram — medir o texto cru faria o teste reprovar a própria justificativa.
 * É o mesmo defeito que a etapa155 tinha, onde um grep casava com o próprio comentário.
 */
const semComentarios = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/\/\/[^\n]*/g, " ");

const decidir = (codigo: string | undefined, extra: Partial<Parameters<typeof decidirAposCerca>[0]> = {}) =>
  decidirAposCerca({
    status: 409,
    codigo,
    runId: "r1",
    rodadas: 9,
    esperasFeitas: 0,
    adocoesFeitas: 0,
    ...extra,
  });

describe("etapa160 · cada 409 pede uma ação DIFERENTE", () => {
  it("⚠️ rodada NO AR é o único caso em que esperar é certo — adotar seria o roubo de novo", () => {
    const a = decidir("rodada_em_voo");
    expect(a).toMatchObject({ tipo: "repetir", adotar: null, esperaMs: ESPERAS_DA_CERCA[0] });
  });

  it.each([
    ["token_vencido", "a rodada anterior JÁ terminou"],
    ["token_ausente", "a run é preexistente e o token não foi mandado"],
  ])("%s → adota o token fresco e repete SEM espera (%s)", (codigo) => {
    const a = decidir(codigo);
    expect(a).toEqual({
      tipo: "repetir",
      adotar: { runId: "r1", rodadasVistas: 9 },
      esperaMs: 0,
      motivo: expect.stringContaining("rodada atual"),
    });
  });

  it("run_alheia → assume a execução: uma esteira, não duas", () => {
    const a = decidir("run_alheia");
    expect(a).toMatchObject({ tipo: "repetir", adotar: { runId: "r1", rodadasVistas: 9 }, esperaMs: 0 });
  });

  it("run_encerrada → abre uma NOVA (id e token zerados), sem insistir na morta", () => {
    const a = decidir("run_encerrada");
    expect(a).toMatchObject({ tipo: "repetir", adotar: { runId: null, rodadasVistas: null }, esperaMs: 0 });
  });

  it("⚠️ 503 do banco NÃO é concorrência — é falha real, e o cliente não espera por vaga livre", () => {
    expect(decidirAposCerca({ status: 503, codigo: "banco_indisponivel", esperasFeitas: 0, adocoesFeitas: 0 }))
      .toEqual({ tipo: "falha_real" });
  });

  it("⚠️ o que decide é o STATUS, não o código — 409 é a única porta para a cerca", () => {
    // Medir só o 503 com `codigo: "banco_indisponivel"` não prova nada: o switch mandaria em
    // `falha_real` de qualquer jeito, e o gate de status poderia sumir sem o teste notar. O
    // caso que separa os dois é um status não-409 trazendo um código que PEDIRIA espera.
    for (const status of [500, 502, 503, 504]) {
      expect(
        decidirAposCerca({ status, codigo: "rodada_em_voo", runId: "r1", rodadas: 9, esperasFeitas: 0, adocoesFeitas: 0 }),
        `HTTP ${status} tratado como concorrência`,
      ).toEqual({ tipo: "falha_real" });
    }
    // …e o 409 com o mesmo código continua sendo espera.
    expect(decidir("rodada_em_voo").tipo).toBe("repetir");
  });

  it("409 SEM código (servidor da janela entre dois deploys) espera — não chuta uma adoção", () => {
    // Adotar com `runId` ausente APAGARIA o run_id que o laço já tem, e a chamada seguinte
    // abriria uma run nova por cima da ativa: o bug que a Fase 30 conserta, pelo outro lado.
    const a = decidir(undefined, { runId: undefined, rodadas: undefined });
    expect(a).toMatchObject({ tipo: "repetir", adotar: null, esperaMs: ESPERAS_DA_CERCA[0] });
  });

  it("corpo com tipos errados não vira adoção com lixo dentro", () => {
    const a = decidir("token_vencido", { runId: 42, rodadas: "9" });
    expect(a).toMatchObject({ tipo: "repetir", adotar: { runId: null, rodadasVistas: null } });
  });
});

describe("etapa160 · a aritmética da espera, contra a rodada real", () => {
  /** O pior caso legítimo: orçamento + o round-trip de auth + o flush da resposta. */
  const RODADA_MAIS_LONGA_MS = HOBBY_BUDGET_MS + 10_000 + 5_000;

  it("⚠️ a soma das esperas COBRE a rodada mais longa — 3×10s (30s) não cobria", () => {
    const soma = ESPERAS_DA_CERCA.reduce((a, b) => a + b, 0);
    expect(soma).toBeGreaterThan(RODADA_MAIS_LONGA_MS);
    expect(soma, "esperas de 10s somariam 30s: desistir com a rodada no ar, garantido").toBeGreaterThan(30_000);
  });

  it("as esperas ESCALAM — a primeira não pode já custar o pior caso", () => {
    const crescente = ESPERAS_DA_CERCA.every((v, i) => i === 0 || v > ESPERAS_DA_CERCA[i - 1]);
    expect(crescente).toBe(true);
    expect(ESPERAS_DA_CERCA[0]).toBeLessThan(RODADA_MAIS_LONGA_MS / 2);
  });

  it("a soma é uma fração do teto de 25 min do laço — a cerca não come a esteira", () => {
    const soma = ESPERAS_DA_CERCA.reduce((a, b) => a + b, 0);
    expect(soma / (25 * 60_000)).toBeLessThan(0.1);
  });

  it("esgotadas as esperas, PARA com motivo — insistir para sempre é o outro extremo", () => {
    const percurso = ESPERAS_DA_CERCA.map((_, i) => decidir("rodada_em_voo", { esperasFeitas: i }));
    expect(percurso.map((a) => (a as Extract<AcaoDaCerca, { tipo: "repetir" }>).esperaMs)).toEqual([...ESPERAS_DA_CERCA]);
    const quarta = decidir("rodada_em_voo", { esperasFeitas: ESPERAS_DA_CERCA.length });
    expect(quarta.tipo).toBe("desistir");
    expect((quarta as Extract<AcaoDaCerca, { tipo: "desistir" }>).motivo).toBeTruthy();
  });
});

describe("etapa160 · os dois contadores são SEPARADOS", () => {
  it("⚠️ adotar não consome espera: três adoções legítimas não podem matar o laço sem esperar", () => {
    // A sequência mais longa que existe: adotar o id da run alheia → adotar o token corrente →
    // rodar. Com um contador só, ela gastaria as três esperas antes da primeira rodada.
    const comEsperasGastas = decidir("run_alheia", { esperasFeitas: ESPERAS_DA_CERCA.length, adocoesFeitas: 0 });
    expect(comEsperasGastas.tipo).toBe("repetir");
    const comAdocoesGastas = decidir("rodada_em_voo", { esperasFeitas: 0, adocoesFeitas: TETO_DE_ADOCOES });
    expect(comAdocoesGastas.tipo).toBe("repetir");
  });

  it("adoção também tem teto — sem ele um servidor em estado inesperado vira laço quente", () => {
    expect(decidir("token_vencido", { adocoesFeitas: TETO_DE_ADOCOES }).tipo).toBe("desistir");
    expect(decidir("token_vencido", { adocoesFeitas: TETO_DE_ADOCOES - 1 }).tipo).toBe("repetir");
    // O teto cobre a sequência legítima mais longa; menos que isso mataria caso bom.
    expect(TETO_DE_ADOCOES).toBeGreaterThanOrEqual(2);
  });
});

describe("etapa160 · o laço da tela usa a decisão, e os contadores zeram no lugar certo", () => {
  const TELA = ler("src/app/dashboard/deliberacoes/votos-diretores/page.tsx");
  const inicio = TELA.indexOf("const corpoDaRodada");
  const LACO = TELA.slice(inicio, inicio + 4_500);

  it("o laço da esteira foi encontrado (âncora do resto deste bloco)", () => {
    expect(inicio).toBeGreaterThan(-1);
  });

  it("o 409 passa pelo módulo puro, com o CORPO do erro", () => {
    expect(LACO).toMatch(/decidirAposCerca\(\{/);
    expect(LACO).toMatch(/codigo: err\.body\.codigo/);
    expect(LACO).toMatch(/runId: err\.body\.run_id/);
    expect(LACO).toMatch(/rodadas: err\.body\.rodadas/);
  });

  it("⚠️ `ApiError` guarda o corpo — sem isso a informação do 409 vira texto e morre", () => {
    const API = ler("src/lib/api.ts");
    expect(API).toMatch(/public body: Record<string, unknown> = \{\}/);
    // O corpo já era lido e DESCARTADO: a mudança é de uma linha, o efeito é o retry deixar de
    // ser inútil.
    expect(API).toMatch(/body && typeof body === "object"/);
  });

  it("⚠️ o crédito da cerca zera no SUCESSO, ao lado de `falhasSeguidas`", () => {
    const iFalhas = LACO.indexOf("falhasSeguidas = 0;");
    const iEsperas = LACO.indexOf("esperasDaCerca = 0;");
    const iAdocoes = LACO.indexOf("adocoesDaCerca = 0;");
    expect(iFalhas).toBeGreaterThan(-1);
    // Os dois zeram logo depois do POST bem-sucedido, antes do `catch`.
    expect(iEsperas).toBeGreaterThan(iFalhas);
    expect(iAdocoes).toBeGreaterThan(iFalhas);
    expect(iEsperas).toBeLessThan(LACO.indexOf("catch (err)"));
    expect(iAdocoes).toBeLessThan(LACO.indexOf("catch (err)"));
    // A forma antiga não volta: crédito vitalício zerado só por HTTP 500.
    expect(semComentarios(TELA)).not.toMatch(/tentativasDeCerca/);
  });

  it("⚠️ `rodada--` morreu: o `for` conta TENTATIVAS e o teto de 300 volta a ser teto", () => {
    expect(semComentarios(TELA)).not.toMatch(/rodada--/);
    expect(TELA).toMatch(/for \(let tentativa = 1; tentativa <= 300; tentativa\+\+\)/);
    // …e `rodadasFeitas` conta rodadas que ACONTECERAM: sobe no sucesso, não na entrada do laço.
    expect(semComentarios(TELA)).not.toMatch(/rodadasFeitas = rodada;/);
    expect(LACO).toMatch(/rodadasFeitas\+\+;/);
  });

  it("⚠️ `runIdAtivo` nasce do /pipeline/status — a metade-cliente da porta", () => {
    // Sem isto o servidor recusa (`run_alheia`) e o usuário não tem como retomar: era `useState`
    // com `null` e nunca semeado, então TODA aba nova mandava corpo vazio.
    expect(TELA).toMatch(/runIdAtivo \?\? esteiraStatus\?\.run\?\.id \?\? null/);
    expect(TELA).toMatch(/if \(!runIdAtivo && esteiraStatus\?\.run\) rodadasVistas = esteiraStatus\.run\.rodadas;/);
  });
});

describe("etapa160 · `encerrar` tem dono, e `fecharRun` filtra por status", () => {
  const ROTA = ler("src/app/api/v1/pipeline/run/route.ts");
  const ESTEIRA = ler("src/lib/server/esteira-run.ts");

  it("⚠️ `fecharRun` filtra por `running` — o comentário da rota dizia isso e era FALSO", () => {
    const fechar = ESTEIRA.slice(ESTEIRA.indexOf("export async function fecharRun"));
    expect(fechar).toMatch(/\.eq\("status", "running"\)/);
    // E devolve boolean: sem ele, quem chama não distingue "eu fechei" de "já estava fechada".
    expect(fechar).toMatch(/Promise<boolean>/);
  });

  it("o `encerrar` confere que o run_id é a run ATIVA — fechar a run alheia era o furo", () => {
    const ramo = ROTA.slice(ROTA.indexOf("if (corpo.encerrar && corpo.run_id)"), ROTA.indexOf("Fase 30 — A PORTA"));
    expect(ramo).toMatch(/const alvo = await buscarRunAtiva\(db\)/);
    expect(ramo).toMatch(/String\(alvo\.id\) !== corpo\.run_id/);
    expect(ramo).toMatch(/encerrado: false/);
  });

  it("com rodada NO AR o `encerrar` não fecha — e diz por quê", () => {
    const ramo = ROTA.slice(ROTA.indexOf("if (corpo.encerrar && corpo.run_id)"), ROTA.indexOf("Fase 30 — A PORTA"));
    expect(ramo).toMatch(/rodadaEmVoo\(alvo\)/);
    expect(ramo).toMatch(/em_voo: true/);
  });

  it("⚠️ TOKEN não se exige no `encerrar` — ele dispara quando o token está vencido", () => {
    // A justificativa vive no bloco ACIMA do `if`: a fatia começa em "Fase 12 — ENCERRAR".
    const ramo = ROTA.slice(ROTA.indexOf("// Fase 12 — ENCERRAR"), ROTA.indexOf("Fase 30 — A PORTA"));
    expect(ramo).toMatch(/TOKEN NÃO SE EXIGE AQUI/);
    expect(semComentarios(ramo)).not.toMatch(/rodadas_vistas/);
  });
});
