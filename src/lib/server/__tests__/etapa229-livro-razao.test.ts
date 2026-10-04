/**
 * Etapa 229 (Fase 38) — o LIVRO-RAZÃO: um critério de "pronto" por reunião, contra o SITE.
 *
 * O que estes testes provam são PROPRIEDADES, não a forma do código:
 *  · o ano da ANM vem da ÂNCORA da série, nunca do ano da página (que é o da publicação);
 *  · fonte cega é portão VERMELHO com motivo — o livro nunca fica mais verde quanto menos enxerga;
 *  · cada portão separa trabalho NOSSO de bloqueio EXTERNO, e "pronto" exige os dois lados;
 *  · a referência gravada nunca é substituída por enumeração vazia/bloqueada, e é cumulativa.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";
import {
  avaliarReuniao, estadoDaReferencia, montarLivroRazao, pertencaAoAno,
  type ContextoDoLivro, type EstadoDaReferencia, type ReuniaoDeReferencia, type ReuniaoDoAcervo,
} from "../livro-razao";
import { fundirReferencia, gravarReferencia, referenciaDaAnm, type LinhaDeReferencia } from "../referencia-site";
import { contarAncorasDeDispositivo } from "../consistency-checks";
import type { MandatoJanela } from "../colegiado-na-data";

const RAIZ = join(__dirname, "../../../..");
const ler = (p: string) => readFileSync(join(RAIZ, p), "utf-8");
const semComentarios = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/\/\/[^\n]*/g, " ");

const ANM_ID = "ag-anm";
const ARTESP_ID = "ag-artesp";
const mandatosAnm: MandatoJanela[] = ["d1", "d2", "d3"].map((id) => ({
  diretor_id: id, agencia_id: ANM_ID, data_inicio: "2022-01-01", data_fim: null, afastado_desde: null, afastado_ate: null,
}));
const ctx: ContextoDoLivro = {
  ano: 2026,
  mandatos: [...mandatosAnm, { diretor_id: "a1", agencia_id: ARTESP_ID, data_inicio: "2022-01-01", data_fim: null, afastado_desde: null, afastado_ate: null }],
  exigeRelator: { ANM: true, ANTT: true, ARTESP: false },
  nomeDe: (id) => `Dir ${id}`,
};
const REF_OK: EstadoDaReferencia = { disponivel: true, ultima_boa_em: "2026-10-04T00:00:00Z", desatualizada: false, motivo: null };

function item(id: string, respondido_por: string[], extra: Partial<{ relator: string | null }> = {}) {
  return { id, resultado: "Deferido", processo: "48400.000001/2026", interessado: "Mineradora X", relator: "Dir d1", respondido_por, ...extra };
}
function reuniao(over: Partial<ReuniaoDoAcervo> = {}): ReuniaoDoAcervo {
  return {
    agencia: "ANM", agencia_id: ANM_ID, serie: "ordinaria", numero: 82, datas: ["2026-02-25"],
    itens: [item("i1", ["d1", "d2", "d3"]), item("i2", ["d1", "d2", "d3"])],
    ancoras_da_ata: 2, ata_sem_texto: false, ...over,
  };
}
const ref = (over: Partial<ReuniaoDeReferencia> = {}): ReuniaoDeReferencia => ({
  agencia: "ANM", serie: "ordinaria", numero: 82, data_reuniao: null, itens_na_fonte: null, decisao_publicada: true, ...over,
});
const estado = (vs: ReturnType<typeof avaliarReuniao>) => Object.fromEntries(vs.map((v) => [v.portao, v.estado]));

