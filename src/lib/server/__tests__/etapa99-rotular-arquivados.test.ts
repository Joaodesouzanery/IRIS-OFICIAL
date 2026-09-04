/**
 * Etapa 99 (Fase 17, commit B) — os 95 arquivados sem rótulo ganham motivo E caminho de volta.
 *
 * O commit A fechou a torneira (o reaper carimba, a origem grava). Este fecha o PASSIVO: os 95
 * itens que o reaper bugado já arquivou sem motivo.
 *
 * ═══ Duas armadilhas que esta migration precisa evitar ═══
 * 1. **A coluna certa.** A migration irmã (20260901120000:43) lê `dr.metadata->>'arquivado_motivo'`
 *    e por isso nunca herdou nada: quem grava escreve em `dr.campos_detectados`
 *    (confirm-lote:74, migration 20260830120000:46, e agora markDocumentReviewed).
 * 2. **O mesmo direito dos novos.** O reaper (commit A) devolve a `importado` o item que carrega
 *    `enqueue_motivo_origem`. Se esta migration gravasse só o motivo, os 95 ficariam com rótulo
 *    legível e SEM caminho de volta — uma classe permanentemente inferior. Por isso ela grava
 *    `enqueue_motivo_origem: 'migration_20260904'` (valor honesto: eles não passaram pelo reaper
 *    corrigido, mas foram reconciliados automaticamente do mesmo jeito).
 *
 * ═══ Ordem obrigatória ═══
 * Aplicar DEPOIS do deploy do commit A e de ao menos uma rodada. Rodar antes carimbaria todo
 * mundo com o genérico e o predicado `enqueue_motivo IS NULL` deixaria de casar — a rotulagem
 * fina dos itens novos ficaria congelada para sempre.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";

const RAIZ = join(__dirname, "../../../..");
const SQL = readFileSync(
  join(RAIZ, "supabase/migrations/20260904120000_rotular_arquivados_sem_motivo.sql"),
  "utf-8",
);
const CODIGO = SQL.replace(/^\s*--.*$/gm, " ");

describe("etapa99 · a migration lê a coluna CERTA", () => {
  it("deriva de campos_detectados, e NUNCA de metadata (o erro da 20260901120000)", () => {
    // ⚠️ Contra CODIGO (sem comentários), não SQL: o cabeçalho CITA
    // `dr.campos_detectados->>'arquivado_motivo'` ao explicar a armadilha, então a asserção
    // sobre o texto cru passava verde mesmo com o código trocado para `metadata`. Prosa não
    // prova conduta — é a mesma lição das etapas 70/73/89.
    expect(CODIGO).toMatch(/dr\.campos_detectados->>'arquivado_motivo'/);
    expect(CODIGO).not.toMatch(/dr\.metadata->>'arquivado_motivo'/);
  });

  it("nunca deixa NULL: motivo do doc → classe pelo tipo → genérico", () => {
    expect(SQL).toMatch(/COALESCE\(/);
    expect(SQL).toMatch(/apoio_nao_final/);
    expect(SQL).toMatch(/documento_arquivado/);
  });
});

describe("etapa99 · os 95 ganham o MESMO direito de retorno dos itens novos", () => {
  it("grava enqueue_motivo_origem — é o predicado que o reaper usa para trazer de volta", () => {
    // Os DOIS ramos (com e sem documento vinculado) precisam carimbar: um item sem o carimbo
    // fica com rótulo legível e sem caminho de volta. Contar as ocorrências mata a mutação que
    // remove só uma delas.
    const carimbos = CODIGO.match(/'enqueue_motivo_origem', 'migration_20260904'/g) ?? [];
    expect(carimbos.length).toBe(2);
  });

  it("o valor é honesto: NÃO se declara «reaper4», porque não passou pelo reaper corrigido", () => {
    expect(CODIGO).not.toMatch(/'reaper4'/);
  });
});

describe("etapa99 · escopo e envelope", () => {
  it("só toca o que está sem rótulo — idempotente por construção", () => {
    expect(SQL).toMatch(/mi\.status = 'ignorado'/);
    expect(SQL).toMatch(/mi\.metadata->>'enqueue_motivo' IS NULL/);
  });

  it("NÃO carimba retry — não ressuscita o que foi arquivado por decisão", () => {
    expect(CODIGO).not.toMatch(/proxima_tentativa_em\s*=\s*NOW\(\)/);
    expect(CODIGO).not.toMatch(/tentativas\s*=\s*0/);
  });

  it("preserva o metadata existente — supabase e SQL substituem o jsonb inteiro", () => {
    expect(SQL).toMatch(/COALESCE\(mi\.metadata, '\{\}'::jsonb\)\s*\|\|/);
  });

  it("envelope do repo: BEGIN/COMMIT + NOTIFY + ROW_COUNT, sem INSERT nem DELETE", () => {
    expect(SQL).toContain("BEGIN;");
    expect(SQL).toContain("COMMIT;");
    expect(SQL).toMatch(/NOTIFY pgrst/);
    expect(SQL).toMatch(/RAISE NOTICE/);
    expect(CODIGO).not.toMatch(/INSERT INTO/i);
    expect(CODIGO).not.toMatch(/DELETE\s+FROM/i);
  });
});
