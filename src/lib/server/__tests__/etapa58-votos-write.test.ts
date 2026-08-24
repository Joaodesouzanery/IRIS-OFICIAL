/**
 * Etapa 58 — caminho ÚNICO de escrita na tabela `votos`.
 *
 * O que este módulo elimina:
 *
 *  1. O ERRO DESCARTADO. `await db.from("votos").upsert(...)` sem `const { error }` fazia uma
 *     violação de constraint apagar os votos do documento EM SILÊNCIO: o confirm reportava
 *     "created" e a deliberação ficava sem voto nenhum — indistinguível de um documento que
 *     realmente não tem voto. É o pior tipo de falha porque não deixa rastro.
 *
 *  2. TRÊS write-paths divergentes. Só o `confirm` protegia voto nominal; o backfill retroativo e
 *     o `materializar-faltantes` faziam upsert cru. O mesmo dado entrava na mesma tabela por três
 *     portas com três comportamentos.
 *
 *  3. COLUNAS QUE AINDA NÃO EXISTEM. A migration da etapa59 é aplicada à mão pelo usuário e o
 *     deploy vem ANTES dela. A sonda de capacidade grava `proveniencia` assim que a coluna existir,
 *     sem redeploy — e não quebra enquanto ela não existe.
 */

import { describe, it, expect, beforeEach } from "vitest";
import {
  upsertVotos,
  upsertVotosProtegido,
  sanitizeVotosSugeridos,
  colunaAusenteDoErro,
  resetCapacidadeVotos,
} from "@/lib/server/votos-write";
import type { VotoInsertRow } from "@/lib/server/vote-inference";

const ROW = (over: Partial<VotoInsertRow> = {}): VotoInsertRow => ({
  deliberacao_id: "del-1",
  diretor_id: "d1",
  tipo_voto: "Favoravel",
  is_divergente: false,
  is_nominal: true,
  proveniencia: "nominal",
  ...over,
});

/** Fake mínimo do client Supabase, com controle sobre o erro de cada upsert. */
function fakeDb(opts: {
  existentes?: any[];
  erros?: Array<{ code: string; message: string } | null>;
  erroLeitura?: { code: string; message: string };
} = {}) {
  const upserts: any[][] = [];
  const erros = [...(opts.erros ?? [])];
  const db = {
    from() {
      return {
        select() { return this; },
        in() {
          return Promise.resolve(
            opts.erroLeitura
              ? { data: null, error: opts.erroLeitura }
              : { data: opts.existentes ?? [], error: null },
          );
        },
        upsert(rows: any[]) {
          upserts.push(rows);
          const err = erros.length ? erros.shift() : null;
          return Promise.resolve({ error: err ?? null });
        },
      };
    },
  };
  return { db, upserts };
}

beforeEach(() => resetCapacidadeVotos());

describe("etapa58 · o erro para de ser descartado", () => {
  it("violação de constraint volta como erro, não como sucesso silencioso", async () => {
    const { db } = fakeDb({ erros: [{ code: "23503", message: "violates foreign key constraint" }] });
    const r = await upsertVotos(db as any, [ROW()]);
    expect(r.gravados).toBe(0);
    expect(r.error?.code).toBe("23503");
    expect(r.error?.message).toMatch(/foreign key/i);
  });

  it("sucesso devolve a contagem e nenhum erro", async () => {
    const { db, upserts } = fakeDb();
    const r = await upsertVotos(db as any, [ROW(), ROW({ diretor_id: "d2" })]);
    expect(r.error).toBeNull();
    expect(r.gravados).toBe(2);
    expect(upserts[0]).toHaveLength(2);
  });

  it("falha ao LER o estado atual não vira «grava tudo»", async () => {
    // Sem saber o que já é nominal, o upsert rebaixaria votos lidos. Recusar é a opção correta.
    const { db, upserts } = fakeDb({ erroLeitura: { code: "42501", message: "permission denied" } });
    const r = await upsertVotosProtegido(db as any, [ROW({ is_nominal: false })]);
    expect(upserts).toHaveLength(0);
    expect(r.error?.message).toMatch(/falha ao ler votos existentes/i);
  });
});

describe("etapa58 · voto nominal não é rebaixado para inferido", () => {
  it("linha INFERIDA não sobrescreve um NOMINAL já gravado", async () => {
    const { db, upserts } = fakeDb({ existentes: [{ deliberacao_id: "del-1", diretor_id: "d1", is_nominal: true }] });
    const r = await upsertVotosProtegido(db as any, [ROW({ is_nominal: false, proveniencia: "inferido_decisao" })]);
    expect(upserts).toHaveLength(0);
    expect(r.gravados).toBe(0);
    expect(r.error).toBeNull();
  });

  it("linha NOMINAL sobrescreve — o documento relido prevalece", async () => {
    const { db, upserts } = fakeDb({ existentes: [{ deliberacao_id: "del-1", diretor_id: "d1", is_nominal: true }] });
    const r = await upsertVotosProtegido(db as any, [ROW({ tipo_voto: "Desfavoravel" })]);
    expect(upserts[0]).toHaveLength(1);
    expect(r.gravados).toBe(1);
  });

  it("inferido grava normalmente onde não havia nominal", async () => {
    const { db, upserts } = fakeDb({ existentes: [{ deliberacao_id: "del-1", diretor_id: "d1", is_nominal: false }] });
    const r = await upsertVotosProtegido(db as any, [ROW({ is_nominal: false })]);
    expect(upserts[0]).toHaveLength(1);
    expect(r.gravados).toBe(1);
  });
});

