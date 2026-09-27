/**
 * Etapa 194 (Fase 33, Bloco E) — o menu ilegível, a esteira das 12 e o Radar reescrito.
 *
 * ═══ ⚠️ O MENU: a causa foi MEDIDA e não era a que eu supus ═══
 * O usuário disse que o menu está "escuro, difícil de ler". Minha hipótese: o scrim da Hero é mais
 * fraco à direita, onde o menu mora. **Errado, e de um jeito que dava para conferir em cinco
 * segundos.** Os links usavam `text-white/72`, e a escala de opacidade do Tailwind 3 anda de 5 em 5:
 * `72` não está nela, e valor arbitrário exige colchetes (`text-white/[0.72]`).
 *
 * Conferido no CSS CONSTRUÍDO, não no fonte: `text-white\/45`, `\/50`, `\/55` e `\/60` existem no
 * bundle; `\/72` não existe. A classe não gerava regra nenhuma, então o link herdava a cor de texto
 * do `body` do app, que é escura. Texto escuro sobre navy escuro, e nenhuma revisão de código
 * pegaria isso, porque a linha parece certa.
 *
 * ⚠️ Décima vez nesta série que eu olhei o fonte e não o resultado. A lição é a mesma da Fase 32,
 * quando dois defeitos visuais só apareceram ao RENDERIZAR e OLHAR a página.
 */

import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "fs";
import { join } from "path";
import {
  ETAPAS_DO_RADAR, BENEFICIOS_DO_RADAR, METODO_DO_RADAR, O_QUE_FAZEMOS, QUEM_SOMOS,
} from "@/lib/landing-content";
import { AGENCIAS_FEDERAIS } from "@/lib/agencias-federais";

const RAIZ = join(__dirname, "../../../..");
const ler = (p: string) => readFileSync(join(RAIZ, p), "utf-8");
const semComentarios = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/\/\/[^\n]*/g, " ");

const CSS = ler("src/app/globals.css");
const HEADER = semComentarios(ler("src/components/landing/LpHeader.tsx"));
const AGENCIAS = semComentarios(ler("src/components/landing/LpAgencias.tsx"));
const RADAR = semComentarios(ler("src/components/landing/LpRadar.tsx"));

