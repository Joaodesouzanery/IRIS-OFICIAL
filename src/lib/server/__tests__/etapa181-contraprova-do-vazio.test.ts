/**
 * Etapa 181 (Fase 31, Bloco 4) — "zero com este recorte" deixa de se ler como "não existe".
 *
 * ═══ O incidente, e ele foi INTEIRAMENTE de tela ═══
 * O usuário disse: *"Nem tem ANM reunião 79. Veja lá, que são 5 páginas e não tem 79."*
 *
 * A 79ª ROP da ANM existe, com 36 votos gravados, em **2025-11-26**. A aba estava em **2026** — e o
 * default do filtro de ano era `String(new Date().getFullYear())`, pré-selecionado a cada visita.
 * Os dois predicados entram na MESMA consulta conjuntivamente:
 *
 *     numero_reuniao = '79' AND data_reuniao >= '2026-01-01' AND data_reuniao <= '2026-12-31'
 *
 * Interseção vazia por construção. A tela imprimia o literal `"Nenhum voto com estes filtros."` —
 * sem total, sem o recorte aplicado, sem causa — e nada na rota nem na tela detectava que os dois
 * filtros se cancelam. Numa ferramenta de auditoria, esse é o pior formato de zero: indistinguível
 * de "o sistema perdeu os votos".
 *
 * ═══ Três consertos, e cada um mata uma parte do engano ═══
 * 1. O ano nasce VAZIO, como nas telas irmãs (`deliberacoes`, `360`, `governanca`).
 * 2. A rota devolve CONTRAPROVA no caso zero: quantos votos existem com os mesmos filtros e SEM a
 *    janela de datas, em que anos, e quantos são de deliberação sem data de reunião.
 * 3. O vazio mostra o total e o recorte em palavras — que não existiam em lugar nenhum da tela.
 *
 * ⚠️ E o item 3 não é cosmético: o total só saía dentro da paginação, condicionada a `pages > 1`.
 * Com zero linhas `pages` é 1, então nem "0 voto(s)" aparecia.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";
import { cabeContraprova, normalizarFiltros } from "../auditoria-votos-filtros";

const RAIZ = join(__dirname, "../../../..");
const ler = (p: string) => readFileSync(join(RAIZ, p), "utf-8");
const semComentarios = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/\/\/[^\n]*/g, " ");

const ROTA = semComentarios(ler("src/app/api/v1/admin/auditoria/votos/route.ts"));
const TELA = ler("src/app/dashboard/deliberacoes/auditoria-votos/page.tsx");
const TELA_CODIGO = semComentarios(TELA);

const filtros = (qs: string) => {
  const r = normalizarFiltros(new URLSearchParams(qs));
  expect(r.ok, `filtros inválidos: ${qs}`).toBe(true);
  return (r as { ok: true; filtros: any }).filtros;
};

describe("etapa181 · `cabeContraprova` — só quando há janela para relaxar", () => {
  it("com `ano`, cabe", () => {
    expect(cabeContraprova(filtros("ano=2026"))).toBe(true);
  });

  it("com `date_from` ou `date_to`, cabe", () => {
    expect(cabeContraprova(filtros("date_from=2026-01-01"))).toBe(true);
    expect(cabeContraprova(filtros("date_to=2026-12-31"))).toBe(true);
  });

  it("⚠️ sem janela NÃO cabe — ali o vazio já é honesto e a consulta seria ruído", () => {
    expect(cabeContraprova(filtros(""))).toBe(false);
    expect(cabeContraprova(filtros("agencia_id=&numero_reuniao=79"))).toBe(false);
  });

  it("o caso medido: reunião 79 + ano 2026 cabe contraprova", () => {
    expect(cabeContraprova(filtros("numero_reuniao=79&ano=2026"))).toBe(true);
  });

  it("⚠️ `date_from` VENCE `ano` — a contraprova segue a janela efetiva, não o parâmetro", () => {
    // `janelaDeDatas` dá precedência ao par explícito; se a contraprova olhasse só `f.ano` ela
    // diria "não cabe" num recorte que TEM janela, e o operador ficaria sem a resposta.
    const f = filtros("date_from=2026-01-01&date_to=2026-12-31");
    expect(f.ano).toBeNull();
    expect(cabeContraprova(f)).toBe(true);
  });
});