describe("etapa229 · o ano da ANM vem da âncora da série, não da página", () => {
  it("80ª ROP é 2025 e 81ª é 2026 — o par de datas que decide a série inteira", () => {
    expect(pertencaAoAno({ agencia: "ANM", serie: "ordinaria", numero: 79, data_reuniao: null }, 2026)).toBe("nao");
    expect(pertencaAoAno({ agencia: "ANM", serie: "ordinaria", numero: 80, data_reuniao: null }, 2026)).toBe("nao");
    expect(pertencaAoAno({ agencia: "ANM", serie: "ordinaria", numero: 81, data_reuniao: null }, 2026)).toBe("sim");
  });

  it("34ª REP é 2025; a próxima REP é INCERTA até alguém ancorá-la — nunca some, nunca entra calada", () => {
    expect(pertencaAoAno({ agencia: "ANM", serie: "extraordinaria", numero: 34, data_reuniao: null }, 2026)).toBe("nao");
    expect(pertencaAoAno({ agencia: "ANM", serie: "extraordinaria", numero: 35, data_reuniao: null }, 2026)).toBe("incerto");
  });

  it("a data da REUNIÃO, quando a listagem dá, vence a âncora", () => {
    expect(pertencaAoAno({ agencia: "ANM", serie: "ordinaria", numero: 90, data_reuniao: "2025-12-17" }, 2026)).toBe("nao");
    expect(pertencaAoAno({ agencia: "ARTESP", serie: "ordinaria", numero: 1200, data_reuniao: null }, 2026)).toBe("incerto");
  });

  it("⚠️ na fixture REAL, a 34ª REP vem publicada em 2026 e mesmo assim fica FORA de 2026", () => {
    const linhas = referenciaDaAnm([{ url: "atas", documento: "ata", html: ler("src/lib/server/__tests__/fixtures/anm/atas-da-rop.html") }]);
    const rep34 = linhas.find((l) => l.serie === "extraordinaria" && l.numero === 34);
    expect(rep34, "a fixture tem a 34ª REP").toBeDefined();
    expect(rep34!.decisao_publicada).toBe(true);
    expect(pertencaAoAno(rep34!, 2026)).toBe("nao");
    // As duas séries saem separadas: REP e ROP não colapsam no mesmo número.
    expect(linhas.some((l) => l.serie === "ordinaria" && l.numero >= 85)).toBe(true);
    expect(linhas.filter((l) => l.serie === null), "item sem série = casamento ambíguo no livro").toEqual([]);
  });

  it("a série vem da PÁGINA quando o item não diz (o arquivo de atas é todo ROP)", () => {
    const html = '<div><a href="/x/ata-77.pdf">Ata 77</a><time datetime="2026-01-10T00:00:00-03:00"></time></div>';
    const [l] = referenciaDaAnm([{ url: "arquivo", documento: "ata", serie_padrao: "ordinaria", html }]);
    expect(l.serie).toBe("ordinaria");
  });
});

