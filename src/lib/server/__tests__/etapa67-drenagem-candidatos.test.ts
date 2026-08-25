/**
 * Etapa 67 — DRENAGEM do lixo legado em `diretor_candidatos`.
 *
 * Os cartões "Agência Utiliza As" (39%), "Você Pode" (36%) etc. eram DADO LEGADO anterior ao
 * endurecimento dos write-paths: os inserts atuais já barram prosa, mas nada REMOVIA o que entrou
 * antes. Pior — o "Rodar tudo" reafirmava o lixo a cada rodada:
 *   · o recompute recomputava a confidence e PRESERVAVA o cartão (nunca rejeitava);
 *   · o aprovar-lote DETECTAVA o lixo e apenas o PULAVA, enquanto o ramo vizinho (cartões com
 *     diretor_id) rejeitava de fato — a mesma assimetria já vista duas vezes nesta série;
 *   · os "35%" eram um PISO inventado (`Math.max(0.35, …)`) sobre score ~0.
 *
 * Medição que fundamenta tudo: `isStrictPersonName` rejeita 6/6 dos nomes-lixo do print e aceita
 * 6/6 dos nomes reais de diretores. O discriminador sempre existiu — faltava ligá-lo ao gate.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { isStrictPersonName } from "@/lib/server/name-matcher";

vi.mock("@/lib/server/is-demo", () => ({ isDemo: () => false }));
vi.mock("@/lib/server/request-guards", () => ({
  isDemoRequest: () => false,
  requireAdmin: async () => null,
  requireAdminOrCron: async () => null,
}));
vi.mock("@/lib/supabase/server", () => ({ createSupabaseServerClient: () => globalThis.__drenDb }));

declare global { var __drenDb: unknown }

type Linha = Record<string, unknown>;

/** Banco falso: candidatos + diretores; registra updates para inspecionar a cascata. */
function fakeDb(candidatos: Linha[], diretores: Linha[], escritas: Linha[]) {
  return {
    from(tabela: string) {
      let linhas: Linha[] =
        tabela === "diretor_candidatos" ? candidatos
        : tabela === "diretores" ? diretores
        : tabela === "mandatos" ? []
        : tabela === "votos" ? []
        : [];
      const filtros: Array<[string, unknown]> = [];
      const self: any = {
        select() { return self; },
        eq(c: string, v: unknown) { filtros.push([c, v]); linhas = linhas.filter((r) => r[c] === v); return self; },
        in(c: string, vs: unknown[]) { linhas = linhas.filter((r) => (vs as unknown[]).includes(r[c])); return self; },
        neq() { return self; },
        not() { return self; },
        or() { return self; },
        gte() { return self; },
        lte() { return self; },
        order() { return self; },
        limit() { return self; },
        update(patch: Linha) {
          // ⚠️ No builder do Supabase, `.update(patch)` vem ANTES dos `.eq()` — o registro guarda
          // a REFERÊNCIA do array de filtros, que os eq() seguintes ainda vão preencher.
          escritas.push({ __tabela: tabela, __patch: patch, __filtros: filtros });
          return self;
        },
        delete() { escritas.push({ __tabela: tabela, __delete: true, __filtros: filtros }); return self; },
        insert(payload: Linha) { escritas.push({ __tabela: tabela, __insert: payload }); return self; },
        maybeSingle: async () => ({ data: linhas[0] ?? null, error: null }),
        single: async () => ({ data: linhas[0] ?? null, error: null }),
        then: (r: (v: { data: Linha[]; error: null }) => unknown) => r({ data: linhas, error: null }),
      };
      return self;
    },
  };
}

const DIRETORES = [
  { id: "d1", nome: "Mauro Henrique Moreira Sousa", nome_variantes: [], agencia_id: "ag1", review_status: "aprovado" },
];

async function rodarRecompute(candidatos: Linha[]) {
  const escritas: Linha[] = [];
  globalThis.__drenDb = fakeDb(candidatos, DIRETORES, escritas);
  const { NextRequest } = await import("next/server");
  const { POST } = await import("@/app/api/v1/admin/diretores/candidatos/recompute/route");
  const res = await POST(new NextRequest("http://localhost/api/v1/admin/diretores/candidatos/recompute?dry_run=0", { method: "POST" }));
  return { body: await res.json(), escritas };
}

const cartao = (over: Linha): Linha => ({
  id: `c-${Math.random().toString(36).slice(2, 8)}`,
  agencia_id: "ag1",
  nome_detectado: "Nome Padrao",
  confidence: 0.4,
  review_status: "pendente",
  diretor_id: null,
  created_at: "2026-08-19T00:00:00Z",
  source_type: "deliberacao",
  ...over,
});