describe("etapa58 · sonda de capacidade (deploy ANTES da migration é seguro)", () => {
  it("reconhece a coluna ausente nas duas formas de erro", () => {
    expect(colunaAusenteDoErro({ code: "PGRST204", message: "Could not find the 'proveniencia' column of 'votos'" }))
      .toBe("proveniencia");
    expect(colunaAusenteDoErro({ code: "42703", message: 'column "motivo_nao_voto" of relation "votos" does not exist' }))
      .toBe("motivo_nao_voto");
    // Erro que NÃO é coluna ausente não pode ser confundido com um — senão o strip-and-retry
    // engoliria uma violação real de constraint.
    expect(colunaAusenteDoErro({ code: "23503", message: "violates foreign key constraint" })).toBeNull();
  });

  it("remove a coluna inexistente e RETENTA — o voto é gravado, nunca perdido", async () => {
    const { db, upserts } = fakeDb({
      erros: [{ code: "PGRST204", message: "Could not find the 'proveniencia' column of 'votos'" }, null],
    });
    const r = await upsertVotos(db as any, [ROW()]);
    expect(r.error).toBeNull();
    expect(r.gravados).toBe(1);
    expect(r.colunasIgnoradas).toContain("proveniencia");
    // 1ª tentativa COM a coluna, 2ª SEM ela.
    expect("proveniencia" in upserts[0][0]).toBe(true);
    expect("proveniencia" in upserts[1][0]).toBe(false);
  });

  it("memoiza a ausência: a segunda escrita já sai sem a coluna (uma tentativa só)", async () => {
    const { db, upserts } = fakeDb({
      erros: [{ code: "PGRST204", message: "Could not find the 'proveniencia' column of 'votos'" }, null, null],
    });
    await upsertVotos(db as any, [ROW()]);
    const antes = upserts.length;
    await upsertVotos(db as any, [ROW({ diretor_id: "d2" })]);
    expect(upserts.length - antes).toBe(1);
    expect("proveniencia" in upserts[upserts.length - 1][0]).toBe(false);
  });

  it("erro REAL depois do strip continua sendo propagado", async () => {
    const { db } = fakeDb({
      erros: [
        { code: "PGRST204", message: "Could not find the 'proveniencia' column of 'votos'" },
        { code: "23514", message: "violates check constraint votos_tipo_voto_check" },
      ],
    });
    const r = await upsertVotos(db as any, [ROW()]);
    expect(r.error?.code).toBe("23514");
  });
});

describe("etapa58 · sanitização de `votos_sugeridos` vindo do browser", () => {
  const UUID = "11111111-2222-3333-4444-555555555555";

  it("aceita o payload legítimo", () => {
    const out = sanitizeVotosSugeridos([
      { nome: "Felipe Queiroz", diretor_id: UUID, tipo_voto: "Desfavoravel", origem: "contrario", is_nominal: true },
    ]);
    expect(out).toEqual([
      { nome: "Felipe Queiroz", diretor_id: UUID, tipo_voto: "Desfavoravel", origem: "contrario", is_nominal: true },
    ]);
  });

  it("rejeita tipo_voto fora do CHECK — o banco deixa de ser o único validador", () => {
    expect(sanitizeVotosSugeridos([{ diretor_id: UUID, tipo_voto: "Favoravel'; DROP TABLE votos;--" }])).toEqual([]);
    expect(sanitizeVotosSugeridos([{ diretor_id: UUID, tipo_voto: "Simpatizante" }])).toEqual([]);
  });

  it("rejeita diretor_id que não é UUID", () => {
    expect(sanitizeVotosSugeridos([{ diretor_id: "../../admin", tipo_voto: "Favoravel" }])).toEqual([]);
    expect(sanitizeVotosSugeridos([{ diretor_id: 42, tipo_voto: "Favoravel" }])).toEqual([]);
  });

  it("descarta campos não previstos em vez de repassá-los ao banco", () => {
    const out = sanitizeVotosSugeridos([
      { diretor_id: UUID, tipo_voto: "Favoravel", is_nominal: true, id: "forjado", created_at: "1999-01-01", role: "admin" },
    ]);
    expect(Object.keys(out[0]).sort()).toEqual(["diretor_id", "is_nominal", "nome", "origem", "tipo_voto"]);
  });

  it("origem desconhecida cai para «nominal» em vez de passar direto", () => {
    expect(sanitizeVotosSugeridos([{ diretor_id: UUID, tipo_voto: "Favoravel", origem: "qualquer_coisa" }])[0].origem)
      .toBe("nominal");
  });

  it("«revisao_humana» é origem VÁLIDA — é o dado de maior qualidade do sistema", () => {
    expect(sanitizeVotosSugeridos([{ diretor_id: UUID, tipo_voto: "Ausente", origem: "revisao_humana", is_nominal: true }])[0].origem)
      .toBe("revisao_humana");
  });

  it("deduplica por diretor e limita o tamanho do lote", () => {
    expect(sanitizeVotosSugeridos([
      { diretor_id: UUID, tipo_voto: "Favoravel" },
      { diretor_id: UUID, tipo_voto: "Desfavoravel" },
    ])).toHaveLength(1);
    const muitos = Array.from({ length: 100 }, (_, i) => ({
      diretor_id: `1111111${String(i).padStart(2, "0")}-2222-3333-4444-555555555555`,
      tipo_voto: "Favoravel",
    }));
    expect(sanitizeVotosSugeridos(muitos).length).toBeLessThanOrEqual(30);
  });

  it("entrada que não é array não derruba nada", () => {
    expect(sanitizeVotosSugeridos(null)).toEqual([]);
    expect(sanitizeVotosSugeridos("votos")).toEqual([]);
    expect(sanitizeVotosSugeridos({ diretor_id: UUID })).toEqual([]);
  });
});
