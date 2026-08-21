/**
 * Boletim Regulatório — template HTML ÚNICO (redesign editorial ago/2026).
 *
 * Antes vivia como string inline de 218 linhas dentro do client (dashboard/boletim/page.tsx),
 * com títulos em monospace, 4 KPI-cards clonados, listas "1. X — N" e 4 opacidades de branco
 * aleatórias — a estética genérica de dashboard gerado. Agora:
 *   · tokens de MARCA importados de report-theme (navy/gold — ponto único de verdade);
 *   · escala de tinta com 3 níveis definidos (INK / INK_SOFT / INK_MUTED) + 1 token de linha;
 *   · Playfair fazendo trabalho real (h1, números-hero); seções com eyebrow dourado small-caps;
 *   · KPIs com HIERARQUIA (1 número-hero + secundários em régua fina, sem cartão);
 *   · rankings como BARRAS horizontais email-safe (tabela com width%), não lista numerada;
 *   · cores de dado sóbrias e semânticas — o dourado é só marca.
 * Markup 100% em tabelas + estilo inline (o HTML é copiado para e-mail).
 */

import { REPORT_COLORS } from "@/lib/report-theme";

const NAVY = REPORT_COLORS.navy;
const GOLD = REPORT_COLORS.gold;

// Superfícies do documento escuro
const OUTER = "#eceae4";     // papel externo (mesmo tom da newsletter)
const FOOTER_BG = "#07091d";

// Escala de TINTA única (3 níveis — fim das opacidades aleatórias)
const INK = "#f4f4f5";
const INK_SOFT = "rgba(255,255,255,0.72)";
const INK_MUTED = "rgba(255,255,255,0.55)";
const LINE = "rgba(255,255,255,0.12)";

// Cores de DADO para fundo escuro (semânticas, sóbrias; dourado nunca é série)
const POS = "#5fbe8b";
const DIVERG = "#b3a1e6";
const BAR_FILL = "#58618f";           // barra de ranking (slate-navy claro)
const BAR_TRACK = "rgba(255,255,255,0.08)";

const SERIF = "'Playfair Display', Georgia, 'Times New Roman', serif";
const SANS = "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Arial, sans-serif";
const NUM = "font-variant-numeric:tabular-nums lining-nums;";

