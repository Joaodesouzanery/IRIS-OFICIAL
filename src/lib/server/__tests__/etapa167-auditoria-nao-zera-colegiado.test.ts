/**
 * Etapa 167 (Fase 31, Bloco 2) — o `.in()` que estourava a URL e zerava uma coluna inteira.
 *
 * ═══ O defeito, medido no CSV de produção de 24/09/2026 ═══
 * `VotosNaDeliberacao` veio **0 em 100% das 2.726 linhas**, nas três agências. Na TELA o mesmo
 * campo estava certo ("4 de 4").
 *
 * A causa é `auditoria/votos/route.ts`: um `.in("deliberacao_id", idsDeDelib)` único, sem lote,
 * sem paginação, com o erro DESCARTADO. O consumidor fazia `(data ?? []).length` — e `.length` de
 * array vazio é `0`, nunca `null`. Falha total virou número plausível.
 *
 * ⚠️ O EXPERIMENTO QUE PROVA A CAUSA JÁ TINHA RODADO, na mesma requisição:
 *
 *   consulta                    ids    URL          resultado no CSV
 *   pdfPorDelib                 595    23.312 ch    preenchida em 100%
 *   votantesRes                 820    32.087 ch    ZERADA em 100%
 *   tela (limit=50)             ≤50     2.057 ch    sempre funcionou
 *
 * O `urlLengthLimit` default do postgrest-js é 8.000. Duas consultas idênticas em forma, na mesma
 * requisição: a menor passou, a maior não.
 *
 * ═══ ⚠️ POR QUE NENHUM TESTE PEGOU, e o que muda aqui ═══
 * `etapa157` testa o FORMATADOR com fixture escrita à mão (`votos_na_deliberacao: 3`). **Nenhum
 * teste do repo executava esta rota.** Pior: o caso "o CSV usa `lerTudo`" EXIGE o ramo que faz
 * `idsDeDelib` chegar a 820 — ele blinda a causa e nada afirma sobre o efeito; e "a tela pagina no
 * BANCO" passa por construção, porque procura `.limit(N≥1000)` e a linha do defeito não tinha
 * `.limit` nenhum.
 *
 * Este arquivo é o primeiro que EXECUTA a rota, com um duplo de banco. Hoje, sem o conserto, ela
 * responderia **200 com 2.726 zeros**.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/supabase/server", () => ({ createSupabaseServerClient: () => globalThis.__auditDb }));
vi.mock("@/lib/server/is-demo", () => ({ isDemo: () => false }));
vi.mock("@/lib/server/request-guards", () => ({
  isDemoRequest: () => false,
  requireAdmin: async () => null,
}));

declare global { var __auditDb: unknown }

import { NextRequest } from "next/server";
import { GET } from "@/app/api/v1/admin/auditoria/votos/route";
import { TAMANHO_DO_LOTE } from "@/lib/server/ler-em-lotes";

type Resultado = { data: unknown; error: unknown; count?: number };

/** Um builder encadeável que resolve no resultado configurado para a tabela. */
function tabela(resultado: Resultado, espiao?: (m: string, a: unknown[]) => void) {
  const q: any = {};
  for (const m of ["select", "eq", "gte", "lte", "or", "order", "in", "not", "is", "neq", "limit", "range"]) {
    q[m] = (...a: unknown[]) => { espiao?.(m, a); return q; };
  }
  q.then = (ok: any, err: any) => Promise.resolve(resultado).then(ok, err);
  q.maybeSingle = async () => resultado;
  q.single = async () => resultado;
  return q;
}

const VOTO = (id: string, delibId: string, diretor: string) => ({
  id, tipo_voto: "Favoravel", is_divergente: false, is_nominal: false,
  proveniencia: "inferido_unanimidade", motivo_nao_voto: null, voto_em_autos: null,
  diretor: { id: diretor, nome: `Diretor ${diretor}`, agencia_id: "ag1" },
  deliberacao: {
    id: delibId, numero_deliberacao: "646", numero_reuniao: "1210", tipo_reuniao: "Ordinaria",
    data_reuniao: "2026-09-02", resultado: "Aprovado", microtema: null,
    tipo_documento: "deliberacao", documento_pai_id: null, agencia_id: "ag1",
    agencia: { sigla: "ARTESP" },
  },
});

