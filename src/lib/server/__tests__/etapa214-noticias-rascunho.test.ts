/**
 * Etapa 214 — a persistência da tela de Notícias, e as três armadilhas que ela tem de sobreviver.
 *
 * O pedido é direto: sair da tela não pode perder a seleção. O que não é direto são os três modos
 * de a persistência dar errado, e é isso que este arquivo prende:
 *
 *  1. **O efeito de gravação apagando o que o de restauração acabou de ler.** O portão é `useState`
 *     e não `useRef` por causa disto: um `ref` marcado dentro do efeito de restauração já estaria
 *     `true` na PRIMEIRA passada do efeito de gravação, quando o `setState` ainda não foi aplicado —
 *     o estado lido seria o VAZIO, `temAlgoParaGuardar` diria `false` e o rascunho seria removido.
 *
 *  2. **O efeito do minuto reescrevendo o texto restaurado.** Ele dispara quando a seleção do minuto
 *     "muda", e a montagem conta como mudança. Sem carimbar `lastMinutoSelectionKey` com a seleção
 *     restaurada, o texto editado é trocado pelo rascunho gerado — e a ordem de declaração dos
 *     efeitos é o que garante o carimbo a tempo.
 *
 *  3. **A cota do `localStorage`.** O cache recebe TODA notícia de TODA página já consultada; salvar
 *     o cache inteiro cresce sem limite, e o que estoura por cota estoura em silêncio.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";
import {
  RASCUNHO_KEY,
  RASCUNHO_VERSAO,
  TETO_CONTEUDO,
  TETO_NOTICIAS,
  VALIDADE_DIAS,
  lerRascunho,
  montarRascunho,
  temAlgoParaGuardar,
} from "../../noticias-rascunho";

const RAIZ = join(__dirname, "../../../..");
const ler = (p: string) => readFileSync(join(RAIZ, p), "utf-8");
const semComentarios = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/\/\/[^\n]*/g, " ");

const TELA = semComentarios(ler("src/app/dashboard/noticias/page.tsx"));

const AGORA = new Date("2026-09-30T12:00:00.000Z");

function estado(over: Partial<Parameters<typeof montarRascunho>[0]> = {}) {
  return {
    newsletterSelectedIds: [] as string[],
    minutoSelectedIds: [] as string[],
    cache: {} as Record<string, object>,
    newsletterArticleTexts: {} as Record<string, string>,
    newsletterArticleTitles: {} as Record<string, string>,
    newsletterImagens: {} as Record<string, string | null>,
    minutoTextos: "",
    socialPosts: [] as unknown[],
    ...over,
  };
}

describe("etapa214 · o rascunho guarda o que a tela não consegue reconstruir", () => {
  it("a ida e a volta preservam a seleção, o texto e o título editados", () => {
    const r = montarRascunho(
      estado({
        newsletterSelectedIds: ["a", "b"],
        cache: { a: { id: "a", titulo: "A" }, b: { id: "b", titulo: "B" } },
        newsletterArticleTexts: { a: "corpo reescrito" },
        newsletterArticleTitles: { a: "título trocado" },
      }),
      AGORA,
    );
    const volta = lerRascunho(JSON.stringify(r), AGORA);
    expect(volta?.newsletterSelectedIds).toEqual(["a", "b"]);
    expect(volta?.newsletterArticleTexts.a).toBe("corpo reescrito");
    expect(volta?.newsletterArticleTitles.a).toBe("título trocado");
    expect(Object.keys(volta?.cache ?? {}).sort()).toEqual(["a", "b"]);
  });

  it("⚠️ PODA o cache aos selecionados — ele cresce com toda consulta já feita", () => {
    const cache: Record<string, object> = {};
    for (let i = 0; i < 200; i++) cache[`n${i}`] = { id: `n${i}` };
    const r = montarRascunho(estado({ newsletterSelectedIds: ["n7"], cache }), AGORA);
    expect(Object.keys(r.cache)).toEqual(["n7"]);
  });

  it("e CORTA o corpo: o teto é o que a tela usa, não o que a fonte manda", () => {
    const longo = "x".repeat(TETO_CONTEUDO + 5_000);
    const r = montarRascunho(
      estado({ newsletterSelectedIds: ["a"], cache: { a: { id: "a", conteudo: longo, resumo: longo } } }),
      AGORA,
    );
    const guardada = r.cache.a as Record<string, unknown>;
    expect((guardada.conteudo as string).length).toBe(TETO_CONTEUDO);
    expect((guardada.resumo as string).length).toBe(TETO_CONTEUDO);
  });

  it("o corte não mexe no que já cabe — nem na notícia original", () => {
    const original = { id: "a", conteudo: "curto" };
    const r = montarRascunho(estado({ newsletterSelectedIds: ["a"], cache: { a: original } }), AGORA);
    expect((r.cache.a as Record<string, unknown>).conteudo).toBe("curto");
    expect(original.conteudo).toBe("curto");
  });

  it("o override de quem foi DESmarcado não viaja — senão o mapa só cresce", () => {
    const r = montarRascunho(
      estado({
        newsletterSelectedIds: ["a"],
        cache: { a: { id: "a" } },
        newsletterArticleTexts: { a: "fica", z: "some" },
        newsletterArticleTitles: { z: "some" },
        newsletterImagens: { z: null },
      }),
      AGORA,
    );
    expect(Object.keys(r.newsletterArticleTexts)).toEqual(["a"]);
    expect(r.newsletterArticleTitles).toEqual({});
    expect(r.newsletterImagens).toEqual({});
  });

  it("a seleção do MINUTO também preserva o cache — são duas listas, não uma", () => {
    const r = montarRascunho(
      estado({ minutoSelectedIds: ["m1"], cache: { m1: { id: "m1" } }, minutoTextos: "texto do minuto" }),
      AGORA,
    );
    expect(Object.keys(r.cache)).toEqual(["m1"]);
    expect(r.minutoTextos).toBe("texto do minuto");
  });

  it("e o cache tem teto de notícias, não só de caracteres", () => {
    const cache: Record<string, object> = {};
    const ids: string[] = [];
    for (let i = 0; i < TETO_NOTICIAS + 10; i++) {
      ids.push(`n${i}`);
      cache[`n${i}`] = { id: `n${i}` };
    }
    const r = montarRascunho(estado({ newsletterSelectedIds: ids, cache }), AGORA);
    expect(Object.keys(r.cache).length).toBe(TETO_NOTICIAS);
    // ⚠️ A seleção INTEIRA continua guardada: o teto é do cache, e a tela recarrega o resto da API.
    expect(r.newsletterSelectedIds.length).toBe(TETO_NOTICIAS + 10);
  });
});

