/**
 * Etapa 204 (Fase 35, Bloco A.4) — os oito downloads que devolviam 401 na cara de quem estava logado.
 *
 * ═══ O defeito ═══
 * `handleApiRequest` exige header `Authorization: Bearer` em TODO GET de `/api/v1/`. Navegação do
 * navegador — clique em `<a href>`, `window.location.href`, "Salvar link como" — **nunca manda
 * header**: manda cookie. Então todo download por link caía em
 * `{"error":"Login obrigatório para consultar dados reais"}`.
 *
 * Eram OITO pontos de uso, e `docs/PENDENCIAS.md:670` registrava só um ("o 'Exportar CSV' de
 * Deliberações devolve erro de login hoje"). Quatro dos oito são os botões HTML/PDF/Word/DOCX da
 * edição salva na tela de Notícias — a mesma tela onde o usuário pediu para editar o título.
 *
 * ═══ Por que lista FECHADA, e não cookie para todo GET ═══
 * Aceitar cookie torna o GET acionável por navegação vinda de outro site. Inócuo para leitura —
 * MENOS quando um GET tem efeito: o GET de `antt/2026/collect` fazia scraping headless de até 80
 * reuniões, sem guard. A lista fechada é o que impede o próximo GET com efeito de herdar a permissão.
 *
 * ⚠️ E a expectativa central deste arquivo é a INVERSA da usual: em vez de conferir que a lista tem
 * consumidor, ela confere que todo CONSUMIDOR está na lista. Varre a interface por link de navegação
 * para `/api/v1/` e exige que cada um case. Link de exportação novo fora da lista reprova.
 */

import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "fs";
import { join } from "path";

const RAIZ = join(__dirname, "../../../..");
const ler = (p: string) => readFileSync(join(RAIZ, p), "utf-8");
const semComentarios = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/\/\/[^\n]*/g, " ");

const MW = semComentarios(ler("src/middleware.ts"));

/** A lista do middleware, lida de lá para o teste não manter uma cópia que envelhece sozinha. */
function padroesDaLista(): RegExp[] {
  const i = MW.indexOf("const EXPORTACAO_POR_NAVEGACAO");
  expect(i, "a lista de exportação desapareceu do middleware").toBeGreaterThan(-1);
  const bloco = MW.slice(i, MW.indexOf("];", i));
  const fontes = [...bloco.matchAll(/\/(\^[^\n]*?\$)\/,/g)].map((m) => m[1]);
  expect(fontes.length, "não consegui ler os padrões da lista").toBeGreaterThan(0);
  return fontes.map((f) => new RegExp(f));
}

/** Varre a interface por NAVEGAÇÃO do navegador para `/api/v1/` (que nunca carrega header). */
function linksDeNavegacaoParaApi(): { caminho: string; onde: string }[] {
  const achados: { caminho: string; onde: string }[] = [];
  const andar = (dir: string) => {
    for (const nome of readdirSync(join(RAIZ, dir))) {
      const rel = `${dir}/${nome}`;
      if (statSync(join(RAIZ, rel)).isDirectory()) { andar(rel); continue; }
      if (!/\.tsx?$/.test(nome)) continue;
      const fonte = semComentarios(ler(rel));
      const padroes = [
        /href=\{`(\/api\/v1[^`]*)`\}/g,
        /href="(\/api\/v1[^"]*)"/g,
        /location\.href\s*=\s*`(\/api\/v1[^`]*)`/g,
        /location\.href\s*=\s*"(\/api\/v1[^"]*)"/g,
      ];
      for (const padrao of padroes) {
        for (const m of fonte.matchAll(padrao)) {
          // `${expressao}` vira um segmento qualquer; a query não faz parte do pathname.
          const caminho = m[1].replace(/\$\{[^}]*\}/g, "id-de-exemplo").split("?")[0];
          achados.push({ caminho, onde: rel });
        }
      }
    }
  };
  andar("src/app");
  andar("src/components");
  return achados;
}

describe("etapa204 · ⚠️ todo link de navegação para a API está coberto", () => {
  const links = linksDeNavegacaoParaApi();
  const lista = padroesDaLista();

  it("a varredura acha os links (o teste não pode passar por não achar nada)", () => {
    expect(links.length, "nenhum link para /api/v1 foi encontrado — a varredura quebrou")
      .toBeGreaterThanOrEqual(8);
  });

  it("⚠️ CADA UM deles casa a lista fechada — link novo fora dela reprova", () => {
    const descobertos = links
      .filter(({ caminho }) => !lista.some((p) => p.test(caminho)))
      .map(({ caminho, onde }) => `${caminho}  (${onde})`)
      .sort();
    expect(
      descobertos,
      "há link de navegação para /api/v1 fora de EXPORTACAO_POR_NAVEGACAO. Ele vai devolver 401 no " +
        "clique. Se é exportação de leitura, entre na lista; se tem efeito, NÃO entre — troque o " +
        "link por fetch com Bearer.",
    ).toEqual([]);
  });

  it("e os quatro botões da Newsletter estão entre eles — foi o caso que o usuário viu", () => {
    const daNewsletter = links.filter((l) => l.caminho.includes("/newsletter/edicoes/"));
    expect(daNewsletter.length, "os botões de exportar da Newsletter sumiram da tela").toBe(4);
    for (const l of daNewsletter) {
      expect(lista.some((p) => p.test(l.caminho)), `${l.caminho} ficou fora da lista`).toBe(true);
    }
  });
});

