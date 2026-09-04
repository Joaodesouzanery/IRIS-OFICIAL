/**
 * Etapa 68 (Fase 7) — paginação e completude da ANTT.
 *
 * ⚠️ ESTE ARQUIVO EXISTE POR UM DIAGNÓSTICO QUE CAIU. A investigação da Fase 7 concluiu que "a
 * ANTT nunca sai da página 1, porque `findNextPageUrl` só reconhece 'próximo'/'next' e o portal usa
 * paginador numérico". Ao escrever o teste contra a fixture REAL (`listagem-reunioes.html`, a
 * página do portal, 227 KB), a hipótese morreu: existe uma âncora "Próximo" e o casamento antigo a
 * encontra. O primeiro teste abaixo é justamente o que derrubou a tese — ele fica aqui para que
 * ninguém "conserte" de novo o que não está quebrado.
 *
 * O que É verdade, e o que estes testes travam:
 *   1. o limite real da cobertura da ANTT é o TETO (`maxPages` ≤ 20 contra as 82 páginas do
 *      portal; 5 na coleta leve) — e parar por teto devolvia `truncated: false`, o que fazia a
 *      conferência declarar "✓ Cobertura completa" comparando o banco contra uma fração;
 *   2. o paginador numérico é uma REDUNDÂNCIA barata: se o rótulo "Próximo" mudar de texto, for
 *      traduzido ou virar ícone, a descoberta continua andando em vez de parar em silêncio;
 *   3. `isTargetMeetingTitle` rejeitava a extraordinária que `classifyMeetingType` já sabia
 *      classificar — e não pode passar a admitir "Administrativa", calendário ou índice.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import {
  findNextPageUrl,
  parseLiferayPageLabel,
  isTargetMeetingTitle,
  classifyMeetingType,
} from "@/lib/server/antt-2026-collector";

const fixtures = join(dirname(fileURLToPath(import.meta.url)), "fixtures/antt");
const LISTAGEM = readFileSync(join(fixtures, "listagem-reunioes.html"), "utf-8");
const BASE = "https://portal.antt.gov.br/web/guest/reunioes-da-diretoria";

describe("etapa68 · o rótulo do paginador é lido da página real", () => {
  it("a fixture se declara «Página 1 de 82»", () => {
    expect(parseLiferayPageLabel(LISTAGEM)).toEqual({ atual: 1, total: 82 });
  });

  it("sem rótulo não se inventa paginação", () => {
    expect(parseLiferayPageLabel("<html><body>sem paginador</body></html>")).toBeNull();
  });
});

describe("etapa68 · a descoberta anda na listagem real", () => {
  it("encontra a próxima página — e a encontrava ANTES da mudança (a tese caiu aqui)", () => {
    const next = findNextPageUrl(LISTAGEM, BASE)!;
    expect(next).toBeTruthy();
    const cur = [...new URL(next).searchParams.entries()].find(([k]) => k.endsWith("_cur"));
    expect(cur?.[1], "a próxima é a página 2 do paginador do Liferay").toBe("2");
  });

  it("a fixture real TEM âncora «Próximo» — é isto que invalida o diagnóstico original", () => {
    // Documentado como teste porque é a evidência: sem ela, alguém relê o relatório da
    // investigação e "conserta" de novo um bug que não existe.
    expect(LISTAGEM).toMatch(/>\s*Próximo\s*</);
  });
});

describe("etapa68 · o paginador numérico é a rede de segurança", () => {
  it("sem «Próximo», a paginação ainda anda pelo número da página", () => {
    const html = `<html><body>Página 3 de 82
      <a href="/pag?cur=1">1</a><a href="/pag?cur=4">4</a><a href="/pag?cur=2">2</a></body></html>`;
    expect(findNextPageUrl(html, "https://x/")).toBe("https://x/pag?cur=4");
  });

  it("na ÚLTIMA página termina — o RÓTULO manda, mesmo com âncora seguinte no HTML", () => {
    // A primeira versão deste teste não exercitava nada: sem âncora "83", a busca falharia de
    // qualquer jeito e ele passava com ou sem o guard. Com a âncora presente, ele testa a
    // propriedade de verdade — quem diz onde a listagem acaba é o rótulo, não o que sobrou no DOM
    // (pager renderizado a mais, template com número fixo, cache de página).
    const html = `<html><body>Página 82 de 82
      <a href="/pag?cur=81">81</a><a href="/pag?cur=83">83</a></body></html>`;
    expect(findNextPageUrl(html, "https://x/")).toBeNull();
  });

  it("sem rótulo e sem «Próximo», não inventa página seguinte", () => {
    const html = `<html><body><a href="/x">2</a></body></html>`;
    expect(findNextPageUrl(html, "https://x/")).toBeNull();
  });

  it('o "próximo" explícito tem prioridade sobre o numérico', () => {
    const html = `<html><body>Página 1 de 5
      <a href="/pag/explicito">Próximo</a>
      <a href="/pag/numerico">2</a></body></html>`;
    expect(findNextPageUrl(html, "https://x/")).toBe("https://x/pag/explicito");
  });
});

describe("etapa68 · enumeração incompleta se declara incompleta", () => {
  it("o coletor marca `truncated` ao parar por teto, não só por orçamento", () => {
    // Prova de código: sair do laço com página pendente na fila é truncamento. Sem isto, a
    // conferência de cobertura lê "enumerei o portal inteiro" e pinta ✓ sobre metade dos dados.
    const fonte = readFileSync(join(fixtures, "../../../antt-2026-collector.ts"), "utf-8");
    // Fase 17 — a MESMA propriedade, agora numa função pura e testável por comportamento
    // (etapa102): o teto passou a ser consumido pelo total VISTO (novos + já conhecidos), porque
    // o skip-set subiu para a primeira volta. Contar só os coletados faria uma enumeração
    // truncada se declarar completa.
    expect(fonte).toMatch(/enumeracaoFoiParcial\(\{/);
    expect(fonte).toMatch(/filaPendente: listingQueue\.length/);
    expect(fonte).toMatch(/pulados: skippedKnown/);
  });
});

describe("etapa68 · o filtro de títulos: o que entra e o que NÃO entra", () => {
  // Guard de falso positivo: a paginação multiplica quantas páginas são lidas, então um filtro
  // frouxo passa a admitir lixo em escala. Estes títulos são os REAIS da listagem.
  it.each([
    "1036ª Reunião de Diretoria",
    "1040ª Reunião de Diretoria",
    "288ª Reunião Deliberativa Eletrônica",
  ])("«%s» é reunião-alvo", (t) => {
    expect(isTargetMeetingTitle(t)).toBe(true);
  });

  it.each([
    "193ª Reunião de Diretoria Administrativa",
    "Calendário das Reuniões de Diretoria",
    "Calendário de atividades das Reuniões de Diretoria",
    "Atas Reuniões Bilaterais e Multilaterais",
    "Reuniões da Diretoria",
  ])("«%s» continua FORA", (t) => {
    expect(isTargetMeetingTitle(t)).toBe(false);
  });

  it("a extraordinária deixa de ser rejeitada — a função irmã já sabia classificá-la", () => {
    expect(isTargetMeetingTitle("1041ª Reunião Extraordinária de Diretoria")).toBe(true);
    expect(classifyMeetingType("1041ª Reunião Extraordinária de Diretoria")).toBe("extraordinaria");
    // …mas a exclusão da administrativa vence a ampliação.
    expect(isTargetMeetingTitle("200ª Reunião Extraordinária de Diretoria Administrativa")).toBe(false);
  });

  it("a contagem de alvos da página real não muda com a ampliação", () => {
    // 13 é o número medido ANTES da ampliação da extraordinária. Mantê-lo é a prova de que a
    // mudança não afrouxou nada: mais alvos aqui seria lixo entrando, não cobertura.
    const titulos = [...LISTAGEM.matchAll(/<a\b[^>]*>([\s\S]*?)<\/a>/gi)]
      .map((m) => m[1].replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim())
      .filter((t) => t.includes("euni"));
    const alvos = new Set(titulos.filter(isTargetMeetingTitle));
    expect(alvos.size, "se a ampliação tivesse afrouxado o filtro, este número subiria").toBe(13);
  });
});