/** Monta o banco falso. `votantes` controla o ramo que o defeito arruinava. */
function montarDb(opcoes: {
  votos: unknown[];
  votantes: Resultado;
  espiaoVotantes?: (m: string, a: unknown[]) => void;
}) {
  let chamadaDeVotos = 0;
  return {
    from(t: string) {
      if (t === "votos") {
        // A 1ª chamada é a listagem (com SELECT_DO_VOTO); as seguintes são os lotes de votantes.
        chamadaDeVotos++;
        if (chamadaDeVotos === 1) {
          return tabela({ data: opcoes.votos, error: null, count: opcoes.votos.length });
        }
        return tabela(opcoes.votantes, opcoes.espiaoVotantes);
      }
      if (t === "mandatos") {
        return tabela({
          data: [
            { diretor_id: "d1", data_inicio: "2020-01-01", data_fim: null, diretores: { agencia_id: "ag1", review_status: "aprovado" } },
            { diretor_id: "d2", data_inicio: "2020-01-01", data_fim: null, diretores: { agencia_id: "ag1", review_status: "aprovado" } },
          ],
          error: null,
        });
      }
      if (t === "documentos_regulatorios") return tabela({ data: [], error: null });
      return tabela({ data: [], error: null });
    },
    storage: { from: () => ({ createSignedUrls: async () => ({ data: [] }) }) },
  };
}

const pedir = (qs: string) =>
  GET(new NextRequest(`http://localhost/api/v1/admin/auditoria/votos?${qs}`) as never);

beforeEach(() => { globalThis.__auditDb = undefined; });

describe("etapa167 · ⚠️ a falha de leitura NÃO pode virar zero", () => {
  it("votantes com erro → 500, e não 200 com a coluna zerada", async () => {
    globalThis.__auditDb = montarDb({
      votos: [VOTO("v1", "del1", "d1"), VOTO("v2", "del1", "d2")],
      votantes: { data: null, error: { message: "URI too long" } },
    });
    const res = await pedir("format=json");
    // Antes do conserto: 200, com `votos_na_deliberacao: 0` em toda linha.
    expect(res.status, "a rota respondeu sucesso com a coluna zerada").toBe(500);
    const corpo = await res.json();
    expect(String(corpo.error)).toMatch(/colegiado|votantes/i);
  });

  it("mandatos com erro também derruba — sem eles «N de M» seria inventado", async () => {
    const db: any = montarDb({ votos: [VOTO("v1", "del1", "d1")], votantes: { data: [], error: null } });
    const original = db.from;
    db.from = (t: string) => (t === "mandatos" ? tabela({ data: null, error: { message: "boom" } }) : original.call(db, t));
    globalThis.__auditDb = db;
    expect((await pedir("format=json")).status).toBe(500);
  });
});

describe("etapa167 · o número volta a variar por linha", () => {
  it("⚠️ votos_na_deliberacao reflete os votantes, e bate com o colegiado quando completo", async () => {
    globalThis.__auditDb = montarDb({
      votos: [VOTO("v1", "del1", "d1"), VOTO("v2", "del1", "d2")],
      votantes: {
        data: [
          { deliberacao_id: "del1", diretor_id: "d1" },
          { deliberacao_id: "del1", diretor_id: "d2" },
        ],
        error: null,
      },
    });
    const corpo = await (await pedir("format=json")).json();
    expect(corpo.linhas).toHaveLength(2);
    for (const l of corpo.linhas) {
      expect(l.votos_na_deliberacao, "o zero de antes").toBe(2);
      expect(l.colegiado_esperado).toBe(2);
      // O critério de aceite do usuário: bate com o esperado quando o colegiado está completo.
      expect(l.votos_na_deliberacao).toBe(l.colegiado_esperado);
    }
  });

  it("colegiado INCOMPLETO aparece como incompleto — não é arredondado para o esperado", async () => {
    globalThis.__auditDb = montarDb({
      votos: [VOTO("v1", "del1", "d1")],
      votantes: { data: [{ deliberacao_id: "del1", diretor_id: "d1" }], error: null },
    });
    const corpo = await (await pedir("format=json")).json();
    expect(corpo.linhas[0].votos_na_deliberacao).toBe(1);
    expect(corpo.linhas[0].colegiado_esperado).toBe(2);
    expect(corpo.linhas[0].faltando).toBe(1);
  });
});

