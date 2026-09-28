/**
 * Etapa 212 (Fase 35, Bloco I) — as duas pendências que sobraram da landing.
 *
 * ═══ I.1 · A seção de PRODUTOS, com DOIS e não cinco ═══
 * Na Fase 33 eu prometi cinco (Painéis Temáticos, Missão Internacional, Pós em ESG e PPPs, Plataforma
 * IRIS, Monitoramento das 12). Recebi só as páginas 12 a 22 do deck, e três deles NÃO estão nelas.
 * Publicar os cinco seria inventar descrição de produto que a instituição vende — e uma landing que
 * descreve errado o que o cliente compra é pior que uma landing curta.
 *
 * ═══ I.2 · O fundo de "Quem somos" ═══
 * O componente dizia, no próprio código: *"enquanto as fotos dos eventos não chegam, esta é a opção
 * honesta… quando chegarem, a troca é mudar esta lista — o componente não muda."* Chegaram. O
 * componente não mudou.
 */

import { describe, it, expect } from "vitest";
import { existsSync, readFileSync } from "fs";
import { join } from "path";
import { PRODUTOS, EVENTOS_REALIZADOS } from "@/lib/landing-content";

const RAIZ = join(__dirname, "../../../..");
const ler = (p: string) => readFileSync(join(RAIZ, p), "utf-8");
const semComentarios = (t: string) =>
  t.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/\/\/[^\n]*/g, " ").replace(/\{\/\*[\s\S]*?\*\/\}/g, " ");

describe("etapa212 · os produtos: só o que o deck documenta", () => {
  it("são DOIS — e a contagem é a afirmação", () => {
    expect(PRODUTOS.length, "um terceiro produto só entra com a página do deck que o descreve").toBe(2);
  });

  it("os dois são os das páginas que eu tenho", () => {
    expect(PRODUTOS.map((p) => p.titulo)).toEqual([
      "Acesso aos Painéis Temáticos",
      "Organização de Missão Internacional",
    ]);
  });

  it("⚠️ e os TRÊS que eu prometi e não tenho NÃO aparecem", () => {
    const tudo = JSON.stringify(PRODUTOS);
    for (const naoPrometido of ["Pós em ESG", "PPPs", "Plataforma IRIS", "Monitoramento das 12"]) {
      expect(tudo, `«${naoPrometido}» voltou sem a página do deck que o descreve`)
        .not.toContain(naoPrometido);
    }
  });

  it("a missão traz os números do deck, não arredondamentos meus", () => {
    const missao = PRODUTOS.find((p) => p.titulo.includes("Missão"))!;
    expect(missao.chamada).toContain("4 cidades");
    expect(missao.chamada).toContain("4.000 km");
    expect(missao.chamada).toContain("08 a 19 de junho");
    const itens = missao.itens.join(" ");
    expect(itens).toContain("VALE");
    expect(itens).toContain("FiberHome");
    expect(itens).toContain("ITMC");
    expect(itens).toContain("Star Energy");
    expect(itens).toContain("Embaixada");
    expect(itens).toContain("BESS");
  });

  it("⚠️ SEM PREÇO — decisão do usuário; o selo diz o que o deck traz", () => {
    const tudo = JSON.stringify(PRODUTOS);
    expect(tudo, "preço em landing foi explicitamente recusado").not.toMatch(/R\$|\bpre[çc]o\b|\bmensalidade\b/i);
    expect(PRODUTOS.every((p) => p.exclusivoParaAssociados)).toBe(true);
    expect(semComentarios(ler("src/components/landing/LpProdutos.tsx")))
      .toMatch(/Exclusivo para associados/);
  });

  it("⚠️ cada foto de produto EXISTE — e nenhuma foto nova foi inventada", () => {
    const daLista = new Set(EVENTOS_REALIZADOS.map((e) => e.foto));
    for (const p of PRODUTOS) {
      expect(existsSync(join(RAIZ, "public/eventos", p.foto)), `${p.foto} não existe em public/eventos`)
        .toBe(true);
      expect(daLista, `${p.foto} não é uma das fotos de evento que o usuário mandou`).toContain(p.foto);
    }
  });
});

