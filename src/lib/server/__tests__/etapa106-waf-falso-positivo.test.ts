/**
 * Etapa 106 (Fase 17, commit J) — "a ARTESP está bloqueada pelo WAF" era, em parte, ERRO NOSSO.
 *
 * ═══ A medição (04/set/2026, contra o portal ao vivo) ═══
 * A listagem de reuniões da ARTESP respondeu **HTTP 200 com 196 KB de conteúdo real**: 129
 * ocorrências de "Deliberação", 210 de "Reunião", zero ocorrências de "Pardon Our Interruption".
 * O parser do projeto encontra **264 itens** nela — incluindo a 1210ª Reunião de 02/09/2026.
 * A página está ACESSÍVEL.
 *
 * E mesmo assim `looksLikeChallenge()` devolvia `true` para ela.
 *
 * ═══ A causa ═══
 * O detector da Fase 9 trata `_Incapsula_Resource` / `\bIncapsula\b` como prova de desafio. Mas
 * esse é o script SENSOR do Imperva — ele roda em TODA página do portal, bloqueada ou não:
 *   <script src="/_Incapsula_Resource?SWJIYLWA=719d34...&ns=1&cb=1433203664">
 * A fixture que existia (`reunioes-diretoria.html`, 1,6 KB recortados à mão) não continha o
 * sensor, então o falso positivo nunca apareceu em teste.
 *
 * ═══ Por que isso é grave, e não acadêmico ═══
 * 1. Diagnóstico: três fases carregaram "a ARTESP está bloqueada" como fato. O que a coleta
 *    prova é `items.length === 0` — e a atribuição da CAUSA ao WAF vinha de um marcador que
 *    sempre casa. Zero itens com a página inteira em mãos é mudança de LAYOUT, não bloqueio.
 * 2. Regressão que eu acabei de introduzir: no commit C desta mesma fase, o enfileiramento passou
 *    a checar `looksLikeChallenge(html)` ANTES de procurar PDFs. Com o falso positivo, QUALQUER
 *    página do portal viraria `waf_desafio` e entraria em 25 dias de retry inútil. O conserto
 *    aqui é pré-requisito daquele commit — e é por isso que ele vem junto.
 *
 * ═══ O contrato novo ═══
 * Marcador de SENSOR não é marcador de DESAFIO. Ele só conta com corroboração: página sem
 * conteúdo de listagem. Os sinais que continuam bastando sozinhos são os que só aparecem numa
 * resposta de bloqueio de verdade ("Pardon Our Interruption", "Request unsuccessful… incident
 * ID", `cf-browser-verification`).
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import { looksLikeChallenge, parseArtespReunioes } from "@/lib/server/monitoring";

const fixtures = join(dirname(fileURLToPath(import.meta.url)), "fixtures/artesp");
/** Baixada ao vivo em 04/09/2026 — não é reconstituição, é o corpo que veio. */
const PAGINA_REAL = readFileSync(join(fixtures, "reunioes-com-sensor-incapsula.html"), "utf-8");
const DESAFIO = readFileSync(join(fixtures, "imperva-desafio.html"), "utf-8");

describe("etapa106 · a página real do portal NÃO é um desafio", () => {
  it("a fixture é a listagem de verdade: grande, com conteúdo, e com o SENSOR do Imperva", () => {
    expect(PAGINA_REAL.length).toBeGreaterThan(100_000);
    expect(PAGINA_REAL).toMatch(/_Incapsula_Resource/);
    expect(PAGINA_REAL).not.toMatch(/Pardon Our Interruption/);
    expect((PAGINA_REAL.match(/Reuni/gi) ?? []).length).toBeGreaterThan(100);
  });

  it("looksLikeChallenge devolve FALSE para ela — era `true`, e isso é o bug", () => {
    expect(looksLikeChallenge(PAGINA_REAL)).toBe(false);
  });

  it("e o parser extrai a listagem inteira dela — prova de que não há bloqueio", () => {
    const itens = parseArtespReunioes(PAGINA_REAL, "https://www.artesp.sp.gov.br/artesp/transparencia/reunioes-diretoria");
    expect(itens.length).toBeGreaterThan(200);
    // Material de 2026 que a coleta deveria estar trazendo.
    expect(itens.some((i) => (i.data_reuniao ?? "").startsWith("2026"))).toBe(true);
  });
});

describe("etapa106 · o desafio DE VERDADE continua sendo reconhecido", () => {
  it("a fixture do bloqueio real ainda dispara", () => {
    expect(looksLikeChallenge(DESAFIO)).toBe(true);
  });

  it("o sensor COM corpo sem conteúdo dispara — a corroboração é o que passou a valer", () => {
    const bloqueioCurto =
      `<html><head><script src="/_Incapsula_Resource?SWJIYLWA=x"></script></head><body><p>Blocked</p></body></html>`;
    expect(looksLikeChallenge(bloqueioCurto)).toBe(true);
  });

  it("os marcadores que só existem em resposta de bloqueio continuam bastando sozinhos", () => {
    const grandeComConteudo = (marcador: string) =>
      `<!DOCTYPE html><html><head><title>x</title></head><body>${marcador}` +
      `<table><tr><td>conteúdo</td></tr></table><li>a</li>${"x".repeat(20_000)}</body></html>`;
    expect(looksLikeChallenge(grandeComConteudo("<h1>Pardon Our Interruption</h1>"))).toBe(true);
    expect(looksLikeChallenge(grandeComConteudo("<p>Request unsuccessful. Incapsula incident ID: 1-2</p>"))).toBe(true);
  });
});