describe("etapa229 · os seis portões", () => {
  it("uma reunião inteira fica com os seis verdes", () => {
    const vs = avaliarReuniao(ref(), reuniao(), REF_OK, ctx);
    expect(vs.map((v) => v.estado)).toEqual(["verde", "verde", "verde", "verde", "verde", "verde"]);
  });

  it("⚠️ fonte cega é VERMELHO externo no portão 1 — nunca '0 reuniões'", () => {
    const cego: EstadoDaReferencia = { disponivel: false, ultima_boa_em: null, desatualizada: true, motivo: "WAF" };
    const [p1] = avaliarReuniao(ref(), reuniao(), cego, ctx);
    expect(p1).toMatchObject({ estado: "vermelho", dono: "externo" });
    expect(p1.motivo).toMatch(/indisponível — WAF/);
  });

  it("o site publica e o banco não tem → trabalho NOSSO; só a pauta saiu → bloqueio EXTERNO", () => {
    expect(avaliarReuniao(ref(), null, REF_OK, ctx)[0]).toMatchObject({ estado: "vermelho", dono: "nosso" });
    expect(avaliarReuniao(ref({ decisao_publicada: false }), null, REF_OK, ctx)[0]).toMatchObject({ estado: "vermelho", dono: "externo" });
  });

  it("⚠️ a 81ª gravada em 2025: data VERMELHA, e colegiado/votos SEM MEDIDA — o colegiado é o da data", () => {
    const vs = avaliarReuniao(ref({ numero: 81 }), reuniao({ numero: 81, datas: ["2025-03-26"] }), REF_OK, ctx);
    expect(estado(vs)).toMatchObject({ listada: "verde", data: "vermelho", colegiado: "sem_medida", votos: "sem_medida" });
    expect(vs[1].motivo).toMatch(/2025-03-26, fora de 2026/);
  });

  it("o mesmo número em duas datas é data vermelha, nomeando as duas", () => {
    const vs = avaliarReuniao(ref(), reuniao({ datas: ["2026-02-25", "2026-03-04"] }), REF_OK, ctx);
    expect(vs[1]).toMatchObject({ estado: "vermelho" });
    expect(vs[1].motivo).toMatch(/2 datas/);
  });

  it("a data do site diverge da do banco → vermelho (a listagem é a referência)", () => {
    const vs = avaliarReuniao(ref({ data_reuniao: "2026-02-26" }), reuniao(), REF_OK, ctx);
    expect(vs[1].motivo).toMatch(/site diz 2026-02-26, o banco tem 2026-02-25/);
  });

  it("⚠️ o caso da 79ª: a ata tem 49 âncoras e o banco 18 itens → portão 3 vermelho com a conta", () => {
    const itens = Array.from({ length: 18 }, (_, i) => item(`i${i}`, ["d1", "d2", "d3"]));
    const vs = avaliarReuniao(ref(), reuniao({ itens, ancoras_da_ata: 49 }), REF_OK, ctx);
    expect(vs[2]).toMatchObject({ estado: "vermelho", dono: "nosso" });
    expect(vs[2].motivo).toMatch(/49 âncoras.*banco 18/);
  });

  it("folga de 2 nas âncoras (duplicata legítima / retirado de pauta) — mas não de 3", () => {
    const doisItens = reuniao();
    expect(avaliarReuniao(ref(), { ...doisItens, ancoras_da_ata: 4 }, REF_OK, ctx)[2].estado).toBe("verde");
    expect(avaliarReuniao(ref(), { ...doisItens, ancoras_da_ata: 5 }, REF_OK, ctx)[2].estado).toBe("vermelho");
  });

  it("contagem da LISTAGEM é exata: banco com menos itens que o site é vermelho, com mais é verde com nota", () => {
    expect(avaliarReuniao(ref({ itens_na_fonte: 3 }), reuniao(), REF_OK, ctx)[2].estado).toBe("vermelho");
    const mais = avaliarReuniao(ref({ itens_na_fonte: 1 }), reuniao(), REF_OK, ctx)[2];
    expect(mais.estado).toBe("verde");
    expect(mais.motivo).toMatch(/1 a mais/);
  });

  it("PDF sem texto e sem listagem → bloqueio EXTERNO nomeado; sem nenhuma conta → sem medida", () => {
    expect(avaliarReuniao(ref(), reuniao({ ancoras_da_ata: null, ata_sem_texto: true }), REF_OK, ctx)[2])
      .toMatchObject({ estado: "vermelho", dono: "externo" });
    expect(avaliarReuniao(ref(), reuniao({ ancoras_da_ata: null }), REF_OK, ctx)[2]).toMatchObject({ estado: "sem_medida", dono: "nosso" });
  });

  it("⚠️ portão que só DEPENDE de um anterior não tem dono — o dono é de quem bloqueia", () => {
    const vs = avaliarReuniao(ref({ decisao_publicada: false }), null, REF_OK, ctx);
    expect(vs.slice(1).map((v) => v.dono)).toEqual([null, null, null, null, null]);
    expect(vs.slice(1).every((v) => v.estado === "sem_medida")).toBe(true);
  });

  it("campos: o relator é exigido onde a agência o nomina (ANM), não na ARTESP", () => {
    const semRelator = [item("i1", ["d1", "d2", "d3"], { relator: null }), item("i2", ["d1", "d2", "d3"])];
    const anm = avaliarReuniao(ref(), reuniao({ itens: semRelator }), REF_OK, ctx)[3];
    expect(anm.estado).toBe("vermelho");
    expect(anm.motivo).toMatch(/sem relator em 1/);
    const artesp = avaliarReuniao(
      ref({ agencia: "ARTESP", numero: 1200, itens_na_fonte: 2 }),
      reuniao({ agencia: "ARTESP", agencia_id: ARTESP_ID, numero: 1200, ancoras_da_ata: null,
        itens: [item("i1", ["a1"], { relator: null }), item("i2", ["a1"], { relator: null })] }),
      REF_OK, ctx)[3];
    expect(artesp.estado).toBe("verde");
  });

  it("colegiado: votante sem mandato na data é bloqueio EXTERNO (DOU), nomeado", () => {
    const vs = avaliarReuniao(ref(), reuniao({ itens: [item("i1", ["d1", "d2", "d3", "x9"]), item("i2", ["d1", "d2", "d3"])] }), REF_OK, ctx);
    expect(vs[4]).toMatchObject({ estado: "vermelho", dono: "externo" });
    expect(vs[4].motivo).toMatch(/Dir x9/);
  });

  it("votos: par faltando é trabalho NOSSO, dizendo quem e em quantos", () => {
    const vs = avaliarReuniao(ref(), reuniao({ itens: [item("i1", ["d1", "d2", "d3"]), item("i2", ["d1", "d2"])] }), REF_OK, ctx);
    expect(vs[5]).toMatchObject({ estado: "vermelho", dono: "nosso" });
    expect(vs[5].motivo).toMatch(/1 de 6 pares sem voto — Dir d3 sem voto em 1 de 2/);
  });
});