describe("etapa194 · ⚠️ o menu: nenhuma opacidade fora da escala do Tailwind", () => {
  it("⚠️ NENHUM componente da landing usa opacidade que o Tailwind não gera", () => {
    /**
     * A regra: com a sintaxe de barra e número cru, só múltiplos de 5 viram regra. Qualquer outro
     * valor precisa de colchetes. Esta expectativa varre o diretório inteiro, então o defeito não
     * pode reaparecer em outro componente — que é exatamente como ele chegou aqui.
     */
    /**
     * ⚠️ E o varredor lê o fonte SEM COMENTÁRIO. A primeira versão leu o arquivo cru e acusou o
     * `text-white/72` que está no MEU docblock explicando o defeito. É a terceira vez nesta série
     * que um teste meu flagra a própria explicação do bug como se fosse o bug.
     */
    const dir = join(RAIZ, "src/components/landing");
    const infracoes: string[] = [];
    for (const arq of readdirSync(dir)) {
      const fonte = semComentarios(ler(`src/components/landing/${arq}`));
      for (const m of fonte.matchAll(/\b(?:text|bg|border|from|to|via)-[a-z]+(?:-\d{2,3})?\/(\d{1,3})\b/g)) {
        if (Number(m[1]) % 5 !== 0) infracoes.push(`${arq}: ${m[0]}`);
      }
    }
    expect(infracoes, `opacidade fora da escala (não gera CSS):\n${infracoes.join("\n")}`).toEqual([]);
  });

  it("os links do menu têm cor PRÓPRIA em CSS, e não dependem de classe utilitária", () => {
    expect(HEADER).toMatch(/className="lp-nav-link text-sm"/);
    expect(CSS).toMatch(/\.lp-nav-link \{[\s\S]*?color: rgba\(255, 255, 255, 0\.9\);/);
    expect(HEADER, "voltou a opacidade que não gera regra").not.toMatch(/text-white\/72/);
  });

  it("⚠️ e o cabeçalho tem FAIXA própria — o contraste não pode depender de qual imagem está passando", () => {
    // A Hero troca de imagem a cada 5s. Um fundo que varia é um contraste que varia.
    expect(HEADER).toMatch(/<div className="lp-header-faixa" aria-hidden \/>/);
    expect(CSS).toMatch(/\.lp-header-faixa \{[\s\S]*?background: linear-gradient\(180deg, rgba\(10, 14, 42, 0\.82\)/);
    // ⚠️ `pointer-events: none`: a faixa cobre a largura toda e engoliria o clique do menu.
    expect(CSS).toMatch(/\.lp-header-faixa \{[\s\S]*?pointer-events: none;/);
  });

  it("o foco de teclado tem sublinhado dourado, além do outline herdado", () => {
    expect(CSS).toMatch(/\.lp-nav-link:focus-visible \{[\s\S]*?border-bottom-color: var\(--lp-gold\);/);
  });
});

describe("etapa194 · a esteira das 12 agências", () => {
  it("é UMA linha, sem card — o pedido do usuário", () => {
    expect(AGENCIAS).toMatch(/style=\{\{ background: "var\(--lp-paper\)" \}\}/);
    expect(CSS).toMatch(/\.lp-esteira \{[\s\S]*?overflow: hidden;/);
    expect(CSS).toMatch(/\.lp-esteira-trilha \{[\s\S]*?display: flex;/);
    // Sem grade: a versão anterior era `grid-cols-4` com cartão branco por agência.
    expect(AGENCIAS, "a grade de cartões voltou").not.toMatch(/grid-cols-|bg-white/);
  });

  it("⚠️ a trilha é DUPLICADA e a cópia não existe para o Tab nem para o leitor de tela", () => {
    /**
     * Duplicar é truque visual (é o que faz o laço não ter costura), e truque visual não pode virar
     * conteúdo: sem estes dois atributos, o Tab percorreria 24 links para 12 agências e o leitor de
     * tela anunciaria cada nome duas vezes.
     */
    expect(AGENCIAS).toMatch(/<Trilha \/>\s*<Trilha espelho \/>/);
    expect(AGENCIAS).toMatch(/\{\.\.\.\(espelho \? \{ "aria-hidden": true \} : \{\}\)\}/);
    expect(AGENCIAS).toMatch(/espelho \? \{ tabIndex: -1 \}/);
  });

  it("⚠️ o laço desloca -50% — é a metade que a trilha duplicada exige", () => {
    // Com 100% a emenda apareceria no meio do ciclo; com -50% ela cai onde a segunda cópia começa.
    expect(CSS).toMatch(/@keyframes lpEsteira \{[\s\S]*?to\s*\{ transform: translateX\(-50%\); \}/);
  });

  it("⚠️ pausa no HOVER e no FOCO — quem chega por Tab precisa que a logo pare de fugir", () => {
    expect(CSS).toMatch(/\.lp-esteira:hover \.lp-esteira-trilha,\s*\n\s*\.lp-esteira:focus-within \.lp-esteira-trilha \{ animation-play-state: paused; \}/);
  });

  it("⚠️ `prefers-reduced-motion` CONGELA e devolve o controle, em vez de desacelerar", () => {
    const i = CSS.lastIndexOf("@media (prefers-reduced-motion: reduce)");
    const bloco = CSS.slice(i, i + 400);
    expect(bloco).toMatch(/\.lp-esteira-trilha \{ animation: none; \}/);
    // Congelar sem dar rolagem esconderia 8 das 12 logos; o snap evita a logo meio cortada.
    expect(bloco).toMatch(/overflow-x: auto/);
    expect(bloco).toMatch(/scroll-snap-align: center/);
  });

  it("⚠️ e este bloco vem DEPOIS do da Hero — o teste da Hero fatia a partir do PRIMEIRO", () => {
    /**
     * `etapa188` faz `CSS.slice(i, i + 260)` a partir do primeiro `@media (prefers-reduced-motion)`.
     * Entrar antes do bloco da Hero faria aquele teste medir o bloco errado e passar por engano.
     */
    const primeiro = CSS.indexOf("@media (prefers-reduced-motion: reduce)");
    const ultimo = CSS.lastIndexOf("@media (prefers-reduced-motion: reduce)");
    expect(ultimo).toBeGreaterThan(primeiro);
    expect(CSS.slice(primeiro, primeiro + 300)).toMatch(/\.lp-hero-img/);
  });

  it("⚠️⚠️ o FUNDO sai da medição dos PNGs, e a exceção é derivada dela", () => {
    /**
     * Eu afirmei NAVY "por medição" e RENDERIZAR desmentiu: seis logos quase sumiam. A medição de
     * verdade (luminância mediana dos pixels opacos) está em `public/agencias/CONTRASTE.json`:
     * sobre navy, 6 de 12 abaixo de 3:1 (ANPD a 1,11:1); sobre papel, 1 de 12 (ANATEL a 1,19:1). E
     * não existe fundo que sirva para as doze: o melhor neutro possível ainda deixa 6 abaixo.
     */
    const medicao = JSON.parse(ler("public/agencias/CONTRASTE.json")) as {
      _limite_wcag: number;
      logos: Record<string, { contraste_no_papel: number; contraste_no_navy: number }>;
    };
    // A medição cobre as 12 — uma logo sem medição seria uma logo sem tratamento decidido.
    expect(Object.keys(medicao.logos).sort()).toEqual(AGENCIAS_FEDERAIS.map((a) => a.sigla).sort());
    expect(medicao._limite_wcag).toBe(3);

    const somemNoPapel = Object.entries(medicao.logos)
      .filter(([, v]) => v.contraste_no_papel < medicao._limite_wcag).map(([k]) => k);
    const somemNoNavy = Object.entries(medicao.logos)
      .filter(([, v]) => v.contraste_no_navy < medicao._limite_wcag).map(([k]) => k);
    // ⚠️ É ISTO que justifica a escolha. Se um dia o papel errar mais que o navy, o fundo tem de mudar.
    expect(somemNoPapel.length, "o papel deixou de ser o fundo que erra menos")
      .toBeLessThan(somemNoNavy.length);

    // E o componente DERIVA a exceção do arquivo, em vez de carregar um nome escrito à mão.
    expect(AGENCIAS).toMatch(/CONTRASTE\.json/);
    expect(AGENCIAS).toMatch(/c < CONTRASTE_MINIMO/);
    expect(AGENCIAS).toMatch(/somNoClaro\(a\.sigla\) \? "lp-esteira-link lp-esteira-link--pilula"/);
    expect(CSS).toMatch(/\.lp-esteira-link--pilula \{[\s\S]*?background: var\(--lp-navy\);/);
    expect(somemNoPapel.length, "a exceção sumiu ou explodiu — reavalie o fundo").toBeLessThanOrEqual(2);
  });

  it("cada logo segue clicável para o site oficial, com rel de segurança", () => {
    expect(AGENCIAS).toMatch(/href=\{a\.site_oficial\}/);
    expect(AGENCIAS).toMatch(/rel="noopener noreferrer"/);
    for (const a of AGENCIAS_FEDERAIS) expect(a.site_oficial).toMatch(/^https:\/\//);
  });
});

describe("etapa194 · o Radar reescrito", () => {
  it("⚠️ NENHUM travessão no conteúdo visível da LP — o pedido do usuário", () => {
    /**
     * Aplicado à página INTEIRA, não só ao Radar: meia página sem travessão e meia com fica pior que
     * nenhuma. Comentário de código não conta, porque não é lido por ninguém de fora.
     */
    const tudo = [
      ...ETAPAS_DO_RADAR.flatMap((e) => [e.titulo, e.texto]),
      ...BENEFICIOS_DO_RADAR.flatMap((b) => [b.titulo, b.texto]),
      ...METODO_DO_RADAR,
      ...O_QUE_FAZEMOS.flatMap((i) => [i.titulo, i.texto]),
      ...QUEM_SOMOS,
    ];
    const comTravessao = tudo.filter((t) => /[—–]/.test(t));
    expect(comTravessao, `travessão no texto visível:\n${comTravessao.join("\n")}`).toEqual([]);
  });

  it("⚠️ e nem nos COMPONENTES — o subtítulo da Hero escapou da primeira versão deste teste", () => {
    /**
     * ⚠️ A primeira versão varria só `landing-content.ts`, e o travessão do subtítulo da Hero está
     * escrito direto no JSX. Eu só vi porque OLHEI a página renderizada: *"Estudamos, analisamos e
     * aprimoramos a regulação no Brasil — com transparência…"*. Um teste que cobre a metade do texto
     * dá a mesma sensação de garantia e não garante nada.
     *
     * O `alt` da logo fica de fora: ele carrega o nome oficial do Instituto, e nome próprio não é
     * prosa que eu possa reescrever.
     */
    const dir = join(RAIZ, "src/components/landing");
    const achados: string[] = [];
    for (const arq of readdirSync(dir)) {
      const fonte = semComentarios(ler(`src/components/landing/${arq}`));
      for (const linha of fonte.split("\n")) {
        if (!/[—–]/.test(linha)) continue;
        if (/\balt=/.test(linha)) continue;
        achados.push(`${arq}: ${linha.trim().slice(0, 90)}`);
      }
    }
    expect(achados, `travessão no texto dos componentes:\n${achados.join("\n")}`).toEqual([]);
  });

  it("as quatro etapas viraram TRILHA, com o filete ligando um marcador ao seguinte", () => {
    expect(RADAR).toMatch(/<ol className="lp-trilha mt-14">/);
    expect(CSS).toMatch(/\.lp-trilha-item:not\(:last-child\)::before/);
    // O último não tem filete: apontaria para o nada.
    expect(CSS).toMatch(/\.lp-trilha-item:last-child \{ padding-bottom: 0; \}/);
    expect(RADAR, "a grade 2x2 voltou, e ela não diz sequência").not.toMatch(/md:grid-cols-2/);
  });

  it("⚠️ entrou o bloco de BENEFÍCIOS — as etapas diziam o que o sistema faz, não o que se ganha", () => {
    expect(BENEFICIOS_DO_RADAR.length).toBe(6);
    expect(RADAR).toMatch(/BENEFICIOS_DO_RADAR\.map/);
    expect(RADAR).toMatch(/O que você ganha/);
    for (const b of BENEFICIOS_DO_RADAR) {
      expect(b.texto.length, `benefício "${b.titulo}" é raso demais para valer a seção`)
        .toBeGreaterThan(90);
    }
  });

  it("e o bloco de MÉTODO responde o que acontece quando a leitura falha", () => {
    expect(METODO_DO_RADAR.length).toBeGreaterThanOrEqual(3);
    expect(RADAR).toMatch(/METODO_DO_RADAR\.map/);
    const metodo = METODO_DO_RADAR.join(" ");
    // ⚠️ As três promessas que o método faz, e que são compromissos de comportamento.
    expect(metodo).toMatch(/documento oficial/);
    expect(metodo).toMatch(/marcado como inferido/);
    expect(metodo).toMatch(/publicada como número/);
  });

  it("⚠️ a etapa 03 continua NOMEANDO as três agências com esteira de votos", () => {
    const etapa = ETAPAS_DO_RADAR.find((e) => e.numero === "03");
    expect(etapa).toBeDefined();
    for (const sigla of ["ANTT", "ANM", "ARTESP"]) expect(etapa!.texto).toContain(sigla);
    // E diz o que as outras nove recebem, em vez de deixar o silêncio afirmar cobertura uniforme.
    expect(etapa!.texto).toMatch(/nove\s+agências federais/);
  });

  it("e nenhum texto chama de auditada a nota de qualidade, que é preliminar", () => {
    const todos = [
      ...ETAPAS_DO_RADAR.map((e) => `${e.titulo} ${e.texto}`),
      ...BENEFICIOS_DO_RADAR.map((b) => `${b.titulo} ${b.texto}`),
      ...METODO_DO_RADAR,
    ].join(" ");
    expect(todos).not.toMatch(/auditad[ao]|certificad[ao]|validad[ao] por/i);
  });
});
