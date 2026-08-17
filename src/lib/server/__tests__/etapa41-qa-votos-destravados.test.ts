import { describe, it, expect } from "vitest";
import { shouldInferVotesFromMandate, buildVotoRows } from "@/lib/server/vote-inference";
import { applyRetroactiveVotes } from "@/lib/server/retroactive-votes";

// QA ago/2026 — os 3 mecanismos que deixavam deliberações finais SEM voto:
//  (1) retroativos: guard antigo pulava TUDO quando o diretor não tinha mandato (active=[]);
//  (2) ARTESP: signatários extraídos que NÃO casam com o cadastro desligavam a inferência
//      sem produzir voto nominal (hasNominalNames por extração, não por match);
//  (3) buildVotoRows com roster do pai (fallback do item ANTT unânime).

const DIRETORES = [
  { id: "d1", nome: "Felipe Fernandes Queiroz", nome_variantes: [] },
  { id: "d2", nome: "Lucas Asfor Rocha Lima", nome_variantes: [] },
];

describe("hasNominalNames por nomes CASADOS [etapa41]", () => {
  const base = {
    resultado: "Aprovado por Unanimidade",
    tipo_documento: "deliberacao",
    import_counts_as_final: true,
    unanimidadeDetectada: true,
    dataReuniao: "2026-05-10",
  };

  it("signatários que NÃO casam com o cadastro não desligam a inferência", () => {
    expect(shouldInferVotesFromMandate({
      ...base,
      nomes: ["Mariana Costa e Silva", "Roberto Guimaraes Pinto"], // rodapé ARTESP, sem match
      diretoresList: DIRETORES,
    })).toBe(true);
  });

  it("nome que CASA (voto nominal real) continua desligando a inferência", () => {
    expect(shouldInferVotesFromMandate({
      ...base,
      nomes: ["Felipe Fernandes Queiroz"],
      diretoresList: DIRETORES,
    })).toBe(false);
  });

  it("sem diretoresList mantém o comportamento antigo (compat)", () => {
    expect(shouldInferVotesFromMandate({ ...base, nomes: ["Qualquer Nome"] })).toBe(false);
    expect(shouldInferVotesFromMandate({ ...base, nomes: [] })).toBe(true);
  });
});

describe("roster do pai preenche item unânime [etapa41]", () => {
  it("unanimidade + roster (presentes do pai) → todos Favorável inferido, sem divergente", () => {
    const rows = buildVotoRows({
      deliberacao_id: "del-1",
      nomes: [], // item ANTT: presentes não são nominais
      nomesContra: [],
      diretoresList: DIRETORES,
      activeDiretoresList: DIRETORES,
      inferFromMandate: true,
      resultado: "Aprovado",
      unanime: true,
    });
    expect(rows).toHaveLength(2);
    expect(rows.every((r) => r.tipo_voto === "Favoravel" && !r.is_nominal && !r.is_divergente)).toBe(true);
  });
});

describe("retroativos destravados (guard active=[]) [etapa41]", () => {
  // db fake: sem mandatos (getActiveDiretoresForVote → []); 1 deliberação com o nome.
  function fakeDb(collector: { upserts: any[]; audits: any[] }) {
    return {
      from(table: string) {
        return {
          select() { return this; },
          eq() { return this; },
          lte() { return this; },
          or() { return this; },
          limit() {
            if (table === "deliberacoes") {
              return Promise.resolve({
                data: [{
                  id: "del-9", data_reuniao: "2026-03-05", numero_deliberacao: "31",
                  resultado: "Aprovado", tipo_documento: "deliberacao",
                  raw_extraction: { nomes_votacao: ["Felipe Fernandes Queiroz"] },
                }],
                error: null,
              });
            }
            return Promise.resolve({ data: [], error: null });
          },
          then(resolve: any) {
            // mandatos query resolve via await direto (sem .limit)
            resolve({ data: [], error: null });
          },
          upsert(rows: any) { collector.upserts.push(...(Array.isArray(rows) ? rows : [rows])); return Promise.resolve({ error: null }); },
          insert(row: any) { if (table === "votos_retroativos_audit") collector.audits.push(row); return Promise.resolve({ error: null }); },
        };
      },
    };
  }

  it("diretor recém-aprovado SEM mandato → votos criados (antes: 0) + primeira_data", async () => {
    const collector = { upserts: [] as any[], audits: [] as any[] };
    const r = await applyRetroactiveVotes(fakeDb(collector) as any, {
      candidato: { id: "c1", agencia_id: "ag1", nome_detectado: "Felipe Fernandes Queiroz" },
      diretorId: "d1",
      reviewedBy: null,
    });
    expect(r.deliberacoes).toBe(1);
    expect(r.criados).toBe(1);
    expect(r.ignorados_fora_mandato).toBe(0);
    expect(r.primeira_data).toBe("2026-03-05");
    expect(collector.upserts[0]).toMatchObject({ deliberacao_id: "del-9", diretor_id: "d1", tipo_voto: "Favoravel" });
  });
});
