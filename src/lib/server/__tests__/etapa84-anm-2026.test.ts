/**
 * Etapa 84 (Fase 13, passo 5) — por que a ANM não tinha 2026, e o seletor que conserta.
 *
 * ═══ A investigação (30/08/2026, página ao vivo) ═══
 * A fonte TEM 2026: a página atas-da-rop lista a 87ª ROP publicada em 21/08/2026 (e 31/07,
 * 21/07, 08/06, 16/01). O problema é NOSSO: os sites da ANM usam `seletor_links = 'a[href]'`,
 * que pega TODAS as âncoras — inclusive as ~760 do MENU do template gov.br. Foi por aí que
 * manual de sistema virou "deliberação" (etapa81) e que a ANM acumulou 110 itens `documento`.
 *
 * ═══ A assinatura, medida na página real ═══
 *  · âncora de ATA:  SEM classe, href terminando em `.pdf` («.../ata-87-rop.pdf»)
 *  · âncora de MENU: `class="state-published"`, href de página HTML
 *
 * Conserto: `matchesLinkSelector` aprende `[attr$="valor"]` (sufixo), e a migration troca o
 * seletor dos sites da ANM para `a[href$=".pdf"]` — só documentos entram; o menu some.
 * A fixture é RECORTE VERBATIM da página baixada, com as 8 atas e 4 âncoras de menu reais.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";
import { parseMonitoringHtml } from "@/lib/server/monitoring";

const URL = "https://www.gov.br/anm/pt-br/composicao/diretoria-colegiada/reunioes-da-diretoria-colegiada/atas-da-rop";
const HTML = readFileSync(join(__dirname, "fixtures/anm/atas-da-rop.html"), "utf-8");

describe("etapa84 · o seletor de sufixo separa conteúdo de menu", () => {
  it("com a:not(.state-published), as 8 atas entram — e NENHUM link de menu", () => {
    const itens = parseMonitoringHtml(HTML, URL, "a:not(.state-published)");
    const atas = itens.filter((i) => /Ata da \d+ª/.test(i.titulo ?? ""));
    expect(atas.length).toBe(8);
    // A 87ª ROP (publicada 21/08/2026) é o dado de 2026 que faltava.
    expect(atas.some((i) => /87/.test(i.titulo ?? ""))).toBe(true);
    // Nenhuma URL de MENU entra (as 4 âncoras state-published da fixture).
    for (const i of itens) {
      expect(i.url_item).not.toMatch(/assuntos\/noticias|acesso-a-sistemas|cadastro-mineiro/);
    }
  });

  it("por que NÃO usamos o sufixo .pdf na ANM: 2 das 8 atas reais apontam para PÁGINA", () => {
    // O sufixo é máquina correta (testado abaixo), mas perderia a 84ª ROP e a 34ª extraordinária,
    // cujos hrefs são páginas HTML — o ramo HTML→PDF do enfileiramento é quem as resolve.
    const soPdf = parseMonitoringHtml(HTML, URL, 'a[href$=".pdf"]');
    const atasPdf = soPdf.filter((i) => /Ata da \d+ª/.test(i.titulo ?? ""));
    expect(atasPdf.length).toBe(6);
    for (const i of soPdf) expect(i.url_item).toMatch(/\.pdf$/i);
  });

  it("o seletor antigo (a[href]) deixava o menu entrar — o teste documenta o buraco", () => {
    const itens = parseMonitoringHtml(HTML, URL, "a[href]");
    // Com tudo liberado, links de página (menu) entram como itens.
    expect(itens.some((i) => !/\.pdf$/i.test(i.url_item))).toBe(true);
  });

  it("o sufixo ignora query/fragment — href real da ANTT vem com ?t=123", () => {
    const html = `<a href="https://x.gov.br/docs/Ata da 99.pdf?t=1773165333667">Ata da 99ª Reunião Ordinária</a>
                  <a href="https://x.gov.br/pagina-qualquer?t=2">Ata da 98ª Reunião Ordinária</a>`;
    const itens = parseMonitoringHtml(html, "https://x.gov.br/", 'a[href$=".pdf"]');
    expect(itens.length).toBe(1);
    expect(itens[0].titulo).toMatch(/99/);
  });

  it("GUARDA: seletor de sufixo que não casa NADA cai no fallback (todos os links)", () => {
    // O fallback anti-regressão-de-config existe e não pode ser quebrado pelo matcher novo.
    const itens = parseMonitoringHtml(HTML, URL, 'a[href$=".docx"]');
    expect(itens.length).toBeGreaterThan(0);
  });

  it("GUARDA: as formas antigas de seletor continuam funcionando", () => {
    // `.classe` — só as âncoras de menu têm classe na fixture.
    const soMenu = parseMonitoringHtml(HTML, URL, "a.state-published");
    expect(soMenu.every((i) => !/\.pdf$/i.test(i.url_item))).toBe(true);
  });
});

describe("etapa84 · a migration aponta os sites da ANM para o seletor novo", () => {
  it("a migration existe, é idempotente e cobre as 4 páginas da diretoria colegiada", () => {
    const sql = readFileSync(
      join(__dirname, "../../../..", "supabase/migrations/20260830130000_anm_seletor_pdf.sql"), "utf-8");
    // A âncora é a LINHA DO UPDATE, não o comentário — mutação provou que o comentário basta
    // para satisfazer um match solto.
    expect(sql).toMatch(/SET seletor_links = 'a:not\(\.state-published\)'/);
    expect(sql.match(/gov\.br\/anm/g)?.length ?? 0).toBeGreaterThanOrEqual(4);
    expect(sql).toMatch(/BEGIN;/);
    expect(sql).toMatch(/NOTIFY pgrst/);
    // Idempotente: UPDATE por URL exata, sem INSERT novo.
    expect(sql).not.toMatch(/INSERT INTO/i);
  });
});