describe("etapa229 · o livro e o critério de fim", () => {
  const montar = (referencia: ReuniaoDeReferencia[], banco: ReuniaoDoAcervo[], est: EstadoDaReferencia = REF_OK) =>
    montarLivroRazao({ referencia, banco, estadoDaReferencia: { ANM: est }, agencias: ["ANM"], ctx });

  it("o denominador é o SITE: reunião do site sem banco entra; reunião anterior ao ano não", () => {
    const l = montar([ref({ numero: 80 }), ref({ numero: 81 }), ref({ numero: 82 })], [reuniao()]);
    expect(l.linhas.map((x) => x.numero)).toEqual([81, 82]);
    expect(l.por_agencia.ANM).toMatchObject({ total: 2, prontas: 1, trabalho_nosso: 1 });
  });

  it("⚠️ reunião só no BANCO entra no denominador — listagem que encolheu não vira cobertura", () => {
    const l = montar([ref()], [reuniao(), reuniao({ numero: 83, datas: ["2026-03-25"] })]);
    expect(l.por_agencia.ANM.total).toBe(2);
    expect(l.linhas.find((x) => x.numero === 83)?.portoes[0].motivo).toMatch(/listagem do site não mostra/);
  });

  it("a 81ª com data errada aparece no livro de 2026 — não some como 'não coletada'", () => {
    const l = montar([ref({ numero: 81 })], [reuniao({ numero: 81, datas: ["2025-03-26"] })]);
    expect(l.linhas).toHaveLength(1);
    expect(l.linhas[0].primeiro_portao_aberto).toBe("data");
  });

  it("série nula no banco (passivo) casa com a série da referência; série diferente não", () => {
    expect(montar([ref()], [reuniao({ serie: null })]).linhas[0].pronta).toBe(true);
    expect(montar([ref()], [reuniao({ serie: "extraordinaria" })]).por_agencia.ANM.total).toBe(2);
  });

  it("⚠️ 'pronto' exige ≥95% E nenhuma aberta por trabalho nosso — bloqueio externo é o único resto aceito", () => {
    const refs = Array.from({ length: 20 }, (_, i) => ref({ numero: 81 + i }));
    const bancoCheio = refs.slice(0, 19).map((r) => reuniao({ numero: r.numero }));
    // 19 de 20 = 95%, e a 20ª é trabalho nosso (o site publica, o banco não tem) → NÃO pronto.
    expect(montar(refs, bancoCheio).por_agencia.ANM).toMatchObject({ pct: 95, pronto: false, trabalho_nosso: 1 });
    // A mesma 20ª com só a pauta publicada é bloqueio externo → pronto.
    const refsPauta = refs.map((r, i) => (i === 19 ? { ...r, decisao_publicada: false } : r));
    expect(montar(refsPauta, bancoCheio).por_agencia.ANM).toMatchObject({ pct: 95, pronto: true, bloqueio_externo: 1 });
  });

  it("⚠️ sem referência não há 'pronto', por mais verde que o banco esteja", () => {
    const cego: EstadoDaReferencia = { disponivel: false, ultima_boa_em: null, desatualizada: true, motivo: "x" };
    const l = montar([], [reuniao()], cego);
    expect(l.por_agencia.ANM).toMatchObject({ prontas: 0, pronto: false });
  });

  it("ano INCERTO sem data de 2026 no banco não passa como listada", () => {
    const l = montar([ref({ serie: "extraordinaria", numero: 35 })], [reuniao({ serie: "extraordinaria", numero: 35, datas: ["2025-12-20"] })]);
    expect(l.linhas[0].portoes[0]).toMatchObject({ estado: "vermelho" });
    expect(l.linhas[0].portoes[0].motivo).toMatch(/ano incerto/);
  });
});

