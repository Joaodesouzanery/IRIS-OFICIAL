/**
 * Etapa 230 (Fase 39, passo 0) — consertar os INSTRUMENTOS antes de qualquer escrita.
 *
 * Três instrumentos mediam errado, e cada um empurraria a fase para o lado errado:
 *  · a certificação contava Ausente/impedido como voto e a mãe-envelope como item — divergência do
 *    instrumento lida como defeito da esteira;
 *  · o livro-razão chamava de "externo" a referência que ninguém tentou buscar — trabalho nosso
 *    escapando da meta;
 *  · o livro e o placar não viam reunião com data errada (a 81ª ROP em 2025, a 289 RDE em 2024).
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";
import { reuniaoNoBancoParaCertificar } from "../certificacao-gabarito";
import { buracosDaSerie } from "../placar";
import {
  avaliarReuniao, estadoDaReferencia, montarLivroRazao,
  type ContextoDoLivro, type EstadoDaReferencia, type ReuniaoDoAcervo,
} from "../livro-razao";
import type { MandatoJanela } from "../colegiado-na-data";

const RAIZ = join(__dirname, "../../../..");
const semComentarios = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/\/\/[^\n]*/g, " ");

describe("etapa230 · a certificação conta com a régua do GABARITO", () => {
  const nomeDe = (id: string) => id;

  it("Ausente (que é como o impedimento é gravado) NÃO é voto — 49 itens, 5 impedidos = 44", () => {
    const linhas = Array.from({ length: 49 }, (_, i) => ({ id: `i${i}`, final: true }));
    const votos = new Map(linhas.map((l, i) => [l.id, [{ diretor_id: "jose", tipo_voto: i < 5 ? "Ausente" : "Favoravel" }]]));
    const r = reuniaoNoBancoParaCertificar(linhas, votos, nomeDe);
    expect(r.votosPorDiretor).toEqual([{ nome: "jose", votos: 44 }]);
  });

  it("a mãe-envelope e a pauta (não finais) não são item nem dão voto", () => {
    const r = reuniaoNoBancoParaCertificar(
      [{ id: "mae", final: false }, { id: "i1", final: true }],
      new Map([["mae", [{ diretor_id: "d", tipo_voto: "Favoravel" }]], ["i1", [{ diretor_id: "d", tipo_voto: "Favoravel" }]]]),
      nomeDe,
    );
    expect(r).toEqual({ itens: 1, votosPorDiretor: [{ nome: "d", votos: 1 }] });
  });

  it("abstenção é manifestação e conta; linha repetida do mesmo diretor no item conta uma vez", () => {
    const r = reuniaoNoBancoParaCertificar(
      [{ id: "i1", final: true }],
      new Map([["i1", [{ diretor_id: "d", tipo_voto: "Abstencao" }, { diretor_id: "d", tipo_voto: "Favoravel" }]]]),
      nomeDe,
    );
    expect(r.votosPorDiretor).toEqual([{ nome: "d", votos: 1 }]);
  });

  it("o placar usa a função — não voltou a contar toda linha de `votos`", () => {
    const P = semComentarios(readFileSync(join(RAIZ, "src/app/api/v1/admin/placar/route.ts"), "utf-8"));
    expect(P).toMatch(/noBanco\[arquivo\] = reuniaoNoBancoParaCertificar\(/);
    expect(P).toMatch(/final: isFinalDecisionRecord\(d\)/);
  });
});

describe("etapa230 · irmãs fora do ano aparecem no placar", () => {
  it("a 289 tem linha em 2026 E irmã em 2024 — antes sumia de fora_do_ano e de duplicados", () => {
    const [b] = buracosDaSerie([
      { agencia: "ANTT", serie: "eletronica", numero_reuniao: "287", data_reuniao: "2026-07-03" },
      { agencia: "ANTT", serie: "eletronica", numero_reuniao: "289", data_reuniao: "2026-07-17" },
      { agencia: "ANTT", serie: "eletronica", numero_reuniao: "289", data_reuniao: "2024-04-29" },
      { agencia: "ANTT", serie: "eletronica", numero_reuniao: "291", data_reuniao: "2026-07-31" },
    ], "2026-01-01", "2026-12-31");
    expect(b.irmaos_fora_do_ano).toEqual([{ ordinal: 289, datas: ["2024-04-29", "2026-07-17"] }]);
    expect(b.duplicados).toEqual([]);
  });
});

const ANM = "ag-anm";
const ANTT = "ag-antt";
const mand = (id: string, ag: string): MandatoJanela =>
  ({ diretor_id: id, agencia_id: ag, data_inicio: "2020-01-01", data_fim: null, afastado_desde: null, afastado_ate: null });
const ctx: ContextoDoLivro = { ano: 2026, mandatos: [mand("d1", ANM), mand("t1", ANTT)], exigeRelator: {} };
const it1 = (resp: string[]) => ({ id: Math.random().toString(36), resultado: "Deferido", processo: "p", interessado: "i", relator: null, respondido_por: resp });
const grupo = (over: Partial<ReuniaoDoAcervo>): ReuniaoDoAcervo => ({
  agencia: "ANTT", agencia_id: ANTT, serie: "eletronica", numero: 287, datas: ["2026-07-03"],
  itens: [it1(["t1"])], ancoras_da_ata: null, ata_sem_texto: false, ...over,
});

describe("etapa230 · portão 1: 'ninguém tentou' é nosso; 'tentou e falhou' é externo", () => {
  it("sem nenhuma fonte gravada → nunca_tentada, e o portão é NOSSO", () => {
    const e = estadoDaReferencia([], new Date("2026-10-05"));
    expect(e).toMatchObject({ disponivel: false, nunca_tentada: true });
    expect(avaliarReuniao(null, grupo({}), e, ctx)[0]).toMatchObject({ estado: "vermelho", dono: "nosso" });
  });

  it("tentou e o site falhou → externo (é o único 'externo' do portão 1)", () => {
    const e = estadoDaReferencia([{ ultima_boa_em: null, ultima_tentativa_em: "2026-10-05T10:00:00Z", ultimo_erro: "WAF" }], new Date("2026-10-05"));
    expect(e).toMatchObject({ disponivel: false, nunca_tentada: false, motivo: "WAF" });
    expect(avaliarReuniao(null, grupo({}), e, ctx)[0]).toMatchObject({ estado: "vermelho", dono: "externo" });
  });

  it("⚠️ sem referência tentada, a reunião NÃO conta como bloqueio externo — fica no trabalho nosso", () => {
    const l = montarLivroRazao({ referencia: [], banco: [grupo({})], estadoDaReferencia: {}, agencias: ["ANTT"], ctx });
    expect(l.por_agencia.ANTT).toMatchObject({ bloqueio_externo: 0, trabalho_nosso: 1, pronto: false });
  });
});

describe("etapa230 · o livro vê a reunião gravada FORA do ano quando o número diz que é do ano", () => {
  const REF_OK: EstadoDaReferencia = { disponivel: true, ultima_boa_em: "2026-10-05", desatualizada: false, motivo: null };
  const montar = (banco: ReuniaoDoAcervo[], agencias = ["ANTT"]) =>
    montarLivroRazao({ referencia: [], banco, estadoDaReferencia: { ANTT: REF_OK, ANM: REF_OK }, agencias, ctx });

  it("a 289 RDE em 2024, entre a 287 e a 291 de 2026 → entra, com o portão 2 dizendo a data errada", () => {
    const l = montar([
      grupo({ numero: 287 }),
      grupo({ numero: 289, datas: ["2024-04-29"] }),
      grupo({ numero: 291, datas: ["2026-07-31"] }),
    ]);
    const l289 = l.linhas.find((x) => x.numero === 289);
    expect(l289, "a 289 sumia do livro").toBeDefined();
    expect(l289!.portoes[1].motivo).toMatch(/gravada em 2024-04-29, fora de 2026/);
  });

  it("a 81ª ROP da ANM, toda em 2025, entra pela ÂNCORA da série mesmo sem vizinhos", () => {
    const l = montar([grupo({ agencia: "ANM", agencia_id: ANM, serie: "ordinaria", numero: 81, datas: ["2025-03-26"] })], ["ANM"]);
    expect(l.linhas.map((x) => x.numero)).toEqual([81]);
    expect(l.linhas[0].primeiro_portao_aberto).toBe("listada");
    expect(l.linhas[0].portoes[1].estado).toBe("vermelho");
  });

  it("fora da faixa da série no ano (antes da 1ª) NÃO entra — o limite declarado", () => {
    const l = montar([grupo({ numero: 287 }), grupo({ numero: 291, datas: ["2026-07-31"] }), grupo({ numero: 250, datas: ["2025-05-01"] })]);
    expect(l.linhas.map((x) => x.numero)).toEqual([287, 291]);
  });

  it("série nula só entra quando UMA série da agência cobre o número — senão seria adivinhar", () => {
    const umaSerie = montar([grupo({ numero: 287 }), grupo({ numero: 291, datas: ["2026-07-31"] }), grupo({ numero: 289, serie: null, datas: ["2024-04-29"] })]);
    expect(umaSerie.linhas.some((x) => x.numero === 289)).toBe(true);
    const duas = montar([
      grupo({ numero: 287 }), grupo({ numero: 291, datas: ["2026-07-31"] }),
      grupo({ serie: "administrativa", numero: 280 }), grupo({ serie: "administrativa", numero: 295, datas: ["2026-08-01"] }),
      grupo({ numero: 289, serie: null, datas: ["2024-04-29"] }),
    ]);
    expect(duas.linhas.some((x) => x.numero === 289 && x.serie === null)).toBe(false);
  });

  it("o número de 2026 com irmã de 2024 vira UMA linha com as duas datas — não duas reuniões", () => {
    const l = montar([grupo({ numero: 289, datas: ["2026-07-17"] }), grupo({ numero: 289, serie: null, datas: ["2024-04-29"] })]);
    expect(l.linhas).toHaveLength(1);
    expect(l.linhas[0].portoes[1].motivo).toMatch(/2 datas/);
  });
});
