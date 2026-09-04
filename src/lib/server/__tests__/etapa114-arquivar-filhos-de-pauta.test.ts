/**
 * Etapa 114 (Fase 19, commit 3) — os 35 filhos fabricados a partir de agenda saem do denominador.
 *
 * O commit anterior fechou a torneira (`declaraSerPauta`); este limpa o que já entrou. A escolha
 * é ARQUIVAR, não deletar: `import_counts_as_final: false` é o primeiro campo que o predicado
 * canônico lê, então a linha sai das métricas em TODOS os sítios de uma vez — sem que cada
 * consulta precise lembrar de filtrar `PAUTA-%`, que seria a receita da divergência entre sítios
 * que a etapa110 acabou de matar.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";
import { isFinalDecisionRecord } from "@/lib/server/regulatory-documents";

const RAIZ = join(__dirname, "../../../..");
const SQL = readFileSync(join(RAIZ, "supabase/migrations/20260906120000_arquivar_filhos_de_pauta.sql"), "utf-8");
const CODIGO = SQL.replace(/^\s*--.*$/gm, " ");

describe("etapa114 · a marca escolhida é a que TODO consumidor já respeita", () => {
  it("COMPORTAMENTO: `import_counts_as_final: false` tira a linha do predicado canônico", () => {
    const filhoDePauta = {
      tipo_documento: "ata",
      documento_pai_id: "pai-1",
      resultado: "Deferido",
      raw_extraction: { import_counts_as_final: false },
    };
    expect(isFinalDecisionRecord(filhoDePauta as any)).toBe(false);
    // …e sem a marca, a mesma linha CONTA — é o que prova que a marca é o que faz o trabalho.
    expect(isFinalDecisionRecord({ ...filhoDePauta, raw_extraction: {} } as any)).toBe(true);
  });

  it("a migration usa essa marca, e não um filtro por prefixo espalhado", () => {
    expect(CODIGO).toMatch(/'import_counts_as_final', false/);
  });
});

describe("etapa114 · escopo e envelope", () => {
  it("só os filhos de pauta, e preserva a linha (arquivar ≠ deletar)", () => {
    expect(CODIGO).toMatch(/numero_deliberacao LIKE 'PAUTA-%'/);
    expect(CODIGO).not.toMatch(/DELETE\s+FROM/i);
  });

  it("guarda o motivo — arquivamento sem motivo foi o buraco da Fase 17", () => {
    expect(CODIGO).toMatch(/'arquivado_motivo', 'filho_de_pauta'/);
  });

  it("idempotente: rodar 2× não marca de novo", () => {
    expect(CODIGO).toMatch(/IS DISTINCT FROM false/);
  });

  it("envelope do repo", () => {
    expect(SQL).toContain("BEGIN;");
    expect(SQL).toContain("COMMIT;");
    expect(SQL).toMatch(/NOTIFY pgrst/);
    expect(SQL).toMatch(/RAISE NOTICE/);
    expect(CODIGO).not.toMatch(/INSERT INTO/i);
  });
});
