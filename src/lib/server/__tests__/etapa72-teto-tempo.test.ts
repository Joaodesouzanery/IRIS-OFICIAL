/**
 * Etapa 72 (Fase 10, commit 0) — MEDIR o teto de execução antes de orçar em cima dele.
 *
 * ═══ O que este arquivo protege ═══
 * Três fases de orçamento foram construídas sobre um número que ninguém mediu: "no Hobby o
 * SIGKILL vem aos 60s". As duas evidências que circulavam não sustentam a afirmação — o Vercel
 * aceita `maxDuration` acima do plano e rebaixa em runtime, e ver a função viva aos 90s prova um
 * piso, não um teto. Esta rota troca a inferência por uma medição de dois minutos.
 *
 * As propriedades abaixo são as que fazem a medição valer e não custar caro:
 *  1. `maxDuration` 120 — o valor que os builds do projeto já usam, para a rota que vai MEDIR o
 *     teto não introduzir ela própria um risco de validação de configuração;
 *  2. auth ANTES do sono — senão qualquer anônimo queima 290s de função por requisição;
 *  3. teto no parâmetro — `?ms=99999999` não pode virar uma invocação infinita;
 *  4. nenhuma escrita — a rota que investiga não pode alterar o que está sendo investigado.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";

const RAIZ = join(__dirname, "../../../..");
const CAMINHO = "src/app/api/v1/admin/diagnostico/teto-tempo/route.ts";
const ROTA = readFileSync(join(RAIZ, CAMINHO), "utf-8");

/** Fonte sem comentários: asserções de ORDEM e de AUSÊNCIA não podem casar com a prosa. */
const CODIGO = ROTA.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");

describe("etapa72 · a rota que mede o teto", () => {
  it("declara maxDuration 120 — o teto já provado em build, não um valor novo", () => {
    // Declarar 300 aqui trocaria um risco conhecido por um desconhecido: a validação de
    // configuração do Vercel quebra em 4-5s, ANTES do build, e o `npm run build` local passa
    // verde sem ver nada. Foi assim que 8 deploys caíram em 26/08.
    const match = /export const maxDuration = (\d+)/.exec(CODIGO);
    expect(match, "a rota precisa declarar maxDuration explicitamente").not.toBeNull();
    expect(Number(match![1])).toBe(120);
  });

  it("autentica ANTES de dormir — anônimo não queima tempo de função", () => {
    const guard = CODIGO.indexOf("requireAdmin(req)");
    const sono = CODIGO.indexOf("setTimeout");
    expect(guard, "a rota precisa chamar requireAdmin").toBeGreaterThan(-1);
    expect(sono, "a rota precisa dormir — é o que ela mede").toBeGreaterThan(-1);
    expect(guard).toBeLessThan(sono);
    // E o retorno do guard tem de cortar o fluxo, não só ser calculado.
    expect(CODIGO).toMatch(/if \(guard\) return guard;/);
  });

  it("limita o parâmetro — `?ms=99999999` não vira invocação sem fim", () => {
    expect(CODIGO).toMatch(/Math\.min\(Math\.round\(bruto\), MAX_MS\)/);
    const teto = /const MAX_MS = ([\d_]+)/.exec(CODIGO);
    expect(teto).not.toBeNull();
    expect(Number(teto![1].replace(/_/g, ""))).toBeLessThanOrEqual(290_000);
  });

  it("recusa `ms` inválido com 400, sem dormir", () => {
    expect(CODIGO).toMatch(/Number\.isFinite\(bruto\)/);
    const erro400 = CODIGO.indexOf("status: 400");
    const sono = CODIGO.indexOf("setTimeout");
    expect(erro400).toBeGreaterThan(-1);
    expect(erro400).toBeLessThan(sono);
  });

  it("não escreve nada nem consulta o banco — a medição não altera o medido", () => {
    expect(CODIGO).not.toContain("createSupabaseServerClient");
    expect(CODIGO).not.toContain(".from(");
    expect(CODIGO).not.toContain(".update(");
    expect(CODIGO).not.toContain(".insert(");
  });

  it("devolve o medido, não só o pedido — pedido sem decorrido não prova nada", () => {
    // Se a função for rebaixada e morrer, não há resposta; mas se responder, `decorrido_ms` é o
    // que distingue "dormiu 110s" de "o runtime encurtou o sono".
    expect(CODIGO).toMatch(/decorrido_ms/);
    expect(CODIGO).toMatch(/Date\.now\(\) - inicio/);
  });
});