describe("etapa229 · a referência: snapshot com data, cumulativo, nunca sobrescrito por vazio", () => {
  const agora = new Date("2026-10-04T12:00:00Z");

  it("sem enumeração boa → indisponível, com o erro da última tentativa", () => {
    expect(estadoDaReferencia([{ ultima_boa_em: null, ultima_tentativa_em: "2026-10-04", ultimo_erro: "WAF" }], agora))
      .toMatchObject({ disponivel: false, motivo: "WAF" });
  });

  it("boa há mais de 7 dias → desatualizada; vale pela fonte MAIS ANTIGA", () => {
    const e = estadoDaReferencia([
      { ultima_boa_em: "2026-10-03T00:00:00Z", ultima_tentativa_em: null, ultimo_erro: null },
      { ultima_boa_em: "2026-09-20T00:00:00Z", ultima_tentativa_em: null, ultimo_erro: null },
    ], agora);
    expect(e).toMatchObject({ disponivel: true, desatualizada: true, ultima_boa_em: "2026-09-20T00:00:00Z" });
  });

  it("a tentativa de hoje falhou, a boa de ontem continua valendo — e o motivo diz isso", () => {
    const e = estadoDaReferencia([{ ultima_boa_em: "2026-10-03T00:00:00Z", ultima_tentativa_em: "2026-10-04T10:00:00Z", ultimo_erro: "WAF" }], agora);
    expect(e).toMatchObject({ disponivel: true, desatualizada: false });
    expect(e.motivo).toMatch(/falhou \(WAF\)/);
  });

  it("fundir: decisão publicada não despublica; itens é o MAIOR visto; dado conhecido vence o nulo", () => {
    const base: LinhaDeReferencia = {
      agencia: "ARTESP", serie: "ordinaria", numero: 1200, data_reuniao: null, itens_na_fonte: 5,
      decisao_publicada: true, fonte: "a", url: null, ano_publicacao: null,
    };
    const [f] = fundirReferencia([
      { ...base, itens_na_fonte: 3, decisao_publicada: false },
      { ...base, data_reuniao: "2026-07-01" },
    ]);
    expect(f).toMatchObject({ itens_na_fonte: 5, decisao_publicada: true, data_reuniao: "2026-07-01" });
  });

  function dbFalso(opts: { erroLeitura?: { code: string; message: string } } = {}) {
    const chamadas: Array<{ tabela: string; op: string; payload: any }> = [];
    const db = {
      from(tabela: string) {
        const q: any = {
          select: () => q, eq: () => q,
          in: async () => ({ data: [], error: opts.erroLeitura ?? null }),
          upsert: async (payload: any) => { chamadas.push({ tabela, op: "upsert", payload }); return { error: null }; },
        };
        return q;
      },
    };
    return { db, chamadas };
  }
  const linha = (fonte: string): LinhaDeReferencia => ({
    agencia: "ANM", serie: "ordinaria", numero: 88, data_reuniao: null, itens_na_fonte: null,
    decisao_publicada: true, fonte, url: null, ano_publicacao: 2026,
  });

  it("⚠️ fonte com ERRO (WAF): nenhuma linha gravada, e o carimbo de 'boa' NÃO é escrito", async () => {
    const { db, chamadas } = dbFalso();
    const r = await gravarReferencia(db, { agenciaId: ANM_ID, linhas: [linha("f1")], tentativas: [{ fonte: "f1", erro: "WAF", parcial: false, itens: 1 }] });
    expect(r).toMatchObject({ gravada: true, linhas: 0, fontes_boas: 0 });
    expect(chamadas.filter((c) => c.tabela === "reunioes_referencia")).toEqual([]);
    const fonte = chamadas.find((c) => c.tabela === "referencia_fontes")!.payload;
    expect(fonte).not.toHaveProperty("ultima_boa_em");
    expect(fonte.ultimo_erro).toBe("WAF");
  });

  it("enumeração VAZIA não carimba; PARCIAL grava as linhas que viu e também não carimba", async () => {
    const vazia = dbFalso();
    await gravarReferencia(vazia.db, { agenciaId: ANM_ID, linhas: [], tentativas: [{ fonte: "f1", erro: null, parcial: false, itens: 0 }] });
    expect(vazia.chamadas.find((c) => c.tabela === "referencia_fontes")!.payload).not.toHaveProperty("ultima_boa_em");

    const parcial = dbFalso();
    await gravarReferencia(parcial.db, { agenciaId: ANM_ID, linhas: [linha("f1")], tentativas: [{ fonte: "f1", erro: null, parcial: true, itens: 1 }] });
    expect(parcial.chamadas.some((c) => c.tabela === "reunioes_referencia")).toBe(true);
    expect(parcial.chamadas.find((c) => c.tabela === "referencia_fontes")!.payload).not.toHaveProperty("ultima_boa_em");
  });

  it("enumeração boa carimba e grava; tabela ausente devolve o motivo com o nome da migration", async () => {
    const ok = dbFalso();
    const r = await gravarReferencia(ok.db, { agenciaId: ANM_ID, linhas: [linha("f1")], tentativas: [{ fonte: "f1", erro: null, parcial: false, itens: 1 }] });
    expect(r).toMatchObject({ gravada: true, linhas: 1, fontes_boas: 1 });
    expect(ok.chamadas.find((c) => c.tabela === "referencia_fontes")!.payload).toHaveProperty("ultima_boa_em");

    const sem = dbFalso({ erroLeitura: { code: "42P01", message: "relation does not exist" } });
    const r2 = await gravarReferencia(sem.db, { agenciaId: ANM_ID, linhas: [linha("f1")], tentativas: [{ fonte: "f1", erro: null, parcial: false, itens: 1 }] });
    expect(r2).toMatchObject({ gravada: false });
    expect((r2 as { motivo: string }).motivo).toMatch(/20261004130000/);
  });
});

