/**
 * Etapa 196 (Fase 34, Bloco 1) — o PLACAR, exercido contra os números reais da produção.
 *
 * ═══ Por que este arquivo existe ═══
 * O usuário perguntou *"como sei que estamos chegando ao fim?"*, e a resposta honesta era que não
 * havia número. Cada fase consertava algo sem medir avanço contra nada, o que dá a sensação de não
 * sair do lugar mesmo quando sai.
 *
 * ⚠️ E o placar só vale se ele próprio for conferível. O bloco ⑨ do QA passou fases inteiras
 * chamando documento avulso de reunião incompleta porque a álgebra dele só existia colada num
 * editor de SQL: conferir exigia olhar o resultado em produção. Aqui a álgebra é exercida com dado
 * montado à mão, caso a caso, e os casos são os REAIS.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";
import { naturezaDaChave } from "../agregar-rodadas";
import { ordinalDeTextoDeReuniao } from "../reunioes";
import {
  classificarReuniao, medirReuniao, buracosDaSerie, resumirPorAgencia, SALTO_MAXIMO_DA_SERIE,
  type EntradaDeNumeracao, type ReuniaoParaPlacar,
} from "../placar";
import type { MandatoJanela } from "../colegiado-na-data";

const DE = "2026-01-01";
const ATE = "2026-12-31";

/** Os cinco da ANTT, como os seeds do repositório os declaram. */
const MANDATOS_ANTT: MandatoJanela[] = [
  { diretor_id: "guilherme", agencia_id: "antt", data_inicio: "2025-08-29", data_fim: "2030-02-18" },
  { diretor_id: "lucas", agencia_id: "antt", data_inicio: "2023-02-20", data_fim: "2028-02-18" },
  { diretor_id: "felipe", agencia_id: "antt", data_inicio: "2022-12-23", data_fim: "2027-02-18" },
  { diretor_id: "alex", agencia_id: "antt", data_inicio: "2025-08-29", data_fim: "2030-02-18" },
  // ⚠️ O Alessandro entra em 23/02/2026 — é o `data_posse` do seed, e é ele que produz o corte
  // que aparece no `esperado` da produção. Não foi decisão de ninguém nesta fase: já estava lá.
  { diretor_id: "alessandro", agencia_id: "antt", data_inicio: "2026-02-23", data_fim: null },
];

const reuniao = (o: Partial<ReuniaoParaPlacar> & { data_reuniao: string; votantes: string[] }): ReuniaoParaPlacar => ({
  agencia: "ANTT", serie: "eletronica", numero_reuniao: null, ...o,
});

describe("etapa196 · ⚠️ a classe separa o que é DEFEITO MEU do que é falta de DOU", () => {
  it("as quatro classes, uma a uma", () => {
    expect(classificarReuniao({ faltando: [], extra: [], roster_conhecido: true })).toBe("completa");
    expect(classificarReuniao({ faltando: ["a"], extra: [], roster_conhecido: true })).toBe("defeito_nosso");
    expect(classificarReuniao({ faltando: [], extra: ["b"], roster_conhecido: true })).toBe("cadastro_pendente");
    expect(classificarReuniao({ faltando: [], extra: [], roster_conhecido: false })).toBe("roster_desconhecido");
  });

  it("⚠️ com os dois, vale `defeito_nosso` — é o que EU consigo consertar sozinho", () => {
    // A outra bandeira não some: `extra` continua publicado ao lado da classe.
    expect(classificarReuniao({ faltando: ["a"], extra: ["b"], roster_conhecido: true })).toBe("defeito_nosso");
  });

  it("⚠️ sem roster, NADA é 'completa' — reportar completude onde não se sabe nada é a mentira oposta", () => {
    expect(classificarReuniao({ faltando: [], extra: ["b"], roster_conhecido: false })).toBe("roster_desconhecido");
  });
});

