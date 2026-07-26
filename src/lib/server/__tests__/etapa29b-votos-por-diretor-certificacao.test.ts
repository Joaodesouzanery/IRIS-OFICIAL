import { describe, it, expect } from "vitest";
import { buildVotoRows, type DiretorVoteRecord } from "@/lib/server/vote-inference";

// BLOCO 1 F6 — o golden-set `vote-certification` roda com db:null → getDiretoresList()=[] →
// buildVotoRows NUNCA executa com diretores reais: as LINHAS DE VOTO por diretor (tipo_voto,
// is_nominal, match por variante, direção) ficavam sem certificação. Este teste fecha o furo
// exercitando buildVotoRows diretamente (função pura, sem DB).

const DIRS: DiretorVoteRecord[] = [
  { id: "d-ana", nome: "Ana Beatriz Silva", nome_variantes: ["Ana Beatriz Silva", "Ana Silva"] },
  { id: "d-bruno", nome: "Bruno Costa Lima", nome_variantes: ["Bruno Costa Lima", "Bruno Lima"] },
  { id: "d-carlos", nome: "Carlos Eduardo Nunes", nome_variantes: ["Carlos Eduardo Nunes", "Carlos Nunes"] },
];
const byId = (rows: ReturnType<typeof buildVotoRows>) => Object.fromEntries(rows.map((r) => [r.diretor_id, r]));

describe("certificação das linhas de voto por diretor [F6]", () => {
  it("NOMINAL: nomes lidos + 1 contra → direção correta, todos is_nominal=true", () => {
    const rows = buildVotoRows({
      deliberacao_id: "delib-1",
      nomes: ["Ana Beatriz Silva", "Bruno Costa Lima", "Carlos Eduardo Nunes"],
      nomesContra: ["Bruno Costa Lima"],
      diretoresList: DIRS,
      activeDiretoresList: DIRS,
      inferFromMandate: false,
      resultado: "Aprovado",
      unanime: false,
    });
    const m = byId(rows);
    expect(m["d-ana"].tipo_voto).toBe("Favoravel");
    expect(m["d-bruno"].tipo_voto).toBe("Desfavoravel");
    expect(m["d-carlos"].tipo_voto).toBe("Favoravel");
    expect(rows.every((r) => r.is_nominal)).toBe(true);
  });

  it("INFERIDO: unanimidade sem nomes + mandato → todos Favoravel is_nominal=false", () => {
    const rows = buildVotoRows({
      deliberacao_id: "delib-2",
      nomes: [],
      nomesContra: [],
      diretoresList: DIRS,
      activeDiretoresList: DIRS,
      inferFromMandate: true,
      resultado: "Aprovado por Unanimidade",
      unanime: true,
    });
    expect(rows).toHaveLength(3);
    expect(rows.every((r) => r.tipo_voto === "Favoravel")).toBe(true);
    expect(rows.every((r) => r.is_nominal === false)).toBe(true);
  });

  it("MATCH POR VARIANTE: 'Ana Silva' (variante) → d-ana Desfavoravel nominal", () => {
    const rows = buildVotoRows({
      deliberacao_id: "delib-3",
      nomes: [],
      nomesContra: ["Ana Silva"],
      diretoresList: DIRS,
      activeDiretoresList: DIRS,
      inferFromMandate: false,
      resultado: "Aprovado",
      unanime: false,
    });
    const ana = rows.find((r) => r.diretor_id === "d-ana");
    expect(ana?.tipo_voto).toBe("Desfavoravel");
    expect(ana?.is_nominal).toBe(true);
  });

  it("PROTEÇÃO P3: com mandato, um contra NOMEADO não vira 'Favoravel' inferido", () => {
    // "Bruno Lima" (variante) é o dissidente; os demais são completados por mandato (inferido).
    const rows = buildVotoRows({
      deliberacao_id: "delib-4",
      nomes: [],
      nomesContra: ["Bruno Lima"],
      diretoresList: DIRS,
      activeDiretoresList: DIRS,
      inferFromMandate: true,
      resultado: "Aprovado",
      unanime: false,
    });
    const m = byId(rows);
    expect(m["d-bruno"].tipo_voto).toBe("Desfavoravel"); // nominal, NÃO favor inferido
    expect(m["d-bruno"].is_nominal).toBe(true);
    expect(m["d-ana"].tipo_voto).toBe("Favoravel");
    expect(m["d-ana"].is_nominal).toBe(false); // inferido do mandato
  });
});
