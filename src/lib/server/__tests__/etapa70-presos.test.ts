/**
 * Etapa 70 (Fase 9) — os documentos que ficavam invisíveis.
 *
 * Produção: **35 `voto_individual` da ANTT em `queued`** (PDF baixado, nunca extraído) e **17
 * `failed` com `tipo_documento` NULL**. Nenhum caminho automático os alcançava.
 *
 * ═══ Três bugs empilhados ═══
 * 1. A fila lê SÓ `upload_jobs.status='pending'`, e os dois reapers conhecem apenas `processing`.
 *    Documento em `queued` com job `done` não está em fila nenhuma e não aparece como falha.
 * 2. `requeueDocument` gravava o DOCUMENTO primeiro e o JOB depois, em UPDATEs não-transacionais,
 *    sem gravar `documento_id` e sem checar o erro do segundo.
 * 3. `reprocess-ignorados` fixava 50s ignorando os ~8s que o orquestrador manda — então rodava
 *    depois de a função-pai já ter queimado o orçamento, e o SIGKILL caía ENTRE os dois UPDATEs
 *    de (2). Era o gerador industrial dos órfãos.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";
import { RESERVA, gateDoPasso } from "@/lib/server/esteira-reservas";

const RAIZ = join(__dirname, "../../../..");
const ler = (p: string) => readFileSync(join(RAIZ, p), "utf-8");
const PIPELINE_LIB = ler("src/lib/server/pipeline.ts");
const QUEUE = ler("src/lib/server/upload-queue.ts");
const RUN = ler("src/app/api/v1/pipeline/run/route.ts");

describe("etapa70 · o terceiro reaper: `queued`", () => {
  it("existe e roda ANTES do select da fila — o job reparado entra na MESMA rodada", () => {
    const iReaper = PIPELINE_LIB.indexOf('.eq("status", "queued")');
    const iFila = PIPELINE_LIB.indexOf('.eq("status", "pending")\n    .order("created_at"');
    expect(iReaper).toBeGreaterThan(-1);
    expect(iReaper).toBeLessThan(iFila);
  });

  it("NÃO é UPDATE cego — doc `queued` com job `pending` é legítimo", () => {
    // Os outros dois reapers são update direto; este precisa ler antes, senão devolveria à fila
    // documentos que já estão nela.
    expect(PIPELINE_LIB).toMatch(/if \(job\.status === "pending" \|\| job\.status === "processing"\) continue/);
  });

  it("tem teto e cede saldo à extração — reaper não é varredura de tabela", () => {
    const bloco = PIPELINE_LIB.slice(PIPELINE_LIB.indexOf('.eq("status", "queued")'));
    expect(bloco).toMatch(/\.limit\(50\)/);
    expect(bloco).toMatch(/if \(!hasBudget\(deadlineAt, 2_000\)\) break/);
  });

  it("grava `documento_id` ao repor o job — o elo que faltava", () => {
    const bloco = PIPELINE_LIB.slice(PIPELINE_LIB.indexOf('.eq("status", "queued")'));
    expect(bloco).toMatch(/documento_id: doc\.id/);
  });

  it("adota job por hash SÓ se estiver livre — `upload_job_id` é UNIQUE", () => {
    expect(PIPELINE_LIB).toMatch(/cand\.documento_id === null \|\| cand\.documento_id === doc\.id/);
  });

  it("sem job e sem candidato vira `failed` COM MOTIVO — nunca fica em `queued`", () => {
    // Ficar em `queued` é o único desfecho proibido: é o estado invisível.
    expect(PIPELINE_LIB).toMatch(/Documento na fila sem upload_job/);
  });

  it("NÃO seleciona `metadata` — a proveniência vem do UPDATE, sem SELECT extra", () => {
    const bloco = PIPELINE_LIB.slice(PIPELINE_LIB.indexOf('.eq("status", "queued")') - 300, PIPELINE_LIB.indexOf('.eq("status", "queued")') + 100);
    expect(bloco).not.toMatch(/select\([^)]*metadata/);
  });

  it("o resultado reporta quantos foram religados", () => {
    expect(PIPELINE_LIB).toMatch(/religados\b/);
    expect(PIPELINE_LIB).toMatch(/reaped: number; religados: number/);
  });
});

describe("etapa70 · requeueDocument virou seguro", () => {
  const bloco = QUEUE.slice(QUEUE.indexOf("export async function requeueDocument"));
  const corpo = bloco.slice(0, bloco.indexOf("return { document_id"));

  it("o JOB é atualizado ANTES do documento", () => {
    // Morrer no meio passa a deixar um job `pending` sem o doc requeueado — estado BENIGNO, que o
    // processPdf apenas reprocessa. Na ordem antiga sobrava um doc `queued` com job `done`, que é
    // invisível para sempre.
    const iJob = corpo.indexOf('from("upload_jobs")');
    const iDoc = corpo.indexOf('from("documentos_regulatorios")\n    .update');
    expect(iJob).toBeGreaterThan(-1);
    expect(iDoc).toBeGreaterThan(-1);
    expect(iJob, "o documento ainda é gravado primeiro").toBeLessThan(iDoc);
  });

  it("grava `documento_id` — sem ele o requeue entrava em laço fechado", () => {
    expect(corpo).toMatch(/documento_id: doc\.id/);
  });

  it("CHECA o erro do UPDATE do job", () => {
    expect(corpo).toMatch(/const \{ error: jobErr \}/);
    expect(corpo).toMatch(/if \(jobErr\) throw/);
  });
});

describe("etapa70 · o gerador de órfãos foi desligado", () => {
  it("reprocess-ignorados honra o `budget_ms` do orquestrador", () => {
    const rota = ler("src/app/api/v1/admin/upload/reprocess-ignorados/route.ts");
    expect(rota).toMatch(/budgetFromRequest\(req\)/);
    expect(rota).not.toMatch(/Date\.now\(\) \+ 50_000/);
  });
});

describe("etapa70 · o passo novo para `failed`", () => {
  it("é um passo SEPARADO, fora do guard anti-ping-pong", () => {
    // Ampliar o passo 9 arrastaria `failed` para debaixo de `arquivouAgora === 0`, e o reprocesso
    // seria pulado em toda rodada em que a aprovação arquivasse uma pauta. `ignored` é decisão;
    // `failed` não é.
    // Asserção sobre a CONDIÇÃO do passo, não sobre a prosa: o comentário que explica a decisão
    // cita `arquivouAgora`, e uma busca por texto no bloco casaria com a própria explicação.
    expect(RUN).toMatch(/if \(hasBudget\(deadlineAt, gateDoPasso\("reprocessarFalhados"\)\)\) \{/);
    expect(RUN).not.toMatch(/arquivouAgora === 0 &&[\s\S]{0,200}?reprocessarFalhados/);
    // …e o guard continua existindo, para o passo 9, que é onde ele faz sentido.
    expect(RUN).toMatch(/arquivouAgora === 0 && hasBudget\(deadlineAt, gateDoPasso\("derivada"\)\)/);
  });

  it("tem TETO de tentativas — PDF corrompido falha idêntico para sempre", () => {
    expect(RUN).toMatch(/reprocessos_falha/);
    expect(RUN).toMatch(/if \(ciclos >= 3\)/);
  });

  it("tem reserva própria, e o gate respeita a regra da Fase 7", () => {
    expect(RESERVA.reprocessarFalhados).toBeGreaterThan(0);
    expect(gateDoPasso("reprocessarFalhados")).toBeGreaterThanOrEqual(RESERVA.reprocessarFalhados);
    expect(RUN).toMatch(/gateDoPasso\("reprocessarFalhados"\)/);
  });

  it("reporta o que fez, incluindo as desistências", () => {
    expect(RUN).toMatch(/desistidos_apos_3_ciclos/);
  });
});

describe("etapa70 · a legenda deixa de mentir", () => {
  const page = ler("src/app/dashboard/deliberacoes/votos-diretores/page.tsx");

  it("não afirma mais que o «Rodar tudo» re-tenta TODOS os presos", () => {
    // A lista cobre `failed`, `queued` e `processing`; antes disso, só `processing` era verdade.
    expect(page).not.toMatch(/reprocessáveis; o &ldquo;Rodar tudo&rdquo; re-tenta os presos/);
  });

  it("diz QUAIS são retentados e o que acontece com o resto", () => {
    expect(page).toMatch(/até 3 ciclos/);
    expect(page).toMatch(/aguardam reenvio/);
  });
});