describe("etapa196 · as nove reuniões da ANTT com 1 de 5, medidas", () => {
  it("a 271ª (09/03/2026): só o Alessandro votou ⇒ defeito nosso, faltando 4", () => {
    // O retrato exato do banco antes do reparo: o relator era o único votante.
    const m = medirReuniao(
      reuniao({ numero_reuniao: "271", data_reuniao: "2026-03-09", votantes: ["alessandro"] }),
      "antt", MANDATOS_ANTT,
    );
    expect(m.classe).toBe("defeito_nosso");
    expect(m.esperado).toBe(5);
    expect(m.com_voto).toBe(1);
    expect(m.faltando.sort()).toEqual(["alex", "felipe", "guilherme", "lucas"]);
    expect(m.extra).toEqual([]);
    expect(m.ordinal).toBe(271);
  });

  it("⚠️ a 264ª (19/01/2026) com o Severino: ele vota sem mandato ⇒ CADASTRO, não defeito meu", () => {
    /**
     * É a distinção que faz o placar valer. Os quatro esperados votaram — não falta voto nenhum.
     * O que há é o Severino votando sem mandato declarado, porque o mandato dele foi criado com
     * `fonte_dado='automatico'` e data placeholder, e todo predicado de colegiado exclui
     * `automatico`. Só a data do DOU fecha isso, e não há código que resolva.
     */
    const m = medirReuniao(
      reuniao({ numero_reuniao: "264", data_reuniao: "2026-01-19",
        votantes: ["alex", "felipe", "guilherme", "lucas", "severino"] }),
      "antt", MANDATOS_ANTT,
    );
    expect(m.classe).toBe("cadastro_pendente");
    expect(m.faltando).toEqual([]);
    expect(m.extra).toEqual(["severino"]);
    // ⚠️ E o esperado é 4, não 5: o Alessandro só entra em 23/02.
    expect(m.esperado).toBe(4);
  });

  it("a 269ª (23/02/2026): com o Alessandro dentro da janela, os cinco fecham", () => {
    const m = medirReuniao(
      reuniao({ numero_reuniao: "269", data_reuniao: "2026-02-23",
        votantes: ["alessandro", "alex", "felipe", "guilherme", "lucas"] }),
      "antt", MANDATOS_ANTT,
    );
    expect(m.classe).toBe("completa");
    expect(m.esperado).toBe(5);
  });

  it("⚠️ sem mandato nenhum na data, `extra` NÃO dispara — senão todo votante viraria extra", () => {
    const m = medirReuniao(
      reuniao({ data_reuniao: "2019-01-01", votantes: ["felipe"] }), "antt", MANDATOS_ANTT,
    );
    expect(m.roster_conhecido).toBe(false);
    expect(m.extra).toEqual([]);
    expect(m.classe).toBe("roster_desconhecido");
  });
});

