/**
 * Etapa 18 — fechamento do QA da esteira zero-toque de votos ANTT:
 * dispositivos de voto ampliados, número VOTO-* estável, gate de auto-confirm
 * dedicado a voto_individual, dedup voto×ata por processo+reunião, e o filtro
 * de órgão interno restrito aos INTERNOS (externos como DNIT voltam ao ranking).
 */
import { describe, it, expect } from "vitest";
import { parseAnttManualDocument } from "@/lib/server/antt-manual-parser";
import { canAutoConfirm, type AutoConfirmDoc } from "@/lib/server/auto-confirm";
import { findDeliberacaoExistente } from "@/lib/server/deliberacao-dedup";
import { isOrgaoInterno } from "@/lib/server/empresa-resolver";

// ─── helpers ─────────────────────────────────────────────────────────────────

// Documento de voto ANTT sintético com conclusão parametrizável.
function votoText(conclusao: string) {
  return [
    "AGÊNCIA NACIONAL DE TRANSPORTES TERRESTRES - ANTT",
    "VOTO DFQ 043/2026",
    "RELATORIA: Diretoria Felipe Queiroz - DFQ",
    "PROCESSO: 50500.123456/2026-11",
    "OBJETO: Recurso administrativo interposto pela empresa Exemplo Rodovias S.A.",
    `Diante do exposto, ${conclusao}`,
    "Documento assinado eletronicamente",
  ].join("\n");
}

function parseVoto(conclusao: string) {
  return parseAnttManualDocument(votoText(conclusao), "Voto DFQ 043-2026.pdf");
}

// Stub de db encadeável (mesmo padrão do etapa16-cobertura-dedup.test.ts).
function makeDb(resultsByTable: Record<string, unknown[]>) {
  const take = (table: string) => {
    const q = resultsByTable[table] ?? [];
    return q.length > 1 ? q.shift() : q[0] ?? { data: null, error: null };
  };
  const db: any = {
    from(table: string) {
      const result = take(table);
      const chain: any = {};
      for (const m of ["select", "eq", "neq", "in", "is", "not", "order", "limit", "gte", "lte", "lt", "insert", "update", "upsert", "delete"]) {
        chain[m] = () => chain;
      }
      chain.single = async () => result;
      chain.maybeSingle = async () => result;
      chain.then = (res: any, rej: any) => Promise.resolve(result).then(res, rej);
      return chain;
    },
  };
  return db;
}

// ─── inferResultado ampliado (via parseAnttManualDocument) ───────────────────

describe("inferResultado (voto_individual) — dispositivos ampliados", () => {
  const casos: Array<[string, string | null]> = [
    ["VOTO por conhecer do recurso e, no mérito, dar provimento ao pedido.", "Deferido"],
    ["voto pelo deferimento do pleito da concessionária.", "Deferido"],
    ["julgo procedente o pedido de revisão tarifária.", "Deferido"],
    ["voto por negar provimento ao recurso interposto.", "Indeferido"],
    ["voto pelo indeferimento do requerimento.", "Indeferido"],
    // Etapa54: não-conhecimento deixou de ser "Indeferido". É juízo de ADMISSIBILIDADE — o
    // colegiado não julgou o pedido, julgou se podia julgá-lo. Somado ao balde negativo, a
    // taxa de deferimento passava a medir prazo processual junto com jurisprudência. O caso
    // continua detectado, agora por `detectJuizo` (ver etapa54-dispositivo-juizo.test.ts).
    ["voto por não conhecer do recurso, por intempestivo.", null],
    ["julgo improcedente o pedido.", "Indeferido"],
    ["voto pela homologação do resultado do leilão.", "Ratificado"],
    ["voto pela ratificação da decisão da Superintendência.", "Ratificado"],
    ["voto pela aprovação da minuta de resolução.", "Aprovado"],
    ["voto por autorizar a transferência de controle societário.", "Autorizado"],
    ["voto por recomendar a celebração do termo aditivo.", "Recomendado"],
    ["voto por determinar à concessionária a execução das obras.", "Determinado"],
    ["voto pela retirada de pauta do presente processo.", "Retirado de Pauta"],
  ];

  for (const [conclusao, esperado] of casos) {
    it(`"${conclusao.slice(0, 45)}..." → ${esperado}`, () => {
      const r = parseVoto(conclusao);
      expect(r.documentType).toBe("voto_individual");
      expect(r.fields.resultado ?? null).toBe(esperado);
    });
  }

  it("negativo tem precedência: 'negar provimento' NÃO vira Deferido", () => {
    const r = parseVoto("voto por conhecer do recurso e negar provimento.");
    expect(r.fields.resultado).toBe("Indeferido");
  });

  it("texto ambíguo → null + warning (nunca chutar a direção do voto)", () => {
    const r = parseVoto("submeto o presente à deliberação do colegiado.");
    expect(r.fields.resultado ?? null).toBeNull();
    expect(r.warnings.some((w) => w.includes("conclusão do voto não identificada"))).toBe(true);
  });
});

describe("extractAnttDocumentNumber — chave estável VOTO-*", () => {
  it("'Voto DFQ 043/2026' → VOTO-DFQ-043-2026 (dedup do mesmo voto reprocessado)", () => {
    const r = parseVoto("voto pelo deferimento.");
    expect(r.fields.numero_deliberacao).toBe("VOTO-DFQ-043-2026");
  });

  it("relator lido entra em nomes_votacao (backfillável se não casar)", () => {
    const r = parseVoto("voto pelo deferimento.");
    expect(r.fields.nomes_votacao).toEqual(["Felipe Queiroz"]);
  });
});

