/**
 * Etapa 213 (Fase 35) — os DOIS defeitos que escaparam para produção, e os dois falham só em EXECUÇÃO.
 *
 * ═══ ① A tela de Notícias caiu com `Cannot access 'tF' before initialization` ═══
 * Eu declarei `const NEWSLETTER_TITULO_LIMITE = 300` **dentro do componente**, ~130 linhas ABAIXO do
 * `useMemo` que a usa. `const` não é içado, e o callback do `useMemo` executa DURANTE o render — antes
 * de a linha da declaração rodar. O React derrubou a tela inteira (`tF` é o nome minificado).
 *
 * ⚠️ NADA disso foi pego pelo ritual: `tsc --noEmit` passa (TDZ é erro de execução, não de tipo),
 * 3150 testes passam, `next build` passa, `next lint` passa. Medi: reintroduzindo o defeito, o
 * `type-check` continua devolvendo 0. As expectativas que escrevi para essa tela varrem o TEXTO do
 * arquivo — e o texto estava certo; o que estava errado era a ORDEM.
 *
 * ═══ ② A migration falhou com `relation "_iris_serie_evidencia" does not exist` ═══
 * Ela montava uma TEMP TABLE numa instrução e a consumia nas seguintes.
 *
 * ⚠️ E eu NÃO sei dizer por que falhou: a `20260821130000_limpeza_residual_anm` usa a MESMA forma e
 * foi aplicada com sucesso — a explicação fácil ("o editor não mantém a sessão") é refutada pelo
 * próprio repositório. A v2 não aposta em causa: REMOVE A DEPENDÊNCIA, com a evidência num CTE dentro
 * de cada `UPDATE`. É a mesma saída que a Fase 24b encontrou para o `iris_seed_director`.
 */

import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "fs";
import { join } from "path";

const RAIZ = join(__dirname, "../../../..");
const ler = (p: string) => readFileSync(join(RAIZ, p), "utf-8");
/**
 * ⚠️ QUARTA vez nesta fase que eu tropeço no mesmo lugar: a expectativa negativa achava
 * `CREATE TEMP TABLE` dentro do CABEÇALHO que explica por que a v2 não usa um. Um scanner que lê
 * comentário mede a prosa, não o programa — e em SQL o comentário vai de `--` até o fim da linha.
 */
const semComentariosSql = (t: string) => t.replace(/--[^\n]*/g, " ");

/**
 * Apaga comentários e literais de string/template PRESERVANDO o comprimento — os deslocamentos
 * continuam válidos, e por isso as linhas reportadas são as reais.
 *
 * ⚠️ Mascarar string não é capricho: a primeira versão deste scanner deu CINCO falsos positivos, todos
 * porque `"deliberacoes-heatmap"` e `["boletim", "schedules"]` casam `\bnome\b` dentro de literal.
 */
function mascarar(src: string): string {
  const out = src.split("");
  const apagar = (a: number, b: number) => {
    for (let k = a; k < b && k < out.length; k += 1) if (out[k] !== "\n") out[k] = " ";
  };
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    const d = src[i + 1];
    if (c === "/" && d === "*") {
      const f = src.indexOf("*/", i + 2);
      const fim = f < 0 ? src.length : f + 2;
      apagar(i, fim); i = fim; continue;
    }
    if (c === "/" && d === "/") {
      const f = src.indexOf("\n", i);
      const fim = f < 0 ? src.length : f;
      apagar(i, fim); i = fim; continue;
    }
    if (c === '"' || c === "'" || c === "`") {
      let k = i + 1;
      while (k < src.length) {
        if (src[k] === "\\") { k += 2; continue; }
        if (src[k] === c) break;
        k += 1;
      }
      apagar(i, Math.min(k + 1, src.length)); i = k + 1; continue;
    }
    i += 1;
  }
  return out.join("");
}

function fimDoParen(s: string, abre: number): number {
  let p = 0;
  for (let k = abre; k < s.length; k += 1) {
    if (s[k] === "(") p += 1;
    else if (s[k] === ")") { p -= 1; if (p === 0) return k; }
  }
  return s.length;
}

export interface RiscoTDZ {
  nome: string;
  usoLinha: number;
  declLinha: number;
}

/**
 * `const` do corpo de componente REFERENCIADO por uma região que executa durante o render
 * (`useMemo` / inicializador de `useState`) declarada ANTES dela.
 *
 * ⚠️ `useEffect` e `useCallback` ficam de fora de propósito: os dois só executam DEPOIS do render, e
 * até lá a declaração já rodou. Incluí-los transformaria o teste num gerador de ruído.
 */
