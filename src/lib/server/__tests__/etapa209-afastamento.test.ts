/**
 * Etapa 209 (Fase 35, Bloco F) — afastamento NÃO é fim de mandato, e marcá-lo era INERTE.
 *
 * ═══ O achado do usuário ═══
 * O QA mostrou o Caio Mário (ANM) faltando nas 84ª, 85ª e 86ª, e a pauta da 34ª REP já o chama de
 * "Diretor afastado". Ele observou o que isso significa: *"Corrigir o Caio elimina o falso «faltando»,
 * mas nenhuma das três reuniões da ANM fecha só com o cadastro."*
 *
 * E eu verifiquei uma coisa pior: marcar `diretores.situacao = 'afastado'` seria **inerte**.
 * `getActiveDiretoresForVote` (`vote-inference.ts`) monta o roster de `mandatos` com três filtros —
 * `fonte_dado <> 'automatico'`, `review_status = 'aprovado'`, janela de datas — e **não lê
 * `situacao`**. Ele continuaria esperado, continuaria em `faltando`, e as três reuniões da ANM não
 * poderiam fechar POR DEFINIÇÃO: o placar ficaria em 0/3 para sempre, com um ruído que nenhum
 * trabalho de esteira resolveria.
 *
 * ═══ E fechar o mandato dele seria gravar coisa falsa ═══
 * Afastamento é suspensão do EXERCÍCIO; o mandato continua. Por isso a janela é separada: o mandato
 * segue vigente no banco, e o colegiado ESPERADO A VOTAR exclui quem estava afastado naquele dia.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";
import { afastadoNaData, colegiadoNaData, type MandatoJanela } from "@/lib/server/colegiado-na-data";
import { rosterDasLinhas } from "@/lib/server/vote-inference";

const RAIZ = join(__dirname, "../../../..");
const ler = (p: string) => readFileSync(join(RAIZ, p), "utf-8");
const semComentarios = (t: string) =>
  t.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/\/\/[^\n]*/g, " ");
const semComentariosSql = (t: string) => t.replace(/--[^\n]*/g, " ");

const m = (o: Partial<MandatoJanela>): MandatoJanela => ({
  diretor_id: "caio", agencia_id: "anm",
  data_inicio: "2022-12-05", data_fim: "2028-12-04", ...o,
});

describe("etapa209 · `afastadoNaData`: bordas inclusivas, como a janela de mandato", () => {
  it("sem afastamento declarado, ninguém está afastado", () => {
    expect(afastadoNaData(m({}), "2026-04-29")).toBe(false);
    expect(afastadoNaData(m({ afastado_desde: null }), "2026-04-29")).toBe(false);
  });

  it("a data do INÍCIO já conta — borda inclusiva", () => {
    expect(afastadoNaData(m({ afastado_desde: "2025-09-17" }), "2025-09-17")).toBe(true);
  });

  it("antes do início, não", () => {
    expect(afastadoNaData(m({ afastado_desde: "2025-09-17" }), "2025-09-16")).toBe(false);
  });

  it("⚠️ `afastado_ate` nulo = afastamento EM CURSO — tratá-lo como encerrado devolveria o ruído", () => {
    expect(afastadoNaData(m({ afastado_desde: "2025-09-17" }), "2030-01-01")).toBe(true);
  });

  it("com fim declarado, volta ao colegiado no dia seguinte — e o fim também é inclusivo", () => {
    const janela = { afastado_desde: "2025-09-17", afastado_ate: "2026-03-31" };
    expect(afastadoNaData(m(janela), "2026-03-31")).toBe(true);
    expect(afastadoNaData(m(janela), "2026-04-01")).toBe(false);
  });
});