function esc(s: string): string {
  return String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/** Título de seção: eyebrow dourado small-caps + filete curto (nada de monospace). */
function sectionHead(titulo: string): string {
  return `
    <table width="100%" cellpadding="0" cellspacing="0"><tr>
      <td style="padding:0 0 4px"><p style="margin:0;font-family:${SANS};font-size:10.5px;font-weight:700;letter-spacing:0.22em;text-transform:uppercase;color:${GOLD}">${esc(titulo)}</p></td>
    </tr><tr>
      <td style="padding:0 0 14px"><table cellpadding="0" cellspacing="0"><tr><td style="width:32px;border-bottom:2px solid ${GOLD};font-size:0;line-height:0">&nbsp;</td></tr></table></td>
    </tr></table>`;
}

function sectionRow(inner: string, first = false): string {
  return `<tr><td style="padding:20px 0 6px;${first ? "" : `border-top:1px solid ${LINE}`}">${inner}</td></tr>`;
}

/** Barra horizontal EMAIL-SAFE: rótulo · trilho com preenchimento por width% · valor tabular. */
function barRow(label: string, value: number, max: number, valueText: string): string {
  const pct = Math.max(3, Math.round((Math.max(0, value) / Math.max(1, max)) * 100));
  return `
    <tr>
      <td style="padding:5px 0;font-family:${SANS};font-size:12px;color:${INK_SOFT};width:44%">${esc(label)}</td>
      <td style="padding:5px 10px 5px 12px;vertical-align:middle">
        <table width="100%" cellpadding="0" cellspacing="0"><tr>
          <td style="width:${pct}%;background:${BAR_FILL};height:8px;line-height:8px;font-size:0">&nbsp;</td>
          ${pct < 100 ? `<td style="background:${BAR_TRACK};height:8px;line-height:8px;font-size:0">&nbsp;</td>` : ""}
        </tr></table>
      </td>
      <td align="right" style="padding:5px 0;font-family:${SANS};font-size:12px;font-weight:700;color:${INK};${NUM}width:52px">${esc(valueText)}</td>
    </tr>`;
}

/** Estat secundária em régua fina (sem cartão): filete no topo, valor forte, rótulo small-caps. */
function stat(valor: string, rotulo: string, cor = INK): string {
  return `
    <td style="border-top:1px solid ${LINE};padding:10px 14px 0 0;vertical-align:top">
      <p style="margin:0;font-family:${SANS};font-size:21px;font-weight:700;color:${cor};${NUM}">${esc(valor)}</p>
      <p style="margin:5px 0 0;font-family:${SANS};font-size:9px;letter-spacing:0.16em;text-transform:uppercase;color:${INK_MUTED}">${esc(rotulo)}</p>
    </td>`;
}

interface ListaItem { titulo: string; meta: string; metaExtraHtml?: string }
function listaRows(itens: ListaItem[]): string {
  return itens.map((it) => `
    <tr><td style="padding:9px 0;border-bottom:1px solid ${LINE}">
      <p style="margin:0;font-family:${SANS};font-size:13px;color:${INK};font-weight:600">${it.titulo}</p>
      <p style="margin:3px 0 0;font-family:${SANS};font-size:11.5px;color:${INK_MUTED}">${it.meta}${it.metaExtraHtml ?? ""}</p>
    </td></tr>`).join("");
}

export interface BoletimHtmlInput {
  selectedSections: string[];
  periodoLabel: string;
  agenciaLabel: string;
  baseUrl: string; // origem absoluta p/ o logo (o HTML vai por e-mail)
  hoje?: string;   // data formatada (injetável p/ teste)
  overview?: {
    total_deliberacoes: number; deferidos: number; taxa_deferimento: string | number;
    reunioes_unicas: number; avg_confidence?: number | null;
  };
  mandatos?: { taxa_consenso: string; taxa_litigio: string; taxa_sancao: string };
  microtemas?: Array<{ label: string; total: number }>;
  areas?: Array<{ label: string; total: number }>;
  empresas?: Array<{ label: string; total: number }>;
  diretores?: Array<{ nome: string; total: number; pctFavor: number }>;
  recentes?: ListaItem[];
  divergentes?: Array<{ titulo: string; meta: string; nomes: string }>;
  publicadas?: ListaItem[];
  formatNumber: (n: number) => string;
}

// Mesma fórmula composta da Governança/Analytics Institucional (não deixar divergir).
export function calcGovScore(consenso: number, deferimento: number, qualidade: number, sancao: number) {
  return Math.round(consenso * 0.3 + deferimento * 0.25 + qualidade * 0.25 + (100 - sancao) * 0.2);
}

export function buildBoletimHtml(input: BoletimHtmlInput): string {
  const sec = (id: string) => input.selectedSections.includes(id);
  const fmt = input.formatNumber;
  const today = input.hoje ?? new Date().toLocaleDateString("pt-BR", { day: "2-digit", month: "long", year: "numeric" });
  const logoUrl = `${input.baseUrl.replace(/\/$/, "")}/brand/newsletter-logo-wide.png`;
  const ov = input.overview;

  const blocks: string[] = [];

  // ── Abertura: número-hero + estatísticas em régua (hierarquia, não 4 clones) ──
  if (sec("kpis") && ov) {
    blocks.push(sectionRow(`
      ${sectionHead("Panorama do período")}
      <table width="100%" cellpadding="0" cellspacing="0"><tr>
        <td style="vertical-align:bottom;padding-right:22px">
          <p style="margin:0;font-family:${SERIF};font-size:52px;font-weight:800;line-height:1;color:${INK};${NUM}">${fmt(ov.total_deliberacoes)}</p>
          <p style="margin:8px 0 0;font-family:${SANS};font-size:12px;color:${INK_SOFT};max-width:34ch">deliberações do colegiado no período, em ${esc(input.agenciaLabel)}.</p>
        </td>
      </tr></table>
      <table width="100%" cellpadding="0" cellspacing="0" style="margin-top:18px"><tr>
        ${stat(fmt(ov.deferidos), "Favoráveis", POS)}
        ${stat(`${ov.taxa_deferimento}%`, "Taxa de deferimento")}
        ${stat(fmt(ov.reunioes_unicas), "Reuniões")}
      </tr></table>`, true));
  }

  if (sec("recentes") && input.recentes?.length) {
    blocks.push(sectionRow(`${sectionHead("Deliberações recentes")}<table width="100%" cellpadding="0" cellspacing="0">${listaRows(input.recentes.slice(0, 5))}</table>`));
  }

  if (sec("divergentes") && input.divergentes?.length) {
    const rows = input.divergentes.slice(0, 5).map((d) => ({
      titulo: d.titulo,
      meta: d.meta,
      metaExtraHtml: d.nomes ? ` &middot; <span style="color:${DIVERG}">Voto divergente: ${d.nomes}</span>` : "",
    }));
    blocks.push(sectionRow(`${sectionHead("Decisões divergentes")}<table width="100%" cellpadding="0" cellspacing="0">${listaRows(rows)}</table>`));
  }

  if (sec("publicacao") && input.publicadas?.length) {
    blocks.push(sectionRow(`${sectionHead("Publicadas no DOU/DOE")}<table width="100%" cellpadding="0" cellspacing="0">${listaRows(input.publicadas.slice(0, 5))}</table>`));
  }

  const ranking = (id: string, titulo: string, itens: Array<{ label: string; total: number }> | undefined, sufixo = "") => {
    if (!sec(id) || !itens?.length) return;
    const top = itens.slice(0, id === "areas" ? 6 : 5);
    const max = Math.max(...top.map((i) => i.total));
    blocks.push(sectionRow(`${sectionHead(titulo)}<table width="100%" cellpadding="0" cellspacing="0">${top.map((i) => barRow(i.label, i.total, max, `${fmt(i.total)}${sufixo}`)).join("")}</table>`));
  };
  ranking("areas", "Por área regulatória", input.areas);
  ranking("setores", "Setores mais afetados", input.microtemas);
  ranking("empresas", "Empresas reguladas — top 5", input.empresas);

  if (sec("diretores") && input.diretores?.length) {
    const rows = input.diretores.slice(0, 5).map((d) => `
      <tr>
        <td style="padding:6px 0;border-bottom:1px solid ${LINE};font-family:${SANS};font-size:12.5px;color:${INK};font-weight:600">${esc(d.nome)}</td>
        <td align="right" style="padding:6px 0;border-bottom:1px solid ${LINE};font-family:${SANS};font-size:12px;color:${INK_SOFT};${NUM}">${fmt(d.total)} votos</td>
        <td align="right" style="padding:6px 0 6px 14px;border-bottom:1px solid ${LINE};font-family:${SANS};font-size:12px;font-weight:700;color:${POS};${NUM};width:64px">${d.pctFavor.toFixed(0)}% fav.</td>
      </tr>`).join("");
    blocks.push(sectionRow(`${sectionHead("Diretores em destaque")}<table width="100%" cellpadding="0" cellspacing="0">${rows}</table>`));
  }

  if (sec("consenso") && input.mandatos) {
    blocks.push(sectionRow(`
      ${sectionHead("Análise de consenso")}
      <table width="100%" cellpadding="0" cellspacing="0"><tr>
        ${stat(input.mandatos.taxa_consenso, "Taxa de consenso", POS)}
        ${stat(input.mandatos.taxa_litigio, "Taxa de litígio")}
      </tr></table>`));
  }

  const govScore = ov && input.mandatos
    ? calcGovScore(parseFloat(input.mandatos.taxa_consenso), parseFloat(String(ov.taxa_deferimento)), (ov.avg_confidence ?? 0) * 100, parseFloat(input.mandatos.taxa_sancao))
    : null;
  if (sec("governanca") && govScore != null) {
    blocks.push(sectionRow(`
      ${sectionHead("Governança institucional")}
      <table cellpadding="0" cellspacing="0"><tr>
        <td style="vertical-align:baseline"><p style="margin:0;font-family:${SERIF};font-size:40px;font-weight:800;line-height:1;color:${INK};${NUM}">${govScore}</p></td>
        <td style="vertical-align:baseline;padding-left:6px"><p style="margin:0;font-family:${SANS};font-size:14px;color:${INK_MUTED}">/100</p></td>
        <td style="vertical-align:middle;padding-left:18px"><p style="margin:0;font-family:${SANS};font-size:11.5px;color:${INK_SOFT};max-width:36ch">score composto de consenso, deferimento, qualidade de dados e sanções — mesma fórmula da tela de Governança.</p></td>
      </tr></table>`));
  }

  return `<!DOCTYPE html>
<html lang="pt-BR">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<link href="https://fonts.googleapis.com/css2?family=Playfair+Display:wght@700;800;900&display=swap" rel="stylesheet">
<title>Boletim IRIS Regulação</title></head>
<body style="margin:0;padding:0;background:${OUTER};font-family:${SANS}">
<table width="100%" cellpadding="0" cellspacing="0" style="background:${OUTER};padding:28px 0">
<tr><td align="center">
<table width="600" cellpadding="0" cellspacing="0" style="background:${NAVY};border-radius:10px;overflow:hidden">

  <!-- Cabeçalho — identidade IRIS -->
  <tr><td style="background:${NAVY};border-bottom:2px solid ${GOLD};padding:24px 32px">
    <table width="100%" cellpadding="0" cellspacing="0"><tr>
      <td style="vertical-align:middle"><img src="${esc(logoUrl)}" alt="IRIS" width="140" style="display:block;width:140px;max-width:140px;height:auto"/></td>
      <td align="right" style="vertical-align:middle">
        <p style="margin:0;font-family:${SANS};font-size:9.5px;letter-spacing:0.24em;text-transform:uppercase;color:${GOLD};font-weight:700">Boletim Regulat&oacute;rio</p>
        <p style="margin:5px 0 0;font-family:${SANS};font-size:11px;color:${INK_MUTED}">${today}</p>
      </td>
    </tr></table>
  </td></tr>
  <tr><td style="padding:28px 32px 2px">
    <h1 style="margin:0;font-family:${SERIF};font-size:30px;font-weight:800;line-height:1.12;color:${INK};letter-spacing:-0.01em">Boletim Regulat&oacute;rio</h1>
    <p style="margin:8px 0 0;font-family:${SANS};font-size:12px;color:${INK_MUTED}">${esc(input.agenciaLabel)} &middot; ${esc(input.periodoLabel)}</p>
  </td></tr>

  <!-- Conteúdo -->
  <tr><td style="padding:4px 32px 14px">
    <table width="100%" cellpadding="0" cellspacing="0">
      ${blocks.join("\n")}
    </table>
  </td></tr>

  <!-- Rodapé -->
  <tr><td style="padding:16px 32px;border-top:1px solid ${LINE};background:${FOOTER_BG}">
    <table width="100%" cellpadding="0" cellspacing="0"><tr>
      <td><p style="margin:0;font-family:${SANS};font-size:10px;letter-spacing:0.08em;color:${INK_MUTED}">IRIS Regula&ccedil;&atilde;o &middot; Instituto de Regula&ccedil;&atilde;o, Inova&ccedil;&atilde;o e Sustentabilidade</p></td>
      <td align="right"><p style="margin:0;font-family:${SANS};font-size:10px;color:${INK_MUTED}">${today}</p></td>
    </tr></table>
  </td></tr>

</table>
</td></tr>
</table>
</body></html>`;
}
