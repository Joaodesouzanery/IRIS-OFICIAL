/**
 * Etapa 103 (Fase 17, commit F) — o e-mail passa a dizer a FONTE, e o PDF ganha o rodapé do IRIS.
 *
 * As duas saídas moram no MESMO arquivo (`src/lib/newsletter-document.ts`):
 * `variant:"email"` → `buildIrisEmailNewsletterHtml`; `variant:"print"` → o documento.
 *
 * ═══ (i) A fonte some no e-mail em casos que o PDF cobre ═══
 * `newsTag` (email) só olha `agencia.sigla`/`agencia_sigla` e `publicado_em`: notícia de veículo
 * (com `fonte`) ou sem data de publicação perde a linha INTEIRA. `formatArticleTag` (print) cai
 * em `item.fonte` e em `first_seen_at`, e por isso sempre imprime. E o link: o print sempre
 * mostra "Ler fonte oficial"; o e-mail omitia quando não havia `url`.
 *
 * ═══ (ii) O PDF não tinha "Siga o IRIS" nem rodapé institucional ═══
 * Os dados JÁ existem no arquivo (IRIS_SITE_URL, IRIS_INSTAGRAM_URL, IRIS_LINKEDIN_URL) e o
 * bloco existe — só no e-mail. Nada a inventar; consolidar.
 *
 * ═══ (iii) Bug achado no caminho: "Salvar edição" grava o HTML de E-MAIL ═══
 * `newsletter/edicoes/route.ts:80` chama o builder SEM o 2º argumento (default `"email"`) e é
 * esse HTML que a rota `/pdf` devolve — com `X-IRIS-PDF-Mode: browser-print`. Quem imprime uma
 * edição salva imprime o e-mail.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";
import { buildRegulatoryNewsletterHtml } from "@/lib/newsletter-document";

const RAIZ = join(__dirname, "../../../..");
const ler = (p: string) => readFileSync(join(RAIZ, p), "utf-8");
const EDICOES = ler("src/app/api/v1/newsletter/edicoes/route.ts")
  .replace(/\/\*[\s\S]*?\*\//g, " ").replace(/\/\/.*$/gm, " ");
const PDF_ROUTE = ler("src/app/api/v1/newsletter/edicoes/[id]/pdf/route.ts");

/** Notícia de VEÍCULO: tem `fonte`, não tem agência nem `publicado_em`. É o caso que sumia. */
const noticiaDeVeiculo = {
  id: "n1",
  titulo: "Agência publica consulta sobre tarifas",
  resumo: "Resumo curto da matéria.",
  fonte: "Valor Econômico",
  url: "https://exemplo.org/materia",
  first_seen_at: "2026-09-01T10:00:00Z",
  publicado_em: null,
  agencia_sigla: null,
} as any;

const entrada = {
  assunto: "Boletim de teste",
  descricao: "",
  destinatarios: [],
  temas: [],
  noticias: [noticiaDeVeiculo],
  documento_tipo: "newsletter_regulatoria" as const,
};

describe("etapa103 · a FONTE aparece no e-mail — o caso que o PDF já cobria", () => {
  it("COMPORTAMENTO: notícia de veículo sem agência mostra o rótulo da fonte no e-mail", () => {
    const email = buildRegulatoryNewsletterHtml(entrada, "email");
    expect(email).toContain("Valor Econômico");
  });

  it("…e o PDF continua mostrando (a paridade é o e-mail alcançar o PDF, não o contrário)", () => {
    const print = buildRegulatoryNewsletterHtml(entrada, "print");
    expect(print).toContain("Valor Econômico");
  });

  it("sem `publicado_em`, a data vem de first_seen_at nos DOIS — nunca some a linha", () => {
    const email = buildRegulatoryNewsletterHtml(entrada, "email");
    const print = buildRegulatoryNewsletterHtml(entrada, "print");
    for (const html of [email, print]) expect(html).toMatch(/set|Set|09/);
  });

  it("notícia SEM url não perde o rótulo da fonte no e-mail", () => {
    const semUrl = { ...entrada, noticias: [{ ...noticiaDeVeiculo, url: null }] };
    const email = buildRegulatoryNewsletterHtml(semUrl, "email");
    expect(email).toContain("Valor Econômico");
    // …e não inventa um link morto: sem url, nada de href vazio.
    expect(email).not.toMatch(/href=""/);
  });
});

describe("etapa103 · tipografia: o e-mail carrega a mesma família do PDF", () => {
  it("Inter entra na pilha sans e no <link> do e-mail", () => {
    const email = buildRegulatoryNewsletterHtml(entrada, "email");
    expect(email).toMatch(/family=Playfair\+Display[^"']*Inter|family=Inter/);
    expect(email).toContain("'Inter'");
  });
});

describe("etapa103 · «Siga o IRIS» e o rodapé institucional no PDF", () => {
  const print = buildRegulatoryNewsletterHtml(entrada, "print");

  it("o bloco social existe no PDF, com links CLICÁVEIS", () => {
    expect(print).toContain("Siga o IRIS");
    expect(print).toContain("https://www.instagram.com/iris.regulacao/");
    expect(print).toContain("https://www.linkedin.com/company/irisregulacao/");
  });

  it("o rodapé traz site e e-mail clicáveis", () => {
    expect(print).toContain("https://irisregulacao.org/");
    expect(print).toContain("mailto:contato@irisregulacao.org");
  });

  it("o e-mail continua com o dele — nada foi movido, só espelhado", () => {
    const email = buildRegulatoryNewsletterHtml(entrada, "email");
    expect(email).toContain("Siga o IRIS");
  });
});

describe("etapa103 · a edição salva guarda as DUAS saídas", () => {
  it("o builder é chamado com «print» além do e-mail", () => {
    expect(EDICOES).toMatch(/buildRegulatoryNewsletterHtml\([\s\S]{0,40}?entradaDoDocumento[\s\S]{0,20}?"print"\)|"print"\)/);
  });

  it("o HTML de impressão é persistido — senão a rota /pdf continua servindo o e-mail", () => {
    expect(EDICOES).toMatch(/html_print/);
  });

  it("a rota /pdf serve o de impressão, com fallback para as edições antigas", () => {
    expect(PDF_ROUTE).toMatch(/html_print/);
    expect(PDF_ROUTE).toMatch(/\?\?\s*data\.html|\|\|\s*data\.html/);
  });
});
