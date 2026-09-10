/**
 * Etapa 139 (Fase 26, commit 1) — o voto inferido acompanha o colegiado.
 *
 * Aprovado com os números do qa-fase25 ④: 700 votos na ARTESP, 72 na ANM e 10 na ANTT eram
 * "Favoravel" inferido em deliberação INDEFERIDA — o sistema afirmava que o diretor foi favorável
 * ao pedido que o colegiado negou, e o marcava divergente quando não unânime. "% Favorável" era
 * 100% para todo diretor sem voto nominal (a coluna não media nada).
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";
import { buildVotoRows, tipoVotoInferido, type DiretorVoteRecord } from "@/lib/server/vote-inference";

const ROSTER: DiretorVoteRecord[] = [
  { id: "a", nome: "Mauro Henrique Moreira Sousa", nome_variantes: [] },
  { id: "b", nome: "Caio Mário Trivellato Seabra Filho", nome_variantes: [] },
];
const base = { deliberacao_id: "d", nomes: [], nomesContra: [], nomesAusente: [], nomesAbstencao: [], diretoresList: ROSTER, activeDiretoresList: ROSTER, inferFromMandate: true };

describe("etapa139 · resultado → tipo do voto inferido", () => {
  it.each([
    ["Indeferido", "Desfavoravel"],
    ["Aprovado", "Favoravel"],
    ["Deferido", "Favoravel"],
    ["Ratificado", "Favoravel"],
    ["Retirado de Pauta", null],
    [null, null],
  ] as Array<[string | null, string | null]>)("%s → %s", (resultado, esperado) => {
    expect(tipoVotoInferido(resultado)).toBe(esperado);
  });
});

describe("etapa139 · o que buildVotoRows grava", () => {
  it("Indeferido NÃO unânime: inferidos são Desfavoráveis e NÃO divergentes (acompanharam)", () => {
    const rows = buildVotoRows({ ...base, resultado: "Indeferido", unanime: false });
    expect(rows).toHaveLength(2);
    expect(rows.every((r) => r.tipo_voto === "Desfavoravel" && r.is_divergente === false && r.is_nominal === false)).toBe(true);
  });
  it("Retirado de Pauta: NENHUM voto inferido (não se infere sobre o que não foi decidido)", () => {
    expect(buildVotoRows({ ...base, resultado: "Retirado de Pauta", unanime: false })).toEqual([]);
  });
  it("voto LIDO contra o desfecho continua divergente — só o inferido é 'acompanhou'", () => {
    const rows = buildVotoRows({ ...base, nomes: ["Mauro Henrique Moreira Sousa"], resultado: "Indeferido", unanime: false });
    const lido = rows.find((r) => r.diretor_id === "a")!;
    expect(lido.is_nominal).toBe(true);
    expect(lido.tipo_voto).toBe("Favoravel");
    expect(lido.is_divergente).toBe(true);
    const inferido = rows.find((r) => r.diretor_id === "b")!;
    expect(inferido.tipo_voto).toBe("Desfavoravel");
    expect(inferido.is_divergente).toBe(false);
  });
});

describe("etapa139 · o histórico é reescrito pela mesma regra, uma vez", () => {
  const RAIZ = join(__dirname, "../../../..");
  it("a rota de recálculo tem o modo direcao e o pipeline o chama", () => {
    const rota = readFileSync(join(RAIZ, "src/app/api/v1/votos/recalcular-divergencia/route.ts"), "utf-8");
    expect(rota).toMatch(/const alvo = tipoVotoInferido\(d\.resultado \?\? null\)/);
    expect(rota).toMatch(/if \(isVotoNominal\(v\) \|\| v\.proveniencia === "revisao_humana"\) continue;/);
    expect(rota).toMatch(/direcao_corrigida: direcaoCorrigida/);
    const run = readFileSync(join(RAIZ, "src/app/api/v1/pipeline/run/route.ts"), "utf-8");
    expect(run).toMatch(/recalcular-divergencia\?apply=1&direcao=1/);
  });
});