describe("etapa214 · a leitura devolve null em QUALQUER dúvida", () => {
  it("nada guardado", () => {
    expect(lerRascunho(null, AGORA)).toBeNull();
    expect(lerRascunho("", AGORA)).toBeNull();
  });

  it("JSON quebrado, ou que não é objeto", () => {
    expect(lerRascunho("{isto não é json", AGORA)).toBeNull();
    expect(lerRascunho("[1,2,3]", AGORA)).toBeNull();
    expect(lerRascunho("null", AGORA)).toBeNull();
    expect(lerRascunho('"texto"', AGORA)).toBeNull();
  });

  it("versão diferente — formato antigo não é lido pela metade", () => {
    const r = montarRascunho(estado({ newsletterSelectedIds: ["a"] }), AGORA);
    const antigo = JSON.stringify({ ...r, v: RASCUNHO_VERSAO + 1 });
    expect(lerRascunho(antigo, AGORA)).toBeNull();
  });

  it("⚠️ VENCIDO: um rascunho de semanas atrás voltando sem aviso é pior que nenhum", () => {
    const velho = montarRascunho(estado({ newsletterSelectedIds: ["a"] }), AGORA);
    const depois = new Date(AGORA.getTime() + (VALIDADE_DIAS + 1) * 86_400_000);
    expect(lerRascunho(JSON.stringify(velho), depois)).toBeNull();
    // No limite ainda vale — o corte é em VALIDADE_DIAS, não antes dele.
    const noLimite = new Date(AGORA.getTime() + (VALIDADE_DIAS - 0.5) * 86_400_000);
    expect(lerRascunho(JSON.stringify(velho), noLimite)).not.toBeNull();
  });

  it("rascunho do FUTURO também é descartado — relógio torto é dúvida", () => {
    const r = montarRascunho(estado({ newsletterSelectedIds: ["a"] }), AGORA);
    const antes = new Date(AGORA.getTime() - 86_400_000);
    expect(lerRascunho(JSON.stringify(r), antes)).toBeNull();
  });

  it("data ilegível", () => {
    const r = montarRascunho(estado({ newsletterSelectedIds: ["a"] }), AGORA);
    expect(lerRascunho(JSON.stringify({ ...r, salvo_em: "ontem" }), AGORA)).toBeNull();
  });

  it("campo com tipo errado não virá tipo errado para a tela", () => {
    const r = montarRascunho(estado({ newsletterSelectedIds: ["a"] }), AGORA);
    const torto = JSON.stringify({
      ...r,
      newsletterSelectedIds: ["ok", 7, null],
      cache: "isto deveria ser objeto",
      minutoTextos: 42,
      socialPosts: "isto deveria ser lista",
    });
    const volta = lerRascunho(torto, AGORA);
    expect(volta?.newsletterSelectedIds).toEqual(["ok"]);
    expect(volta?.cache).toEqual({});
    expect(volta?.minutoTextos).toBe("");
    expect(volta?.socialPosts).toEqual([]);
  });
});

describe("etapa214 · rascunho vazio não é guardado", () => {
  it("sem seleção, sem post e sem texto, não há o que guardar", () => {
    expect(temAlgoParaGuardar(estado())).toBe(false);
    expect(temAlgoParaGuardar(estado({ minutoTextos: "   " }))).toBe(false);
  });

  it("qualquer uma das quatro evidências basta", () => {
    expect(temAlgoParaGuardar(estado({ newsletterSelectedIds: ["a"] }))).toBe(true);
    expect(temAlgoParaGuardar(estado({ minutoSelectedIds: ["a"] }))).toBe(true);
    expect(temAlgoParaGuardar(estado({ socialPosts: [{}] }))).toBe(true);
    expect(temAlgoParaGuardar(estado({ minutoTextos: "texto" }))).toBe(true);
  });
});

