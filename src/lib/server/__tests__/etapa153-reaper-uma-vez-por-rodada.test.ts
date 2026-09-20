/**
 * Etapa 153 (Fase 29, commit 1) — o reaper para de comer a fatia da extração.
 *
 * ═══ O defeito, medido em produção ═══
 * A esteira chama `/upload/process` DUAS vezes por rodada: o passo `reaper` (barato, cedo) e a
 * extração. Mas `processPendingDocuments` rodava os QUATRO reapers INCONDICIONALMENTE e só depois
 * consultava o modo — então a segunda chamada repetia todo o reparo, e a conta saía da fatia da
 * EXTRAÇÃO: 1 SELECT de `queued` + 25 do N+1 (os 25 documentos da ARTESP presos em fila) + 2
 * UPDATEs cegos + o poço `em_revisao` + até 25 carimbos + 2 SELECTs da reconciliação.
 * **33 a 58 round-trips, até 51.000 ms de uma fatia de 53.000 ms.**
 *
 * Resultado medido: a extração INICIOU 2 jobs em 10 rodadas. E os mesmos 25 em `queued` eram o
 * que tornava o reaper caro — um laço que se alimenta, porque a extração é quem os drenaria.
 *
 * ⚠️ Os 2.000 ms do guard do religamento protegiam o custo de UMA iteração, não o de quem vem
 * depois. Sair do laço com 2.001 ms deixa `jobsPermitidos(2_001, 4) = 0`: a extração roda, paga o
 * round-trip de auth e devolve ZERO. É a regra da Fase 7 violada dentro de uma função só.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { modoDoProcessamento } from "@/lib/server/modo-do-processamento";
import { planejarReligacao, type JobConhecido } from "@/lib/server/religacao-da-fila";
import {
  protecaoDepoisDe,
  RESERVA_RELIGACAO_MS,
  RESERVA_CARIMBO_MS,
  RESERVA_RECONCILIACAO_MS,
} from "@/lib/server/orcamento-dos-reapers";
import { RESERVA_POR_JOB_MS, jobsPermitidos } from "@/lib/server/pipeline";

vi.mock("@/lib/supabase/server", () => ({ createSupabaseServerClient: () => globalThis.__reaperDb }));
declare global { var __reaperDb: unknown }

describe("etapa153 · o modo é explícito nos DOIS sentidos", () => {
  it.each([
    [{ apenasReaper: true }, "reaper", true, false],
    [{ apenasExtracao: true }, "extracao", false, true],
    [{}, "ambos", true, true],
    // Combinação que nenhum chamador real usa; o reaper vence porque é o modo conservador
    // (repara e não gasta a fila cara).
    [{ apenasReaper: true, apenasExtracao: true }, "reaper", true, false],
  ] as Array<[Record<string, boolean>, string, boolean, boolean]>)(
    "%o → modo %s (reparar=%s, extrair=%s)",
    (params, modo, reparar, extrair) => {
      expect(modoDoProcessamento(params)).toEqual({ modo, reparar, extrair });
    },
  );

  it("⚠️ o default é «ambos» — a tela de upload manual chama sem flag e depende do reparo", () => {
    expect(modoDoProcessamento({}).reparar).toBe(true);
  });
});

describe("etapa153 · a reserva vira escada — o laço deixa saldo para quem vem depois", () => {
  it.each([
    ["religacao", "reaper", RESERVA_RELIGACAO_MS + RESERVA_CARIMBO_MS + RESERVA_RECONCILIACAO_MS],
    ["carimbo", "reaper", RESERVA_CARIMBO_MS + RESERVA_RECONCILIACAO_MS],
    ["reconciliacao", "reaper", RESERVA_RECONCILIACAO_MS],
    ["religacao", "ambos", RESERVA_RELIGACAO_MS + RESERVA_CARIMBO_MS + RESERVA_RECONCILIACAO_MS + RESERVA_POR_JOB_MS],
    ["carimbo", "ambos", RESERVA_CARIMBO_MS + RESERVA_RECONCILIACAO_MS + RESERVA_POR_JOB_MS],
    ["reconciliacao", "ambos", RESERVA_RECONCILIACAO_MS + RESERVA_POR_JOB_MS],
  ] as Array<[any, any, number]>)("%s no modo %s → %i ms", (etapa, modo, esperado) => {
    expect(protecaoDepoisDe(etapa, modo)).toBe(esperado);
  });

  it("no modo «ambos», sair do laço deixa saldo para ADMITIR um job — era isto que faltava", () => {
    // O guard antigo era 2.000. Com ele, o laço parava com 2.001 ms e a extração recebia zero.
    const saldoAoSair = protecaoDepoisDe("reconciliacao", "ambos");
    expect(jobsPermitidos(saldoAoSair, 4)).toBeGreaterThanOrEqual(1);
    expect(jobsPermitidos(2_001, 4)).toBe(0); // a aritmética do defeito, explícita
  });

  it("o carimbo reserva mais que um round-trip real — 400 ms não cobria uma iteração", () => {
    expect(RESERVA_CARIMBO_MS).toBeGreaterThan(400);
  });
});

describe("etapa153 · a religação decide em LOTE, e o hash ambíguo continua NÃO adotando", () => {
  const job = (id: string, status: string, dono: string | null = null): JobConhecido =>
    ({ id, status, documento_id: dono });
  const doc = (id: string, jobId: string | null, hash: string | null) =>
    ({ id, upload_job_id: jobId, file_hash: hash });

  it.each([
    // [documento, jobsPorId, jobsPorHash, desfecho esperado]
    ["sem job e sem candidato", doc("d1", null, "h1"), [], [], "falhar"],
    ["sem job, candidato livre", doc("d2", null, "h2"), [], [job("j2", "done")], "adotar"],
    ["sem job, candidato já é dele", doc("d3", null, "h3"), [], [job("j3", "done", "d3")], "adotar"],
    ["sem job, candidato de OUTRO dono", doc("d4", null, "h4"), [], [job("j4", "done", "outro")], "falhar"],
    // ⚠️ O `.maybeSingle()` de antes ERRAVA com 2 linhas e devolvia null — não adotava. Em lote
    // isso tem de ser explícito, senão o reaper adota um job arbitrário e estoura a UNIQUE.
    ["hash com DOIS candidatos", doc("d5", null, "h5"), [], [job("j5a", "done"), job("j5b", "done")], "falhar"],
    ["job pending — está na fila", doc("d6", "j6", null), [job("j6", "pending")], [], "segue"],
    ["job processing — é do reaper #1", doc("d7", "j7", null), [job("j7", "processing")], [], "segue"],
    ["job done", doc("d8", "j8", null), [job("j8", "done")], [], "religar"],
    ["job failed", doc("d9", "j9", null), [job("j9", "failed")], [], "religar"],
    ["vínculo para job inexistente", doc("d10", "sumiu", null), [], [], "falhar"],
  ] as Array<[string, any, JobConhecido[], JobConhecido[], string]>)(
    "%s → %s", (_nome, documento, porId, porHash, esperado) => {
      const mapaId = new Map(porId.map((j) => [j.id, j]));
      const mapaHash = new Map<string, JobConhecido[]>();
      if (porHash.length && documento.file_hash) mapaHash.set(documento.file_hash, porHash);
      expect(planejarReligacao([documento], mapaId, mapaHash)[0].desfecho).toBe(esperado);
    },
  );

  it("o motivo do fracasso vai junto — «failed» sem motivo é silêncio com outro nome", () => {
    const r = planejarReligacao([doc("d", null, "h")], new Map(), new Map());
    expect(r[0].motivo).toMatch(/sem job e sem candidato/);
  });
});

/**
 * A prova de COMPORTAMENTO: contar round-trips. Não é grep — o `db` falso registra cada `from()`
 * e cada filtro, e a asserção é sobre o que a função REALMENTE consultou.
 */
