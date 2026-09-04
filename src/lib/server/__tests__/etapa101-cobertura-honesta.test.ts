/**
 * Etapa 101 (Fase 17, commit D) — a cobertura para de mentir, e a queda vira alarme.
 *
 * ═══ Defeito 1: o instrumento afirma o contrário do que sabe ═══
 * `admin/cobertura-ao-vivo` existe para PROVAR cobertura. Quando o site devolve ZERO reuniões
 * (WAF, portal fora do ar, layout novo), `faltando` é `site.filter(...)` sobre uma lista vazia —
 * ou seja, `[]` — e nenhum alerta dispara: a tela imprime "✓ Cobertura completa" exatamente no
 * momento em que a fonte está invisível. É o pior modo de falha possível para um instrumento de
 * conferência: ele fica MAIS verde quanto menos enxerga.
 *
 * ═══ Defeito 2: "nada de novo" é indistinguível de "nada visto" ═══
 * O usuário perguntou se fazemos o que o `changedetection.io` faz. Não: nós re-parseamos a página
 * inteira e deduplicamos por `hash_item` (mais robusto que um diff de HTML), mas não temos o
 * ALARME que ele tem. `monitoramento_sites.ultimo_hash` é gravado e NUNCA lido; e
 * `monitoramento_runs.itens_encontrados` — o fingerprint que já existe, indexado desde a
 * migration 005 — nunca é comparado com a run anterior. Uma fonte que trazia 284 itens e passa a
 * trazer 0 termina a rodada com o banner verde.
 *
 * ⚠️ O alarme nasce COM consumidor. Capacidade sem consumidor já custou três vezes neste projeto
 * (`juizo`, `relator`, `CAPACIDADE_NOMINAL`): aqui ele grava em `monitoramento_alertas` — que o
 * Dashboard e a tela de Monitoramento já exibem — e a coluna `tipo` é VARCHAR(30) SEM CHECK
 * (005:162), então não precisa de migration.
 *
 * ═══ Defeito 3: bomba de relógio ═══
 * `YEAR = 2026` fixo no coletor da ANTT. Em 01/01/2027 a coleta zera em silêncio.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";

const RAIZ = join(__dirname, "../../../..");
const ler = (p: string) => readFileSync(join(RAIZ, p), "utf-8");
const semComentarios = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/\/\/.*$/gm, " ");
const COBERTURA = semComentarios(ler("src/app/api/v1/admin/cobertura-ao-vivo/route.ts"));
const RUNNER = semComentarios(ler("src/lib/server/monitoring-runner.ts"));
const COLETOR = semComentarios(ler("src/lib/server/antt-2026-collector.ts"));

describe("etapa101 · «zero no site» nunca mais é «cobertura completa»", () => {
  it("site vazio com banco cheio vira ERRO, não silêncio", () => {
    expect(COBERTURA).toMatch(/site\.length === 0 && banco\.length > 0/);
  });

  it("o instrumento reconhece a página de desafio — mesmo detector da coleta", () => {
    expect(COBERTURA).toMatch(/import \{[^}]*looksLikeChallenge[^}]*\} from "@\/lib\/server\/monitoring"/);
    expect(COBERTURA).toMatch(/looksLikeChallenge\(/);
  });

  it("o `extra` (banco − site) deixa de morrer no payload", () => {
    // Ele já era CALCULADO e nunca virava alerta: divergência ao contrário é sinal de que a
    // listagem encolheu (ou de que o banco tem lixo) — nos dois casos alguém precisa olhar.
    expect(COBERTURA).toMatch(/a\.extra\.length > 0/);
  });
});

describe("etapa101 · o alarme de QUEDA (o que o changedetection.io tem e nós não tínhamos)", () => {
  it("compara com a run ANTERIOR do mesmo site — o histórico já existe", () => {
    expect(RUNNER).toMatch(/from\("monitoramento_runs"\)[\s\S]{0,220}?itens_encontrados/);
    expect(RUNNER).toMatch(/quedaDeVolume|itensAnteriores/);
  });

  it("o alarme tem CONSUMIDOR: grava em monitoramento_alertas, que o Dashboard já exibe", () => {
    const bloco = RUNNER.slice(RUNNER.indexOf("quedaDeVolume"));
    expect(bloco).toMatch(/from\("monitoramento_alertas"\)/);
    expect(bloco).toMatch(/tipo: "queda_de_volume"/);
  });

  it("só alarma queda RELEVANTE — fonte que sempre trouxe pouco não vira ruído diário", () => {
    expect(RUNNER).toMatch(/MIN_ITENS_PARA_ALARME|>= \d+/);
  });
});

describe("etapa101 · a bomba de relógio do coletor da ANTT", () => {
  it("o ano vem do relógio, não de um literal — em 01/01/2027 a coleta não zera", () => {
    expect(COLETOR).not.toMatch(/const YEAR = 2026;/);
    expect(COLETOR).toMatch(/getFullYear\(\)/);
  });
});