describe("etapa214 · ⚠️ as três armadilhas, prendidas na tela", () => {
  it("o portão é useState — com useRef, a gravação apagaria o que a restauração leu", () => {
    expect(TELA).toMatch(/const \[rascunhoPronto, setRascunhoPronto\] = useState\(false\)/);
    expect(TELA, "o portão virou ref: o efeito de gravação roda antes do estado restaurado chegar")
      .not.toMatch(/rascunhoPronto\s*=\s*useRef/);
  });

  it("e o portão guarda o efeito de gravação, além de estar nas dependências dele", () => {
    const i = TELA.indexOf("if (!rascunhoPronto) return;");
    expect(i, "o efeito de gravação deixou de checar o portão").toBeGreaterThan(-1);
    const bloco = TELA.slice(i, i + 1_600);
    expect(bloco).toMatch(/localStorage\.setItem\(RASCUNHO_KEY/);
    expect(bloco, "`rascunhoPronto` saiu das dependências — a gravação não reagiria ao portão")
      .toMatch(/\[\s*rascunhoPronto,/);
  });

  it("⚠️ a restauração vem ANTES do efeito do minuto — é a ordem que salva o texto editado", () => {
    const restaura = TELA.indexOf("localStorage.getItem(RASCUNHO_KEY)");
    const minuto = TELA.indexOf("lastMinutoSelectionKey.current = key;");
    expect(restaura).toBeGreaterThan(-1);
    expect(minuto).toBeGreaterThan(-1);
    expect(restaura, "o efeito do minuto passou a rodar antes e reescreve o texto restaurado")
      .toBeLessThan(minuto);
  });

  it("e a restauração CARIMBA a chave do minuto, senão a ordem sozinha não bastaria", () => {
    const i = TELA.indexOf("localStorage.getItem(RASCUNHO_KEY)");
    const bloco = TELA.slice(i, i + 1_800);
    expect(bloco).toMatch(/lastMinutoSelectionKey\.current = rascunho\.minutoSelectedIds\.join\("\|"\)/);
    expect(bloco).toMatch(/setMinutoTextos\(rascunho\.minutoTextos\)/);
  });

  it("⚠️ TODO acesso ao storage do rascunho está protegido — cota e aba anônima lançam", () => {
    const acessos = [...TELA.matchAll(/localStorage\.(?:getItem|setItem|removeItem)\([^)]*RASCUNHO_KEY/g)];
    expect(acessos.length, "nenhum acesso encontrado — o teste deixou de medir algo").toBeGreaterThanOrEqual(3);
    for (const m of acessos) {
      const antes = TELA.slice(Math.max(0, m.index! - 400), m.index!);
      const tentativa = antes.lastIndexOf("try {");
      const fechou = antes.lastIndexOf("} catch");
      expect(tentativa, `acesso ao storage fora de try/catch: ...${antes.slice(-90)}`).toBeGreaterThan(fechou);
    }
  });

  it("o cache VIVO tem precedência sobre o restaurado — a consulta é mais fresca", () => {
    const i = TELA.indexOf("localStorage.getItem(RASCUNHO_KEY)");
    const bloco = TELA.slice(i, i + 1_800);
    // O espalhamento do rascunho vem PRIMEIRO; o anterior sobrescreve.
    expect(bloco).toMatch(/\.\.\.\(rascunho\.cache as Record<string, RegulatoryNews>\),\s*\.\.\.anterior,/);
  });

  it("desmarcar tudo REMOVE o rascunho em vez de ressuscitá-lo na próxima visita", () => {
    expect(TELA).toMatch(/if \(!temAlgoParaGuardar\(estado\)\) \{\s*localStorage\.removeItem\(RASCUNHO_KEY\);/);
  });

  it("a tela DIZ que restaurou, e oferece saída — restauração silenciosa não tem desfazer", () => {
    expect(TELA).toMatch(/Rascunho restaurado/);
    expect(TELA).toMatch(/function descartarRascunho\(\)/);
    expect(TELA).toMatch(/onClick=\{descartarRascunho\}/);
    const i = TELA.indexOf("function descartarRascunho()");
    const bloco = TELA.slice(i, i + 900);
    for (const zerado of [
      "setNewsletterSelectedIds([])",
      "setMinutoSelectedIds([])",
      "setNewsletterArticleTexts({})",
      "setNewsletterArticleTitles({})",
      "setNewsletterImagens({})",
      "setSocialPosts([])",
      'setMinutoTextos("")',
    ]) {
      expect(bloco, `descartar deixou ${zerado} para trás`).toContain(zerado);
    }
  });

  it("a chave é uma só, e é a do módulo — não uma string solta na tela", () => {
    expect(RASCUNHO_KEY).toBe("iris_noticias_rascunho");
    expect(TELA, "a tela passou a usar a chave literal em vez da constante")
      .not.toMatch(/"iris_noticias_rascunho"/);
  });
});