describe("etapa196 · ⚠️ os buracos: ausente × fora do ano × duplicado", () => {
  const e = (numero: string, data: string, serie = "eletronica"): EntradaDeNumeracao =>
    ({ agencia: "ANTT", serie, numero_reuniao: numero, data_reuniao: data });

  it("o número que o banco TEM com data de outro ano não é 'faltando coletar'", () => {
    /**
     * ⚠️ É o achado que unifica dois pilares. Medido em produção: ANTT RDE 282 gravada em
     * 2016-06-08, 286 em 2022-11-03, 289 em 2024-04-29. Um detector que só dissesse "faltando: 282"
     * mandaria recoletar o que já está lá, e o defeito de DATA ficaria invisível.
     */
    const b = buracosDaSerie([
      e("281", "2026-04-24"), e("282", "2016-06-08"), e("283", "2026-06-03"),
    ], DE, ATE)[0];
    expect(b.ausentes).toEqual([]);
    expect(b.fora_do_ano).toEqual([{ ordinal: 282, datas: ["2016-06-08"] }]);
  });

  it("o número que não existe em data nenhuma é ausente de verdade", () => {
    const b = buracosDaSerie([e("281", "2026-04-24"), e("283", "2026-06-03")], DE, ATE)[0];
    expect(b.ausentes).toEqual([282]);
    expect(b.fora_do_ano).toEqual([]);
  });

  it("⚠️ o MESMO número em duas datas do ano é duplicata — e infla o denominador", () => {
    // Medido na ARTESP: 239 em 23/06 e 25/06, 1192 em 23/04 e 28/04, 1178 em 20/01 e 26/03.
    const b = buracosDaSerie([
      { agencia: "ARTESP", serie: "ordinaria", numero_reuniao: "1192", data_reuniao: "2026-04-23" },
      { agencia: "ARTESP", serie: "ordinaria", numero_reuniao: "1192", data_reuniao: "2026-04-28" },
    ], DE, ATE)[0];
    expect(b.duplicados).toEqual([{ ordinal: 1192, datas: ["2026-04-23", "2026-04-28"] }]);
  });

  it("⚠️ `1.028` conta como 1028, não como 1 — era o defeito das três cópias do parser", () => {
    const b = buracosDaSerie([
      e("1.028", "2026-03-12", "ordinaria"), e("1.030", "2026-04-09", "ordinaria"),
    ], DE, ATE)[0];
    expect(b.min).toBe(1028);
    expect(b.max).toBe(1030);
    expect(b.ausentes).toEqual([1029]);
  });

  it("séries diferentes NÃO se misturam — a 271 RDE e a 1.028 RD são universos separados", () => {
    const b = buracosDaSerie([
      e("271", "2026-03-09", "eletronica"), e("1.028", "2026-03-12", "ordinaria"),
    ], DE, ATE);
    expect(b).toHaveLength(2);
    // Sem a separação, o cálculo enumeraria 757 "ausentes" entre 271 e 1028.
    expect(b.every((x) => x.ausentes.length === 0)).toBe(true);
  });

  it("⚠️ repetição em ANOS diferentes não é duplicata DO ANO — e o filtro é o que separa", () => {
    /**
     * ⚠️ Esta expectativa nasceu de uma MUTAÇÃO SOBREVIVENTE: tirar o filtro de ano de `duplicados`
     * passava por todos os outros casos, porque eu só tinha montado duplicatas dentro do ano.
     *
     * `duplicados` mede uma coisa específica: o mesmo número contado DUAS VEZES no denominador do
     * ano. Um número que aparece uma vez em 2026 e uma vez em 2025 não infla o de 2026.
     *
     * ⚠️ E digo o que este recorte deixa de fora: esse caso (medido na ARTESP, 1200 em 2026-06-23 e
     * 2025-10-28) fica INVISÍVEL nos três campos — não é ausente, não é fora do ano, não é
     * duplicado do ano. É suspeito e não tem sinal próprio ainda.
     */
    const b = buracosDaSerie([
      { agencia: "ARTESP", serie: "ordinaria", numero_reuniao: "1200", data_reuniao: "2026-06-23" },
      { agencia: "ARTESP", serie: "ordinaria", numero_reuniao: "1200", data_reuniao: "2025-10-28" },
    ], DE, ATE)[0];
    expect(b.duplicados).toEqual([]);
    expect(b.fora_do_ano).toEqual([]);
  });

  it("⚠️ salto absurdo NÃO vira lista de ausentes — é número lido errado, não coleta faltando", () => {
    const b = buracosDaSerie([e("1", "2026-01-05"), e("999", "2026-12-20")], DE, ATE)[0];
    expect(b.max! - b.min!).toBeGreaterThan(SALTO_MAXIMO_DA_SERIE);
    expect(b.ausentes).toEqual([]);
  });

  it("série sem nenhuma reunião NO ANO sai do cálculo — não se enumera buraco de ano vazio", () => {
    expect(buracosDaSerie([e("282", "2016-06-08")], DE, ATE)).toEqual([]);
  });
});

