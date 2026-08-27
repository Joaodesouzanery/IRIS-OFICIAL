/**
 * Etapa 74 (Fase 10, commit 3) — soltar os presos deixa de custar o preço da extração.
 *
 * ═══ O bug ═══
 * Os três reapers de documento preso existem desde a Fase 9 e nunca agiram. Não por defeito
 * próprio: eles moram dentro de `processPendingDocuments`, cujo **único chamador em todo o
 * repositório** é `/api/v1/upload/process` — o passo de EXTRAÇÃO, o mais caro da rodada (reserva
 * de 20s). Como a extração era a última da fila e nunca alcançava o portão, os reapers iam junto.
 *
 * Produção mediu o resultado: **62 documentos em `queued`, os MESMOS**, depois de 26 rodadas —
 * com o PDF já baixado e nunca extraído.
 *
 * ═══ O conserto ═══
 * Reparar um documento custa ~2s (2-3 round-trips); extrair custa até 20s. Enquanto foram o mesmo
 * passo, os presos herdaram o preço do trabalho caro. Agora o reaper é um passo próprio, barato,
 * na cauda privilegiada, e ANTES da extração — o documento que ele solta volta para `pending` e
 * ainda pode ser extraído na mesma rodada.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";
import { RESERVA, PASSOS_CAUDA, ORDEM_DOS_PASSOS } from "@/lib/server/esteira-reservas";

const RAIZ = join(__dirname, "../../../..");
const ler = (p: string) => readFileSync(join(RAIZ, p), "utf-8");
const RUN = ler("src/app/api/v1/pipeline/run/route.ts");
const PIPELINE = ler("src/lib/server/pipeline.ts");
const ROTA = ler("src/app/api/v1/upload/process/route.ts");

describe("etapa74 · o reaper vira um passo próprio", () => {
  it("`processPendingDocuments` sabe rodar SÓ os reapers", () => {
    expect(PIPELINE).toMatch(/apenasReaper\?: boolean/);
    expect(PIPELINE).toMatch(/if \(opcoes\?\.apenasReaper\) return \{ processed: 0/);
  });

  it("o retorno antecipado vem DEPOIS dos reapers e ANTES da fila cara", () => {
    // Se voltasse antes dos reapers não repararia nada; se voltasse depois do select de
    // `pending`, teria pago o preço que o passo existe para não pagar.
    const codigo = PIPELINE.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/\/\/.*$/gm, " ");
    const terceiroReaper = codigo.indexOf("religados++");
    const retorno = codigo.indexOf("if (opcoes?.apenasReaper)");
    const filaCara = codigo.indexOf("const normalizedLimit");
    expect(terceiroReaper).toBeGreaterThan(-1);
    expect(retorno).toBeGreaterThan(terceiroReaper);
    expect(retorno).toBeLessThan(filaCara);
  });

  it("a rota expõe o modo, sem rota nova e sem guard novo", () => {
    expect(ROTA).toMatch(/apenas_reaper"\) === "1"/);
    expect(ROTA).toMatch(/\{ apenasReaper \}/);
    // O guard continua sendo o da rota — nada de superfície nova de autorização.
    expect(ROTA).toMatch(/requireAdminOrCron/);
  });
});

describe("etapa74 · o reaper é barato e privilegiado", () => {
  it("custa uma fração da extração — é isso que o separa", () => {
    // Se a reserva do reaper subir para perto da extração, o conserto perde o sentido: ele volta
    // a ser caro e a ser pulado junto.
    expect(RESERVA.reaper).toBeLessThanOrEqual(RESERVA.extracao / 2);
  });

  it("está na CAUDA — é ele que solta o que já foi baixado", () => {
    expect(PASSOS_CAUDA).toContain("reaper");
  });

  it("vem ANTES da extração no plano — o que ele solta ainda pode ser extraído na mesma rodada", () => {
    const iReaper = ORDEM_DOS_PASSOS.indexOf("reaper");
    const iExtracao = ORDEM_DOS_PASSOS.indexOf("extracao");
    expect(iReaper).toBeGreaterThan(-1);
    expect(iReaper).toBeLessThan(iExtracao);
  });
});

describe("etapa74 · o orquestrador chama o passo, e reporta", () => {
  it("há um passo dedicado, com `apenas_reaper=1` e o passo «reaper»", () => {
    expect(RUN).toMatch(/call\(processPOST, "\/api\/v1\/upload\/process\?apenas_reaper=1", "reaper", \{\}\)/);
  });

  it("o passo do reaper vem antes do passo de extração NO CÓDIGO", () => {
    const codigo = RUN.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/\/\/.*$/gm, " ");
    const iReaper = codigo.indexOf('apenas_reaper=1');
    const iExtracao = codigo.indexOf('"/api/v1/upload/process?limit=20"');
    expect(iReaper).toBeGreaterThan(-1);
    expect(iExtracao).toBeGreaterThan(-1);
    expect(iReaper).toBeLessThan(iExtracao);
  });

  it("o que foi solto vira número na etapa — não some como antes", () => {
    expect(RUN).toMatch(/etapas\.presos = anotar\(r, "reaper", \{ religados/);
  });

  it("documento religado pede outra rodada — ele voltou para a fila para ser extraído", () => {
    expect(RUN).toMatch(/if \(religados > 0\) restantes = true;/);
  });

  it("o passo fora do plano se declara, como todos os outros", () => {
    expect(RUN).toMatch(/etapas\.presos = foraDoPlano\("reaper"\)/);
  });
});
