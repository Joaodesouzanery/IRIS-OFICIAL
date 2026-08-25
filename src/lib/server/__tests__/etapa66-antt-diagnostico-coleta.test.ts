/**
 * Etapa 66 — o diagnóstico do FUNIL de coleta da ANTT.
 *
 * A pergunta que a rota responde é uma só: **por que a ANTT aparece com 0% de cobertura nominal,
 * se o parser extrai os votos corretamente?** Medido contra três páginas reais de 2026, o coletor
 * captura 5/5, 6/6 e 3/3 votos, cada um ligado ao processo, com relator nominal. Então o gargalo
 * está a jusante ou é operacional — e o degrau em que o número cai é a resposta.
 *
 * O que este teste trava:
 *  · cada degrau do funil produz o diagnóstico CERTO (senão a rota vira ruído);
 *  · a rota **não escreve** — o banco falso lança em `insert`/`update`/`delete`/`upsert`.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/server/is-demo", () => ({ isDemo: () => false }));
vi.mock("@/lib/server/request-guards", () => ({
  isDemoRequest: (req: { headers: { get: (k: string) => string | null } }) =>
    req.headers.get("x-iris-demo") === "1",
  requireAdmin: async () => null,
}));
vi.mock("@/lib/supabase/server", () => ({ createSupabaseServerClient: () => globalThis.__db }));

declare global { var __db: unknown }

type Cenario = {
  reunioes?: Array<Record<string, unknown>>;
  documentos?: Array<Record<string, unknown>>;
  deliberacoes?: Array<Record<string, unknown>>;
  votosNominais?: number;
};

function fakeDb(c: Cenario, escritas: string[]) {
  const proibir = (op: string) => () => { escritas.push(op); throw new Error(`READ-ONLY chamou ${op}`); };
  return {
    from(tabela: string) {
      let linhas: Array<Record<string, unknown>> =
        tabela === "agencias" ? [{ id: "ag-antt", sigla: "ANTT" }]
        : tabela === "antt_reunioes_coletadas" ? (c.reunioes ?? [])
        : tabela === "documentos_coletados" ? (c.documentos ?? [])
        : tabela === "deliberacoes" ? (c.deliberacoes ?? [])
        : tabela === "votos" ? Array.from({ length: c.votosNominais ?? 0 }, (_, i) => ({ id: `v${i}` }))
        : [];
      let head = false;
      const self: any = {
        insert: proibir("insert"), update: proibir("update"),
        delete: proibir("delete"), upsert: proibir("upsert"),
        select(_c?: string, opts?: { count?: string; head?: boolean }) { head = Boolean(opts?.head); return self; },
        eq(coluna: string, valor: unknown) {
          if (tabela === "votos" && coluna === "is_nominal") return self;
          if (coluna === "agencia_id") return self;
          linhas = linhas.filter((r) => r[coluna] === valor || r[coluna] === undefined);
          return self;
        },
        in() { return self; },
        order() { return self; },
        limit() { return self; },
        maybeSingle: async () => ({ data: linhas[0] ?? null, error: null }),
        then: (r: (v: { data: unknown; error: null; count: number }) => unknown) =>
          r({ data: head ? null : linhas, error: null, count: linhas.length }),
      };
      return self;
    },
  };
}

async function rodar(c: Cenario) {
  const escritas: string[] = [];
  globalThis.__db = fakeDb(c, escritas);
  const { NextRequest } = await import("next/server");
  const { GET } = await import("@/app/api/v1/admin/antt/diagnostico-coleta/route");
  const res = await GET(new NextRequest("http://localhost/api/v1/admin/antt/diagnostico-coleta"));
  return { body: await res.json(), status: res.status, escritas };
}

const ONTEM = new Date(Date.now() - 86_400_000).toISOString();
const HA_40_DIAS = new Date(Date.now() - 40 * 86_400_000).toISOString();

beforeEach(() => vi.resetModules());

describe("etapa66 · diagnóstico do funil de coleta da ANTT", () => {
  it("degrau 1 — coletor NUNCA rodou", async () => {
    const { body, status, escritas } = await rodar({});
    expect(status).toBe(200);
    expect(escritas, "a rota não pode escrever").toEqual([]);
    expect(body.degrau_que_para).toBe("1_descoberta");
    expect(body.diagnostico.join(" ")).toMatch(/NUNCA rodou/);
  });

  it("degrau 1 — coleta VELHA aponta o plano Hobby, que é o candidato nº 1", async () => {
    const { body } = await rodar({
      reunioes: [{ tipo: "ordinaria", data_inicio: "2026-01-19", status: "coletada", coletado_em: HA_40_DIAS }],
    });
    expect(body.degrau_que_para).toBe("1_descoberta");
    expect(body.dias_desde_ultima_coleta).toBeGreaterThan(7);
    expect(body.diagnostico.join(" ")).toMatch(/Hobby|botão/);
  });

  it("degrau 2 — reuniões coletadas mas nenhum voto baixado", async () => {
    const { body } = await rodar({
      reunioes: [{ tipo: "ordinaria", data_inicio: "2026-07-02", status: "coletada", coletado_em: ONTEM }],
      documentos: [{ tipo: "pauta", status: "coletado" }, { tipo: "ata", status: "coletado" }],
    });
    expect(body.degrau_que_para).toBe("2_download");
    expect(body.funil.votos_baixados).toBe(0);
  });

  it("degrau 3 — voto baixado que não virou `voto_individual`", async () => {
    const { body } = await rodar({
      reunioes: [{ tipo: "ordinaria", data_inicio: "2026-07-02", status: "coletada", coletado_em: ONTEM }],
      documentos: [{ tipo: "voto", status: "coletado" }, { tipo: "voto", status: "coletado" }],
      deliberacoes: [],
    });
    expect(body.degrau_que_para).toBe("3_extracao");
    expect(body.funil.votos_baixados).toBe(2);
    expect(body.diagnostico.join(" ")).toMatch(/pendencias-voto/);
  });

  it("degrau 4 — extraído mas sem linha NOMINAL: o gargalo é o confirm", async () => {
    const { body } = await rodar({
      reunioes: [{ tipo: "ordinaria", data_inicio: "2026-07-02", status: "coletada", coletado_em: ONTEM }],
      documentos: [{ tipo: "voto", status: "importado" }],
      deliberacoes: [{ id: "d1", tipo_documento: "voto_individual" }],
      votosNominais: 0,
    });
    expect(body.degrau_que_para).toBe("4_voto_nominal");
    expect(body.diagnostico.join(" ")).toMatch(/CONFIRM|relator/i);
  });

  it("funil íntegro não inventa problema", async () => {
    const { body } = await rodar({
      reunioes: [{ tipo: "ordinaria", data_inicio: "2026-07-02", status: "coletada", coletado_em: ONTEM }],
      documentos: [{ tipo: "voto", status: "importado" }],
      deliberacoes: [{ id: "d1", tipo_documento: "voto_individual" }],
      votosNominais: 3,
    });
    expect(body.degrau_que_para).toBeNull();
    expect(body.diagnostico.join(" ")).toMatch(/íntegro/);
  });

  it("acusa a SÉRIE eletrônica ausente — a ANTT publica nas duas", async () => {
    const { body } = await rodar({
      reunioes: [{ tipo: "ordinaria", data_inicio: "2026-07-02", status: "coletada", coletado_em: ONTEM }],
      documentos: [{ tipo: "voto", status: "importado" }],
      deliberacoes: [{ id: "d1", tipo_documento: "voto_individual" }],
      votosNominais: 3,
    });
    expect(body.diagnostico.join(" ")).toMatch(/ELETR[ÔO]NICA/i);
    expect(body.reunioes_por_serie.map((s: { serie: string }) => s.serie)).toEqual(["ordinaria"]);
  });

  it("com as DUAS séries, não acusa ausência", async () => {
    const { body } = await rodar({
      reunioes: [
        { tipo: "ordinaria", data_inicio: "2026-07-02", status: "coletada", coletado_em: ONTEM },
        { tipo: "eletronica", data_inicio: "2026-07-01", status: "coletada", coletado_em: ONTEM },
      ],
      documentos: [{ tipo: "voto", status: "importado" }],
      deliberacoes: [{ id: "d1", tipo_documento: "voto_individual" }],
      votosNominais: 3,
    });
    expect(body.diagnostico.join(" ")).not.toMatch(/ELETR[ÔO]NICA/i);
    expect(body.reunioes_por_serie).toHaveLength(2);
  });

  it("modo demo devolve a mesma FORMA — o consumidor não quebra", async () => {
    vi.resetModules();
    vi.doMock("@/lib/server/is-demo", () => ({ isDemo: () => true }));
    const { NextRequest } = await import("next/server");
    const { GET } = await import("@/app/api/v1/admin/antt/diagnostico-coleta/route");
    const body = await (await GET(new NextRequest("http://localhost/x"))).json();
    for (const chave of ["funil", "reunioes_por_serie", "documentos_por_tipo_status", "diagnostico"]) {
      expect(Object.keys(body), `demo perdeu "${chave}"`).toContain(chave);
    }
    expect(Array.isArray(body.reunioes_por_serie)).toBe(true);
  });
});
