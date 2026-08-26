/**
 * Etapa 70 (Fase 9) — bloqueio de WAF deixa de ser "ok".
 *
 * ═══ O que foi medido ═══
 * Em 26/08/2026 pedi a página de reuniões da ARTESP e recebi **HTTP 200 com 6.183 bytes** que não
 * são a listagem: é a página de desafio do Imperva. A resposta literal está versionada em
 * `fixtures/artesp/imperva-desafio.html` — não é reconstituição, é o corpo que veio.
 *
 * ═══ Por que passava batido ═══
 * `resilientFetch` trata todo 2xx como sucesso; o parser acha zero itens; e a heurística de
 * `needs_headless` exige `!hasAnchors` — mas a página do Imperva tem **exatamente uma âncora**.
 * Uma única âncora derrota o detector inteiro. Resultado: a run ia para o banco como `ok`, com
 * `itens_encontrados: 0`, e uma agência inteira parou de ser coletada enquanto o painel dizia que
 * estava tudo bem. É a mesma família de bug das Fases 7-8: o dado existe, ninguém conta.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { looksLikeChallenge, parseArtespReunioes } from "@/lib/server/monitoring";

const fixtures = join(dirname(fileURLToPath(import.meta.url)), "fixtures/artesp");
const DESAFIO = readFileSync(join(fixtures, "imperva-desafio.html"), "utf-8");
const RAIZ = join(__dirname, "../../../..");
const ler = (p: string) => readFileSync(join(RAIZ, p), "utf-8");

describe("etapa70 · a resposta real do Imperva", () => {
  it("a fixture é a página de desafio, não a listagem", () => {
    expect(DESAFIO.length).toBeLessThan(10_000);
    expect(DESAFIO).toMatch(/Pardon Our Interruption/);
    expect(DESAFIO).toMatch(/_Incapsula_Resource/);
  });

  it("tem EXATAMENTE uma âncora — é o que derrota a heurística de headless", () => {
    // `needsHeadless` exige `!hasAnchors`. Um único `<a>` faz `hasAnchors` ser true e a página
    // passar como se fosse conteúdo legítimo. Este número é a razão de o detector novo existir.
    expect((DESAFIO.match(/<a\b/gi) ?? []).length).toBe(1);
  });

  it("o parser da ARTESP não tira nada dela — zero itens, sem erro", () => {
    expect(parseArtespReunioes(DESAFIO, "https://www.artesp.sp.gov.br/x")).toEqual([]);
  });

  it("`looksLikeChallenge` a reconhece", () => {
    expect(looksLikeChallenge(DESAFIO)).toBe(true);
  });
});

describe("etapa70 · cada caminho de detecção sozinho", () => {
  // A fixture real dispara TRÊS caminhos ao mesmo tempo (marcador Imperva, título, e a heurística
  // genérica de "pequena + noindex + sem conteúdo"). Isso é redundância boa no código, mas fazia o
  // teste não provar nada sobre cada um: remover um marcador continuava passando pelos outros.
  // Estes casos isolam — uma página GRANDE e COM conteúdo, onde só o marcador específico salva.
  const grandeComConteudo = (marcador: string) =>
    `<!DOCTYPE html><html><head><title>x</title></head><body>${marcador}` +
    `<table><tr><td>conteúdo</td></tr></table><li>a</li>${"x".repeat(20_000)}</body></html>`;

  it("o marcador do Imperva sozinho basta", () => {
    const html = grandeComConteudo('<script src="/_Incapsula_Resource?SWJIYLWA=x"></script>');
    expect(html.length, "grande o bastante para a heurística genérica não pegar").toBeGreaterThan(15_000);
    expect(looksLikeChallenge(html)).toBe(true);
  });

  it("o título do desafio sozinho basta", () => {
    expect(looksLikeChallenge(grandeComConteudo("<h1>Pardon Our Interruption</h1>"))).toBe(true);
  });

  it("a heurística genérica sozinha basta (WAF que não conhecemos)", () => {
    // Nenhum marcador de produto: só o formato — pequena, não-indexável, sem conteúdo de lista.
    const desconhecido = `<html><head><meta name="robots" content="noindex"></head><body><p>Blocked.</p></body></html>`;
    expect(looksLikeChallenge(desconhecido)).toBe(true);
  });

  it("e uma página grande, indexável e com conteúdo NÃO dispara nenhum deles", () => {
    expect(looksLikeChallenge(grandeComConteudo("<p>reuniões</p>"))).toBe(false);
  });
});

describe("etapa70 · o detector não pode acusar página legítima", () => {
  // Guard de falso positivo: marcar a run como `error` numa fonte que está apenas sem novidades
  // seria trocar um silêncio por um alarme falso — e alarme falso treina a ignorar alarme.
  it("página de listagem normal NÃO é desafio", () => {
    const legitima = `<!DOCTYPE html><html><head><title>Reuniões</title></head><body>
      <h2>1209ª Reunião do Conselho Diretor</h2>
      <ul><li><a href="/dam/a?binary=true">Ata</a></li><li><a href="/dam/b?binary=true">Pauta</a></li></ul>
      <table><tr><td>x</td></tr></table></body></html>`;
    expect(looksLikeChallenge(legitima)).toBe(false);
  });

  it("página pequena mas COM conteúdo de listagem não é desafio", () => {
    const curta = `<html><head><meta name="robots" content="noindex"></head><body><li>item</li></body></html>`;
    expect(looksLikeChallenge(curta), "tem <li>: é conteúdo, não desafio").toBe(false);
  });

  it("HTML vazio ou nulo não dispara", () => {
    expect(looksLikeChallenge("")).toBe(false);
  });

  it("reconhece também o Cloudflare, sem depender do Imperva", () => {
    expect(looksLikeChallenge("<html><body>Attention Required! | Cloudflare</body></html>")).toBe(true);
    expect(looksLikeChallenge('<html><body><div class="cf-browser-verification"></div></body></html>')).toBe(true);
  });
});

describe("etapa70 · o bloqueio chega ao banco como ERRO", () => {
  const MON = ler("src/lib/server/monitoring.ts");
  const RUNNER = ler("src/lib/server/monitoring-runner.ts");

  it("o resultado do fetch declara `bloqueado`", () => {
    expect(MON).toMatch(/bloqueado\?: boolean/);
    expect(MON).toMatch(/const bloqueado = items\.length === 0 && looksLikeChallenge\(firstHtml\)/);
  });

  it("um desafio FORÇA a tentativa headless, mesmo fora do gate de html-static", () => {
    expect(MON).toMatch(/const pareceDesafio = pageCount === 1 && looksLikeChallenge\(html\)/);
    expect(MON).toMatch(/\(isDocStatic \|\| pareceDesafio\)/);
  });

  it("a run vira `error`, não `ok`", () => {
    expect(RUNNER).toMatch(/result\.bloqueado \? "error" :/);
  });

  it("e leva MOTIVO — parar em silêncio seria o mesmo bug por outro nome", () => {
    expect(RUNNER).toMatch(/erroDoBloqueio/);
    expect(RUNNER).toMatch(/página de desafio \(WAF\)/);
    expect(RUNNER).toMatch(/ultimo_erro: erroDoBloqueio/);
  });

  it("reusa o status `error` — o CHECK da tabela é fechado e um valor novo exigiria migration", () => {
    const migration = ler("supabase/migrations/005_monitoramento_multiagency.sql");
    expect(migration).toMatch(/status[\s\S]{0,120}?'error'/);
    expect(RUNNER).not.toMatch(/status = .*"bloqueado"/);
  });
});
