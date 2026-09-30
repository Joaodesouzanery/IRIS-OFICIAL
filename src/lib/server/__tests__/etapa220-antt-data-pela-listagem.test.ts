/**
 * Etapa 220 (Fase 36, B.3) — a data da ANTT pela listagem, e o PORTÃO que decide se dá para confiar.
 *
 * ═══ Por que a ANTT precisa de outro caminho ═══
 * A Janela C re-deriva pelo TEXTO e a ANTT está fora de `AGENCIAS_COM_ANCORA_CERTIFICADA` — o
 * preâmbulo dela não foi conferido contra os PDFs. Mas a ANTT tem a listagem do próprio site em
 * `antt_reunioes_coletadas`, com `numero` e `data_inicio`.
 *
 * ═══ Por que o portão não é opcional ═══
 * Trocar uma data que eu não sei se está certa por outra que eu também não sei não é conserto. O
 * gabarito tem DUAS atas da ANTT conferidas à mão — a 1.024ª e a 264ª RDE, ambas **2026-01-19**. Se
 * a listagem reproduz as duas, é testemunha. Se não, o erro está NELA, e aplicá-la espalharia o
 * defeito por centenas de linhas.
 *
 * ⚠️ Listagem VAZIA reprova. Um `every` sobre conjunto vazio devolve `true`, e é assim que "não
 * mediu nada" vira "está tudo certo" — o formato de zero que a Fase 17 catalogou.
 *
 * ⚠️ E o veredito sai publicado COM `conferidas`: "aprovado" sobre duas atas não é "a listagem está
 * certa", e um número sem escopo é lido como se fosse.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";
import {
  dataDaListagem,
  numeroDaListagem,
  portaoDaListagemAntt,
  type ReuniaoDaListagem,
} from "../antt-data-da-listagem";
import { GABARITO_POR_ARQUIVO } from "../gabarito";

const RAIZ = join(__dirname, "../../../..");
const ler = (p: string) => readFileSync(join(RAIZ, p), "utf-8");
const semComentarios = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/\/\/[^\n]*/g, " ");
const R = semComentarios(ler("src/app/api/v1/admin/deliberacoes/redatar/route.ts"));

/** As duas atas da ANTT que o gabarito certifica — lidas do gabarito, não copiadas. */
const ATAS_ANTT = Object.values(GABARITO_POR_ARQUIVO)
  .filter((a) => a.agencia.toUpperCase() === "ANTT")
  .map((a) => ({ reuniao: a.reuniao, data_reuniao: a.data_reuniao }));

const L = (numero: string, data: string | null, tipo = "ordinaria"): ReuniaoDaListagem =>
  ({ numero, tipo, data_inicio: data });

describe("etapa220 · o gabarito realmente tem as duas atas, com a mesma data", () => {
  it("1.024ª e 264ª RDE, ambas 2026-01-19", () => {
    expect(ATAS_ANTT.length, "o gabarito da ANTT mudou — reavalie a força do portão").toBe(2);
    expect(new Set(ATAS_ANTT.map((a) => a.data_reuniao))).toEqual(new Set(["2026-01-19"]));
  });

  it("⚠️ e as duas terem a MESMA data é uma fraqueza declarada do portão", () => {
    // Duas atas de datas diferentes seriam um teste mais forte; não existem no gabarito. Por isso o
    // veredito publica `conferidas`, e por isso esta expectativa existe: se um dia entrar uma
    // terceira ata da ANTT com outra data, o portão fica mais forte e isto reprova para avisar.
    expect(new Set(ATAS_ANTT.map((a) => a.data_reuniao)).size).toBe(1);
  });
});

describe("etapa220 · o número, lido dos dois formatos", () => {
  it("o ponto de milhar e o ordinal saem", () => {
    expect(numeroDaListagem("1.024ª")).toBe(1024);
    expect(numeroDaListagem("1024")).toBe(1024);
    expect(numeroDaListagem("264ª RDE")).toBe(264);
    expect(numeroDaListagem("81ª ROP")).toBe(81);
  });

  it("e o que não tem número devolve null", () => {
    expect(numeroDaListagem(null)).toBeNull();
    expect(numeroDaListagem("")).toBeNull();
    expect(numeroDaListagem("sem numero")).toBeNull();
    expect(numeroDaListagem("0")).toBeNull();
  });
});

describe("etapa220 · a data da listagem, e quando ela se recusa a responder", () => {
  const listagem = [L("1.024", "2026-01-19"), L("264", "2026-01-19", "extraordinaria"), L("1.025", "2026-02-02")];

  it("casa o número em qualquer grafia", () => {
    expect(dataDaListagem(listagem, "1.024ª")).toBe("2026-01-19");
    expect(dataDaListagem(listagem, "1024")).toBe("2026-01-19");
    expect(dataDaListagem(listagem, "264ª RDE")).toBe("2026-01-19");
  });

  it("número que a listagem não tem devolve null", () => {
    expect(dataDaListagem(listagem, "9999")).toBeNull();
  });

  it("⚠️ DUAS datas para o mesmo número devolve null — escolher seria adivinhar", () => {
    // Este é o caminho que vai ESCREVER data. O lado seguro é não saber.
    const ambigua = [...listagem, L("1.024", "2026-03-10")];
    expect(dataDaListagem(ambigua, "1.024ª")).toBeNull();
  });

  it("e duas linhas com a MESMA data não são ambiguidade", () => {
    const repetida = [...listagem, L("1.024", "2026-01-19", "extraordinaria")];
    expect(dataDaListagem(repetida, "1.024ª")).toBe("2026-01-19");
  });

  it("data nula na listagem não vale como resposta", () => {
    expect(dataDaListagem([L("777", null)], "777")).toBeNull();
  });
});

