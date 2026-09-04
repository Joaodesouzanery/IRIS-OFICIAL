/**
 * Etapa 112 (Fase 19, commit 1) — o requeue para de apagar a fonte do próprio reparo.
 *
 * ═══ A urgência que este commit resolve ═══
 * `requeueDocument` zera `texto_extraido` E `ata_items` (upload-queue.ts:316-331), e o passo 9 da
 * esteira (`reprocess-ignorados`) roda a cada "Rodar tudo". Enquanto houver filho de ata com
 * `resultado` NULL — 232 deles medidos em produção —, cada clique pode transformar um reparo
 * barato (UPDATE, casando por `item_numero` contra os `ata_items` do pai) em "re-baixar os PDFs
 * das atas e torcer para as fontes seguirem no ar".
 *
 * Zerar é CORRETO no caso geral: o documento vai ser reprocessado do zero e o resto é lixo. O que
 * não pode é zerar enquanto alguém ainda depende daquele conteúdo. A guarda é essa distinção — e
 * ela vale para sempre, não só para este mutirão.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

/** O UPDATE que o teste observa: qual patch chegou em `documentos_regulatorios`. */
let patchDoDocumento: Record<string, unknown> | null = null;
/** Quantos filhos com `resultado` NULL o banco simulado tem para este documento. */
let filhosPendentes = 0;

function fakeDb(doc: Record<string, unknown>) {
  const api = (tabela: string): any => {
    const self: any = {
      select: (cols?: string) => {
        // A consulta de filhos pendentes usa `count`, a do documento usa `.single()`.
        if (tabela === "deliberacoes") {
          return {
            eq: () => ({
              is: () => ({
                limit: async () => ({ data: Array.from({ length: filhosPendentes }, (_, i) => ({ id: `f${i}` })), error: null }),
                then: (r: any) => r({ data: Array.from({ length: filhosPendentes }, (_, i) => ({ id: `f${i}` })), error: null }),
              }),
            }),
          };
        }
        return self;
      },
      update: (patch: Record<string, unknown>) => {
        if (tabela === "documentos_regulatorios") patchDoDocumento = patch;
        return { eq: async () => ({ data: null, error: null }) };
      },
      eq: () => self,
      is: () => self,
      limit: () => self,
      single: async () => ({ data: doc, error: null }),
      maybeSingle: async () => ({ data: doc, error: null }),
      then: (r: any) => r({ data: [], error: null }),
    };
    return self;
  };
  return { from: api };
}

const DOC = {
  id: "doc-1",
  upload_job_id: "job-1",
  filename: "ata.pdf",
  agencia_id: "ag-1",
  storage_path: "pdfs/ata.pdf",
  error_message: null,
};

describe("etapa112 · a janela de reparo não fecha sozinha", () => {
  beforeEach(() => {
    patchDoDocumento = null;
    filhosPendentes = 0;
  });

  it("COMPORTAMENTO: documento com filho SEM resultado preserva ata_items e texto_extraido", async () => {
    filhosPendentes = 3;
    const { requeueDocument } = await import("@/lib/server/upload-queue");
    await requeueDocument(fakeDb(DOC), "doc-1");
    expect(patchDoDocumento).not.toBeNull();
    // O reparo casa `item_numero` contra os `ata_items` do pai: sem eles, o UPDATE barato morre.
    expect(patchDoDocumento).not.toHaveProperty("ata_items", null);
    expect(patchDoDocumento).not.toHaveProperty("texto_extraido", null);
    // …e o requeue continua fazendo o que precisa: o documento volta para a fila.
    expect(patchDoDocumento).toHaveProperty("status", "queued");
  });

  it("COMPORTAMENTO: sem filho pendente, o requeue continua limpando (senão vira lixo acumulado)", async () => {
    filhosPendentes = 0;
    const { requeueDocument } = await import("@/lib/server/upload-queue");
    await requeueDocument(fakeDb(DOC), "doc-1");
    expect(patchDoDocumento).toHaveProperty("ata_items", null);
    expect(patchDoDocumento).toHaveProperty("texto_extraido", null);
  });

  it("a guarda degrada para o comportamento antigo se a consulta falhar", async () => {
    // Diagnóstico não pode derrubar o requeue: na dúvida, preserva (o conservador aqui é NÃO
    // apagar — dado apagado não volta, dado preservado a mais custa bytes).
    const dbQuebrado = {
      from: (t: string) =>
        t === "deliberacoes"
          ? { select: () => ({ eq: () => ({ is: () => ({ limit: async () => { throw new Error("boom"); } }) }) }) }
          : fakeDb(DOC).from(t),
    };
    const { requeueDocument } = await import("@/lib/server/upload-queue");
    await requeueDocument(dbQuebrado as any, "doc-1");
    expect(patchDoDocumento).not.toHaveProperty("ata_items", null);
  });
});
