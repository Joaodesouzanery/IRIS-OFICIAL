/**
 * Etapa 98 (Fase 17, commit A) — o arquivamento volta a ter motivo. E foi EU quem tirou.
 *
 * ═══ A regressão, com autoria e data ═══
 * O reaper #4 que escrevi na Fase 16 (pipeline.ts, commit de 31/08) é o ÚNICO ponto do repo que
 * grava `status: "ignorado"` em `monitoramento_itens` SEM `enqueue_motivo`. Todos os outros
 * gravam: `enqueue-pdfs:333` (motivoTerminal), `:459` (download_falhou), `monitoring-runner:374`
 * (documento_arquivado) e as migrations 20260831120000 / 20260901120000.
 *
 * Os 95 itens "sem motivo" da tela (50 ANTT·voto + 24 ANM·documento + 21 ANTT·pauta) não são
 * itens novos: são itens que o reaper moveu do poço INVISÍVEL (`em_revisao`, que
 * `nao-enfileirados:46` não consulta) para o balde visível — sem rótulo.
 *
 * ═══ Por que é pior que cosmético ═══
 * `enqueue_motivo` NULL + `proxima_tentativa_em` NULL põe o item fora dos DOIS filtros do retry
 * (`enqueue-pdfs:149` exige carimbo `<= agora`; `:163` exige motivo em
 * {download_falhou, sem_pdf}). São 95 itens em morte terminal — e SEM motivo nenhuma migration
 * futura consegue selecioná-los para reabrir. Um bug que se esconde do próprio mecanismo de
 * correção é a classe mais perigosa desta série.
 *
 * ═══ E a referência que eu copiei também estava quebrada ═══
 * A migration irmã lê `dr.metadata->>'arquivado_motivo'` (20260901120000:43), mas quem grava
 * escreve em `dr.campos_detectados` (confirm-lote:74, migration 20260830120000:46). O "herda o
 * motivo" sempre foi no-op. E a ORIGEM é pior ainda: `markDocumentReviewed` arquivava pauta/apoio
 * gravando só {status, reviewed_at, updated_at} — para essa família o motivo fino NUNCA existiu.
 * Por isso o conserto tem duas camadas: a origem passa a gravar, e o reaper passa a herdar.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";

const RAIZ = join(__dirname, "../../../..");
const ler = (p: string) => readFileSync(join(RAIZ, p), "utf-8");
const semComentarios = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/\/\/.*$/gm, " ");
const PIPELINE = ler("src/lib/server/pipeline.ts");
const CODIGO_PIPE = semComentarios(PIPELINE);
const CONFIRM = ler("src/app/api/v1/upload/confirm/route.ts");
const CODIGO_CONFIRM = semComentarios(CONFIRM);

/**
 * O bloco do reaper #4 — recortado a partir da PRIMEIRA consulta a `monitoramento_itens` no
 * arquivo (só o reaper #4 toca essa tabela aqui). Ancorar em `.eq("status","em_revisao")`
 * deixaria o `.select(...)` de fora do recorte: ele vem ANTES do filtro.
 */
const REAPER4 = CODIGO_PIPE.slice(CODIGO_PIPE.indexOf('from("monitoramento_itens")'));