describe("etapa196 · o resumo por agência: o número que toda fase tem de mover", () => {
  it("soma as classes e o total fecha", () => {
    const mandatos = MANDATOS_ANTT;
    const medidas = [
      medirReuniao(reuniao({ numero_reuniao: "271", data_reuniao: "2026-03-09", votantes: ["alessandro"] }), "antt", mandatos),
      medirReuniao(reuniao({ numero_reuniao: "264", data_reuniao: "2026-01-19", votantes: ["alex", "felipe", "guilherme", "lucas", "severino"] }), "antt", mandatos),
      medirReuniao(reuniao({ numero_reuniao: "269", data_reuniao: "2026-02-23", votantes: ["alessandro", "alex", "felipe", "guilherme", "lucas"] }), "antt", mandatos),
    ];
    const r = resumirPorAgencia(medidas).ANTT;
    expect(r).toEqual({ total: 3, completas: 1, defeito_nosso: 1, cadastro_pendente: 1, roster_desconhecido: 0 });
    // ⚠️ A soma das classes é o total: nenhuma reunião pode cair em duas nem em nenhuma.
    expect(r.completas + r.defeito_nosso + r.cadastro_pendente + r.roster_desconhecido).toBe(r.total);
  });
});


const RAIZ = join(__dirname, "../../../..");
const ler = (p: string) => readFileSync(join(RAIZ, p), "utf-8");
const semComentarios = (t: string) => t.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/\/\/[^\n]*/g, " ");

