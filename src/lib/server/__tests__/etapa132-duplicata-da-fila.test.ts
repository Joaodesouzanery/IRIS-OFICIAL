/**
 * Etapa 132 (Fase 23, commit 3) — duplicata da PRÓPRIA fila tem saída.
 *
 * 36 deliberações da ARTESP presas por "possível duplicata": dois PDFs irmãos em `review_pending`
 * marcavam-se mutuamente, e nenhum arquivador alcançava esse sabor (`confirm-lote` só arquiva
 * duplicata EXATA de doc confirmado; `canAutoConfirm` recusa qualquer `is_duplicate`). Nenhum
 * dos dois confirmava; nenhum virava o original do outro. Laço eterno, medido no qa-fase22 ④.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";
import { decidirDuplicata } from "@/lib/server/duplicata-da-fila";

describe("etapa132 · a decisão", () => {
  it("há gêmeo CONFIRMADO com o mesmo hash → arquiva como exata, com o link", () => {
    const d = decidirDuplicata({ doc: { id: "b", file_hash: "h1" }, gemeosConfirmados: [{ id: "a", deliberacao_id: "del-a", file_hash: "h1" }], irmaosPendentesIds: [] });
    expect(d).toEqual({ acao: "arquivar", motivo: "duplicata_exata", original_id: "a", original_deliberacao_id: "del-a" });
  });

  it("há gêmeo CONFIRMADO só pela chave semântica → arquiva como semântica", () => {
    const d = decidirDuplicata({ doc: { id: "b", file_hash: "h2" }, gemeosConfirmados: [{ id: "a", deliberacao_id: null, file_hash: "h1" }], irmaosPendentesIds: [] });
    expect(d).toMatchObject({ acao: "arquivar", motivo: "duplicata_semantica", original_id: "a" });
  });

  it("só irmãos PENDENTES: o primeiro (menor id) é liberado, o outro espera — o beco sem saída acaba", () => {
    expect(decidirDuplicata({ doc: { id: "a", file_hash: null }, gemeosConfirmados: [], irmaosPendentesIds: ["b"] })).toEqual({ acao: "liberar" });
    expect(decidirDuplicata({ doc: { id: "b", file_hash: null }, gemeosConfirmados: [], irmaosPendentesIds: ["a"] })).toEqual({ acao: "esperar", irmao_id: "a" });
  });

  it("marca órfã (sem gêmeo nenhum) → libera", () => {
    expect(decidirDuplicata({ doc: { id: "z", file_hash: "h" }, gemeosConfirmados: [], irmaosPendentesIds: [] })).toEqual({ acao: "liberar" });
  });

  it("o próprio documento na lista de confirmados não conta como gêmeo", () => {
    expect(decidirDuplicata({ doc: { id: "a", file_hash: "h" }, gemeosConfirmados: [{ id: "a", deliberacao_id: null, file_hash: "h" }], irmaosPendentesIds: [] })).toEqual({ acao: "liberar" });
  });
});

describe("etapa132 · o número chega ao banner", () => {
  const RAIZ = join(__dirname, "../../../..");
  const ler = (p: string) => readFileSync(join(RAIZ, p), "utf-8");
  it("a rota publica os dois contadores, o pipeline os carrega e a tela os lê", () => {
    expect(ler("src/app/api/v1/upload/auto-confirm/route.ts")).toMatch(/duplicatas_arquivadas: duplicatasArquivadas/);
    expect(ler("src/app/api/v1/pipeline/run/route.ts")).toMatch(/duplicatas_liberadas: r\.body\?\.duplicatas_liberadas/);
    expect(ler("src/app/dashboard/deliberacoes/votos-diretores/page.tsx")).toMatch(/totais\.duplicatas_liberadas/);
  });
});