describe("etapa212 · a seção está montada e alcançável", () => {
  const PAGE = semComentarios(ler("src/app/page.tsx"));
  const HEADER = semComentarios(ler("src/components/landing/LpHeader.tsx"));
  const COMP = semComentarios(ler("src/components/landing/LpProdutos.tsx"));

  it("a página monta `LpProdutos`", () => {
    expect(PAGE).toMatch(/<LpProdutos \/>/);
    expect(PAGE).toMatch(/import \{ LpProdutos \}/);
  });

  it("⚠️ o menu tem o link, e na MESMA ordem do scroll", () => {
    expect(HEADER).toMatch(/href: "#produtos"/);
    // Um menu que discorda da ordem da página faz o leitor achar que clicou errado.
    const iFazemos = HEADER.indexOf('"#o-que-fazemos"');
    const iProdutos = HEADER.indexOf('"#produtos"');
    const iQuemSomos = HEADER.indexOf('"#quem-somos"');
    expect(iFazemos).toBeLessThan(iProdutos);
    expect(iProdutos).toBeLessThan(iQuemSomos);
    const pFazemos = PAGE.indexOf("<LpOQueFazemos />");
    const pProdutos = PAGE.indexOf("<LpProdutos />");
    const pQuemSomos = PAGE.indexOf("<LpQuemSomos />");
    expect(pFazemos).toBeLessThan(pProdutos);
    expect(pProdutos).toBeLessThan(pQuemSomos);
  });

  it("a âncora do menu casa o `id` da seção", () => {
    expect(COMP).toMatch(/id="produtos"/);
  });

  it("⚠️ o dourado sobre PAPEL é o escurecido — a mesma escolha do LpEventos", () => {
    /**
     * `--lp-gold` (#c2a24a) sobre `--lp-paper` (#f4f1ea) fica em ~2,5:1. `#8a6d1f` é o valor que o
     * `LpEventos` já usa para o mesmo caso, e reusá-lo evita dois dourados de papel na mesma página.
     */
    expect(COMP).toMatch(/#8a6d1f/);
    expect(COMP, "o dourado claro sobre papel não passa de contraste").not.toMatch(/var\(--lp-gold\)/);
    expect(semComentarios(ler("src/components/landing/LpEventos.tsx")), "a referência mudou de valor")
      .toMatch(/#8a6d1f/);
  });

  it("e usa só tokens que EXISTEM", () => {
    const CSS = ler("src/app/globals.css");
    for (const token of [...COMP.matchAll(/var\((--lp-[a-z0-9-]+)\)/g)].map((m) => m[1])) {
      expect(CSS, `o token ${token} não existe em globals.css`).toContain(`${token}:`);
    }
    // E as duas classes novas foram definidas.
    expect(CSS).toMatch(/\.lp-produto \{/);
    expect(CSS).toMatch(/\.lp-selo \{/);
  });
});

describe("etapa212 · o fundo de «Quem somos» passou às fotos dos EVENTOS", () => {
  const COMP = semComentarios(ler("src/components/landing/LpQuemSomos.tsx"));

  it("não usa mais as fotos setoriais da Hero", () => {
    expect(COMP, "as fotos dos eventos chegaram; o `/hero/` era a opção provisória")
      .not.toMatch(/\/hero\//);
    expect(COMP).toMatch(/\/eventos\/\$\{foto\}\.jpg/);
  });

  it("⚠️ as QUATRO do mosaico existem, e são fotos que o usuário mandou", () => {
    const daLista = new Set(EVENTOS_REALIZADOS.map((e) => e.foto));
    const nomes = [...COMP.matchAll(/^\s*"([a-z0-9-]+)",$/gm)].map((m) => m[1]);
    expect(nomes.length, "o mosaico tem quatro colunas").toBe(4);
    for (const nome of nomes) {
      expect(existsSync(join(RAIZ, "public/eventos", `${nome}.jpg`)), `${nome}.jpg não existe`).toBe(true);
      expect(daLista, `${nome}.jpg não está entre as fotos de evento`).toContain(`${nome}.jpg`);
    }
  });

  it("o scrim continua lá — há PARÁGRAFO para ler sobre a imagem", () => {
    expect(COMP).toMatch(/linear-gradient\(180deg, rgba\(10,14,42,0\.86\), rgba\(10,14,42,0\.93\)\)/);
  });
});
