import { describe, it, expect } from "vitest";
import { buildSimpleDocxFromHtml } from "@/lib/server/docx-export";

// QA ago/2026: o DOCX era lossy por construção — dedup por Set comia linhas legítimas
// repetidas (dois diretores com o mesmo placar), corte em 180 truncava o fim, células de
// tabela viravam linhas soltas e o conteúdo interno dos SVG vazava como texto.

function docxText(buffer: Buffer): string {
  // ZIP em modo STORE (sem compressão) → o document.xml está legível no buffer.
  return buffer.toString("utf8");
}

describe("DOCX fiel ao HTML [etapa43]", () => {
  it("linha de tabela vira 'célula — célula — célula' (uma linha por <tr>)", () => {
    const html = `<table><thead><tr><th>Diretor</th><th>Votos</th></tr></thead>
      <tbody><tr><td>Lucas Asfor</td><td>73</td></tr></tbody></table>`;
    const txt = docxText(buildSimpleDocxFromHtml({ title: "T", html }));
    expect(txt).toContain("Diretor — Votos");
    expect(txt).toContain("Lucas Asfor — 73");
  });

  it("linhas repetidas legítimas NÃO são deduplicadas", () => {
    const html = `<p>10 votos favoráveis</p><p>outra coisa</p><p>10 votos favoráveis</p>`;
    const txt = docxText(buildSimpleDocxFromHtml({ title: "T", html }));
    expect(txt.split("10 votos favoráveis").length - 1).toBe(2);
  });

  it("documento longo não é truncado em 180 linhas", () => {
    const html = Array.from({ length: 300 }, (_, i) => `<p>Linha ${i + 1} do relatório</p>`).join("");
    const txt = docxText(buildSimpleDocxFromHtml({ title: "T", html }));
    expect(txt).toContain("Linha 300 do relatório");
  });

  it("conteúdo interno de SVG não vaza como texto", () => {
    const html = `<p>Antes</p><svg><text>42%</text><path d="M0 0"/></svg><p>Depois</p>`;
    const txt = docxText(buildSimpleDocxFromHtml({ title: "T", html }));
    expect(txt).toContain("Antes");
    expect(txt).toContain("Depois");
    expect(txt).not.toContain("42%");
  });
});