describe("etapa181 · a rota mede a contraprova sem criar uma segunda verdade", () => {
  it("⚠️ reusa os MESMOS predicados, com a janela desligada por parâmetro", () => {
    // Mutação a matar: reescrever a lista de predicados num segundo lugar. A contraprova passaria a
    // responder sobre um recorte diferente do que a tela mostrou — e afirmaria com confiança algo
    // que não corresponde ao vazio que o operador está vendo.
    expect(ROTA).toMatch(/const comFiltros = \(q: any, comJanela = true\) => \{/);
    expect(ROTA).toMatch(/if \(comJanela && de\) q = q\.gte\("deliberacao\.data_reuniao", de\);/);
    expect(ROTA).toMatch(/if \(comJanela && ate\) q = q\.lte\("deliberacao\.data_reuniao", ate\);/);
  });

  it("⚠️ e a chamada da contraprova passa `false` — com `true` ela mediria o mesmo zero", () => {
    const i = ROTA.indexOf("total === 0 && cabeContraprova(f)");
    expect(i, "o gate da contraprova desapareceu").toBeGreaterThan(-1);
    const bloco = ROTA.slice(i, i + 1800);
    expect((bloco.match(/, false,\n\s*\)/g) ?? []).length, "a contraprova voltou a aplicar a janela")
      .toBe(2);
  });

  it("só roda no caso ZERO, e nem no CSV nem na amostra", () => {
    expect(ROTA).toMatch(
      /if \(!querAmostra && f\.format !== "csv" && total === 0 && cabeContraprova\(f\)\) \{/,
    );
  });

  it("⚠️ falha de leitura NÃO vira contraprova de zeros — sem número, a tela não afirma nada", () => {
    // Mutação a matar: tirar o `!fora.error`. A rota publicaria `votos_fora_da_janela: 0` e o vazio
    // voltaria a dizer implicitamente "não existe" — agora com a autoridade de uma medição.
    expect(ROTA).toMatch(/if \(!fora\.error && \(fora\.count \?\? 0\) > 0\) \{/);
  });

  it("o TOTAL é exato (`count`) e a quebra por ano é declarada como piso quando bate no teto", () => {
    expect(ROTA).toMatch(/votos_fora_da_janela: fora\.count \?\? 0,/);
    expect(ROTA).toMatch(/anos_parciais: \(\(fora\.data \?\? \[\]\) as any\[\]\)\.length >= TETO_DA_CONTRAPROVA,/);
    expect(ROTA, "o teto virou literal solto — o nome é o que liga a leitura ao rótulo de piso")
      .toMatch(/const TETO_DA_CONTRAPROVA = \d+;/);
  });

  it("⚠️ `sem_data_de_reuniao` é contagem PRÓPRIA e exata, não tirada da amostra com teto", () => {
    /**
     * É o número mais consequente dos dois: essa população nunca aparece com ano selecionado, em
     * ano nenhum, porque `gte`/`lte` descartam NULL em silêncio. Tirá-la da leitura com teto daria
     * um piso apresentado como fato — e é justo a população que o contrato dos filtros diz ser "a
     * que mais precisa de auditoria".
     */
    expect(ROTA).toMatch(/const semData = await comFiltros\(/);
    expect(ROTA).toMatch(/\{ count: "exact", head: true \}/);
    expect(ROTA).toMatch(/\.is\("deliberacao\.data_reuniao", null\)/);
    expect(ROTA).toMatch(/sem_data_de_reuniao: semData\.error \? 0 : semData\.count \?\? 0,/);
  });

  it("e a contraprova é PUBLICADA — capacidade sem consumidor é o defeito recorrente da fase", () => {
    const i = ROTA.indexOf("return NextResponse.json({\n    linhas,");
    expect(i).toBeGreaterThan(-1);
    expect(ROTA.slice(i, i + 700)).toMatch(/\n    contraprova,/);
  });
});

describe("etapa181 · ⚠️ o filtro de ano deixa de esconder o acervo por default", () => {
  it("o ano nasce VAZIO", () => {
    expect(TELA_CODIGO).toMatch(/const \[ano, setAno\] = useState\(""\);/);
  });

  it("⚠️ e o default do relógio não pode voltar", () => {
    expect(TELA_CODIGO, "voltou o ano corrente pré-selecionado — é o que escondeu a 79ª ROP")
      .not.toMatch(/const \[ano, setAno\] = useState\(String\(new Date\(\)\.getFullYear\(\)\)\)/);
  });

  it("as telas irmãs seguem em «todos os anos» — a Auditoria voltou a convergir com elas", () => {
    for (const irma of [
      "src/app/dashboard/deliberacoes/page.tsx",
      "src/app/dashboard/360/page.tsx",
      "src/app/dashboard/governanca/page.tsx",
    ]) {
      /**
       * ⚠️ A âncora é o ESTADO DO ANO, não "algum useState vazio". A primeira versão desta
       * expectativa usava `/useState(<string>)?\(""\)/` solto, e essas telas têm meia dúzia de
       * estados de texto vazio — ela passaria com o ano pré-selecionado. É a mesma armadilha que
       * esta fase encontrou cinco vezes: procurar texto em vez de medir a propriedade.
       */
      expect(semComentarios(ler(irma)), `${irma} passou a pré-selecionar o ano`)
        .toMatch(/const \[year, setYear\]\s*(?::[^=]*)?=\s*useState(?:<string>)?\(""\)/);
    }
  });

  it("a opção «Todos os anos» continua existindo no seletor", () => {
    expect(TELA).toMatch(/<option value="">Todos os anos<\/option>/);
  });
});

describe("etapa181 · o vazio mostra o total, o recorte e a saída", () => {
  it("⚠️ o TOTAL aparece — ele não existia fora da paginação, que some com zero linhas", () => {
    /**
     * A contagem só saía em `{data.total} voto(s)`, dentro de um bloco condicionado a
     * `data.pages > 1`. Com `total = 0`, `pages = max(1, ceil(0/50)) = 1` → nada renderizava. Um
     * vazio sem total é indistinguível de um erro de carregamento.
     */
    expect(TELA).toMatch(/0 voto\(s\)<\/span> neste recorte/);
  });

  it("o recorte aplicado é montado dos filtros REAIS da tela", () => {
    expect(TELA_CODIGO).toMatch(/const recorteEmPalavras = \[/);
    // O ano entra como "todos os anos" quando vazio — o recorte nunca fica mudo sobre ele.
    expect(TELA_CODIGO).toMatch(/ano \|\| "todos os anos",/);
    expect(TELA_CODIGO).toMatch(/numeroReuniao\.trim\(\) \? `reunião \$\{numeroReuniao\.trim\(\)\}` : null,/);
    expect(TELA_CODIGO).toMatch(/\{recorteEmPalavras/);
  });

  it("a contraprova é renderizada com o número, os anos e o rótulo de piso", () => {
    expect(TELA).toMatch(/Existe fora deste recorte/);
    expect(TELA_CODIGO).toMatch(/\{contraprova\.votos_fora_da_janela\}/);
    expect(TELA_CODIGO).toMatch(/contraprova\.anos\.map\(\(a\) => `\$\{a\.ano\} \(\$\{a\.votos\}\)`\)/);
    expect(TELA_CODIGO).toMatch(/contraprova\.anos_parciais \? " — piso: a quebra por ano sai de uma leitura com teto" : ""/);
  });

  it("⚠️ e diz que deliberação sem data não aparece com ano NENHUM", () => {
    expect(TELA_CODIGO).toMatch(/\{contraprova\.sem_data_de_reuniao\}/);
    expect(TELA).toMatch(/não aparecem\s*\n?\s*com nenhum ano selecionado, em ano nenhum/);
  });

  it("há SAÍDA, não só diagnóstico: o botão limpa o ano", () => {
    // Um vazio que explica e não oferece a ação deixa o operador reconstruindo o filtro na mão.
    expect(TELA_CODIGO).toMatch(/onClick=\{\(\) => aoFiltrar\(setAno\)\(""\)\}/);
    expect(TELA).toMatch(/Ver todos os anos/);
  });

  it("⚠️ a contraprova vem ANTES da hipótese de mandato, e esta deixou de ser a única", () => {
    // Antes, a única causa oferecida era o mandato — e só quando havia diretor selecionado. O ramo
    // que o usuário atingiu (sem diretor) não dizia nada.
    const i = TELA_CODIGO.indexOf("Existe fora deste recorte");
    const j = TELA_CODIGO.indexOf("pode ser o mandato: confira em Mandatos");
    expect(i).toBeGreaterThan(-1);
    expect(j).toBeGreaterThan(i);
  });
});