describe("etapa167 · a URL não cresce com o resultado", () => {
  it("⚠️ a consulta vai em LOTES — 820 ids davam 32.087 chars de URL", async () => {
    const lotes: number[] = [];
    const ids = Array.from({ length: 250 }, (_, i) => `del${i}`);
    globalThis.__auditDb = montarDb({
      votos: ids.map((d, i) => VOTO(`v${i}`, d, "d1")),
      votantes: { data: [], error: null },
      espiaoVotantes: (m, a) => { if (m === "in") lotes.push((a[1] as string[]).length); },
    });
    await pedir("format=json&limit=200");

    expect(lotes.length, "mandou tudo num `.in()` só").toBeGreaterThan(1);
    for (const n of lotes) expect(n).toBeLessThanOrEqual(TAMANHO_DO_LOTE);
    expect(lotes.reduce((a, b) => a + b, 0)).toBe(250);
    // A conta que importa: ~36 chars por UUID + vírgula. 100 ids ≈ 3,7 KB, metade do
    // `urlLengthLimit` de 8.000 do postgrest-js. 250 num `.in()` só passariam de 9 KB.
    expect(TAMANHO_DO_LOTE * 37).toBeLessThan(8_000);
  });

  it("lista vazia não dispara requisição nenhuma", async () => {
    const lotes: number[] = [];
    globalThis.__auditDb = montarDb({
      votos: [], votantes: { data: [], error: null },
      espiaoVotantes: (m) => { if (m === "in") lotes.push(1); },
    });
    const corpo = await (await pedir("format=json")).json();
    expect(corpo.linhas).toEqual([]);
    expect(lotes).toHaveLength(0);
  });
});

describe("etapa167 · a forma que estourava não pode voltar", () => {
  const semComentarios = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/\/\/[^\n]*/g, " ");

  it.each([
    ["src/app/api/v1/admin/auditoria/votos/route.ts", "a consulta que zerou a coluna"],
    ["src/lib/server/pdf-da-deliberacao.ts", "a irmã latente, que já ia em 23,3 KB de URL"],
  ])("%s não faz `.in()` direto (%s)", async (arquivo) => {
    const { readFileSync } = await import("fs");
    const { join } = await import("path");
    const codigo = semComentarios(readFileSync(join(__dirname, "../../../..", arquivo), "utf-8"));
    // ⚠️ A checagem é sobre a CHAMADA, não sobre a palavra: `lerEmLotes` usa `.in()` por dentro,
    // e é lá que ele deve estar — num lugar só, com o erro checado e o lote fixo.
    expect(codigo, "voltou a montar `.in()` na própria rota").not.toMatch(/\.in\(\s*"/);
    expect(codigo).toMatch(/lerEmLotes[<(]/);
  });

  it("⚠️ o consumidor não pode transformar falha em zero com `?? []`", async () => {
    const { readFileSync } = await import("fs");
    const { join } = await import("path");
    const rota = readFileSync(
      join(__dirname, "../../../..", "src/app/api/v1/admin/auditoria/votos/route.ts"), "utf-8");
    // O `?? []` pode continuar existindo — o que não pode é existir SEM a checagem do erro antes.
    const iCheck = rota.indexOf("if (votantesRes.error");
    const iUso = rota.indexOf("votantesRes.data ?? []");
    expect(iCheck, "a checagem do erro sumiu").toBeGreaterThan(-1);
    expect(iUso).toBeGreaterThan(-1);
    expect(iCheck, "o `?? []` vem antes da checagem — a falha volta a virar zero").toBeLessThan(iUso);
  });
});