describe("etapa229 · a ligação nas rotas", () => {
  it("as âncoras de dispositivo têm UMA contagem, usada pela análise e pelo livro", () => {
    expect(contarAncorasDeDispositivo("DELIBERAÇÃO: a\nDecisão: b\nItem retirado de pauta\nDELIBERACAO: c")).toBe(4);
    const ANALISE = semComentarios(ler("src/lib/server/upload-analysis.ts"));
    expect(ANALISE).toMatch(/ancoras: contarAncorasDeDispositivo\(extraction\.text\)/);
    expect(ANALISE, "voltou uma regex própria de âncora").not.toMatch(/DELIBERA\[ÇC\]\[ÃA\]O\\s\*:\|Decis/);
  });

  it("a conferência ao vivo grava a referência e decide o ano da ANM pela âncora, não pela página", () => {
    const COB = semComentarios(ler("src/app/api/v1/admin/cobertura-ao-vivo/route.ts"));
    expect(COB).toMatch(/gravarReferencia\(db,/);
    expect(COB).toMatch(/pertencaAoAno\(l, Number\(year\)\) !== "nao"/);
    expect(COB, "o filtro pelo ano da PÁGINA voltou").not.toMatch(/anmNumerosDoAno/);
    expect(COB).toMatch(/atas-reunioes-ordinarias/);
    expect(COB).toMatch(/referencia_gravada/);
  });

  it("o placar entrega o livro, e o ramo demo carrega a chave", () => {
    const PLACAR = ler("src/app/api/v1/admin/placar/route.ts");
    expect(PLACAR).toMatch(/livro_razao: \{ meta_pct: 95/);
    expect(semComentarios(PLACAR)).toMatch(/montarLivroRazao\(\{/);
    expect(semComentarios(PLACAR)).toMatch(/contarAncorasDeDispositivo\(texto\)/);
  });

  it("a migration é idempotente e tem RLS no padrão do projeto", () => {
    const MIG = ler("supabase/migrations/20261004130000_reunioes_referencia.sql");
    expect(MIG).toMatch(/CREATE TABLE IF NOT EXISTS public\.reunioes_referencia/);
    expect(MIG).toMatch(/CREATE TABLE IF NOT EXISTS public\.referencia_fontes/);
    expect(MIG).toMatch(/UNIQUE \(agencia_id, serie, numero\)/);
    expect((MIG.match(/_service_role_all/g) ?? []).length).toBeGreaterThanOrEqual(4);
    expect(MIG).toMatch(/NOTIFY pgrst, 'reload schema'/);
  });
});