describe("etapa204 · ⚠️ a lista não pode abrigar rota com EFEITO", () => {
  const lista = padroesDaLista();

  it("cada rota da lista existe, declara SÓ GET e não escreve nada", () => {
    /**
     * A permissão é dada ao CAMINHO, então a prova tem de ser sobre o arquivo que o serve. Uma rota
     * que ganhe um POST, ou um insert dentro do GET, passa a ser alcançável por navegação de
     * terceiro site — e aí esta expectativa cai antes de o deploy sair.
     */
    const ROTAS = [
      "src/app/api/v1/newsletter/edicoes/[id]/html/route.ts",
      "src/app/api/v1/newsletter/edicoes/[id]/pdf/route.ts",
      "src/app/api/v1/newsletter/edicoes/[id]/word/route.ts",
      "src/app/api/v1/newsletter/edicoes/[id]/docx/route.ts",
      "src/app/api/v1/deliberacoes/export/route.ts",
      "src/app/api/v1/associados/documentos/[id]/html/route.ts",
      "src/app/api/v1/qualidade-regulatoria/relatorios/ranking/route.ts",
    ];
    for (const rota of ROTAS) {
      const fonte = semComentarios(ler(rota));
      const metodos = [...fonte.matchAll(/export async function (GET|POST|PUT|PATCH|DELETE)\b/g)].map(
        (m) => m[1],
      );
      expect(metodos, `${rota} deveria declarar só GET`).toEqual(["GET"]);
      expect(fonte, `${rota} passou a ESCREVER — tire-a da lista de cookie`).not.toMatch(
        /\.(?:insert|update|upsert|delete)\(/,
      );
    }
    // E o caminho servido por cada arquivo é coberto pela lista.
    const exemplos = [
      "/api/v1/newsletter/edicoes/abc/html",
      "/api/v1/newsletter/edicoes/abc/pdf",
      "/api/v1/newsletter/edicoes/abc/word",
      "/api/v1/newsletter/edicoes/abc/docx",
      "/api/v1/deliberacoes/export",
      "/api/v1/associados/documentos/abc/html",
      "/api/v1/qualidade-regulatoria/relatorios/ranking",
    ];
    for (const c of exemplos) {
      expect(lista.some((p) => p.test(c)), `${c} deixou de casar a lista`).toBe(true);
    }
  });

  it("⚠️ e NÃO abriga o GET de scraping, nem rota de escrita, nem prefixo largo", () => {
    const PROIBIDOS = [
      "/api/v1/antt/2026/collect",
      "/api/v1/pipeline/run",
      "/api/v1/upload/confirm",
      "/api/v1/admin/placar",
      "/api/v1/newsletter/edicoes",
      "/api/v1/deliberacoes",
      "/api/v1/deliberacoes/export/extra",
      "/api/v1/qualidade-regulatoria/relatorios",
    ];
    for (const c of PROIBIDOS) {
      expect(lista.some((p) => p.test(c)), `a lista passou a cobrir ${c}`).toBe(false);
    }
  });

  it("os padrões são ANCORADOS nas duas pontas — sem isso `/export/qualquer-coisa` entraria", () => {
    const i = MW.indexOf("const EXPORTACAO_POR_NAVEGACAO");
    const bloco = MW.slice(i, MW.indexOf("];", i));
    const padroes = [...bloco.matchAll(/\/(\^[^\n]*?\$)\/,/g)];
    expect(padroes.length, "algum padrão perdeu a âncora ^...$").toBeGreaterThanOrEqual(4);
  });
});

describe("etapa204 · o cookie vale só para GET, e só depois do Bearer", () => {
  it("o fallback fica DEPOIS da barreira de método — escrita nunca chega nele", () => {
    const iSoGet = MW.indexOf('if (req.method !== "GET") return NextResponse.next();');
    const iFallback = MW.indexOf("ehExportacaoPorNavegacao(pathname)");
    expect(iSoGet, "a barreira de método saiu do middleware").toBeGreaterThan(-1);
    expect(iFallback, "o fallback de cookie desapareceu").toBeGreaterThan(-1);
    expect(iFallback, "o fallback subiu para antes da barreira de método").toBeGreaterThan(iSoGet);
  });

  it("e o Bearer continua tendo precedência — o cookie é só quando não há token", () => {
    const iToken = MW.indexOf("if (!token) {");
    expect(iToken).toBeGreaterThan(-1);
    const dentro = MW.slice(iToken, iToken + 400);
    expect(dentro, "o fallback saiu de dentro do ramo «sem token»").toMatch(
      /ehExportacaoPorNavegacao\(pathname\)/,
    );
  });

  it("⚠️ sem sessão válida no cookie, ainda é 401 — o fallback não é bypass", () => {
    const i = MW.indexOf("async function autenticarPorCookie");
    expect(i, "o helper de cookie desapareceu").toBeGreaterThan(-1);
    const corpo = MW.slice(i, MW.indexOf("\n}", i));
    expect(corpo).toMatch(/getUser\(\)/);
    expect(corpo).toMatch(/status: 401/);
    // E os cookies RENOVADOS voltam na resposta — senão o refresh silencioso se perde.
    expect(corpo, "o padrão de reatribuir `response` no setAll se perdeu").toMatch(
      /response = NextResponse\.next\(/,
    );
  });
});
