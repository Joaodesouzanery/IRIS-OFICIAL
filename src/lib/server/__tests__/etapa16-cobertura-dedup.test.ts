/**
 * Etapa 16 — skip-set ampliado (cobertura definitiva), dedup de deliberações
 * tolerante a número, e as garantias de limpeza retroativa.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

type CallLog = { table: string; op: string; args: unknown[] };

// Stub de db encadeável: cada tabela tem uma fila de resultados; métodos
// terminais (maybeSingle/single/then) resolvem o próximo resultado.
function makeDb(resultsByTable: Record<string, unknown[]>, log: CallLog[] = []) {
  const take = (table: string) => {
    const q = resultsByTable[table] ?? [];
    return q.length > 1 ? q.shift() : q[0] ?? { data: null, error: null };
  };
  const db: any = {
    log,
    from(table: string) {
      const result = take(table);
      const chain: any = {};
      for (const m of ["select", "eq", "neq", "in", "is", "not", "order", "limit", "gte", "lte", "lt"]) {
        chain[m] = (...args: unknown[]) => { log.push({ table, op: m, args }); return chain; };
      }
      for (const m of ["insert", "update", "upsert", "delete"]) {
        chain[m] = (...args: unknown[]) => { log.push({ table, op: m, args }); return chain; };
      }
      chain.single = async () => result;
      chain.maybeSingle = async () => result;
      chain.then = (res: any, rej: any) => Promise.resolve(result).then(res, rej);
      return chain;
    },
  };
  return db;
}

// ─── skip-set ampliado ───────────────────────────────────────────────────────
describe("buildAnttMeetingSkipSet — cobertura definitiva", () => {
  it("pula reunião ANTIGA com qualquer item + ata/deliberação de qualquer idade; NÃO pula recente só-com-voto", async () => {
    const { buildAnttMeetingSkipSet } = await import("@/lib/server/antt-2026-collector");
    const nowMs = Date.parse("2026-07-08T00:00:00Z");
    // corte = 2026-05-24 (45 dias antes)
    const itens = [
      { tipo: "voto", data_reuniao: "2026-03-01", metadata: { meeting_url: "u/antiga-voto" } },   // antiga + voto → pula
      { tipo: "pauta", data_reuniao: "2026-07-01", metadata: { meeting_url: "u/recente-pauta" } }, // recente só pauta → NÃO pula
      { tipo: "ata", data_reuniao: "2026-07-05", metadata: { meeting_url: "u/recente-ata" } },     // ata (qualquer idade) → pula
      { tipo: "voto", data_reuniao: null, metadata: { meeting_url: "u/sem-data" } },               // sem data + voto → NÃO pula
    ];
    const db = makeDb({ monitoramento_itens: [{ data: itens, error: null }], documentos_coletados: [{ data: [], error: null }] });
    const skip = await buildAnttMeetingSkipSet(db, { siteId: "s1", nowMs });
    expect(skip.has("u/antiga-voto")).toBe(true);
    expect(skip.has("u/recente-ata")).toBe(true);
    expect(skip.has("u/recente-pauta")).toBe(false);
    expect(skip.has("u/sem-data")).toBe(false);
  });

  it("falha de query → Set vazio (degrada p/ crawl completo)", async () => {
    const { buildAnttMeetingSkipSet } = await import("@/lib/server/antt-2026-collector");
    const db: any = { from() { throw new Error("boom"); } };
    const skip = await buildAnttMeetingSkipSet(db, {});
    expect(skip.size).toBe(0);
  });
});

// ─── dedup de deliberações tolerante a número ────────────────────────────────
describe("findDeliberacaoExistente — número tolerante", () => {
  it("casa por número exato (mesmo ano)", async () => {
    const { findDeliberacaoExistente } = await import("@/lib/server/deliberacao-dedup");
    const db = makeDb({
      deliberacoes: [{ data: [{ id: "d1", resultado: "Aprovado", data_reuniao: "2026-03-10", reuniao_id: null, numero_deliberacao: "487" }], error: null }],
    });
    const dup = await findDeliberacaoExistente(db, { agenciaId: "ag", numeroDeliberacao: "487", dataReuniao: "2026-03-10" });
    expect(dup?.id).toBe("d1");
  });

  it("casa '0487'≡'487' pela normalização (mesma data)", async () => {
    const { findDeliberacaoExistente } = await import("@/lib/server/deliberacao-dedup");
    // 1ª query (exata) não acha; 2ª query (mesma data) traz a linha com "0487".
    const db = makeDb({
      deliberacoes: [
        { data: [], error: null },
        { data: [{ id: "d9", resultado: null, data_reuniao: "2026-04-02", reuniao_id: null, numero_deliberacao: "0487" }], error: null },
      ],
    });
    const dup = await findDeliberacaoExistente(db, { agenciaId: "ag", numeroDeliberacao: "487", dataReuniao: "2026-04-02" });
    expect(dup?.id).toBe("d9");
  });
});

// ─── recompute: auto-aprova ≥0.85, recomputa/colapsa o resto ──────────────────
describe("recompute de candidatos (via findBestMatch real)", () => {
  beforeEach(() => vi.resetModules());
  afterEach(() => vi.restoreAllMocks());

  it("candidato legado 'Alex Azevedo' recomputa ≥0.85 contra 'Alex Antonio de Azevedo Cruz'", async () => {
    const { findBestMatch } = await import("@/lib/server/name-matcher");
    const m = findBestMatch("Alex Azevedo", [
      { id: "dir-alex", nome: "Alex Antonio de Azevedo Cruz", nome_variantes: [] },
    ]);
    expect(m.diretorId).toBe("dir-alex");
    expect(m.needsReview).toBe(false);
    expect(m.score).toBeGreaterThanOrEqual(0.85);
  });
});
