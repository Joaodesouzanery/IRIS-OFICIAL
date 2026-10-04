/**
 * Etapa 225 — trocar a ORDEM das notícias na Newsletter (pedido do usuário: "trocar a ordem nas
 * notícias na lateral, junto de trocar imagens, justificar").
 *
 * A ordem de `newsletterSelectedIds` É o layout: índice 0 de cada página = principal, 1 e 2 =
 * laterais. Mover é trocar de posição — e tudo o que é editado por notícia (texto, título, imagem,
 * justificar) é chave por `id`, então viaja junto.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";
import { moverNaOrdem } from "../../newsletter-ordem";

const RAIZ = join(__dirname, "../../../..");
const semComentarios = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/\/\/[^\n]*/g, " ");
const TELA = semComentarios(readFileSync(join(RAIZ, "src/app/dashboard/noticias/page.tsx"), "utf-8"));

describe("etapa225 · moverNaOrdem", () => {
  it("sobe e desce uma posição", () => {
    expect(moverNaOrdem(["a", "b", "c"], "b", -1)).toEqual(["b", "a", "c"]);
    expect(moverNaOrdem(["a", "b", "c"], "b", 1)).toEqual(["a", "c", "b"]);
  });

  it("promover a lateral 1 a principal é um 'subir' da segunda posição", () => {
    expect(moverNaOrdem(["principal", "lateral1", "lateral2"], "lateral1", -1))
      .toEqual(["lateral1", "principal", "lateral2"]);
  });

  it("atravessa a fronteira da página (índice 3 sobe para a lateral 2 da página 1)", () => {
    expect(moverNaOrdem(["a", "b", "c", "d"], "d", -1)).toEqual(["a", "b", "d", "c"]);
  });

  it("⚠️ no topo/fundo devolve o MESMO array — sem re-render nem 'edição alterada' à toa", () => {
    const ids = ["a", "b"];
    expect(moverNaOrdem(ids, "a", -1)).toBe(ids);
    expect(moverNaOrdem(ids, "b", 1)).toBe(ids);
    expect(moverNaOrdem(ids, "zzz", 1)).toBe(ids);
  });

  it("⚠️ salta ids INVISÍVEIS — senão o clique não mudaria nada na tela", () => {
    // "x" está selecionado mas a notícia ainda não chegou ao cache: a tela não a mostra.
    const visivel = (id: string) => id !== "x";
    expect(moverNaOrdem(["a", "x", "b"], "b", -1, visivel)).toEqual(["b", "x", "a"]);
    // e o invisível fica exatamente onde estava
    expect(moverNaOrdem(["a", "x", "b"], "b", -1, visivel)[1]).toBe("x");
  });

  it("não muta a entrada", () => {
    const ids = ["a", "b", "c"];
    moverNaOrdem(ids, "c", -1);
    expect(ids).toEqual(["a", "b", "c"]);
  });
});

describe("etapa225 · a tela", () => {
  it("cada notícia do editor tem ↑ e ↓, desabilitados nas pontas", () => {
    expect(TELA).toMatch(/moverNoticiaNewsletter\(item\.id, -1\)/);
    expect(TELA).toMatch(/moverNoticiaNewsletter\(item\.id, 1\)/);
    expect(TELA).toMatch(/disabled=\{index === 0\}/);
    expect(TELA).toMatch(/disabled=\{index === newsletterSelected\.length - 1\}/);
  });

  it("a troca usa os ids VISÍVEIS da lista exibida", () => {
    const i = TELA.indexOf("function moverNoticiaNewsletter");
    const bloco = TELA.slice(i, i + 500);
    expect(bloco).toMatch(/new Set\(newsletterSelected\.map\(\(item\) => item\.id\)\)/);
    expect(bloco).toMatch(/moverNaOrdem\(prev, id, delta, \(x\) => visiveis\.has\(x\)\)/);
  });

  it("⚠️ texto maior que o espaço da posição nova é AVISADO, não cortado no estado", () => {
    // O corte é só no documento (newsletterTextOverrides fatia por índice); mover de volta restaura.
    expect(TELA).toMatch(/acima do espaço desta posição/);
    expect(TELA).toMatch(/value\.slice\(0, newsletterTextLimitForIndex\(index\)\)/);
  });
});
