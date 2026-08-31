/**
 * Etapa 95 (Fase 16, commit C) — o poço `em_revisao` ganha reconciliação (e contador).
 *
 * ═══ O poço, provado ═══
 * NENHUMA query do repo lê `monitoramento_itens.status = 'em_revisao'`. O único write de
 * `importado` (enqueue-pdfs) seleciona só `novo`/`ignorado`; o confirm não toca a tabela. Então
 * todo item que o auto-enqueue marcou `em_revisao` congela ali PARA SEMPRE — mesmo com o
 * documento já `confirmed` (virou deliberação) ou `ignored` (arquivado de propósito). Produção:
 * a pauta da 87ª ROP, 4 "Voto DFQ" da ANTT desde 09/07, 43 itens da ANM. E a origem agravava:
 * `existing_archived` (doc JÁ arquivado) também virava `em_revisao` — item nascendo morto.
 *
 * ═══ O conserto, em três peças ═══
 * 1. Migration one-shot drena o passivo (herda o motivo do doc — os manuais ignorados de
 *    propósito NÃO ressuscitam: `ignorado` sem carimbo fica fora do retry).
 * 2. Reaper #4 impede o poço de voltar — e CONTA o que reconcilia. O poço se formou em silêncio
 *    por meses porque nada o expunha (o padrão "capacidade sem consumidor"); o contador por
 *    rodada é o alarme de recorrência.
 * 3. A origem para de criar item morto: `existing_archived` → `ignorado` na hora.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";

const RAIZ = join(__dirname, "../../../..");
const ler = (p: string) => readFileSync(join(RAIZ, p), "utf-8");
const semComentarios = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/\/\/.*$/gm, " ").replace(/^\s*--.*$/gm, " ");
const SQL = ler("supabase/migrations/20260901120000_reconciliar_em_revisao.sql");
const CODIGO_SQL = semComentarios(SQL);
const PIPELINE = ler("src/lib/server/pipeline.ts");
const CODIGO_PIPE = semComentarios(PIPELINE);
const RUNNER = ler("src/lib/server/monitoring-runner.ts");
const RUN = semComentarios(ler("src/app/api/v1/pipeline/run/route.ts"));

describe("etapa95 · a migration drena o passivo — e SÓ os destinos terminais", () => {
  it("doc confirmed → item importado; doc ignored → item ignorado (com o motivo do doc)", () => {
    expect(SQL).toMatch(/WHEN 'confirmed' THEN 'importado'/);
    expect(SQL).toMatch(/WHEN 'ignored'\s+THEN 'ignorado'/);
    expect(SQL).toMatch(/arquivado_motivo/);
  });

  it("ignorado SEM carimbo — a fila de retry não ressuscita o que foi arquivado de propósito", () => {
    expect(SQL).toMatch(/proxima_tentativa_em = NULL/);
  });

  it("doc em trânsito NÃO é tocado: a esteira move o doc, não a migration", () => {
    expect(SQL).toMatch(/dr\.status IN \('confirmed', 'ignored'\)/);
    for (const status of ["'queued'", "'review_pending'", "'failed'", "'processing'"]) {
      expect(CODIGO_SQL, `migration não pode decidir por doc ${status}`).not.toContain(status);
    }
  });

  it("item órfão (documento apagado) volta a `novo` — re-entra pela porta da frente", () => {
    expect(SQL).toMatch(/documento_id IS NULL|NOT EXISTS/);
    expect(SQL).toMatch(/status = 'novo'/);
  });

  it("envelope do repo: BEGIN/COMMIT + NOTIFY + ROW_COUNT, sem INSERT nem DELETE", () => {
    expect(SQL).toContain("BEGIN;");
    expect(SQL).toContain("COMMIT;");
    expect(SQL).toMatch(/NOTIFY pgrst/);
    expect(SQL).toMatch(/RAISE NOTICE/);
    expect(CODIGO_SQL).not.toMatch(/INSERT INTO/i);
    expect(CODIGO_SQL).not.toMatch(/DELETE\s+FROM/i);
  });
});

describe("etapa95 · reaper #4 — a reconciliação contínua, contada", () => {
  it("vem DEPOIS do reaper #3 e ANTES do retorno de apenasReaper — repara mesmo no modo barato", () => {
    const terceiro = CODIGO_PIPE.indexOf("religados++");
    const quarto = CODIGO_PIPE.indexOf('.eq("status", "em_revisao")');
    const retorno = CODIGO_PIPE.indexOf("if (opcoes?.apenasReaper)");
    expect(terceiro).toBeGreaterThan(-1);
    expect(quarto).toBeGreaterThan(terceiro);
    expect(quarto).toBeLessThan(retorno);
  });

  it("decide pelo STATUS DO DOC, em lote — e não toca doc em trânsito", () => {
    expect(CODIGO_PIPE).toMatch(/reconciliadosImportado/);
    expect(CODIGO_PIPE).toMatch(/reconciliadosIgnorado/);
    expect(CODIGO_PIPE).toMatch(/reconciliadosNovo/);
    // Três UPDATEs em lote (.in), não um por item — reaper é barato por contrato.
    const quarto = CODIGO_PIPE.slice(CODIGO_PIPE.indexOf('.eq("status", "em_revisao")'));
    expect(quarto.split('.in("id",').length - 1).toBeGreaterThanOrEqual(3);
  });

  it("os DOIS retornos carregam os contadores — o poço nunca mais é invisível", () => {
    expect(PIPELINE).toMatch(/apenasReaper\) return \{ processed: 0, job_ids: \[\], reaped, religados, reconciliados_importado/);
    // E o tipo declara os três — quem consome vê que o campo existe.
    expect(PIPELINE).toMatch(/reconciliados_importado: number; reconciliados_ignorado: number; reconciliados_novo: number/);
  });

  it("o orquestrador soma no passo «presos» e re-roda quando devolveu item a `novo`", () => {
    expect(RUN).toMatch(/reconciliados_importado/);
    expect(RUN).toMatch(/if \(religados > 0 \|\| reconciliadosNovo > 0\) restantes = true;/);
  });
});

describe("etapa95 · a origem para de criar item morto", () => {
  it("existing_archived nasce `ignorado` com motivo — nunca mais `em_revisao`", () => {
    expect(RUNNER).toMatch(/const arquivadoNaOrigem = result\.status === "existing_archived"/);
    expect(RUNNER).toMatch(/arquivadoNaOrigem \? "ignorado" : ok \? "em_revisao" : "novo"/);
    expect(RUNNER).toMatch(/documento_arquivado/);
  });
});
