import { describe, it, expect } from "vitest";
import { findBestMatch } from "@/lib/server/name-matcher";
import {
  shouldInferVotesFromMandate,
  buildVotoRows,
  getActiveDiretoresForVote,
  type DiretorVoteRecord,
} from "@/lib/server/vote-inference";

const DIR = (id: string, nome: string): DiretorVoteRecord => ({ id, nome, nome_variantes: [] });
const board: DiretorVoteRecord[] = [
  DIR("d1", "Guilherme Theo Rodrigues da Rocha Sampaio"),
  DIR("d2", "Lucas Asfor Rocha Lima"),
  DIR("d3", "Felipe Queiroz Fernandes"),
];
const DATA = "2026-03-15";

// ─── Quando (não) inferir por mandato — guarda anti-falsa-unanimidade ────────
describe("shouldInferVotesFromMandate (conservador)", () => {
  const base = { tipo_documento: "deliberacao", import_counts_as_final: true } as const;

  it("NÃO infere sem data da reunião (não sabe a composição)", () => {
    expect(shouldInferVotesFromMandate({ ...base, resultado: "Aprovado por Unanimidade", unanimidadeDetectada: true, dataReuniao: null })).toBe(false);
  });
  it("NÃO infere por simples quórum (≥2 assinaturas, sem nomes/unanimidade)", () => {
    expect(shouldInferVotesFromMandate({ ...base, resultado: "Aprovado", dataReuniao: DATA, nomes: [], signatariosCount: 4 })).toBe(false);
  });
  it("NÃO infere em 'Retirado de Pauta'", () => {
    expect(shouldInferVotesFromMandate({ ...base, resultado: "Retirado de Pauta", unanimidadeDetectada: true, dataReuniao: DATA })).toBe(false);
  });
  it("infere quando há unanimidade textual, sem nomes, com data", () => {
    expect(shouldInferVotesFromMandate({ ...base, resultado: "Aprovado", unanimidadeDetectada: true, nomes: [], dataReuniao: DATA })).toBe(true);
  });
  it("infere o restante quando há divergência nomeada, com data", () => {
    expect(shouldInferVotesFromMandate({ ...base, resultado: "Aprovado", nomesContra: ["Fulano"], dataReuniao: DATA })).toBe(true);
  });
  it("NÃO infere quando há nomes mas sem unanimidade nem divergência", () => {
    expect(shouldInferVotesFromMandate({ ...base, resultado: "Aprovado", nomes: ["Lucas Asfor Rocha Lima"], dataReuniao: DATA })).toBe(false);
  });
});

// ─── Composição na data ─────────────────────────────────────────────────────
describe("getActiveDiretoresForVote", () => {
  it("retorna [] sem data da reunião (sem inferir → sem diretor fantasma)", async () => {
    const r = await getActiveDiretoresForVote({} as any, "ag", null, board);
    expect(r).toEqual([]);
  });
});

// ─── Construção de votos ────────────────────────────────────────────────────
describe("buildVotoRows", () => {
  it("inferência marca is_nominal=false (Favorável) para os ativos sem voto nominal", () => {
    const rows = buildVotoRows({
      deliberacao_id: "x", nomes: [], nomesContra: [],
      diretoresList: board, activeDiretoresList: board, inferFromMandate: true, resultado: "Aprovado por Unanimidade",
    });
    expect(rows).toHaveLength(3);
    expect(rows.every((r) => r.tipo_voto === "Favoravel" && r.is_nominal === false && r.is_divergente === false)).toBe(true);
  });

  it("inferFromMandate=false → nenhum voto inventado", () => {
    const rows = buildVotoRows({
      deliberacao_id: "x", nomes: [], nomesContra: [],
      diretoresList: board, activeDiretoresList: board, inferFromMandate: false, resultado: "Aprovado",
    });
    expect(rows).toHaveLength(0);
  });

  it("voto contra nominal é registrado e marcado divergente (resultado positivo)", () => {
    const rows = buildVotoRows({
      deliberacao_id: "x", nomes: ["Guilherme Theo Rodrigues da Rocha Sampaio", "Felipe Queiroz Fernandes"],
      nomesContra: ["Lucas Asfor Rocha Lima"],
      diretoresList: board, activeDiretoresList: board, inferFromMandate: true, resultado: "Aprovado",
    });
    const lucas = rows.find((r) => r.diretor_id === "d2");
    expect(lucas?.tipo_voto).toBe("Desfavoravel");
    expect(lucas?.is_divergente).toBe(true);
    expect(lucas?.is_nominal).toBe(true);
    // os demais ficam favoráveis e não divergentes
    expect(rows.find((r) => r.diretor_id === "d1")?.is_divergente).toBe(false);
  });

  it("divergência é relativa ao resultado: em Indeferido, quem votou Favorável diverge; abstenção sempre diverge", () => {
    const rows = buildVotoRows({
      deliberacao_id: "x",
      nomes: ["Guilherme Theo Rodrigues da Rocha Sampaio"],
      nomesContra: [], nomesAbstencao: ["Felipe Queiroz Fernandes"],
      diretoresList: board, activeDiretoresList: board, inferFromMandate: false, resultado: "Indeferido",
    });
    expect(rows.find((r) => r.diretor_id === "d1")?.tipo_voto).toBe("Favoravel");
    expect(rows.find((r) => r.diretor_id === "d1")?.is_divergente).toBe(true); // favorável diverge de Indeferido
    expect(rows.find((r) => r.diretor_id === "d3")?.tipo_voto).toBe("Abstencao");
    expect(rows.find((r) => r.diretor_id === "d3")?.is_divergente).toBe(true); // abstenção sempre
  });

  it("ANTI-PIOR-CASO: voto contra com match médio (0,6–0,85) não vira voto, mas BLOQUEIA o favorável inferido", () => {
    const dir = DIR("dx", "Alessandro Baumgartner");
    const contraName = "Alexandro Baungarte"; // grafia errada → match médio ~0,77 (needsReview)
    const m = findBestMatch(contraName, [dir]);
    expect(m.diretorId).toBe("dx");
    expect(m.needsReview).toBe(true);          // confirma que está na faixa de descarte
    expect(m.score).toBeGreaterThanOrEqual(0.6);

    const rows = buildVotoRows({
      deliberacao_id: "x", nomes: [], nomesContra: [contraName],
      diretoresList: [dir], activeDiretoresList: [dir], inferFromMandate: true, resultado: "Aprovado",
    });
    // não inventou "Favoravel" para quem o documento aponta como contra (mesmo com match médio)
    expect(rows.find((r) => r.diretor_id === "dx")).toBeUndefined();
  });
});
