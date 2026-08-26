/**
 * Etapa 68 (Fase 7) — a logo sem fundo, legível nos DOIS temas.
 *
 * O que estava errado em produção: a arte branca vivia dentro de um "chip" preto hardcoded, que o
 * usuário rejeitou. Mas removê-lo sem mais nada torna a logo INVISÍVEL no tema claro — a arte é uma
 * silhueta monocromática de traço branco puro, e `--bg-sidebar` do `.light` é #ebebeb (contraste
 * ~1,05:1). A correção é a MESMA arte em duas tintas, trocada por CSS.
 *
 * Estes testes travam as três coisas que, se regredirem, devolvem o bug:
 *   1. as duas artes existem e têm o MESMO tamanho (a troca é pixel-a-pixel, não um "quase igual");
 *   2. a troca é escopada por `.light` — escopar por `.dark` reintroduz o flash de primeira pintura,
 *      porque o HTML sai do servidor SEM classe nenhuma e `:root` já é o tema escuro;
 *   3. o login NÃO participa da troca (tela de fundo escuro fixo — ver o teste comentado abaixo).
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";

const RAIZ = join(__dirname, "../../../..");
const ler = (p: string) => readFileSync(join(RAIZ, p), "utf-8");

/** Dimensões de um PNG pelo cabeçalho IHDR — evita dependência de biblioteca de imagem. */
function dimensoesPng(caminho: string): { largura: number; altura: number } {
  const buf = readFileSync(join(RAIZ, caminho));
  expect(buf.subarray(1, 4).toString("ascii"), `${caminho} não é um PNG`).toBe("PNG");
  return { largura: buf.readUInt32BE(16), altura: buf.readUInt32BE(20) };
}

describe("etapa68 · as duas tintas da mesma arte", () => {
  it("as duas artes existem e têm dimensões IDÊNTICAS", () => {
    const clara = dimensoesPng("public/brand/logo-iris.png");
    const escura = dimensoesPng("public/brand/logo-iris-escura.png");
    expect(escura, "tamanhos diferentes fazem a logo 'pular' ao trocar de tema").toEqual(clara);
    expect(clara.largura).toBeGreaterThan(0);
  });

  it("a arte da newsletter continua intocada — ela é usada em PDF/e-mail a 140px", () => {
    expect(() => dimensoesPng("public/brand/newsletter-logo-wide.png")).not.toThrow();
  });
});

describe("etapa68 · a troca de tinta é por CSS, escopada em .light", () => {
  const css = ler("src/app/globals.css");

  it("`.light .brand-logo` aponta para a arte escura", () => {
    expect(css).toMatch(/\.light\s+\.brand-logo\s*\{[^}]*logo-iris-escura\.png/);
  });

  it("NÃO existe regra escopada em `.dark` para a logo — é isso que evita o flash", () => {
    // O documento sai do SSR sem classe alguma e `:root` já é o tema escuro (globals.css:9).
    // Escopar a arte BRANCA em `.dark` a esconderia até o script do next-themes rodar.
    expect(css).not.toMatch(/\.dark\s+\.brand-logo/);
  });

  it("o tema claro realmente tem fundo de sidebar claro — a premissa do conserto", () => {
    expect(css).toMatch(/\.light\s*\{[\s\S]*?--bg-sidebar:\s*#ebebeb/);
  });
});

describe("etapa68 · os dois pontos de render", () => {
  const sidebar = ler("src/components/layout/Sidebar.tsx");
  const login = ler("src/app/login/page.tsx");

  it("a sidebar usa a arte nova COM a troca de tinta e SEM chip de fundo", () => {
    expect(sidebar).toContain('src="/brand/logo-iris.png"');
    expect(sidebar).toMatch(/className="brand-logo/);
    expect(sidebar, "o chip preto era exatamente o que o usuário pediu para tirar").not.toMatch(
      /bg-black[^"]*"[^>]*>\s*\{?\s*\/\*[\s\S]{0,200}?logo-iris/,
    );
  });

  it("o login usa a arte branca mas FICA FORA da troca — a tela é escura por decisão fixa", () => {
    expect(login).toContain('src="/brand/logo-iris.png"');
    expect(login).toContain("bg-[#0f1117]"); // fundo escuro fixo, não segue o tema
    // Se o login ganhasse `.brand-logo`, um usuário de tema claro receberia a arte ESCURA
    // sobre o card escuro (#191b22) — invisível. O bug que este teste existe para impedir.
    const tagDaLogo = login.slice(login.indexOf('src="/brand/logo-iris.png"') - 400, login.indexOf('src="/brand/logo-iris.png"') + 300);
    expect(tagDaLogo).not.toMatch(/className="[^"]*\bbrand-logo\b/);
  });

  it("nenhum dos dois embrulha a logo num fundo preto", () => {
    for (const [nome, fonte] of [["sidebar", sidebar], ["login", login]] as const) {
      const trecho = fonte.slice(0, fonte.indexOf('src="/brand/logo-iris.png"'));
      const ultimasLinhas = trecho.split("\n").slice(-6).join("\n");
      expect(ultimasLinhas, `${nome} ainda embrulha a logo num chip`).not.toMatch(/bg-black|bg-\[#0a0e2a\]/);
    }
  });
});
