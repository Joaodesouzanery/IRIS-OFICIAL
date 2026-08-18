import { describe, it, expect } from "vitest";
import { resolvePdfLinksFromHtml, sniffIsPdf, sniffIsHtml, ploneDownloadUrl } from "@/lib/server/pdf-link-resolver";

// QA ago/2026 ("208 detectados / 0 na fila"): o gate do enqueue era regex de URL e
// barrava ARTESP (DAM sem .pdf) e ANM (páginas /view). Agora o critério é CONTEÚDO.

describe("sniff por conteúdo [etapa42]", () => {
  it("PDF sem .pdf na URL (ARTESP/DAM): magic bytes bastam", () => {
    expect(sniffIsPdf(null, Buffer.from("%PDF-1.7 blablabla"))).toBe(true);
    expect(sniffIsPdf("application/octet-stream", Buffer.from("%PDF-1.4"))).toBe(true);
  });
  it("content-type pdf também basta", () => {
    expect(sniffIsPdf("application/pdf; charset=binary", Buffer.from("qualquer"))).toBe(true);
  });
  it("HTML é recusado como PDF e detectado como HTML", () => {
    const html = Buffer.from("<!DOCTYPE html><html><head></head><body>x</body></html>");
    expect(sniffIsPdf("text/html", html)).toBe(false);
    expect(sniffIsHtml("text/html", html)).toBe(true);
    expect(sniffIsHtml(null, html)).toBe(true); // sniff pelo corpo, sem content-type
  });
});

describe("resolvePdfLinksFromHtml [etapa42]", () => {
  const BASE = "https://www.gov.br/antt/pt-br/reunioes/reuniao-15";

  it("página de reunião ANTT: acha os N PDFs (relativos resolvidos)", () => {
    const html = `
      <html><body>
        <a href="/antt/docs/ata_15.pdf">Ata</a>
        <a href="votos/voto_daa_123.pdf?x=1">Voto DAA</a>
        <a href="#topo">topo</a>
        <a href="mailto:x@y.z">contato</a>
        <a href="/antt/docs/ata_15.pdf">Ata (repetida)</a>
      </body></html>`;
    const links = resolvePdfLinksFromHtml(html, BASE);
    expect(links).toEqual([
      "https://www.gov.br/antt/docs/ata_15.pdf",
      "https://www.gov.br/antt/pt-br/reunioes/votos/voto_daa_123.pdf?x=1",
    ]); // dedup + ordem de aparição
  });

  it("padrão Plone (ANM): /view vira @@download/file", () => {
    const html = `<a href="https://www.gov.br/anm/atas/ata-85/view">Ata 85</a>`;
    expect(resolvePdfLinksFromHtml(html, BASE)).toEqual([
      "https://www.gov.br/anm/atas/ata-85/@@download/file",
    ]);
    expect(ploneDownloadUrl("https://x.gov.br/doc/view")).toBe("https://x.gov.br/doc/@@download/file");
    expect(ploneDownloadUrl("https://x.gov.br/doc.pdf")).toBe("https://x.gov.br/doc.pdf");
  });

  it("página sem nenhum PDF → vazio (item vira terminal 'sem_pdf')", () => {
    expect(resolvePdfLinksFromHtml("<html><body><a href='/sobre'>Sobre</a></body></html>", BASE)).toEqual([]);
  });
});