export function riscosTDZ(src: string): RiscoTDZ[] {
  const s = mascarar(src);
  const linhaDe = (off: number) => s.slice(0, off).split("\n").length;

  /**
   * ⚠️ A PRIMEIRA declaração de cada nome. O mesmo identificador pode ser declarado em várias funções
   * do arquivo (os helpers abaixo do componente também têm 2 espaços de indentação); usar a ÚLTIMA
   * fazia `selected` — declarado na 501 e redeclarado noutra função na 1994 — parecer TDZ.
   */
  const primeira = new Map<string, number>();
  for (const m of s.matchAll(/^ {2}const ([A-Za-z_$][\w$]*)\s*[:=]/gm)) {
    if (!primeira.has(m[1])) primeira.set(m[1], m.index ?? 0);
  }

  const regioes: Array<[number, number]> = [];
  for (const m of s.matchAll(/\buse(?:Memo|State)\s*\(/g)) {
    const abre = (m.index ?? 0) + m[0].length - 1;
    regioes.push([abre, fimDoParen(s, abre)]);
  }

  const achados: RiscoTDZ[] = [];
  for (const [nome, off] of primeira) {
    for (const [a, b] of regioes) {
      if (b >= off) continue; // a região termina DEPOIS da declaração: sem risco
      if (!new RegExp(`\\b${nome}\\b`).test(s.slice(a, b))) continue;
      achados.push({ nome, usoLinha: linhaDe(a), declLinha: linhaDe(off) });
      break;
    }
  }
  return achados;
}

function varrerTsx(dir: string, out: string[] = []): string[] {
  for (const nome of readdirSync(join(RAIZ, dir))) {
    const rel = `${dir}/${nome}`;
    if (statSync(join(RAIZ, rel)).isDirectory()) { if (nome !== "__tests__") varrerTsx(rel, out); }
    else if (/\.tsx?$/.test(nome)) out.push(rel);
  }
  return out;
}

describe("etapa213 · ⚠️ nenhum `const` de componente é usado antes de existir", () => {
  const ARQUIVOS = varrerTsx("src/app").concat(varrerTsx("src/components"));

  it("a varredura acha arquivos (o teste não pode passar por não achar nada)", () => {
    expect(ARQUIVOS.length, "a varredura quebrou").toBeGreaterThan(40);
  });

  it("⚠️ NENHUM risco de TDZ em src/app e src/components", () => {
    const riscos = ARQUIVOS.flatMap((rel) =>
      riscosTDZ(ler(rel)).map((r) => `${rel}: «${r.nome}» usado na linha ${r.usoLinha}, declarado na ${r.declLinha}`),
    ).sort();
    expect(
      riscos,
      "`const` do corpo do componente usado dentro de um useMemo/useState que vem ANTES dele. " +
        "Isso derruba a tela em produção com «Cannot access 'X' before initialization», e o tsc NÃO vê. " +
        "Conserto: mover a constante para o escopo do MÓDULO (se for literal) ou a declaração para antes do uso.",
    ).toEqual([]);
  });

  it("⚠️ e o scanner PEGA o defeito real — provado contra o código que quebrou a produção", () => {
    /**
     * Sem este caso, um scanner que sempre devolve `[]` passaria para sempre. O trecho abaixo é a
     * forma exata do que foi para produção: `useMemo` na frente, `const` do corpo lá embaixo.
     */
    const comDefeito = `
export default function Tela() {
  const overrides = useMemo(() => {
    return valor.slice(0, LIMITE);
  }, [valor]);

  const LIMITE = 300;

  return <div>{overrides}</div>;
}`;
    const achados = riscosTDZ(comDefeito);
    expect(achados.map((a) => a.nome)).toEqual(["LIMITE"]);
  });

  it("e NÃO acusa o caso legítimo: declaração ANTES do uso", () => {
    const certo = `
export default function Tela() {
  const LIMITE = 300;
  const overrides = useMemo(() => valor.slice(0, LIMITE), [valor]);
  return <div>{overrides}</div>;
}`;
    expect(riscosTDZ(certo)).toEqual([]);
  });

  it("nem o `useEffect`/`useCallback`, que rodam DEPOIS do render", () => {
    // Incluí-los faria o teste acusar padrão correto e viraria ruído que ninguém lê.
    const certo = `
export default function Tela() {
  useEffect(() => { console.log(LIMITE); }, []);
  const aoClicar = useCallback(() => LIMITE + 1, []);
  const LIMITE = 300;
  return <div onClick={aoClicar} />;
}`;
    expect(riscosTDZ(certo)).toEqual([]);
  });

  it("⚠️ nem o nome que só aparece dentro de STRING — foram 5 falsos positivos assim", () => {
    const certo = `
export default function Tela() {
  const { data } = useQuery({ queryKey: ["boletim", "schedules"], queryFn: f });
  const schedules = data?.schedules ?? [];
  return <div>{schedules.length}</div>;
}`;
    expect(riscosTDZ(certo)).toEqual([]);
  });
});

describe("etapa213 · a migration v2 não depende de nada que outra instrução deixou", () => {
  const V1 = "supabase/migrations/20260928120000_reunioes_serie_rederivar.sql";
  const V2 = "supabase/migrations/20260928140000_reunioes_serie_rederivar_v2.sql";

  it("a v1 está marcada como NÃO RODAR, com o erro real escrito", () => {
    const s = ler(V1);
    expect(s.slice(0, 900)).toMatch(/NÃO RODAR/);
    expect(s).toMatch(/_iris_serie_evidencia" does not exist/);
    expect(s, "tem de apontar a substituta pelo nome").toMatch(/20260928140000_reunioes_serie_rederivar_v2/);
  });

  it("⚠️ e ela ADMITE que a causa não foi determinada — em vez de inventar um diagnóstico", () => {
    /**
     * A `20260821130000` usa a MESMA forma e foi aplicada com sucesso. Escrever "o editor não mantém a
     * sessão" seria palpite com cara de explicação, e a próxima pessoa confiaria nele.
     */
    const s = ler(V1);
    expect(s).toMatch(/20260821130000/);
    expect(s).toMatch(/NÃO sei|não sei/);
  });

  it("a v2 NÃO cria tabela temporária — a dependência foi removida, não diagnosticada", () => {
    const s = semComentariosSql(ler(V2));
    expect(s, "voltar a depender de objeto criado por outra instrução é o defeito").not.toMatch(
      /CREATE\s+(?:TEMP|TEMPORARY)\s+TABLE/i,
    );
    expect(s, "nem a tabela antiga pelo nome").not.toMatch(/_iris_serie_evidencia/);
  });

  it("⚠️ cada UPDATE carrega sua PRÓPRIA evidência num CTE", () => {
    const s = ler(V2);
    const updates = (s.match(/^UPDATE public\.reunioes r$/gm) ?? []).length;
    const ctes = (s.match(/^WITH titulo_da_delib AS \($/gm) ?? []).length;
    expect(updates, "a v2 deveria ter os dois UPDATEs da v1").toBe(2);
    expect(ctes, "cada UPDATE precisa do seu CTE — repetir é o preço de não depender de estado").toBe(updates);
  });

  it("e a lógica da v1 foi preservada: alvo estreito, guarda de colisão, padrões curtos", () => {
    const s = ler(V2);
    expect(s).toMatch(/e\.serie_atual = 'ordinaria'/);
    expect(s).toMatch(/e\.serie_da_evidencia <> 'ordinaria'/);
    const guardas = (s.match(/NOT EXISTS \(\s*SELECT 1 FROM public\.reunioes irma/g) ?? []).length;
    expect(guardas, "os DOIS updates precisam da guarda contra o índice único").toBe(2);
    expect(s).toMatch(/ILIKE '%eletr%'/);
    expect(s).toMatch(/MAX\(d\.reuniao_ordinaria\)/);
  });

  it("⚠️ o segundo UPDATE não grava 'ordinaria' em título irreconhecível", () => {
    /**
     * `deriveSerie` devolve NULL sem marcador, de propósito — "presumir 'ordinaria' juntaria séries
     * distintas na mesma chave", diz o docblock de `reunioes.ts`. Gravar 'ordinaria' ali recriaria
     * exatamente o defeito que esta migration existe para desfazer.
     */
    const s = ler(V2);
    expect(s).toMatch(/e\.titulo_usado ILIKE '%reuni%'/);
  });

  it("é transacional e recarrega o schema", () => {
    const s = ler(V2);
    expect(s).toMatch(/^BEGIN;$/m);
    expect(s).toMatch(/^COMMIT;$/m);
    expect(s).toMatch(/NOTIFY pgrst, 'reload schema'/);
  });
});