beforeEach(() => vi.resetModules());

describe("etapa67 · a base da drenagem — o discriminador que já existia", () => {
  it("os 6 nomes-lixo do print reprovam; 6 nomes reais passam", () => {
    const LIXO = ["Agência Utiliza As", "Acesse Sempre Pelo", "Você Pode",
      "Análise Automatizada Não Será Aplicada Nos",
      "Manifestação Obrigatória Da Diretoria Colegiada Nas",
      "Neste Processo Deverão Ser Inseridos Os"];
    const REAIS = ["Mauro Henrique Moreira Sousa", "Roger Romão Cabral", "Tasso Mendonça Júnior",
      "Fábio Fernando Borges", "Alessandro Baumgartner", "Felipe Fernandes Queiroz"];
    for (const n of LIXO) expect(isStrictPersonName(n), `"${n}" deveria reprovar`).toBe(false);
    for (const n of REAIS) expect(isStrictPersonName(n), `"${n}" deveria passar`).toBe(true);
  });
});

describe("etapa67 · recompute DRENA o lixo em cascata", () => {
  it("grupo com nome-lixo → review_status rejeitado, em cascata por (agência, nome)", async () => {
    const { body, escritas } = await rodarRecompute([
      cartao({ nome_detectado: "Você Pode" }),
      cartao({ nome_detectado: "Você Pode" }), // duplicata do mesmo nome (cascata)
    ]);
    expect(body.grupos_rejeitados_lixo).toBe(1);
    const rejeicao = escritas.find((e) =>
      e.__tabela === "diretor_candidatos"
      && (e.__patch as Linha)?.review_status === "rejeitado",
    );
    expect(rejeicao, "nenhum UPDATE de rejeição foi emitido").toBeTruthy();
    // A cascata filtra por agência+nome+pendente — não por id único.
    const filtros = Object.fromEntries((rejeicao!.__filtros as Array<[string, unknown]>));
    expect(filtros.nome_detectado).toBe("Você Pode");
    expect(filtros.review_status).toBe("pendente");
  });

  it("nome REAL ambíguo NÃO é rejeitado — segue para o resolvedor", async () => {
    const { body, escritas } = await rodarRecompute([
      // Nome real, mas distante de qualquer diretor cadastrado (score baixo).
      cartao({ nome_detectado: "Carlos Eduardo Nunes Braga" }),
    ]);
    expect(body.grupos_rejeitados_lixo).toBe(0);
    const rejeicao = escritas.find((e) => (e.__patch as Linha)?.review_status === "rejeitado");
    expect(rejeicao, "nome real não pode ser drenado como lixo").toBeUndefined();
  });

  it("nome real ≥0.85 continua auto-aprovando — a drenagem não quebrou o caminho feliz", async () => {
    const { body } = await rodarRecompute([
      cartao({ nome_detectado: "Mauro Henrique Moreira Sousa" }),
    ]);
    expect(body.grupos_auto_aprovados).toBe(1);
    expect(body.grupos_rejeitados_lixo).toBe(0);
  });
});

describe("etapa67 · o piso inventado morreu", () => {
  it("confirm e importer não têm mais Math.max(0.35, …) — confiança exibida é o score real", async () => {
    const { readFileSync } = await import("fs");
    const { join, dirname } = await import("path");
    const { fileURLToPath } = await import("url");
    const raiz = join(dirname(fileURLToPath(import.meta.url)), "../../../..");
    for (const rel of ["src/app/api/v1/upload/confirm/route.ts", "src/lib/server/diretores-importer.ts"]) {
      const src = readFileSync(join(raiz, rel), "utf-8");
      expect(src, `${rel} voltou a inventar 35% para score 0`).not.toContain("Math.max(0.35");
    }
  });

  it("aprovar-lote REJEITA (não só pula) o lixo sem diretor_id — simetria com o ramo vizinho", async () => {
    const { readFileSync } = await import("fs");
    const { join, dirname } = await import("path");
    const { fileURLToPath } = await import("url");
    const raiz = join(dirname(fileURLToPath(import.meta.url)), "../../../..");
    const src = readFileSync(join(raiz, "src/app/api/v1/diretores/candidatos/aprovar-lote/route.ts"), "utf-8");
    expect(src).toContain('reviewed_by: "aprovar-lote:nome-invalido"');
  });
});
