/**
 * Etapa 14 — testes do orçamento de tempo nos collectors, do skip-set ANTT,
 * do dedup de deliberações na importação e da prevenção de diretor duplicado.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ─── stub de db encadeável (Supabase-like) ───────────────────────────────────
type CallLog = { table: string; op: string; args: unknown[] };

function makeDb(resultQueues: Record<string, unknown[]>, log: CallLog[] = []) {
  const takeResult = (table: string) => {
    const queue = resultQueues[table] ?? [];
    return queue.length > 1 ? queue.shift() : queue[0] ?? { data: null, error: null };
  };
  const db = {
    log,
    from(table: string) {
      const result = takeResult(table);
      const chain: any = {};
      for (const m of ["select", "eq", "neq", "in", "is", "not", "order", "limit", "gte", "lte", "lt"]) {
        chain[m] = (...args: unknown[]) => { log.push({ table, op: m, args }); return chain; };
      }
      for (const m of ["insert", "update", "upsert", "delete"]) {
        chain[m] = (...args: unknown[]) => { log.push({ table, op: m, args }); return chain; };
      }
      chain.single = async () => { log.push({ table, op: "single", args: [] }); return result; };
      chain.maybeSingle = async () => { log.push({ table, op: "maybeSingle", args: [] }); return result; };
      chain.then = (res: any, rej: any) => Promise.resolve(result).then(res, rej);
      return chain;
    },
  };
  return db as any;
}

// ─── discoverAntt2026Meetings: deadline + skip-set ───────────────────────────
describe("discoverAntt2026Meetings — orçamento e skip-set", () => {
  const LISTAGEM = `
    <html><body>
      Reuniões de 2026
      <a href="https://portal.antt.gov.br/reuniao-1036">1036ª Reunião de Diretoria Ordinária - 2026</a>
      <a href="https://portal.antt.gov.br/reuniao-1037">1037ª Reunião de Diretoria Ordinária - 2026</a>
    </body></html>`;
  const PAGINA_REUNIAO = `
    <html><body>
      <h1>1037ª Reunião de Diretoria Ordinária</h1>
      Data: 15 de junho de 2026
    </body></html>`;

  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.resetModules();
    process.env.COLLECTOR_HOST_THROTTLE_MS = "1";
    fetchMock = vi.fn(async (url: string | URL) => {
      const u = String(url);
      const body = u.includes("reuniao-") ? PAGINA_REUNIAO : LISTAGEM;
      return new Response(body, { status: 200, headers: { "content-type": "text/html" } });
    });
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.COLLECTOR_HOST_THROTTLE_MS;
  });

  it("deadline no passado ⇒ truncated=true sem buscar nenhuma página", async () => {
    const { discoverAntt2026Meetings } = await import("@/lib/server/antt-2026-collector");
    const result = await discoverAntt2026Meetings({ deadlineAt: Date.now() - 1 });
    expect(result.truncated).toBe(true);
    expect(result.meetings).toHaveLength(0);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("skip-set pula o fetch das reuniões já conhecidas (re-run barato)", async () => {
    const { discoverAntt2026Meetings } = await import("@/lib/server/antt-2026-collector");
    const skip = new Set(["https://portal.antt.gov.br/reuniao-1036"]);
    const result = await discoverAntt2026Meetings({ skipMeetingUrls: skip, maxPages: 1 });
    expect(result.skippedKnown).toBe(1);
    const urlsBuscadas = fetchMock.mock.calls.map((c) => String(c[0]));
    expect(urlsBuscadas.some((u) => u.includes("reuniao-1036"))).toBe(false);
    expect(urlsBuscadas.some((u) => u.includes("reuniao-1037"))).toBe(true);
  });
});

// ─── fetchMonitoringSite: truncamento preserva itens / headless sem saldo ────
describe("fetchMonitoringSite — orçamento na paginação e no headless", () => {
  beforeEach(() => vi.resetModules());
  afterEach(() => vi.restoreAllMocks());

  it("orçamento curto: lê a 1ª página, preserva itens e marca truncated (sem página 2)", async () => {
    const fetchText = vi.fn()
      .mockResolvedValueOnce(`
        <a href="https://site.gov/ata-1.pdf">Ata da 1ª Reunião</a>
        <a rel="next" href="https://site.gov/lista?p=2">Próximo</a>`);
    vi.doMock("@/lib/server/resilient-fetch", () => ({ resilientFetchText: fetchText }));
    const headless = vi.fn();
    vi.doMock("@/lib/server/headless", () => ({ tryRenderHtmlFallback: headless }));

    const { fetchMonitoringSite } = await import("@/lib/server/monitoring");
    const result = await fetchMonitoringSite(
      { id: "s1", agencia_id: null, nome: "Fonte", url: "https://site.gov/lista", estrategia: "html-static" },
      { deadlineAt: Date.now() + 1_000 }, // cabe a 1ª página; nada além
    );
    expect(result.items.length).toBeGreaterThan(0);
    expect(result.truncated).toBe(true);
    expect(fetchText).toHaveBeenCalledTimes(1);
    expect(headless).not.toHaveBeenCalled(); // reserva de 35s não cabe
  });
});

// ─── dedup de deliberações na importação ─────────────────────────────────────
describe("findDeliberacaoExistente — dedup na importação", () => {
  it("mesmo número no MESMO ano ⇒ duplicata; ano diferente ⇒ não", async () => {
    const { findDeliberacaoExistente } = await import("@/lib/server/deliberacao-dedup");
    const db = makeDb({
      deliberacoes: [{
        data: [{ id: "d1", resultado: "Aprovado", data_reuniao: "2026-03-10", reuniao_id: null }],
        error: null,
      }],
    });
    const dup = await findDeliberacaoExistente(db, {
      agenciaId: "ag1", numeroDeliberacao: "487", dataReuniao: "2026-05-01",
    });
    expect(dup?.id).toBe("d1");

    const dbOutroAno = makeDb({
      deliberacoes: [{
        data: [{ id: "d1", resultado: "Aprovado", data_reuniao: "2025-03-10", reuniao_id: null }],
        error: null,
      }],
    });
    const naoDup = await findDeliberacaoExistente(dbOutroAno, {
      agenciaId: "ag1", numeroDeliberacao: "487", dataReuniao: "2026-05-01",
    });
    expect(naoDup).toBeNull();
  });

  it("fallback por processo+data quando não há número", async () => {
    const { findDeliberacaoExistente } = await import("@/lib/server/deliberacao-dedup");
    const db = makeDb({
      deliberacoes: [{
        data: [{ id: "d2", resultado: null, data_reuniao: "2026-04-02", reuniao_id: null }],
        error: null,
      }],
    });
    const dup = await findDeliberacaoExistente(db, {
      agenciaId: "ag1", processo: "50500.123/2026-11", dataReuniao: "2026-04-02",
    });
    expect(dup?.id).toBe("d2");
  });
});

// ─── prevenção de diretor duplicado ao aprovar new_director ──────────────────
describe("aprovarCandidato — prevenção de diretor duplicado", () => {
  it("nome que casa ≥0.85 com diretor existente REUSA o cadastro (não cria)", async () => {
    vi.resetModules();
    vi.doMock("@/lib/server/retroactive-votes", () => ({
      applyRetroactiveVotes: vi.fn(async () => ({ criados: 0 })),
    }));
    const log: CallLog[] = [];
    const db = makeDb({
      diretores: [
        // 1ª chamada: lista da agência p/ prevenção
        { data: [{ id: "dir-alex", nome: "Alex Antonio de Azevedo Cruz", nome_variantes: [] }], error: null },
        // 2ª chamada: leitura p/ aprender variante
        { data: { nome: "Alex Antonio de Azevedo Cruz", nome_variantes: [] }, error: null },
        // 3ª chamada: update
        { data: null, error: null },
      ],
      diretor_candidatos: [{ data: null, error: null }],
    }, log);

    const { aprovarCandidato } = await import("@/lib/server/candidato-approval");
    const result = await aprovarCandidato(db, {
      id: "cand1",
      agencia_id: "ag-antt",
      nome_detectado: "Alex Azevedo",
      diretor_id: null,
    });

    expect(result.diretorId).toBe("dir-alex");
    const insertsDiretor = log.filter((c) => c.table === "diretores" && c.op === "insert");
    expect(insertsDiretor).toHaveLength(0); // NÃO criou segundo diretor
    const updates = log.filter((c) => c.table === "diretores" && c.op === "update");
    expect(updates.length).toBeGreaterThan(0); // aprendeu a variante no existente
  });
});
