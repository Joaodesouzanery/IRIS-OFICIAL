/**
 * Etapa 222 (Fase 36, continuação) — a ANAC, e a segunda causa plausível que o `/health` escondia.
 *
 * ═══ O defeito ═══
 * O `/noticias/health` buscava `regulatory_news` com um `.limit(2000)` GLOBAL — ordenado por
 * `publicado_em DESC` somando TODAS as agências antes de cortar. Uma fonte quieta (poucas
 * publicações, ou publicações mais antigas que as de outras agências) tem suas linhas empurradas
 * para fora do topo-2000 por volume alheio, e `total = rows.length` lia ZERO mesmo com histórico
 * real no banco — "Fonte configurada sem nenhuma notícia" quando a fonte TEM notícia.
 *
 * ⚠️ É a MESMA forma de erro que a Fase 24b catalogou cinco vezes: "`.limit(N)` grande não pagina;
 * o PostgREST corta em silêncio". Aqui o corte era por ORDENAÇÃO CRUZADA entre agências, não só por
 * tamanho — mais sutil, porque `total` parecia um número honesto (não truncado visivelmente), só
 * que media o banco errado.
 *
 * ═══ O conserto ═══
 * Uma consulta POR AGÊNCIA, com `{ count: "exact" }` — o `count` reflete o WHERE inteiro (não o
 * `.limit` da página), então `total` deixa de depender do volume de QUALQUER outra agência.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";

const RAIZ = join(__dirname, "../../../..");
const ler = (p: string) => readFileSync(join(RAIZ, p), "utf-8");
const semComentarios = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/\/\/[^\n]*/g, " ");

const R = semComentarios(ler("src/app/api/v1/noticias/health/route.ts"));

describe("etapa222 · ⚠️ `total` deixa de depender do volume de OUTRA agência", () => {
  it("não existe mais um `.limit` GLOBAL ordenado por publicado_em sobre todas as siglas", () => {
    expect(R, "voltou o `.in(\"agencia_sigla\", siglas)` com um limite único cruzando agências")
      .not.toMatch(/\.in\("agencia_sigla", siglas\)/);
  });

  it("a consulta passa a ser POR AGÊNCIA, com `.eq(\"agencia_sigla\", sigla)`", () => {
    expect(R).toMatch(/siglas\.map\(async \(sigla\) => \{/);
    expect(R).toMatch(/\.eq\("agencia_sigla", sigla\)/);
  });

  it("⚠️ e usa `{ count: \"exact\" }` — sem ele `total` voltaria a ser o tamanho da PÁGINA, não o total real", () => {
    expect(R).toMatch(/\.select\("agencia_sigla, titulo, url, publicado_em, last_seen_at", \{ count: "exact" \}\)/);
    expect(R, "total voltou a ser rows.length — o tamanho da página bounded, não o count exato")
      .not.toMatch(/total: rows\.length/);
    expect(R).toMatch(/total: count \?\? 0/);
  });

  it("as chamadas por agência rodam em PARALELO, não uma serializada atrás da outra", () => {
    const i = R.indexOf("Promise.all(siglas.map(");
    expect(i, "o Promise.all sobre as siglas desapareceu — isso serializaria 13 round-trips").toBeGreaterThan(-1);
  });

  it("erro em QUALQUER agência derruba a rota com 500 — não falha em silêncio", () => {
    expect(R).toMatch(/const erroDeAlgumaAgencia = porAgencia\.find\(\(p\) => p\.error\)\?\.error;/);
    expect(R).toMatch(/if \(erroDeAlgumaAgencia\) return NextResponse\.json\(\{ error:/);
  });

  it("o total downstream vem do índice por agência, não de filtrar uma lista global", () => {
    expect(R, "voltou o filter((item) => item.agencia_sigla === source.agencia_sigla) sobre uma lista global")
      .not.toMatch(/\(data \?\? \[\]\)\.filter\(\(item\) => item\.agencia_sigla === source\.agencia_sigla\)/);
    expect(R).toMatch(/const entrada = indicePorAgencia\.get\(source\.agencia_sigla\);/);
  });
});