describe("etapa220 · ⚠️ O PORTÃO", () => {
  it("aprova quando a listagem reproduz as duas atas conferidas", () => {
    const v = portaoDaListagemAntt([L("1.024", "2026-01-19"), L("264", "2026-01-19")], ATAS_ANTT);
    expect(v.aprovado).toBe(true);
    expect(v.conferidas).toBe(2);
    expect(v.batem).toBe(2);
    expect(v.divergem).toEqual([]);
    expect(v.motivo).toBe("aprovado");
  });

  it("⚠️ REPROVA se UMA divergir — e diz qual, com os dois valores", () => {
    const v = portaoDaListagemAntt([L("1.024", "2026-01-19"), L("264", "2026-02-02")], ATAS_ANTT);
    expect(v.aprovado).toBe(false);
    expect(v.batem).toBe(1);
    expect(v.divergem).toEqual([{ reuniao: "264ª RDE", no_gabarito: "2026-01-19", na_listagem: "2026-02-02" }]);
    expect(v.motivo).toBe("divergencia");
  });

  it("⚠️ REPROVA com a listagem VAZIA — 'não mediu nada' não é 'está certo'", () => {
    const v = portaoDaListagemAntt([], ATAS_ANTT);
    expect(v.aprovado).toBe(false);
    expect(v.motivo).toBe("listagem_vazia");
    expect(v.conferidas, "listagem vazia não pode reportar atas conferidas").toBe(0);
  });

  it("⚠️ REPROVA sem ata para conferir — portão sem gabarito é portão aberto", () => {
    const v = portaoDaListagemAntt([L("1.024", "2026-01-19")], []);
    expect(v.aprovado).toBe(false);
    expect(v.motivo).toBe("sem_ata_para_conferir");
  });

  it("reprova quando a ata conferida simplesmente FALTA na listagem", () => {
    const v = portaoDaListagemAntt([L("1.024", "2026-01-19")], ATAS_ANTT);
    expect(v.aprovado).toBe(false);
    expect(v.divergem[0]).toEqual({ reuniao: "264ª RDE", no_gabarito: "2026-01-19", na_listagem: null });
  });

  it("e reprova quando o número da ata está AMBÍGUO na listagem", () => {
    const v = portaoDaListagemAntt(
      [L("1.024", "2026-01-19"), L("1.024", "2026-05-05"), L("264", "2026-01-19")], ATAS_ANTT);
    expect(v.aprovado).toBe(false);
    expect(v.divergem[0].na_listagem).toBeNull();
  });
});

describe("etapa220 · a Janela D usa o portão como portão", () => {
  it("nada é escrito antes de `anttPortao.aprovado`", () => {
    const iPortao = R.indexOf("anttPortao = portaoDaListagemAntt(listagem, atasAntt)");
    const iAprovado = R.indexOf("if (anttPortao.aprovado) {");
    const iEscrita = R.indexOf("redatar ANTT pela listagem");
    expect(iPortao).toBeGreaterThan(-1);
    expect(iAprovado).toBeGreaterThan(iPortao);
    expect(iEscrita, "a escrita da ANTT saiu de dentro do ramo aprovado").toBeGreaterThan(iAprovado);
  });

  it("⚠️ leitura truncada da listagem REPROVA o portão em vez de aprovar por acidente", () => {
    // A ata conferida pode estar justamente no pedaço que faltou.
    expect(R).toMatch(/if \(listagemRes\.error \|\| listagemRes\.truncated\) \{/);
    const i = R.indexOf("if (listagemRes.error || listagemRes.truncated) {");
    const bloco = R.slice(i, i + 400);
    expect(bloco).toMatch(/aprovado: false/);
  });

  it("só MÃE/avulso é corrigida pela listagem — o filho segue a mãe", () => {
    const i = R.indexOf("redatar/antt-deliberacoes");
    const bloco = R.slice(i, i + 900);
    expect(bloco).toMatch(/if \(d\.documento_pai_id\) continue;/);
  });

  it("⚠️ a mãe da ANTT entra na reconciliação SÓ como validada pela listagem", () => {
    expect(R).toMatch(/sigla: "ANTT", validadaPor: "listagem_antt"/);
    expect(R, "a regra voltou a ser a sigla, e não quem validou a data")
      .toMatch(/m\.sigla\.toUpperCase\(\) !== "ANTT" \|\| m\.validadaPor === "listagem_antt"/);
  });

  it("dry_run mede e não escreve", () => {
    const i = R.indexOf("anttDivergentes++");
    const bloco = R.slice(i, i + 900);
    expect(bloco).toMatch(/if \(dryRun\) continue;/);
  });

  it("⚠️ a série da ANTT NÃO vem da faixa numérica, e isso é deliberado", () => {
    // A série Administrativa ocupa 193-199 intercalada em 2026, e número lido errado também cai
    // abaixo de 200 — a faixa produziria série errada, e série errada religa a reunião errada.
    const i = R.indexOf("redatar ANTT pela listagem");
    const antes = R.slice(Math.max(0, i - 1_200), i);
    expect(antes).toMatch(/serieDaReuniao\(\{\s*sigla: "ANTT"/);
  });

  it("o veredito é publicado INTEIRO, com o escopo", () => {
    expect(R).toMatch(/antt_portao: anttPortao/);
    expect(R).toMatch(/antt_divergentes: anttDivergentes/);
    expect(R).toMatch(/antt_corrigidas: anttCorrigidas/);
    expect(R).toMatch(/antt_amostra: anttAmostra/);
  });
});
