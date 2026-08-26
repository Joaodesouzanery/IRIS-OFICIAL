/**
 * Etapa 69 (Fase 8) — "a coleta puxa tudo, sem deixar documento para trás?"
 *
 * A resposta era NÃO, por três caminhos. Este arquivo trava os consertos de dois deles (o teto de
 * filhos e a visibilidade do que foi arquivado) e, de quebra, um bug maior que a investigação de
 * risco desenterrou no caminho: TODOS os documentos de uma reunião recebiam o MESMO nome.
 *
 * Tudo aqui foi MEDIDO contra as fixtures reais do portal da ANTT, não estimado.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { resolvePdfLinks, resolvePdfLinksFromHtml } from "@/lib/server/pdf-link-resolver";
import { deriveFilename } from "@/app/api/v1/deliberacoes/enqueue-pdfs/route";

const RAIZ = join(__dirname, "../../../..");
const ler = (p: string) => readFileSync(join(RAIZ, p), "utf-8");
const fixtures = join(dirname(fileURLToPath(import.meta.url)), "fixtures/antt");

const ENQUEUE = ler("src/app/api/v1/deliberacoes/enqueue-pdfs/route.ts");

/** As 7 URLs REAIS de documento da 1.036ª Reunião de Diretoria (Liferay: terminam em UUID). */
const URLS_1036 = [
  "https://portal.antt.gov.br/documents/498202/0/1.036%C2%AA+REUNI%C3%83O+DE+DIRETORIA+P%C3%9ABLICA%2C+DE+2.7.2026+(1).pdf/abc-123",
  "https://portal.antt.gov.br/documents/498202/0/SEI_43781547_Ata_da_Reuniao_de_Diretoria_N__1.036.pdf/aa433e6a-f",
  "https://portal.antt.gov.br/documents/498202/0/Voto+DG+026-2026.pdf/3bee6d55-fa12",
  "https://portal.antt.gov.br/documents/498202/0/Voto+DFQ+042-2026.pdf/a56e963d-909e",
  "https://portal.antt.gov.br/documents/498202/0/Voto+DAB+030-2026.pdf/0479748f-f2ba",
  "https://portal.antt.gov.br/documents/498202/0/Voto+DFQ+044-2026.pdf/e0c5e4e1-842c",
  "https://portal.antt.gov.br/documents/498202/0/Voto+DFQ+043-2026.pdf/60f8733d-104b",
];
const TITULO_REUNIAO = "1.036ª Reunião de Diretoria";

/** O regex que a esteira usa para RESGATAR votos mal classificados (pipeline/run). */
const RE_VOTO = /voto[ _-]+(vista[ _-]+)?d[a-z]{1,2}[ _-]*[0-9]/i;

describe("etapa69 · o nome do arquivo — 7 documentos, 7 nomes", () => {
  it("cada documento da reunião recebe um nome PRÓPRIO", () => {
    const nomes = URLS_1036.map((u) => deriveFilename(TITULO_REUNIAO, u));
    expect(new Set(nomes).size, "todos caíam no slug do título da REUNIÃO").toBe(URLS_1036.length);
  });

  it("os 5 votos individuais voltam a casar o regex de resgate da esteira", () => {
    // Esta é a consequência que importa: com o nome da reunião no lugar de "Voto DFQ 043-2026",
    // o passo que devolve votos mal classificados à fila NUNCA casava.
    const nomes = URLS_1036.map((u) => deriveFilename(TITULO_REUNIAO, u));
    expect(nomes.filter((n) => RE_VOTO.test(n))).toHaveLength(5);
  });

  it("o PENÚLTIMO segmento é a chave — a URL do Liferay termina em UUID", () => {
    expect(deriveFilename(TITULO_REUNIAO, URLS_1036[6])).toBe("Voto DFQ 043-2026.pdf");
  });

  it("`+` vira espaço: é espaço codificado nessas URLs", () => {
    expect(deriveFilename("x", "https://a/b/Voto+DG+026-2026.pdf/uuid")).not.toContain("+");
  });

  it("URL que JÁ termina em .pdf continua vencendo (não regride)", () => {
    expect(deriveFilename("titulo", "https://a/b/ata-85.pdf")).toBe("ata-85.pdf");
  });

  it("sem nenhum segmento .pdf, cai no slug do título — o fallback continua lá", () => {
    const n = deriveFilename("Ata da 85ª ROP", "https://a/b/download?id=9");
    expect(n).toMatch(/\.pdf$/);
    expect(n).toContain("Ata");
  });

  it("escape inválido não derruba a rodada inteira", () => {
    expect(() => deriveFilename("t", "https://a/b/%E0%A4%A/uuid")).not.toThrow();
  });
});

describe("etapa69 · o teto de filhos por página", () => {
  it("a 1.036ª tem SETE PDFs — o teto de 6 cortava exatamente um voto", () => {
    const html = readFileSync(join(fixtures, "reuniao-1036-diretoria.html"), "utf-8");
    const { links, totalEncontrado } = resolvePdfLinks(html, "https://portal.antt.gov.br/r/1036");
    expect(totalEncontrado).toBe(7);
    expect(links).toHaveLength(7);
    const ultimo = deriveFilename(TITULO_REUNIAO, links[6]);
    expect(ultimo, "o descartado era sempre o último — e é um voto").toMatch(RE_VOTO);
  });

  it("o teto de reunião cobre o maior caso medido com folga", () => {
    const m = ENQUEUE.match(/MAX_FILHOS_REUNIAO = (\d+)/);
    expect(m).toBeTruthy();
    expect(Number(m![1]), "abaixo de 7 volta a perder voto").toBeGreaterThanOrEqual(7);
  });

  it("uma página de DOCUMENTO continua rendendo um documento", () => {
    expect(ENQUEUE).toMatch(/MAX_FILHOS_DOCUMENTO = 1/);
  });
});

