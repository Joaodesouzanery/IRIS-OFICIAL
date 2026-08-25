/**
 * Etapa 66 — a rota de diagnóstico da inversão de sinal.
 *
 * Ela não é só prudência antes de escrever no banco: **é a verificação de que a correção da
 * etapa65 funciona em dado REAL**, que teste de unidade não dá. Se em produção ela listar
 * exatamente o que o gabarito prevê, a correção está provada; se listar muito mais, mexeu em algo
 * não previsto.
 *
 * O banco falso aqui existe por dois motivos. O primeiro é exercitar a lógica (o handler roda com
 * `db: null` em lugar nenhum). O segundo é o mais importante: **provar que a rota não escreve** —
 * `insert`/`update`/`delete`/`upsert` lançam se alguém os chamar. Um diagnóstico que escreve
 * deixa de ser diagnóstico, e é a diferença entre "olhar o número com calma" e "aplicar sem olhar".
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/server/is-demo", () => ({ isDemo: () => false }));
vi.mock("@/lib/server/request-guards", () => ({
  isDemoRequest: (req: { headers: { get: (k: string) => string | null } }) =>
    req.headers.get("x-iris-demo") === "1",
  requireAdmin: async () => null, // autorizado
}));

const DG = "Mauro Henrique Moreira Sousa";
const PREAMBULO = `A sessão foi presidida pelo Diretor-Geral, ${DG}.`;

/** Linhas do banco falso, no formato que a rota consulta. */
type Cenario = {
  votos: Array<{ deliberacao_id: string; diretor_id: string; tipo_voto: string; diretores: { nome: string } }>;
  deliberacoes: Array<Record<string, unknown>>;
};

function fakeDb(cenario: Cenario, escritas: string[]) {
  const proibir = (op: string) => () => { escritas.push(op); throw new Error(`rota READ-ONLY chamou ${op}`); };
  return {
    from(tabela: string) {
      const q: Record<string, unknown> = {
        insert: proibir("insert"), update: proibir("update"),
        delete: proibir("delete"), upsert: proibir("upsert"),
      };
      let linhas: unknown[] =
        tabela === "votos" ? cenario.votos
        : tabela === "deliberacoes" ? cenario.deliberacoes
        : [];
      const self: any = {
        ...q,
        select() { return self; },
        eq(coluna: string, valor: unknown) {
          linhas = (linhas as Array<Record<string, unknown>>).filter((r) => r[coluna] === valor);
          return self;
        },
        in(coluna: string, valores: unknown[]) {
          linhas = (linhas as Array<Record<string, unknown>>).filter((r) => valores.includes(r[coluna]));
          return self;
        },
        limit() { return self; },
        maybeSingle: async () => ({ data: (linhas as unknown[])[0] ?? null, error: null }),
        then: (resolve: (v: { data: unknown[]; error: null }) => unknown) =>
          resolve({ data: linhas as unknown[], error: null }),
      };
      return self;
    },
  };
}

vi.mock("@/lib/supabase/server", () => ({ createSupabaseServerClient: () => globalThis.__fakeDb }));

declare global { var __fakeDb: unknown }

async function rodar(cenario: Cenario) {
  const escritas: string[] = [];
  globalThis.__fakeDb = fakeDb(cenario, escritas);
  const { NextRequest } = await import("next/server");
  const { GET } = await import("@/app/api/v1/admin/votos/diagnostico-direcao/route");
  const res = await GET(new NextRequest("http://localhost/api/v1/admin/votos/diagnostico-direcao"));
  return { body: await res.json(), status: res.status, escritas };
}

const delibBase = {
  numero_reuniao: "83", data_reuniao: "2026-03-25", documento_pai_id: null,
  agencias: { sigla: "ANM" },
};

beforeEach(() => vi.resetModules());