describe("etapa196 · ⚠️ `1.028` vira 1028 — e as TRÊS cópias do parser errado morreram", () => {
  it("o ordinal aceita separador de milhar, sufixo ordinal e título inteiro", () => {
    expect(ordinalDeTextoDeReuniao("1.028")).toBe(1028);
    expect(ordinalDeTextoDeReuniao("1028")).toBe(1028);
    expect(ordinalDeTextoDeReuniao("1.036ª REUNIÃO DE DIRETORIA")).toBe(1036);
    expect(ordinalDeTextoDeReuniao("85ª")).toBe(85);
    expect(ordinalDeTextoDeReuniao("264")).toBe(264);
    expect(ordinalDeTextoDeReuniao(null)).toBeNull();
    expect(ordinalDeTextoDeReuniao("sem número")).toBeNull();
  });

  it("⚠️ a alternativa COM milhar vem PRIMEIRO — na ordem inversa, `1.028` daria 1", () => {
    // É o defeito literal que estava em três arquivos. `\d{1,4}` casa o `1` e para no ponto.
    expect("1.028".match(/\d{1,4}/)?.[0]).toBe("1");
    expect("1.028".match(/\d{1,3}(?:\.\d{3})+|\d{1,4}/)?.[0]).toBe("1.028");
  });

  it("nenhum dos três lugares reimplementa o parser", () => {
    const COBERTURA = semComentarios(ler("src/app/api/v1/admin/cobertura-ao-vivo/route.ts"));
    expect(COBERTURA).toMatch(/ordinalDeTextoDeReuniao\(v\)/);
    expect(COBERTURA, "voltou a regex que trunca no ponto").not.toMatch(/match\(\/\(\\d\{1,4\}\)\/\)/);

    const COLLECTOR = semComentarios(ler("src/lib/server/antt-2026-collector.ts"));
    expect(COLLECTOR).toMatch(/firstMatch\(title, \/\(\\d\{1,3\}\(\?:\\\.\\d\{3\}\)\+\|\\d\{1,4\}\)\//);

    const COMPLETUDE = semComentarios(ler("src/app/api/v1/admin/completude-2026/route.ts"));
    expect(COMPLETUDE).toMatch(/\^\(\\d\{1,3\}\(\?:\\\.\\d\{3\}\)\+\|\\d\+\)/);
  });
});

describe("etapa196 · a rota do placar e a ligação com a esteira", () => {
  const ROTA = semComentarios(ler("src/app/api/v1/admin/placar/route.ts"));
  const RUN = semComentarios(ler("src/app/api/v1/pipeline/run/route.ts"));

  it("tem gate de demo, guard e orçamento — a ordem que o projeto exige", () => {
    expect(ROTA).toMatch(/if \(isDemo\(\) \|\| isDemoRequest\(req\)\)/);
    expect(ROTA).toMatch(/const guard = await requireAdminOrCron\(req, "placar"\);\s*\n\s*if \(guard\) return guard;/);
    expect(ROTA).toMatch(/budgetFromRequest\(req\)/);
  });

  it("⚠️ TODA leitura é paginada, e a truncagem vira bandeira", () => {
    // `.limit(N)` grande não é paginação no PostgREST — ele corta em ~1.000 sem avisar, e um placar
    // que subconta sobe quando o acervo cresce.
    expect(ROTA, "apareceu `.limit()` numa leitura do placar").not.toMatch(/\.limit\(/);
    expect((ROTA.match(/lerTudo</g) ?? []).length).toBeGreaterThanOrEqual(4);
    // ⚠️ `truncated` sozinho não basta: no erro, `selectAllPaged` devolve `truncated: false`.
    expect(ROTA).toMatch(/r\.truncated \|\| Boolean\(r\.error\)/);
    expect(ROTA).toMatch(/leitura_completa: leituraCompleta/);
  });

  it("⚠️ o ramo demo carrega TODAS as chaves do real — chave ausente vira buraco na tela", () => {
    for (const k of ["buracos_de_numeracao", "colegiado_por_reuniao", "reunioes_incompletas",
      "certificacao_no_banco", "leitura_completa", "alertas"]) {
      expect(ROTA, `${k} falta no ramo demo`).toMatch(new RegExp(`${k}`));
    }
    expect(ROTA).toMatch(/modo: "demo"[\s\S]{0,120}\.\.\.vazio/);
  });

  it("só agências COLEGIADAS entram, e documento avulso não vira reunião", () => {
    expect(ROTA).toMatch(/COLEGIADO_SIGLAS\.has\(a\.sigla\)/);
    expect(ROTA).toMatch(/if \(!isFinalDecisionRecord\(d\)\) continue;/);
    // Era o falso positivo do bloco ⑨: documento sem número virava reunião com 4 faltando.
    expect(ROTA).toMatch(/if \(!d\.numero_reuniao\) continue;/);
  });

  it("⚠️ a numeração olha TODO o acervo — é o que permite dizer «existe, com data de outro ano»", () => {
    const i = ROTA.indexOf("entradas.push");
    const j = ROTA.indexOf("if (d.data_reuniao < de || d.data_reuniao > ate) continue;");
    expect(i).toBeGreaterThan(-1);
    expect(j).toBeGreaterThan(i); // o filtro de ano vem DEPOIS de alimentar a numeração
  });

  it("a esteira chama o placar pela SOBRA, não como passo", () => {
    expect(RUN).toMatch(/const sobraParaPlacar = saldo\(\);/);
    expect(RUN).toMatch(/if \(sobraParaPlacar >= SOBRA_MINIMA_PLACAR_MS\)/);
    expect(RUN).toMatch(/chamarComSobra\(\s*placarGET/);
    // ⚠️ Passo de cabeça custaria `reResultar` — o `etapa119` proíbe esse trade.
    expect(RUN, "o placar virou passo planejado").not.toMatch(/ORDEM_DOS_PASSOS[\s\S]{0,600}?"placar"/);
  });

  it("⚠️ `reunioes_completas` NUNCA viaja sem o denominador", () => {
    const i = RUN.indexOf("etapas.placar = anotar(");
    const bloco = RUN.slice(i, i + 700);
    expect(bloco).toMatch(/reunioes_completas: completas/);
    expect(bloco).toMatch(/reunioes_no_ano: total/);
  });

  it("⚠️⚠️ todas as chaves do placar são ESTOQUE — somadas, a leitura inverteria", () => {
    /**
     * O alvo de `reunioes_com_voto_faltando` é ZERO. Somado entre rodadas, ele cresce enquanto o
     * defeito existe e continua crescendo depois de consertado; e `reunioes_completas` somado
     * passaria o total. Um número que sobe quando melhora e sobe quando piora não mede nada.
     */
    for (const chave of ["reunioes_completas", "reunioes_no_ano", "reunioes_com_voto_faltando",
      "reunioes_esperando_cadastro", "numeros_ausentes", "numeros_com_data_fora_do_ano",
      "numeros_duplicados", "placar_leitura_incompleta"]) {
      expect(naturezaDaChave(chave), `${chave} não é estoque`).toBe("estoque");
    }
  });
});
