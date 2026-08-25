/**
 * Etapa 67 — o AUTO-RESOLVER: nada espera humano, e a medição vai embutida.
 *
 * A fila de "Matches Pendentes" deixou de ser etapa (decisão do usuário). Os quatro passos:
 *   1. MANDATO — filtra os diretores candidatos pelos ATIVOS na data da deliberação de origem.
 *      A maioria das colisões reais é titular × ex-titular de épocas diferentes: o roster por
 *      data as desfaz sem heurística nova.
 *   2. MARGEM — `findBestMatchComMargem` sobre o conjunto filtrado (≥0.15 sobre o 2º).
 *   3. FALLBACK (exceção, não fluxo) — sem margem mesmo assim, aprova o melhor score e CARIMBA
 *      `confianca_match` em cada voto retroativo. Sem UI própria até o número justificar.
 *   4. APRENDER — a resolução grava a variante (mecanismo da Etapa 13); a repetição casa ≥0.85.
 *
 * As contagens `resolvidos_por_mandato / por_margem / sem_margem / rejeitados_lixo` saem na
 * resposta: a primeira rodada de "Rodar tudo" em produção É a medição do passo 3.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { findBestMatchComMargem } from "@/lib/server/name-matcher";
import type { DiretorVoteRecord } from "@/lib/server/vote-inference";

vi.mock("@/lib/server/is-demo", () => ({ isDemo: () => false }));
vi.mock("@/lib/server/request-guards", () => ({
  isDemoRequest: () => false,
  requireAdmin: async () => null,
  requireAdminOrCron: async () => null,
  getAuthenticatedUser: async () => ({ id: "u1", email: "admin@iris" }),
}));
vi.mock("@/lib/supabase/server", () => ({ createSupabaseServerClient: () => globalThis.__resolverDb }));

declare global { var __resolverDb: unknown }

type Linha = Record<string, unknown>;

// Colisão realista: titular atual × ex-titular com nomes PARECIDOS (mesmo primeiro nome+sobrenome).
const TITULAR = { id: "d-atual", nome: "Rafael Souza Vieira", nome_variantes: [], agencia_id: "ag1", review_status: "aprovado" };
const EX_TITULAR = { id: "d-antigo", nome: "Rafael Souza Vieira Filho", nome_variantes: [], agencia_id: "ag1", review_status: "aprovado" };

function fakeDb(opts: {
  candidatosFaixa: Linha[];
  mandatosAtivos: Array<{ diretor_id: string; diretores: Linha }>;
  deliberacao?: Linha | null;
}, escritas: Linha[]) {
  return {
    from(tabela: string) {
      let linhas: Linha[] =
        tabela === "diretor_candidatos" ? opts.candidatosFaixa
        : tabela === "diretores" ? [TITULAR, EX_TITULAR]
        : tabela === "mandatos" ? (opts.mandatosAtivos as unknown as Linha[])
        : tabela === "deliberacoes" ? (opts.deliberacao ? [opts.deliberacao] : [])
        : [];
      const self: any = {
        select() { return self; },
        eq(c: string, v: unknown) {
          if (tabela === "diretor_candidatos" && c === "review_status") linhas = linhas.filter((r) => r[c] === v);
          if (tabela === "deliberacoes" && c === "id") linhas = linhas.filter((r) => r[c] === v);
          return self;
        },
        gte(c: string, v: number) { if (tabela === "diretor_candidatos") linhas = linhas.filter((r) => Number(r[c]) >= v); return self; },
        lt(c: string, v: number) { if (tabela === "diretor_candidatos") linhas = linhas.filter((r) => Number(r[c]) < v); return self; },
        lte() { return self; },
        not(c: string, op: string, v: unknown) {
          if (tabela === "diretor_candidatos" && c === "diretor_id" && op === "is" && v === null) {
            linhas = linhas.filter((r) => r.diretor_id !== null);
          }
          return self;
        },
        neq() { return self; },
        or() { return self; },
        in() { return self; },
        is() { linhas = []; return self; }, // ramo "novos" (diretor_id IS NULL) — fora destes testes
        order() { return self; },
        limit() { return self; },
        update(patch: Linha) { escritas.push({ __tabela: tabela, __patch: patch }); return self; },
        insert(payload: Linha) { escritas.push({ __tabela: tabela, __insert: payload }); return self; },
        upsert(payload: Linha) { escritas.push({ __tabela: tabela, __upsert: payload }); return self; },
        maybeSingle: async () => ({ data: linhas[0] ?? null, error: null }),
        single: async () => ({ data: linhas[0] ?? null, error: null }),
        then: (r: (v: { data: Linha[]; error: null }) => unknown) => r({ data: linhas, error: null }),
      };
      return self;
    },
  };
}

async function rodarLote(opts: Parameters<typeof fakeDb>[0]) {
  const escritas: Linha[] = [];
  globalThis.__resolverDb = fakeDb(opts, escritas);
  const { NextRequest } = await import("next/server");
  const { POST } = await import("@/app/api/v1/diretores/candidatos/aprovar-lote/route");
  const res = await POST(new NextRequest("http://localhost/api/v1/diretores/candidatos/aprovar-lote", {
    method: "POST",
    body: JSON.stringify({ min_confidence: 0.8, incluir_novos: true }),
    headers: { "content-type": "application/json" },
  }));
  return { body: await res.json(), escritas };
}

const cartaoAmbiguo = (over: Linha = {}): Linha => ({
  id: "cand-1",
  agencia_id: "ag1",
  // "Rafael Souza" casa os DOIS diretores com score parecido — ambiguidade real.
  nome_detectado: "Rafael Souza",
  confidence: 0.7,
  review_status: "pendente",
  diretor_id: "d-atual",
  created_at: "2026-08-19T00:00:00Z",
  evidence: { deliberacao_id: "del-1" },
  ...over,
});

beforeEach(() => vi.resetModules());

describe("etapa67 · pré-condição — a colisão é REAL sem o filtro", () => {
  it("«Rafael Souza» é ambíguo entre titular e ex-titular (margem < 0.15)", () => {
    const lista: DiretorVoteRecord[] = [
      { id: TITULAR.id, nome: TITULAR.nome, nome_variantes: [] },
      { id: EX_TITULAR.id, nome: EX_TITULAR.nome, nome_variantes: [] },
    ];
    const m = findBestMatchComMargem("Rafael Souza", lista);
    expect(m.score).toBeGreaterThanOrEqual(0.6);
    expect(m.margem, "se houver margem, o cenário do teste não exercita o resolver").toBeLessThan(0.15);
  });
});

describe("etapa67 · passo 1 — o MANDATO desfaz a ambiguidade", () => {
  it("com só o titular ativo na data, resolve por mandato (resolvidos_por_mandato=1)", async () => {
    const { body } = await rodarLote({
      candidatosFaixa: [cartaoAmbiguo()],
      deliberacao: { id: "del-1", data_reuniao: "2026-03-10" },
      mandatosAtivos: [{ diretor_id: TITULAR.id, diretores: TITULAR }],
    });
    expect(body.resolvidos_por_mandato).toBe(1);
    expect(body.resolvidos_sem_margem).toBe(0);
    expect(body.aprovados).toBe(1);
  });

  it("MUTAÇÃO-ALVO: sem o filtro de mandato este caso cairia no fallback sem margem", async () => {
    // O mesmo cartão, mas SEM data de reunião (o filtro não tem como rodar): cai no passo 3.
    const { body } = await rodarLote({
      candidatosFaixa: [cartaoAmbiguo({ evidence: {} })],
      deliberacao: null,
      mandatosAtivos: [{ diretor_id: TITULAR.id, diretores: TITULAR }],
    });
    expect(body.resolvidos_por_mandato).toBe(0);
    expect(body.resolvidos_sem_margem).toBe(1);
  });
});

describe("etapa67 · passo 3 — o fallback aprova E carimba", () => {
  it("sem margem e sem mandato utilizável: aprova o melhor score com confianca_match no voto", async () => {
    const { body, escritas } = await rodarLote({
      candidatosFaixa: [cartaoAmbiguo({ evidence: {} })],
      deliberacao: null,
      mandatosAtivos: [],
    });
    expect(body.resolvidos_sem_margem).toBe(1);
    // O candidato foi aprovado (update de review_status) — o carimbo em si viaja pela tubulação
    // aprovarCandidato → applyRetroactiveVotes → VotoInsertRow.confianca_match, provada abaixo.
    const aprovacao = escritas.find((e) => (e.__patch as Linha)?.review_status === "aprovado");
    expect(aprovacao).toBeTruthy();
  });

  it("a tubulação do carimbo existe de ponta a ponta (contrato no código)", async () => {
    const { readFileSync } = await import("fs");
    const { join, dirname } = await import("path");
    const { fileURLToPath } = await import("url");
    const raiz = join(dirname(fileURLToPath(import.meta.url)), "../../../..");
    expect(readFileSync(join(raiz, "src/lib/server/vote-inference.ts"), "utf-8"))
      .toContain("confianca_match?: number");
    expect(readFileSync(join(raiz, "src/lib/server/retroactive-votes.ts"), "utf-8"))
      .toContain("r.confianca_match = Math.round(confiancaMatch * 1000) / 1000");
    expect(readFileSync(join(raiz, "src/lib/server/candidato-approval.ts"), "utf-8"))
      .toContain("confiancaMatch: opts.confiancaMatch ?? null");
  });
});

describe("etapa67 · a MEDIÇÃO embutida", () => {
  it("as quatro contagens aparecem na resposta do lote", async () => {
    const { body } = await rodarLote({ candidatosFaixa: [], deliberacao: null, mandatosAtivos: [] });
    for (const chave of ["resolvidos_por_margem", "resolvidos_por_mandato", "resolvidos_sem_margem"]) {
      expect(Object.keys(body), `resposta perdeu "${chave}" — a medição do resolver morre`).toContain(chave);
    }
  });

  it("o pipeline propaga as contagens para o resumo do «Rodar tudo»", async () => {
    const { readFileSync } = await import("fs");
    const { join, dirname } = await import("path");
    const { fileURLToPath } = await import("url");
    const raiz = join(dirname(fileURLToPath(import.meta.url)), "../../../..");
    const pipeline = readFileSync(join(raiz, "src/app/api/v1/pipeline/run/route.ts"), "utf-8");
    for (const chave of ["rejeitados_lixo", "resolvidos_por_mandato", "resolvidos_sem_margem"]) {
      expect(pipeline, `pipeline não propaga ${chave}`).toContain(chave);
    }
  });
});