describe("etapa66 · diagnóstico READ-ONLY da inversão de sinal", () => {
  it("acusa o Diretor-Geral gravado como CONTRA quando o dispositivo diz que ele venceu", async () => {
    const { body, status, escritas } = await rodar({
      votos: [{ deliberacao_id: "d1", diretor_id: "dg", tipo_voto: "Desfavoravel", diretores: { nome: DG } }],
      deliberacoes: [{
        ...delibBase, id: "d1", item_numero: "2.3.1",
        resumo_pleito: "DELIBERAÇÃO: Voto do Revisor, Diretor-Geral, aprovado por maioria dos membros.",
        raw_extraction: { raw_text: PREAMBULO },
      }],
    });
    expect(status).toBe(200);
    expect(escritas, "a rota não pode escrever").toEqual([]);
    expect(body.total_afetadas).toBe(1);
    expect(body.total_votos_invertidos).toBe(1);
    expect(body.itens[0].invertidos).toEqual([DG]);
    expect(body.itens[0].item_numero).toBe("2.3.1");
    expect(body.por_agencia[0]).toMatchObject({ agencia: "ANM", deliberacoes: 1, votos: 1 });
  });

  it("NÃO acusa divergência REAL — o caso da 32ª, em que o Diretor-Geral perdeu", async () => {
    // Sem crédito a ele no dispositivo: o voto contrário está certo e tem de permanecer.
    const { body } = await rodar({
      votos: [{ deliberacao_id: "d2", diretor_id: "dg", tipo_voto: "Desfavoravel", diretores: { nome: DG } }],
      deliberacoes: [{
        ...delibBase, id: "d2", item_numero: "1.1.1",
        resumo_pleito: "DELIBERAÇÃO: Voto do revisor aprovado por maioria, com voto contrário do Diretor-Geral.",
        raw_extraction: { raw_text: PREAMBULO },
      }],
    });
    expect(body.total_afetadas, "divergência real não pode virar 'invertida'").toBe(0);
  });

  it("item de ata busca o PREÂMBULO no documento pai — o filho não persiste `raw_text`", async () => {
    const { body } = await rodar({
      votos: [{ deliberacao_id: "filho", diretor_id: "dg", tipo_voto: "Desfavoravel", diretores: { nome: DG } }],
      deliberacoes: [
        {
          ...delibBase, id: "filho", item_numero: "2.2.1", documento_pai_id: "pai",
          resumo_pleito: "acompanhando o voto do primeiro revisor, Diretor-Geral, este foi aprovado por maioria.",
          raw_extraction: {}, // sem raw_text, como o filho real
        },
        { ...delibBase, id: "pai", item_numero: null, raw_extraction: { raw_text: PREAMBULO } },
      ],
    });
    expect(body.total_afetadas, "sem o preâmbulo do pai o cargo não resolve e o caso passa batido").toBe(1);
    expect(body.itens[0].invertidos).toEqual([DG]);
  });

  it("cargo NÃO resolvido não acusa ninguém — adivinhar seria fabricar", async () => {
    const { body } = await rodar({
      votos: [{ deliberacao_id: "d3", diretor_id: "dg", tipo_voto: "Desfavoravel", diretores: { nome: DG } }],
      deliberacoes: [{
        ...delibBase, id: "d3", item_numero: "1.2.3",
        resumo_pleito: "DELIBERAÇÃO: Voto do Revisor, Diretor-Geral, aprovado por maioria.",
        raw_extraction: { raw_text: "sem preâmbulo que nomeie o Diretor-Geral" },
      }],
    });
    expect(body.total_afetadas).toBe(0);
  });

  it("sem voto contrário nenhum, devolve zero e explica", async () => {
    const { body, escritas } = await rodar({ votos: [], deliberacoes: [] });
    expect(body.total_deliberacoes_com_contra).toBe(0);
    expect(body.nota).toMatch(/Nenhum voto Desfavoravel/);
    expect(escritas).toEqual([]);
  });

  it("a evidência acompanha o achado — o revisor confere sem abrir o PDF", async () => {
    const { body } = await rodar({
      votos: [{ deliberacao_id: "d4", diretor_id: "dg", tipo_voto: "Desfavoravel", diretores: { nome: DG } }],
      deliberacoes: [{
        ...delibBase, id: "d4", item_numero: "2.3.1",
        resumo_pleito: "DELIBERAÇÃO: Voto do Revisor, Diretor-Geral, aprovado por maioria dos membros.",
        raw_extraction: { raw_text: PREAMBULO },
      }],
    });
    expect(body.itens[0].evidencia).toContain("aprovado por maioria");
  });
});