describe("etapa69 · nenhum corte silencioso: o resolvedor conta o que descartou", () => {
  const muitos = (n: number) =>
    `<html><body>${Array.from({ length: n }, (_, i) => `<a href="/d/doc-${i}.pdf">d${i}</a>`).join("")}</body></html>`;

  it("`totalEncontrado` reporta o que a página tinha, mesmo além do teto", () => {
    const r = resolvePdfLinks(muitos(45), "https://x/");
    expect(r.totalEncontrado).toBe(45);
    expect(r.links.length, "o teto continua existindo").toBeLessThan(45);
  });

  it("o contrato antigo (só os links) segue de pé — há teste que o trava", () => {
    expect(resolvePdfLinksFromHtml(muitos(3), "https://x/")).toHaveLength(3);
  });

  it("o truncamento é medido contra o total da PÁGINA, não contra a lista já cortada", () => {
    // Medir `links.length - pdfs.length` reportaria ZERO numa página de 45: o resolvedor já teria
    // cortado antes de a rota ver. É o cap errado.
    expect(ENQUEUE).toMatch(/pdfsNaPagina > pdfs\.length/);
    expect(ENQUEUE).toMatch(/pdfsNaPagina = totalEncontrado/);
    expect(ENQUEUE).toMatch(/filhos_truncados/);
  });
});

describe("etapa69 · gravar mais filhos não pode matar a função", () => {
  it("o laço de GRAVAÇÃO passou a checar orçamento", () => {
    // A colheita já respeitava o deadline; a gravação, nenhuma vez. Com 12 filhos, o SIGKILL
    // alcança o meio do laço — e os PDFs já gravados ficam com o item ainda "novo".
    expect(ENQUEUE).toMatch(/RESERVA_GRAVACAO_MS/);
    expect(ENQUEUE).toMatch(/for \(const \{ item, valor \} of colheita\.concluidos\) \{\s*\n\s*if \(!hasBudget\(deadlineAt, RESERVA_GRAVACAO_MS\)\)/);
  });

  it("para ENTRE filhos, nunca no meio de um", () => {
    expect(ENQUEUE).toMatch(/for \(const pdf of pdfs\) \{[\s\S]{0,400}?hasBudget\(deadlineAt, RESERVA_GRAVACAO_MS\)/);
  });

  it("item com filho adiado NÃO é marcado como importado", () => {
    // Marcá-lo importado faria os filhos restantes nunca mais serem buscados.
    expect(ENQUEUE).toMatch(/filhosAdiados === 0 && \(algumOk \|\| !algumErro\)/);
  });
});

describe("etapa69 · o teto de vazão volta a ser respeitado", () => {
  const PIPELINE = ler("src/app/api/v1/pipeline/run/route.ts");

  it("o orquestrador manda o teto na unidade que ele limita (PDFs)", () => {
    // `limit` conta ITENS. Com 12 filhos, 20 itens poderiam gravar 240 PDFs contra um teto de 60.
    expect(PIPELINE).toMatch(/max_pdfs: saldoTeto/);
  });

  it("a rota respeita `max_pdfs` e adia o excedente", () => {
    expect(ENQUEUE).toMatch(/max_pdfs\?: number/);
    expect(ENQUEUE).toMatch(/pdfsGravados >= maxPdfs/);
  });
});

describe("etapa69 · o que foi arquivado deixa de ser invisível", () => {
  const ROTA = ler("src/app/api/v1/admin/monitoramento/nao-enfileirados/route.ts");
  const PAGE = ler("src/app/dashboard/deliberacoes/votos-diretores/page.tsx");

  it("o MOTIVO entra na chave do grupo — recuperável × conteúdo são coisas diferentes", () => {
    expect(ROTA).toMatch(/\$\{motivoItem \?\? "-"\}/);
    expect(ROTA).toMatch(/motivo: motivoItem/);
  });

  it("a rota separa o arquivado RECUPERÁVEL do resto", () => {
    expect(ROTA).toMatch(/total_arquivados_recuperaveis/);
    expect(ROTA).toMatch(/g\.motivo === "download_falhou"/);
  });

  it("o ramo demo tem as chaves novas (lição da etapa65)", () => {
    expect(ROTA).toMatch(/modo: "demo",[\s\S]{0,300}?total_arquivados_recuperaveis: 0/);
  });

  it("a tela mostra os arquivados, com motivo", () => {
    expect(PAGE).toMatch(/total_arquivados/);
    expect(PAGE).toMatch(/g\.status === "ignorado"/);
    expect(PAGE).toMatch(/arquivado\(s\) com motivo/);
  });

  it("o bloco honesto da Fase 7 continua de pé (não foi reescrito por cima)", () => {
    expect(PAGE).toMatch(/podeVirarVoto\(g\.tipo\)/);
    expect(PAGE).toMatch(/naEsteira/);
  });
});
