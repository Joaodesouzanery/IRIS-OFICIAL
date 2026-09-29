/**
 * Etapa 214 (Fase 35) — editar o título não mudava nada na tela, e o lint tinha AVISADO.
 *
 * ═══ O defeito ═══
 * O `useMemo` de `documentInput` — que alimenta a pré-visualização E o PDF — não listava
 * `newsletterTitleOverrides` nas dependências. O usuário digitava o título, o estado mudava, o memo do
 * MAPA recalculava, e `documentInput` **não**: a tela seguia com o valor da primeira renderização (o
 * mapa vazio). Editar o título era um campo que não fazia nada.
 *
 * ═══ ⚠️ E o que dói: a ferramenta DISSE, por escrito ═══
 *     547:7  Warning: React Hook useMemo has a missing dependency: 'newsletterTitleOverrides'.
 *
 * `next lint` sai com código **0** em warning, e o meu ritual olha o código de saída. Declarei "lint=0,
 * verde" com a resposta na tela. É a terceira vez nesta fase que o ritual passa e o produto está
 * quebrado — depois do TDZ e do SQL, que ao menos o ritual não tinha como ver. Este ele VIU.
 *
 * Dependência faltando num memo que alimenta o que a tela mostra não é estilo: é resultado errado.
 * Por isso a regra virou `error`, e este arquivo guarda a configuração — o lint não pode vigiar a
 * própria configuração.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";

const RAIZ = join(__dirname, "../../../..");
const ler = (p: string) => readFileSync(join(RAIZ, p), "utf-8");
const semComentarios = (t: string) =>
  t.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/\/\/[^\n]*/g, " ");

describe("etapa214 · ⚠️ `exhaustive-deps` é ERRO, não aviso", () => {
  it("a regra está em `error` no eslintrc", () => {
    const conf = JSON.parse(ler(".eslintrc.json")) as { rules?: Record<string, unknown> };
    expect(
      conf.rules?.["react-hooks/exhaustive-deps"],
      "em `warn`, `next lint` sai com código 0 e o ritual declara verde com o produto quebrado",
    ).toBe("error");
  });

  it("e o `next/core-web-vitals` continua estendido — a regra ACRESCENTA, não substitui", () => {
    const conf = JSON.parse(ler(".eslintrc.json")) as { extends?: string[] };
    expect(conf.extends).toContain("next/core-web-vitals");
  });
});

describe("etapa214 · o memo que alimenta a tela conhece TODOS os overrides", () => {
  const PAGINA = semComentarios(ler("src/app/dashboard/noticias/page.tsx"));

  /** O array de dependências do `useMemo` de `documentInput`. */
  function depsDoDocumentInput(): string[] {
    const i = PAGINA.indexOf("const documentInput = useMemo(");
    expect(i, "o memo do documentInput desapareceu").toBeGreaterThan(-1);
    const resto = PAGINA.slice(i);
    const m = resto.match(/\}\)\s*,\s*\[([^\]]*)\]\s*\)/);
    expect(m, "não achei o array de dependências do documentInput").not.toBeNull();
    return (m?.[1] ?? "").split(",").map((d) => d.trim()).filter(Boolean);
  }

  it("⚠️ `newsletterTitleOverrides` está nas dependências — era ele que faltava", () => {
    expect(depsDoDocumentInput()).toContain("newsletterTitleOverrides");
  });

  it("e `newsletterTextOverrides` e `newsletterImagens` também — os três overrides da mesma tela", () => {
    /**
     * Os três entram em `documentInput` e mudam o que a tela mostra. Cobrir só o que quebrou hoje
     * deixaria os irmãos expostos ao mesmo defeito — e o de imagem já tinha sido quebrado uma vez,
     * por não entrar na entrada do documento no servidor.
     */
    const deps = depsDoDocumentInput();
    for (const dep of ["newsletterTextOverrides", "newsletterTitleOverrides", "newsletterImagens"]) {
      expect(deps, `«${dep}» fora das dependências: a tela congela no primeiro valor`).toContain(dep);
    }
  });

  it("⚠️ TODO override usado no corpo do memo está nas dependências", () => {
    // A propriedade geral, não a lista: qualquer `newsletter*Overrides` novo entra automaticamente.
    const i = PAGINA.indexOf("const documentInput = useMemo(");
    const corpo = PAGINA.slice(i, PAGINA.indexOf("}), [", i));
    const usados = [...new Set([...corpo.matchAll(/\b(newsletter[A-Za-z]*(?:Overrides|Imagens))\b/g)].map((m) => m[1]))];
    expect(usados.length, "a extração dos overrides usados quebrou").toBeGreaterThanOrEqual(2);
    const deps = depsDoDocumentInput();
    expect(usados.filter((u) => !deps.includes(u)), "override usado e não declarado").toEqual([]);
  });

  it("a pré-visualização e o PDF saem DESSE memo — é por isso que ele é o ponto crítico", () => {
    expect(PAGINA).toMatch(/buildRegulatoryNewsletterHtml\(documentInput, "email"\)/);
    expect(PAGINA).toMatch(/buildRegulatoryNewsletterHtml\(documentInput, "print"\)/);
    expect(PAGINA, "o iframe mostra um dos dois").toMatch(/srcDoc=\{documentConfig\.formato === "pdf" \? documentHtml : html\}/);
  });
});

describe("etapa214 · o array estável que fazia a dependência ser decorativa", () => {
  it("⚠️ `deliberacoes` vem de `useMemo`, não de `?? []` solto", () => {
    /**
     * `deliberacoesPag?.data ?? []` cria um ARRAY NOVO a cada render. Os memos que dependem dele
     * recalculavam sempre — a lista de dependências deles não significava nada. Foram esses quatro
     * avisos que impediam promover a regra a erro.
     */
    for (const p of ["src/app/dashboard/analytics/diretores/page.tsx", "src/app/dashboard/governanca/page.tsx"]) {
      const fonte = semComentarios(ler(p));
      expect(fonte, `${p}: array instável volta a tornar as dependências decorativas`)
        .not.toMatch(/const deliberacoes: Deliberacao\[\] = deliberacoesPag\?\.data \?\? \[\];/);
      expect(fonte).toMatch(/const deliberacoes: Deliberacao\[\] = useMemo\(/);
    }
  });
});