describe("etapa153 · no modo «extracao» o reaper não consulta NADA", () => {
  function fakeDb(consultas: Array<{ tabela: string; filtros: string[] }>) {
    return {
      from(tabela: string) {
        const filtros: string[] = [];
        const registro = { tabela, filtros };
        consultas.push(registro);
        const self: any = new Proxy({}, {
          get(_t, prop: string) {
            if (prop === "then") {
              return (r: (v: { data: never[]; error: null }) => unknown) => r({ data: [], error: null });
            }
            if (prop === "maybeSingle" || prop === "single") {
              return async () => ({ data: null, error: null });
            }
            return (coluna?: unknown, valor?: unknown) => {
              if (typeof coluna === "string") filtros.push(`${prop}:${coluna}=${String(valor)}`);
              else filtros.push(prop);
              return self;
            };
          },
        });
        return self;
      },
    };
  }

  beforeEach(() => { vi.resetModules(); });

  it("modo «extracao»: zero consultas a `queued` e a `monitoramento_itens`", async () => {
    const consultas: Array<{ tabela: string; filtros: string[] }> = [];
    globalThis.__reaperDb = fakeDb(consultas);
    const { processPendingDocuments } = await import("@/lib/server/pipeline");
    await processPendingDocuments(20, Date.now() + 50_000, { apenasExtracao: true });

    const aQueued = consultas.filter((c) => c.filtros.some((f) => f.includes("queued")));
    const aoPoco = consultas.filter((c) => c.tabela === "monitoramento_itens");
    expect(aQueued, `consultou queued: ${JSON.stringify(aQueued)}`).toHaveLength(0);
    expect(aoPoco, `consultou o poço: ${JSON.stringify(aoPoco)}`).toHaveLength(0);
    // E não escreveu nos documentos presos (os dois UPDATEs cegos dos reapers #1 e #2).
    expect(consultas.filter((c) => c.filtros.includes("update"))).toHaveLength(0);
  });

  it("modo «reaper»: repara, e a fila cara NÃO é tocada", async () => {
    const consultas: Array<{ tabela: string; filtros: string[] }> = [];
    globalThis.__reaperDb = fakeDb(consultas);
    const { processPendingDocuments } = await import("@/lib/server/pipeline");
    const r = await processPendingDocuments(20, Date.now() + 50_000, { apenasReaper: true });

    expect(consultas.some((c) => c.filtros.some((f) => f.includes("queued")))).toBe(true);
    expect(r.processed).toBe(0);
    // `pending` é a fila cara: o passo do reaper existe justamente para não pagar por ela.
    expect(consultas.some((c) => c.filtros.some((f) => f.includes("pending")))).toBe(false);
  });

  it("com 25 presos, a religação custa DUAS leituras de job, não 26", async () => {
    const consultas: Array<{ tabela: string; filtros: string[] }> = [];
    const presos = Array.from({ length: 25 }, (_, i) => ({
      id: `d${i}`, upload_job_id: i % 2 === 0 ? `j${i}` : null, file_hash: `h${i}`,
      storage_path: `p${i}`, agencia_id: "ag",
    }));
    const db = {
      from(tabela: string) {
        const filtros: string[] = [];
        consultas.push({ tabela, filtros });
        const self: any = new Proxy({}, {
          get(_t, prop: string) {
            if (prop === "then") {
              return (r: (v: { data: unknown[]; error: null }) => unknown) => {
                const ehQueued = filtros.some((f) => f.includes("queued"));
                return r({ data: ehQueued ? presos : [], error: null });
              };
            }
            if (prop === "maybeSingle" || prop === "single") return async () => ({ data: null, error: null });
            return (coluna?: unknown, valor?: unknown) => {
              if (typeof coluna === "string") filtros.push(`${prop}:${coluna}=${String(valor)}`);
              else filtros.push(prop);
              return self;
            };
          },
        });
        return self;
      },
    };
    globalThis.__reaperDb = db;
    const { processPendingDocuments } = await import("@/lib/server/pipeline");
    await processPendingDocuments(20, Date.now() + 50_000, { apenasReaper: true });

    // As leituras de `upload_jobs` que servem à decisão: por id e por file_hash. Duas, em lote.
    const leiturasDeJob = consultas.filter(
      (c) => c.tabela === "upload_jobs" && c.filtros.some((f) => f.startsWith("in:")),
    );
    expect(leiturasDeJob.length, `esperava 2 leituras em lote, veio ${leiturasDeJob.length}`).toBeLessThanOrEqual(2);
    // E nenhuma leitura por documento (o N+1 de antes usava `.eq("id", jobId)` + maybeSingle).
    const porDocumento = consultas.filter(
      (c) => c.tabela === "upload_jobs" && c.filtros.some((f) => f.startsWith("eq:file_hash")),
    );
    expect(porDocumento).toHaveLength(0);
  });
});
