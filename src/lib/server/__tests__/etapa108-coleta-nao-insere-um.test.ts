/**
 * Etapa 108 (Fase 18, commit 1) — a coleta para de inserir UM item por rodada.
 *
 * ═══ O defeito, com a aritmética que o denuncia ═══
 * O laço que insere os itens descobertos gateava CADA item com
 * `hasBudget(deadlineAt, RESERVA.coleta)` — 25 segundos por item. A fatia real da coleta é 28s
 * (TETO_FATIA.coleta + MARGEM_PARTIDA_MS): cabe UM. É a explicação exata do que a medição de
 * produção mostrou — a ARTESP com `itens: 264, novos: 1`: a fonte tinha 264 itens e a rodada
 * inseriu um.
 *
 * A reserva de 25s é o custo de um DOWNLOAD DE PDF — o `tryAutoEnqueueMonitoredDocument` que roda
 * DEPOIS do insert. O insert em si é uma ida ao banco. Cobrar o preço do download por item
 * descoberto estrangulou a descoberta das três agências.
 *
 * ═══ A separação ═══
 * Descobrir é barato e é o que não pode parar; baixar é caro e já tem um passo próprio na esteira
 * (`enqueue`). Item descoberto e não baixado fica `novo` e o passo seguinte o pega — que é
 * exatamente para isso que ele existe.
 *
 * ⚠️ O efeito colateral entra vigiado (ver etapa110/QA): acelerar a descoberta sem acelerar o
 * download alarga o vão entre descoberto e baixado. Item parado em `novo` por semanas seria um
 * poço novo — a mesma classe do `em_revisao`, um estágio antes.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

/** Relógio controlado: cada consulta ao orçamento anda o tempo simulado. */
let agora = 0;
const avancar = (ms: number) => { agora += ms; };

vi.mock("@/lib/server/time-budget", async (original) => {
  const real = (await original()) as Record<string, unknown>;
  return {
    ...real,
    // `hasBudget(deadlineAt, reserva)` → sobra > reserva, com o relógio simulado.
    hasBudget: (deadlineAt?: number, reserva = 0) =>
      deadlineAt === undefined ? true : deadlineAt - agora > reserva,
  };
});

/** A rede não entra no teste: a listagem já vem parseada, com 50 itens. */
const ITENS = Array.from({ length: 50 }, (_, i) => ({
  tipo: "deliberacao",
  titulo: `Deliberação ${i + 1}`,
  url_item: `https://exemplo.org/doc-${i + 1}.pdf`,
  reuniao: null,
  data_reuniao: null,
  hash_item: `hash-${i + 1}`,
  metadata: {},
}));

vi.mock("@/lib/server/monitoring", async (original) => {
  const real = (await original()) as Record<string, unknown>;
  return {
    ...real,
    fetchMonitoringSite: async () => ({ items: ITENS, truncated: false, skippedKnown: 0 }),
  };
});

vi.mock("@/lib/server/resilient-fetch", () => ({
  drainFetchStats: () => ({ retries: 0, http429: 0, throttleWaitsMs: 0 }),
  // O download REAL do PDF é o custo que este teste isola: 20s de relógio por chamada.
  resilientFetch: async () => {
    downloads++;
    avancar(20_000);
    // PDF mínimo válido: os magic bytes bastam para o sniff do runner.
    return {
      ok: true,
      status: 200,
      headers: { get: (h: string) => (h.toLowerCase() === "content-type" ? "application/pdf" : null) },
      arrayBuffer: async () => new TextEncoder().encode("%PDF-1.4\n%%EOF").buffer,
    } as any;
  },
}));

vi.mock("@/lib/server/headless", () => ({
  drainHeadlessOutcomes: () => ({ dependency_missing: 0, launch_failed: 0 }),
  fetchHtmlHeadless: async () => null,
}));

/** Cada download simulado custa 20s do relógio — é o que torna o download o gargalo REAL. */
let downloads = 0;
vi.mock("@/lib/server/upload-queue", () => ({
  ensurePdfStorageBucket: async () => null,
  enqueuePdfBuffer: async () => ({ status: "queued", job_id: "job", document_id: "doc" }),
}));

let inseridos = 0;

/** Stub de banco: conta INSERTs em monitoramento_itens e aceita o resto em silêncio. */
function fakeDb() {
  const chain = (tabela: string) => {
    const api: any = {
      insert: (linha: any) => {
        if (tabela === "monitoramento_itens") {
          inseridos++;
          // cada INSERT custa ~120ms de relógio — barato, que é o ponto
          avancar(120);
        }
        return {
          select: () => ({
            single: async () => ({ data: { id: `item-${inseridos}`, ...linha }, error: null }),
          }),
          then: (r: any) => r({ data: null, error: null }),
        };
      },
      update: () => api,
      select: () => api,
      eq: () => api,
      not: () => api,
      in: () => api,
      lt: () => api,
      gt: () => api,
      order: () => api,
      limit: () => api,
      maybeSingle: async () => ({ data: null, error: null }),
      single: async () => ({ data: null, error: null }),
      then: (r: any) => r({ data: [], error: null }),
    };
    return api;
  };
  return { from: (t: string) => chain(t) };
}

const SITE = {
  id: "site-1",
  agencia_id: "ag-1",
  nome: "Fonte de teste",
  url: "https://exemplo.org/lista",
  estrategia: "html-static",
  seletor_links: "a[href]",
  tipo_fonte: "documentos_regulatorios",
  auto_enfileirar_pdf: true,
  ativo: true,
} as any;

describe("etapa108 · descobrir é barato; baixar é que é caro", () => {
  beforeEach(() => {
    agora = 0;
    inseridos = 0;
    downloads = 0;
  });

  it("COMPORTAMENTO: 50 itens numa fatia de 28s — insere os 50, não 1", async () => {
    const { processMonitoringSite } = await import("@/lib/server/monitoring-runner");
    // A fatia real da coleta: TETO_FATIA.coleta (25s) + MARGEM_PARTIDA_MS (3s).
    await processMonitoringSite(fakeDb(), SITE, { deadlineAt: 28_000 });
    // Antes deste commit: 1. O gate de 25s por item consumia a rodada inteira no primeiro.
    expect(inseridos).toBe(50);
  });

  it("…e o DOWNLOAD continua limitado pelo orçamento — o caro não virou barato", async () => {
    const { processMonitoringSite } = await import("@/lib/server/monitoring-runner");
    await processMonitoringSite(fakeDb(), SITE, { deadlineAt: 28_000 });
    // Com 20s por download num orçamento de 28s, cabe no máximo 1. O resto fica `novo` e o passo
    // `enqueue` da esteira os pega depois — que é exatamente para isso que ele existe.
    expect(downloads).toBeLessThanOrEqual(1);
    expect(inseridos).toBeGreaterThan(downloads * 10);
  });

  it("orçamento minúsculo continua interrompendo — o freio não sumiu, ficou proporcional", async () => {
    const { processMonitoringSite } = await import("@/lib/server/monitoring-runner");
    // 500ms não paga nem 5 inserções de 120ms.
    await processMonitoringSite(fakeDb(), SITE, { deadlineAt: 500 });
    expect(inseridos).toBeLessThan(10);
  });
});
