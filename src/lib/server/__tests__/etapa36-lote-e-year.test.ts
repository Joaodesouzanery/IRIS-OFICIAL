import { describe, it, expect } from "vitest";
import { matchesYear } from "@/lib/server/year-filter";
import { buildConfirmDelibFromDoc } from "@/lib/server/auto-confirm";

// QA ago/2026: (1) filtro de ANO honesto nas agregações (as abas mandavam ?year= e as rotas
// ignoravam); (2) aprovação em LOTE reusa buildConfirmDelibFromDoc + trilha de auditoria.

describe("matchesYear [2b]", () => {
  it("filtra por data_reuniao; fallback data_publicacao", () => {
    expect(matchesYear({ data_reuniao: "2026-07-01" }, "2026")).toBe(true);
    expect(matchesYear({ data_reuniao: "2025-07-16" }, "2026")).toBe(false);
    expect(matchesYear({ data_reuniao: null, data_publicacao: "2026-01-13" }, "2026")).toBe(true);
    expect(matchesYear({ data_reuniao: null, data_publicacao: "2024-01-13" }, "2026")).toBe(false);
  });
  it("sem year (ou inválido) → passa tudo; sem data nenhuma → mantém (não some registro)", () => {
    expect(matchesYear({ data_reuniao: "2020-01-01" }, null)).toBe(true);
    expect(matchesYear({ data_reuniao: "2020-01-01" }, "abc")).toBe(true);
    expect(matchesYear({}, "2026")).toBe(true);
  });
});

describe("montagem do lote (buildConfirmDelibFromDoc) [1a]", () => {
  const doc = {
    id: "doc-1",
    agencia_id: "ag-1",
    tipo_documento: "deliberacao",
    extraction_confidence: 0.8,
    ata_items: null,
    campos_detectados: {
      preview: {
        filename: "delib-487.pdf",
        fields: { numero_deliberacao: "487", resultado: "Aprovado", tipo_documento: "deliberacao" },
        extraction_raw: { fonte: "teste" },
      },
    },
  };
  it("payload leva documento_id/agencia/campos e preserva extraction_raw", () => {
    const d = buildConfirmDelibFromDoc(doc as never);
    expect(d.documento_id).toBe("doc-1");
    expect(d.agencia_id).toBe("ag-1");
    expect(d.numero_deliberacao).toBe("487");
    expect(d.resultado).toBe("Aprovado");
    // A rota de lote acrescenta a trilha sem perder o raw original:
    const raw: Record<string, unknown> = { ...(d.extraction_raw as Record<string, unknown>), aprovado_em_lote: true };
    expect(raw.fonte).toBe("teste");
    expect(raw.aprovado_em_lote).toBe(true);
  });
});
