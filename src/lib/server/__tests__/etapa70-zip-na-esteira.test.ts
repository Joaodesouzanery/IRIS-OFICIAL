/**
 * Etapa 70 (Fase 9) — a esteira aprende a ler ZIP.
 *
 * ═══ O buraco ═══
 * Medição ao vivo da página de reuniões da ARTESP (26/08/2026): 256 URLs de documento, todas
 * HTTP 200 com arquivo real — **148 PDF, 76 ZIP, 32 DOCX**. Por rótulo: Deliberação 85 → 75 ZIP
 * (88%); Pauta 84 → 31 DOCX; Ata 83 → 82 PDF. Em produção estavam arquivados como `sem_pdf`:
 * deliberação 133, pauta 65, ata 2 — a MESMA assinatura.
 *
 * O gate do enfileiramento conhecia dois estados: "é PDF" ou "é HTML com links de PDF". ZIP e DOCX
 * caíam no vão e viravam `sem_pdf` terminal — e `sem_pdf` é, por desenho, excluído do retry. Morte
 * definitiva por tipo de arquivo. Amostra de 11 ZIPs: 207 PDFs dentro, média 18,8.
 *
 * `src/lib/server/zip-extractor.ts` existia desde julho, ligado só ao upload MANUAL: o upload comia
 * o mesmo ZIP que a esteira jogava fora. Este arquivo é também o PRIMEIRO teste desse módulo —
 * 130 linhas de parser binário que estavam sem cobertura nenhuma.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";
import { extractPdfEntriesFromZip, isZipBuffer } from "@/lib/server/zip-extractor";
import { sniffIsZip, sniffIsDocx, sniffIsPdf, sniffIsHtml } from "@/lib/server/pdf-link-resolver";

const RAIZ = join(__dirname, "../../../..");
const ler = (p: string) => readFileSync(join(RAIZ, p), "utf-8");
const ENQUEUE = ler("src/app/api/v1/deliberacoes/enqueue-pdfs/route.ts");

// ─── Fixture: ZIP "stored" (método 0) montado em memória ──────────────────────
// Método 0 dispensa deflate, então a fixture é aritmética de buffer pura — o mesmo caminho que
// `docx-export.ts` já usa do lado gerador. Sem isto, testar o extractor exigiria um .zip binário
// versionado, que ninguém consegue revisar num diff.
function montarZip(arquivos: Array<{ nome: string; conteudo: Buffer }>): Buffer {
  const locais: Buffer[] = [];
  const centrais: Buffer[] = [];
  let offset = 0;
  for (const { nome, conteudo } of arquivos) {
    const nomeBuf = Buffer.from(nome, "utf8");
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);   // assinatura local
    local.writeUInt16LE(20, 4);           // versão
    local.writeUInt16LE(0, 8);            // método 0 = stored
    local.writeUInt32LE(0, 14);           // crc (o extrator não confere)
    local.writeUInt32LE(conteudo.length, 18);
    local.writeUInt32LE(conteudo.length, 22);
    local.writeUInt16LE(nomeBuf.length, 26);
    locais.push(local, nomeBuf, conteudo);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(0, 10);         // método 0
    central.writeUInt32LE(conteudo.length, 20);
    central.writeUInt32LE(conteudo.length, 24);
    central.writeUInt16LE(nomeBuf.length, 28);
    central.writeUInt32LE(offset, 42);    // offset do header local
    centrais.push(central, nomeBuf);

    offset += 30 + nomeBuf.length + conteudo.length;
  }
  const corpoLocal = Buffer.concat(locais);
  const corpoCentral = Buffer.concat(centrais);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(arquivos.length, 8);
  eocd.writeUInt16LE(arquivos.length, 10);
  eocd.writeUInt32LE(corpoCentral.length, 12);
  eocd.writeUInt32LE(corpoLocal.length, 16);
  return Buffer.concat([corpoLocal, corpoCentral, eocd]);
}

const pdfFalso = (marca: string) => Buffer.from(`%PDF-1.4\n${marca}\n%%EOF`, "latin1");

describe("etapa70 · o extractor, que nunca teve teste", () => {
  it("tira só os .pdf de um ZIP misto, e usa o BASENAME", () => {
    const zip = montarZip([
      { nome: "Deliberacoes/2026/DELIBERACAO ARTESP No 620.pdf", conteudo: pdfFalso("a") },
      { nome: "leiame.txt", conteudo: Buffer.from("nada aqui") },
      { nome: "Deliberacoes/2026/DELIBERACAO ARTESP No 621.pdf", conteudo: pdfFalso("b") },
    ]);
    const entradas = extractPdfEntriesFromZip(zip);
    expect(entradas).toHaveLength(2);
    expect(entradas.map((e) => e.name)).toEqual([
      "DELIBERACAO ARTESP No 620.pdf",
      "DELIBERACAO ARTESP No 621.pdf",
    ]);
    expect(entradas[0].buffer.subarray(0, 5).toString("latin1")).toBe("%PDF-");
  });

  it("ZIP sem nenhum PDF devolve lista vazia, não erro", () => {
    expect(extractPdfEntriesFromZip(montarZip([{ nome: "a.txt", conteudo: Buffer.from("x") }]))).toEqual([]);
  });

  it("LANÇA ao exceder maxFiles — por isso o corte tem de ser nosso", () => {
    // É o motivo de o gate passar maxFiles: 100 e cortar em MAX_PDFS_POR_ZIP do lado da gravação:
    // se o teto fosse do extractor, um acervo grande viraria ERRO em vez de truncamento reportado.
    const zip = montarZip([1, 2, 3].map((n) => ({ nome: `d${n}.pdf`, conteudo: pdfFalso(String(n)) })));
    expect(() => extractPdfEntriesFromZip(zip, { maxFiles: 2 })).toThrow(/limite de 2 PDFs/);
    expect(extractPdfEntriesFromZip(zip, { maxFiles: 100 })).toHaveLength(3);
  });

  it("ZIP corrompido LANÇA — e o gate tem de tratar isso como terminal, não como falha de rede", () => {
    const truncado = montarZip([{ nome: "a.pdf", conteudo: pdfFalso("a") }]).subarray(0, 12);
    expect(isZipBuffer(truncado), "os 4 bytes de magic continuam lá").toBe(true);
    expect(() => extractPdfEntriesFromZip(truncado)).toThrow();
  });
});

describe("etapa70 · os sniffs, e a armadilha do DOCX", () => {
  it("reconhece ZIP pela assinatura PK", () => {
    expect(sniffIsZip(montarZip([{ nome: "a.pdf", conteudo: pdfFalso("a") }]))).toBe(true);
    expect(sniffIsZip(pdfFalso("x"))).toBe(false);
  });

  it("DOCX É ZIP — e é reconhecido como DOCX pelo diretório central", () => {
    // A armadilha central desta fase: sem este teste, os 32 .docx da ARTESP entrariam no ramo do
    // ZIP, sairiam com zero entradas .pdf e voltariam a ser arquivados como "sem PDF" — o mesmo
    // diagnóstico errado por um caminho novo, e o conserto nasceria sem efeito.
    const docx = montarZip([
      { nome: "[Content_Types].xml", conteudo: Buffer.from("<Types/>") },
      { nome: "word/document.xml", conteudo: Buffer.from("<w:document/>") },
    ]);
    expect(sniffIsZip(docx), "um DOCX passa no teste de ZIP").toBe(true);
    expect(extractPdfEntriesFromZip(docx), "e não tem PDF nenhum dentro").toEqual([]);
    expect(sniffIsDocx(null, "https://x/dam/abc?binary=true", docx), "por isso o sniff próprio").toBe(true);
  });

  it("reconhece DOCX por content-type e por extensão, sem depender do binário", () => {
    const vazio = Buffer.alloc(0);
    expect(sniffIsDocx("application/vnd.openxmlformats-officedocument.wordprocessingml.document", "https://x/a", vazio)).toBe(true);
    expect(sniffIsDocx(null, "https://x/pauta.docx", vazio)).toBe(true);
  });

  it("um ZIP de verdade NÃO é confundido com DOCX", () => {
    const zip = montarZip([{ nome: "Delib 1.pdf", conteudo: pdfFalso("a") }]);
    expect(sniffIsDocx("application/zip", "https://x/dam/abc?binary=true", zip)).toBe(false);
  });

  it("os sniffs não se atropelam: PDF não é ZIP, ZIP não é HTML", () => {
    const zip = montarZip([{ nome: "a.pdf", conteudo: pdfFalso("a") }]);
    expect(sniffIsPdf(null, zip)).toBe(false);
    expect(sniffIsHtml("application/zip", zip)).toBe(false);
    expect(sniffIsZip(Buffer.from("<html><head></head></html>"))).toBe(false);
  });
});

describe("etapa70 · o terceiro ramo do gate", () => {
  it("existe, e vem ANTES do ramo HTML", () => {
    // `sniffIsHtml` casa `<head` em qualquer lugar dos primeiros 512 bytes; `PK\x03\x04` é exato.
    // Na ordem inversa, um ZIP cujo conteúdo comprimido contivesse esses bytes viraria "página".
    const iZip = ENQUEUE.indexOf("} else if (sniffIsZip(fetched.buffer)) {");
    const iHtml = ENQUEUE.indexOf("} else if (sniffIsHtml(fetched.contentType, fetched.buffer)) {");
    expect(iZip).toBeGreaterThan(-1);
    expect(iZip).toBeLessThan(iHtml);
  });

  it("testa DOCX ANTES de tentar extrair", () => {
    const ramo = ENQUEUE.slice(ENQUEUE.indexOf("} else if (sniffIsZip(fetched.buffer)) {"));
    const ateExtrair = ramo.slice(0, ramo.indexOf("extractPdfEntriesFromZip("));
    expect(ateExtrair).toMatch(/sniffIsDocx\(/);
  });

  it("tem try/catch PRÓPRIO — senão ZIP corrompido vira 25 dias de retry de rede", () => {
    const ramo = ENQUEUE.slice(
      ENQUEUE.indexOf("} else if (sniffIsZip(fetched.buffer)) {"),
      ENQUEUE.indexOf("} else if (sniffIsHtml(fetched.contentType, fetched.buffer)) {"),
    );
    expect(ramo).toMatch(/catch \(erroZip\)/);
    expect(ramo).toMatch(/zip_invalido:/);
  });

  it("cada desfecho tem motivo PRÓPRIO — nunca mais tudo virando `sem_pdf`", () => {
    expect(ENQUEUE).toMatch(/formato_nao_suportado:docx/);
    expect(ENQUEUE).toMatch(/"zip_sem_pdf"/);
    expect(ENQUEUE).toMatch(/const motivoTerminal = valor\.motivo \?\? "sem_pdf"/);
  });

  it("usa o nome de DENTRO do ZIP, não o slug do título", () => {
    // Sem isto, os 19 documentos de um ZIP recebem o mesmo nome — o bug que a Fase 8 matou,
    // voltando por outra porta.
    expect(ENQUEUE).toMatch(/filename: entrada\.name/);
    expect(ENQUEUE).toMatch(/const filename = pdf\.filename \?\? deriveFilename\(/);
  });

  it("registra a origem: sourceArchive + a entrada do ZIP", () => {
    expect(ENQUEUE).toMatch(/sourceArchive: pdf\.sourceArchive/);
    expect(ENQUEUE).toMatch(/source_zip_entry/);
  });

  it("passa maxFiles alto e teto de memória próprio ao extractor", () => {
    const ramo = ENQUEUE.slice(ENQUEUE.indexOf("} else if (sniffIsZip(fetched.buffer)) {"));
    expect(ramo).toMatch(/maxFiles: 100/);
    expect(ramo).toMatch(/maxTotalUncompressedBytes: 60 \* 1024 \* 1024/);
  });
});

describe("etapa70 · os tetos conversam entre si", () => {
  it("o teto da rodada é MAIOR que o maior ZIP possível — é o que evita o livelock", async () => {
    const { TETO_ENQUEUE_POR_RODADA } = await import("@/lib/server/esteira-reservas");
    const m = ENQUEUE.match(/MAX_PDFS_POR_ZIP = (\d+)/);
    expect(m).toBeTruthy();
    expect(TETO_ENQUEUE_POR_RODADA).toBeGreaterThan(Number(m![1]));
  });

  it("o teto por ZIP cobre o maior arquivo medido no acervo (58 entradas)", () => {
    const m = ENQUEUE.match(/MAX_PDFS_POR_ZIP = (\d+)/);
    expect(Number(m![1])).toBeGreaterThanOrEqual(58);
  });

  it("`MAX_FILHOS_DOCUMENTO` continua 1 — a semântica do ramo HTML não mudou", () => {
    expect(ENQUEUE).toMatch(/MAX_FILHOS_DOCUMENTO = 1/);
  });
});