describe("etapa98 · a ORIGEM grava o motivo (sem isso, o reaper só herda genérico)", () => {
  it("markDocumentReviewed aceita motivo e grava em campos_detectados — a coluna CERTA", () => {
    expect(CODIGO_CONFIRM).toMatch(/async function markDocumentReviewed\([\s\S]{0,320}?motivo\?: string/);
    expect(CODIGO_CONFIRM).toMatch(/arquivado_motivo: motivo/);
    // `campos_detectados` é onde confirm-lote:74 e a migration 20260830120000 gravam. A
    // 20260901120000 leu `metadata` e por isso nunca herdou nada.
    expect(CODIGO_CONFIRM).toMatch(/campos_detectados/);
  });

  it("o merge preserva o que já estava lá — supabase-js SUBSTITUI o jsonb inteiro", () => {
    expect(CODIGO_CONFIRM).toMatch(/\.\.\.\(\(atual\?\.campos_detectados[\s\S]{0,80}?\)\s*\?\?\s*\{\}\)/);
  });

  it("o arquivamento de apoio no confirm passa um motivo — é o perfil dos 95", () => {
    // confirm/route.ts:594 — "Documento mantido como apoio; nao entrou nos dashboards."
    expect(CODIGO_CONFIRM).toMatch(/markDocumentReviewed\(db, d\.documento_id, "ignored", null, "[a-z_]+"\)/);
  });

  it("NÃO usa o select proibido pela etapa68 (metadata na parte quente)", () => {
    expect(CODIGO_CONFIRM).not.toMatch(/from\("documentos_regulatorios"\)\s*\.select\("metadata"\)/);
  });
});

describe("etapa98 · o reaper #4 CARIMBA o que arquiva", () => {
  it("lê o metadata do item — sem ele o merge apagaria meeting_url e prioridade", () => {
    expect(REAPER4.slice(0, 400)).toMatch(/select\("id, documento_id, metadata"\)/);
  });

  it("lê tipo_documento e campos_detectados do doc — a fonte do motivo herdado", () => {
    expect(REAPER4).toMatch(/select\("id, status, tipo_documento, campos_detectados"\)/);
    expect(CODIGO_PIPE).not.toMatch(/from\("documentos_regulatorios"\)\s*\.select\("metadata"\)/);
  });

  it("tem ORDEM estável — sem ela a janela de 50 trava em itens em trânsito (head-of-line)", () => {
    expect(REAPER4.slice(0, 400)).toMatch(/\.order\(/);
  });

  it("grava enqueue_motivo E a origem do carimbo, com merge do metadata do item", () => {
    expect(REAPER4).toMatch(/enqueue_motivo: motivoDoArquivamento/);
    expect(REAPER4).toMatch(/enqueue_motivo_origem: "reaper4"/);
    expect(REAPER4).toMatch(/\.\.\.\(item\.metadata \?\? \{\}\)/);
  });

  it("herda o motivo do doc; sem ele, classifica pelo tipo; nunca fica NULL", () => {
    expect(CODIGO_PIPE).toMatch(/campos_detectados[\s\S]{0,90}?arquivado_motivo/);
    expect(CODIGO_PIPE).toMatch(/apoio_nao_final/);
    expect(CODIGO_PIPE).toMatch(/documento_arquivado/);
  });

  it("carimbar é por ITEM (o metadata difere), mas com TETO e orçamento", () => {
    // O contrato "reaper é barato" continua valendo — muda a forma de honrá-lo: em vez de um
    // UPDATE cego em lote, um teto explícito + hasBudget. O que sobrar fica para a rodada
    // seguinte, e agora o poço É drenado (antes ele era terminal).
    expect(REAPER4).toMatch(/TETO_CARIMBO_POR_RODADA/);
    expect(REAPER4).toMatch(/hasBudget\(deadlineAt, \d+\)/);
  });

  it("importado e novo CONTINUAM em lote — só o ignorado precisa de merge", () => {
    expect(REAPER4).toMatch(/status: "importado"[\s\S]{0,160}?\.in\("id", paraImportado\)/);
    expect(REAPER4).toMatch(/status: "novo"[\s\S]{0,200}?\.in\("id", paraNovo\)/);
  });
});

describe("etapa98 · mão DUPLA: o que a reconciliação arquivou pode voltar", () => {
  it("o predicado é o CARIMBO DE ORIGEM, não o valor «reaper4»", () => {
    // Os 95 antigos serão rotulados pela migration do commit B com origem
    // `migration_20260904`. Casar `= "reaper4"` os deixaria numa classe permanentemente
    // inferior: motivo legível, mas sem caminho de volta.
    // ⚠️ A primeira versão desta asserção SOBREVIVEU à mutação: ela procurava
    // `enqueue_motivo_origem` a até 60 chars de `"is", null` — e casava o `"is", null` da linha
    // VIZINHA (`.not("documento_id", "is", null)`). Trocar o filtro por
    // `.eq(..., "reaper4")` passava verde. Agora a asserção casa o FILTRO INTEIRO, e proíbe
    // explicitamente a forma por igualdade.
    expect(REAPER4).toMatch(/\.not\("metadata->>enqueue_motivo_origem", "is", null\)/);
    expect(REAPER4).not.toMatch(/\.eq\("metadata->>enqueue_motivo_origem"/);
  });

  it("volta a `importado` só quando o doc virou confirmed — nunca varre todo `ignorado`", () => {
    // Varrer todo `ignorado` seria o ping-pong da Fase 7 (upload-queue.ts:337-348).
    expect(REAPER4).toMatch(/reconciliadosDeVolta/);
    expect(REAPER4).toMatch(/"confirmed"/);
  });

  it("o retorno e o orquestrador contam o que voltou — capacidade com consumidor", () => {
    expect(PIPELINE).toMatch(/reconciliados_de_volta: number/);
    const RUN = semComentarios(ler("src/app/api/v1/pipeline/run/route.ts"));
    expect(RUN).toMatch(/reconciliados_de_volta/);
  });
});