// ─── gate de auto-confirm do voto_individual ─────────────────────────────────

function votoDoc(overrides: Partial<AutoConfirmDoc> & { fields?: Record<string, unknown> } = {}): AutoConfirmDoc {
  const { fields, ...rest } = overrides;
  return {
    id: "doc1",
    status: "review_pending",
    extraction_confidence: 0.8,
    chars_per_page: 900,
    is_duplicate: false,
    agencia_id: "ag-antt",
    warnings: [],
    relator_match_ok: true,
    campos_detectados: {
      preview: {
        fields: {
          tipo_documento: "voto_individual",
          relator: "Felipe Queiroz",
          resultado: "Deferido",
          processo: "50500.123456/2026-11",
          data_reuniao: "2026-06-10",
          ...(fields ?? {}),
        },
      },
    },
    ...rest,
  };
}

describe("canAutoConfirm — voto_individual (gate dedicado)", () => {
  it("relator casado + resultado + chave de dedup → confirma", () => {
    const r = canAutoConfirm(votoDoc());
    expect(r.ok).toBe(true);
    expect(r.reason).toContain("relator lido");
  });

  it("sem relator_match_ok → recusa (relator sem match ≥0.85)", () => {
    const r = canAutoConfirm(votoDoc({ relator_match_ok: false }));
    expect(r.ok).toBe(false);
    expect(r.reason).toContain("relator sem match");
  });

  it("sem resultado extraído → recusa", () => {
    const r = canAutoConfirm(votoDoc({ fields: { resultado: null } }));
    expect(r.ok).toBe(false);
    expect(r.reason).toContain("sem resultado");
  });

  it("sem processo E sem data (sem chave de dedup) → recusa", () => {
    const r = canAutoConfirm(votoDoc({ fields: { processo: null, data_reuniao: null } }));
    expect(r.ok).toBe(false);
    expect(r.reason).toContain("sem chave de dedup");
  });

  it("confiança 0.7 basta para voto (limiar dedicado, não o 0.9 geral)", () => {
    expect(canAutoConfirm(votoDoc({ extraction_confidence: 0.72 })).ok).toBe(true);
    expect(canAutoConfirm(votoDoc({ extraction_confidence: 0.65 })).ok).toBe(false);
  });

  it("warning de qualidade → recusa mesmo com tudo mais ok", () => {
    const r = canAutoConfirm(votoDoc({ warnings: ["ANTT: conclusão do voto não identificada — resultado NÃO inferido; revisar."] }));
    expect(r.ok).toBe(false);
  });
});

// ─── dedup voto×ata por processo normalizado + numero_reuniao ────────────────

describe("findDeliberacaoExistente — fallback voto×ata (processo + reunião)", () => {
  it("mesmo processo (formatação diferente) na mesma reunião, SEM data → casa", async () => {
    const db = makeDb({
      deliberacoes: [
        // única query executada: fallback por numero_reuniao (sem numero nem data no key)
        { data: [{ id: "ata-item-7", resultado: "Deferido", data_reuniao: "2026-06-10", reuniao_id: "r1", processo: "50500 123456 2026 11" }], error: null },
      ],
    });
    const dup = await findDeliberacaoExistente(db, {
      agenciaId: "ag-antt",
      processo: "50500.123456/2026-11",
      numeroReuniao: "1036",
    });
    expect(dup?.id).toBe("ata-item-7");
  });

  it("processo diferente na mesma reunião → NÃO casa", async () => {
    const db = makeDb({
      deliberacoes: [
        { data: [{ id: "outro", resultado: null, data_reuniao: null, reuniao_id: null, processo: "50500.999999/2026-00" }], error: null },
      ],
    });
    const dup = await findDeliberacaoExistente(db, {
      agenciaId: "ag-antt",
      processo: "50500.123456/2026-11",
      numeroReuniao: "1036",
    });
    expect(dup).toBeNull();
  });
});

// ─── isOrgaoInterno restrito a INTERNOS (QA D — decisão de produto) ──────────

describe("isOrgaoInterno — externos voltam ao ranking", () => {
  it("órgãos EXTERNOS não são filtrados (DNIT, Ministério, Secretaria, DER)", () => {
    expect(isOrgaoInterno("DNIT - Departamento Nacional de Infraestrutura de Transportes")).toBe(false);
    expect(isOrgaoInterno("Ministério dos Transportes")).toBe(false);
    expect(isOrgaoInterno("Secretaria de Parcerias em Investimentos")).toBe(false);
  });

  it("órgãos INTERNOS continuam fora (Superintendência/Diretoria/Gerência)", () => {
    expect(isOrgaoInterno("Superintendência de Concessão da Infraestrutura Rodoviária")).toBe(true);
    expect(isOrgaoInterno("Diretoria Colegiada")).toBe(true);
    expect(isOrgaoInterno("Gerência de Fiscalização")).toBe(true);
  });

  it("empresas seguem passando", () => {
    expect(isOrgaoInterno("CCR ViaSul S.A.")).toBe(false);
    expect(isOrgaoInterno("Rumo Malha Paulista S.A.")).toBe(false);
  });
});
