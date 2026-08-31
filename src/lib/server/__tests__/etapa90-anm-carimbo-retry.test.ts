/**
 * Etapa 90 (Fase 15, commit B) — soltar o que a ANM já viu e arquivou.
 *
 * ═══ O quadro (QA da Fase 14) ═══
 * `novos: 0` em todas as fontes ANM não é seletor quebrado — a fixture verbatim (etapa84) prova
 * que `a:not(.state-published)` pega a 87ª ROP. É o dedup por desenho: na colisão de hash o
 * runner atualiza SÓ titulo/reuniao/data_reuniao/last_seen_at; `status` fica intocado e não há
 * re-enqueue. Como o `tipo` entra no hash, `novos: 0` prova que as atas JÁ EXISTEM gravadas com
 * o tipo certo — presas em `ignorado` sem carimbo (`proxima_tentativa_em IS NULL` não satisfaz
 * o `<=` da fila de retry; o caminho do `sem_pdf` LIMPA o carimbo de propósito).
 *
 * ═══ O conserto ═══
 * O precedente é a 20260826150000 (ARTESP): uma migration de CARIMBO — `proxima_tentativa_em =
 * NOW(), tentativas = 0` — reabre o passivo um-tiro-só; se o item continuar sem render documento,
 * sai com a coluna nula outra vez, nunca um moinho. Aqui é a mesma coisa para a ANM, com os DOIS
 * motivos elegíveis da fila (`sem_pdf` E `download_falhou` — a ARTESP só precisava do primeiro).
 *
 * GUARDA: `em_revisao`/`importado` ficam DE FORA. Reset cego ressuscitaria os manuais que a
 * limpeza 20260830120000 ignorou de propósito — e `enqueuePdfBuffer` devolveria
 * `existing_archived` em círculo. Se o QA da fase provar que a 87ª está nessa classe, o conserto
 * será dirigido, com a evidência na mão.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";
import { TIPOS_ESTEIRA_VOTOS } from "@/lib/esteira-tipos";

const RAIZ = join(__dirname, "../../../..");
const SQL = readFileSync(
  join(RAIZ, "supabase/migrations/20260831130000_anm_carimbo_retry.sql"),
  "utf-8",
);
const CODIGO = SQL.replace(/^\s*--.*$/gm, " ");

describe("etapa90 · o carimbo reabre exatamente o que a fila de retry sabe pegar", () => {
  it("carimba proxima_tentativa_em e zera tentativas — o opt-in do retry", () => {
    expect(SQL).toMatch(/SET proxima_tentativa_em = NOW\(\)/);
    expect(SQL).toMatch(/tentativas = 0/);
  });

  it("só `ignorado`, e só os DOIS motivos que a fila aceita", () => {
    expect(SQL).toMatch(/status = 'ignorado'/);
    // O predicado da fila (enqueue-pdfs) aceita sem_pdf E download_falhou; carimbar outro
    // motivo (ex.: download_falhou_desistido, pagina_institucional) seria carimbo à toa.
    expect(SQL).toMatch(/IN \('sem_pdf', 'download_falhou'\)/);
    expect(CODIGO).not.toContain("pagina_institucional");
  });

  it("só tipos da esteira — `diretoria` arquivado pela etapa89 não volta", () => {
    // A fila exige tipo ∈ TIPOS_ESTEIRA_VOTOS; o carimbo espelha a MESMA lista para não
    // marcar linha que a fila nunca vai ler.
    for (const tipo of TIPOS_ESTEIRA_VOTOS) expect(SQL).toContain(`'${tipo}'`);
    expect(CODIGO).not.toMatch(/'diretoria'/);
  });

  it("escopo ANM 2026 (data nula entra — a data vem do parse, excluir por ela seria excluir pelo bug)", () => {
    expect(SQL).toMatch(/sigla = 'ANM'/);
    expect(SQL).toMatch(/data_reuniao IS NULL OR .*data_reuniao >= DATE '2026-01-01'/);
  });

  it("em_revisao e importado ficam DE FORA — reset cego ressuscitaria lixo limpo de propósito", () => {
    expect(CODIGO).not.toMatch(/'em_revisao'/);
    expect(CODIGO).not.toMatch(/'importado'/);
    expect(CODIGO).not.toMatch(/documento_id\s*=/);
  });
});

describe("etapa90 · envelope", () => {
  it("BEGIN/COMMIT + NOTIFY + ROW_COUNT, sem INSERT nem DELETE", () => {
    expect(SQL).toContain("BEGIN;");
    expect(SQL).toContain("COMMIT;");
    expect(SQL).toMatch(/NOTIFY pgrst/);
    expect(SQL).toMatch(/RAISE NOTICE/);
    expect(CODIGO).not.toMatch(/INSERT INTO/i);
    expect(CODIGO).not.toMatch(/DELETE\s+FROM/i);
  });

  it("guarda de coluna: sem a 20260826140000 aplicada, avisa e não faz nada", () => {
    expect(SQL).toMatch(/information_schema\.columns/);
    expect(SQL).toContain("proxima_tentativa_em");
  });
});
