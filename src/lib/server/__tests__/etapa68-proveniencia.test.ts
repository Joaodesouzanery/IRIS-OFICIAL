/**
 * Etapa 68 (Fase 7) — PROVENIÊNCIA: dá para auditar o que a esteira decidiu?
 *
 * Antecipado a pedido do usuário, e o motivo é bom: a auditoria tem de existir ANTES de o volume
 * subir (commits 4-7), não depois. Sem ela, "300 documentos processados" é uma afirmação que
 * ninguém consegue conferir.
 *
 * O que estava quebrado: no caminho zero-toque, `deliberacoes.raw_extraction` nascia SEM a URL de
 * origem e SEM qualquer texto — o card "Documento e classificação" do detalhe (que existe desde o
 * commit 3bca9ea) degradava para quase nada justamente nos documentos que a esteira processou
 * sozinha, ou seja, em quase todos. E o MÉTODO de extração (pdf-parse × OCR) era calculado para
 * rebaixar a confiança e jogado fora em seguida.
 *
 * A regra que estes testes protegem: o texto COMPLETO continua fora do JSONB de propósito (ele vive
 * em `documentos_regulatorios.texto_extraido`; duplicar 50k por deliberação incharia a tabela), mas
 * o mínimo auditável — de onde veio, como foi lido, e um trecho para bater o olho — viaja junto.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";

const RAIZ = join(__dirname, "../../../..");
const ler = (p: string) => readFileSync(join(RAIZ, p), "utf-8");

describe("etapa68 · a URL de origem chega até a deliberação", () => {
  const pipeline = ler("src/lib/server/pipeline.ts");

  it("a esteira colhe `metadata.source_url` do documento", () => {
    expect(pipeline).toMatch(/docMeta\.source_url/);
    expect(pipeline).toMatch(/const sourceUrl/);
  });

  it("colher a origem NÃO custa um round-trip novo na parte quente", () => {
    // O `.select()` no UPDATE que já marcava "processing" devolve a linha na mesma ida ao banco.
    // Um SELECT extra por PDF seria pago 15-30× por rodada depois do commit de vazão.
    expect(pipeline).toMatch(/devolverLinha\s*\?\s*await q\.select\("metadata"\)/);
    expect(pipeline).toMatch(/\.update\(patch\)\.eq\("id", documentoId\)/);
    expect(pipeline).not.toMatch(/from\("documentos_regulatorios"\)\s*\.select\("metadata"\)/);
  });

  it("a origem entra no extraction_raw que o resto da esteira copia", () => {
    expect(pipeline).toMatch(/previewToJson\(analysis,\s*sourceUrl\)/);
    expect(pipeline).toMatch(/sourceUrl\s*\?\s*\{\s*source_url:\s*sourceUrl\s*\}/);
  });
});

describe("etapa68 · o trecho viaja, o texto completo não", () => {
  const pipeline = ler("src/lib/server/pipeline.ts");

  it("`texto_trecho` é gravado e é LIMITADO", () => {
    // Asserção sobre a ESCRITA, não sobre a palavra aparecer no arquivo: a primeira versão deste
    // teste casava com o próprio comentário acima e sobrevivia à remoção da linha que grava.
    expect(pipeline).toMatch(/\.\.\.\(trecho \? \{ texto_trecho: trecho \} : \{\}\)/);
    expect(pipeline).toMatch(/const trecho = typeof rawText === "string"/);
    const m = pipeline.match(/TRECHO_MAX_CHARS\s*=\s*([\d_]+)/);
    expect(m, "o limite precisa ser uma constante nomeada").toBeTruthy();
    const n = Number(m![1].replace(/_/g, ""));
    expect(n).toBeGreaterThan(500);
    expect(n, "trecho grande demais devolve o problema de inchaço que o strip resolvia").toBeLessThanOrEqual(8_000);
  });

  it("o raw_text de 50k continua FORA do JSONB — o strip é proposital", () => {
    expect(pipeline).toMatch(/const \{ raw_text: rawText, \.\.\.rawWithoutText \}/);
    expect(pipeline).not.toMatch(/extraction_raw:\s*\{[^}]*\braw_text\b/);
  });

  it("o nome não se disfarça de texto completo", () => {
    // `texto_trecho` × `raw_text`: quem ler o banco tem de saber que é um pedaço. Gravar o
    // recorte sob a chave `raw_text` seria pior que não gravar — quem consultasse leria um
    // texto truncado achando que tinha o documento inteiro.
    expect(pipeline).not.toMatch(/raw_text:\s*(rawText\.slice|trecho)/);
  });
});

describe("etapa68 · o método de extração deixa de ser descartado", () => {
  const analise = ler("src/lib/server/upload-analysis.ts");

  it("`extracao_metodo` é persistido a partir do ocrApplied", () => {
    expect(analise).toMatch(/extracao_metodo:\s*extraction\.ocrApplied\s*\?\s*"ocr"\s*:\s*"pdf-parse"/);
  });

  it("continua dentro do extraction_raw, junto de page_count/chars_per_page", () => {
    const bloco = analise.slice(analise.indexOf("extraction_raw: {"), analise.indexOf("raw_text:"));
    expect(bloco).toContain("extracao_metodo");
    expect(bloco).toContain("page_count");
  });
});

describe("etapa68 · o detalhe volta a mostrar a inspeção", () => {
  const rota = ler("src/app/api/v1/deliberacoes/[id]/route.ts");
  const page = ler("src/app/dashboard/deliberacoes/[id]/page.tsx");

  it("a rota cai para `texto_trecho` quando não há raw_text (o caso zero-toque)", () => {
    expect(rota).toMatch(/rawText[\s\S]{0,160}?texto_trecho/);
  });

  it("a rota expõe o método de extração", () => {
    expect(rota).toMatch(/extracao_metodo:\s*typeof raw\?\.extracao_metodo/);
  });

  it("a tela mostra se o texto veio de OCR — porque OCR erra diferente", () => {
    expect(page).toMatch(/extra\.extracao_metodo/);
    expect(page).toMatch(/OCR \(imagem\)/);
  });
});