describe("etapa209 · ⚠️ o afastado sai do colegiado ESPERADO, e o mandato fica intacto", () => {
  const COLEGIADO: MandatoJanela[] = [
    m({ diretor_id: "mauro", afastado_desde: null }),
    m({ diretor_id: "fabio", afastado_desde: null }),
    m({ diretor_id: "luiz", afastado_desde: null }),
    m({ diretor_id: "jose_fernando", data_inicio: "2025-09-01", afastado_desde: null }),
    // O caso real: mandato até 2028, afastado desde 09/2025.
    m({ diretor_id: "caio", afastado_desde: "2025-09-17" }),
  ];

  it("na 84ª (29/04/2026) o colegiado esperado são QUATRO, não cinco", () => {
    const roster = colegiadoNaData(COLEGIADO, "anm", "2026-04-29");
    expect(roster).not.toContain("caio");
    expect(roster.sort()).toEqual(["fabio", "jose_fernando", "luiz", "mauro"]);
  });

  it("e ANTES do afastamento ele continua esperado — a janela não é retroativa", () => {
    expect(colegiadoNaData(COLEGIADO, "anm", "2025-06-30")).toContain("caio");
  });

  it("⚠️ o MANDATO dele não foi alterado — é a diferença entre afastar e encerrar", () => {
    const dele = COLEGIADO.find((x) => x.diretor_id === "caio")!;
    expect(dele.data_fim, "fechar o mandato em 17/09/2025 gravaria coisa que o ato não diz")
      .toBe("2028-12-04");
  });

  it("o colegiado NÃO fica vazio por afastamento de um só — `roster_conhecido` segue verdadeiro", () => {
    // Um afastamento não pode virar "não sabemos quem estava lá": isso tiraria a reunião do placar.
    expect(colegiadoNaData(COLEGIADO, "anm", "2026-04-29").length).toBeGreaterThan(0);
  });
});

describe("etapa209 · ⚠️ o motor de voto e o placar usam a MESMA regra", () => {
  const MOTOR = semComentarios(ler("src/lib/server/vote-inference.ts"));
  const ROTA = semComentarios(ler("src/app/api/v1/admin/placar/route.ts"));

  /**
   * ⚠️ COMPORTAMENTO, e não texto. A primeira versão desta expectativa só conferia que a chamada
   * `afastadoNaData(` aparecia no arquivo — e a mutação que prefixa a condição com `false &&`
   * SOBREVIVEU. Por isso a parte pura do motor virou `rosterDasLinhas`, exportada: o teste chama e
   * mede quem entra no roster.
   */
  const linhaDe = (id: string, afastadoDesde: string | null, afastadoAte: string | null = null) => ({
    diretor_id: id,
    diretores: {
      id, nome: id, nome_variantes: [], agencia_id: "anm", review_status: "aprovado",
      situacao: afastadoDesde ? "afastado" : "titular",
      metadata: afastadoDesde
        ? { afastado_desde: afastadoDesde, ...(afastadoAte ? { afastado_ate: afastadoAte } : {}) }
        : {},
    },
  });

  it("⚠️ o motor NÃO devolve quem estava afastado na data — medido, não lido", () => {
    const roster = rosterDasLinhas(
      [linhaDe("mauro", null), linhaDe("caio", "2025-09-17")],
      "2026-04-29",
    );
    expect(roster.map((d) => d.id)).toEqual(["mauro"]);
  });

  it("e DEVOLVE o mesmo diretor numa data anterior ao afastamento", () => {
    const roster = rosterDasLinhas([linhaDe("caio", "2025-09-17")], "2025-06-30");
    expect(roster.map((d) => d.id)).toEqual(["caio"]);
  });

  it("afastamento com fim: volta ao roster depois dele", () => {
    const linhas = [linhaDe("caio", "2025-09-17", "2026-03-31")];
    expect(rosterDasLinhas(linhas, "2026-03-31").map((d) => d.id)).toEqual([]);
    expect(rosterDasLinhas(linhas, "2026-04-01").map((d) => d.id)).toEqual(["caio"]);
  });

  it("sem metadata de afastamento, ninguém é excluído — é o comportamento de hoje, preservado", () => {
    const roster = rosterDasLinhas([linhaDe("mauro", null), linhaDe("fabio", null)], "2026-04-29");
    expect(roster.map((d) => d.id).sort(), "sem a migration aplicada nada pode mudar")
      .toEqual(["fabio", "mauro"]);
  });

  it("dois mandatos do mesmo diretor contam UMA vez — a dedução antiga foi preservada", () => {
    const roster = rosterDasLinhas([linhaDe("mauro", null), linhaDe("mauro", null)], "2026-04-29");
    expect(roster.length).toBe(1);
  });

  it("e o motor usa a função extraída em vez de uma cópia do laço", () => {
    expect(MOTOR).toMatch(/return rosterDasLinhas\(data as any\[\], dataReuniao\);/);
  });

  it("e a rota do placar PROPAGA a janela para o `MandatoJanela`", () => {
    expect(ROTA).toMatch(/afastado_desde: \(dir\.metadata\?\.afastado_desde/);
    expect(ROTA).toMatch(/afastado_ate: \(dir\.metadata\?\.afastado_ate/);
  });

  it("⚠️ nenhum dos dois `select` pede COLUNA NOVA — o deploy antes da migration tem de ser seguro", () => {
    /**
     * A regra é dura por um motivo concreto: se o `select` do motor pedisse uma coluna ainda não
     * criada, o PostgREST erraria, `getActiveDiretoresForVote` cairia no `if (error) return []` logo
     * abaixo e o motor pararia de produzir voto para TODAS as agências. Por isso a data vive em
     * `metadata`, que existe desde os ALTERs antigos.
     */
    expect(MOTOR, "`afastado_desde` como coluna quebraria o motor antes da migration")
      .not.toMatch(/select\([^)]*afastado_desde/s);
    expect(ROTA).not.toMatch(/select\([^)]*afastado_desde/s);
    // E as duas colunas que ELES pedem de fato existem.
    expect(MOTOR).toMatch(/situacao, metadata/);
    expect(ROTA).toMatch(/situacao, metadata/);
  });

  it("o motor ainda devolve [] em erro — a degradação existente não foi afrouxada", () => {
    expect(MOTOR).toMatch(/if \(error \|\| !data\?\.length\) return \[\];/);
  });
});

describe("etapa209 · a migration não mente sobre o que sabe", () => {
  const MIG = semComentariosSql(ler("supabase/migrations/20260928130000_mandatos_dou_fase35.sql"));
  const CRU = ler("supabase/migrations/20260928130000_mandatos_dou_fase35.sql");

  it("as datas do usuário estão lá, uma a uma", () => {
    expect(MIG).toMatch(/DATE '2025-11-19'/); // Severino início
    expect(MIG).toMatch(/DATE '2026-02-18'/); // Severino fim
    expect(MIG).toMatch(/DATE '2026-02-23'/); // Alessandro início
    expect(MIG).toMatch(/DATE '2026-08-21'/); // Alessandro fim — é o que solta a 295ª
    expect(MIG).toMatch(/DATE '2026-08-24'/); // Marcelo início
    expect(MIG).toMatch(/DATE '2027-02-20'/); // Marcelo fim
    expect(MIG).toMatch(/DATE '2022-05-24'/); // Roger/Tasso posse
    expect(MIG).toMatch(/DATE '2025-12-04'/); // Roger/Tasso fim
  });

  it("⚠️ o Caio Mário é AFASTADO e o mandato dele NÃO é tocado", () => {
    const i = MIG.indexOf("Caio%Trivellato");
    expect(i, "o UPDATE do Caio Mário desapareceu").toBeGreaterThan(-1);
    // A escrita é em `diretores`, não em `mandatos`.
    const bloco = MIG.slice(Math.max(0, i - 900), i + 200);
    expect(bloco).toMatch(/UPDATE public\.diretores/);
    expect(bloco, "encerrar o mandato dele afirmaria o que o ato não diz")
      .not.toMatch(/UPDATE public\.mandatos[\s\S]*Caio/);
  });

  it("⚠️ e a data do afastamento vai marcada como INFERÊNCIA", () => {
    /**
     * A evidência é a pauta da 34ª REP tratando-o como "Diretor afastado" — não um ato publicado que
     * eu tenha lido. Sem a marca, 17/09/2025 apareceria em relatório futuro com a mesma autoridade de
     * uma data de DOU.
     */
    expect(MIG).toMatch(/'afastado_desde_e_inferencia', 'true'/);
    expect(MIG).toMatch(/afastado_evidencia/);
  });

  it("o substituto entra com guarda de duplicata nos DOIS inserts", () => {
    const guardas = (MIG.match(/NOT EXISTS \(/g) ?? []).length;
    expect(guardas, "sem guarda, reaplicar cria segundo diretor e segundo mandato")
      .toBeGreaterThanOrEqual(2);
    expect(MIG).toMatch(/Portaria DG 190\/2026/);
  });

  it("é idempotente: todo UPDATE exige que o valor DIFIRA", () => {
    const distintos = (MIG.match(/IS DISTINCT FROM/g) ?? []).length;
    expect(distintos, "UPDATE sem comparação reescreve a linha a cada aplicação")
      .toBeGreaterThanOrEqual(4);
    expect(MIG).toMatch(/BEGIN;/);
    expect(MIG).toMatch(/COMMIT;/);
    expect(MIG).toMatch(/NOTIFY pgrst, 'reload schema'/);
  });

  it("não cria função auxiliar — a lição do `iris_seed_director`", () => {
    expect(MIG).not.toMatch(/CREATE (OR REPLACE )?FUNCTION/i);
  });

  it("e traz CONFERÊNCIA com o gabarito de aceite escrito", () => {
    expect(CRU).toMatch(/ACEITE:/);
    expect(CRU, "o aceite tem de dizer o efeito esperado no placar").toMatch(/295a/);
    expect(CRU).toMatch(/MANDATO INTACTO/);
  });
});
