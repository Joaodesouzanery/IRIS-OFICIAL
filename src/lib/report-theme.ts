/**
 * Tema de IMPRESSÃO dos relatórios IRIS — direção EDITORIAL (redesign ago/2026): fundo branco,
 * faixa de cabeçalho navy com o logo, títulos em Playfair, corpo serifado (Georgia) e números
 * SEMPRE tabulares em sans. O dourado é MARCA (filetes, eyebrows, meta) — nunca cor de dado;
 * texto dourado sobre branco usa o tom escuro `goldInk` (contraste). Sem pills, sem cartões
 * cinza: hierarquia por tipografia, filetes e espaço. CSS com `@media print`/`@page` e botão
 * "Imprimir / salvar PDF". Reutilizado por todos os relatórios (ponto único de verdade).
 */

export const REPORT_COLORS = {
  navy: "#0a0e2a",
  gold: "#c2a24a",
  goldInk: "#8a6d1f", // dourado ESCURO para texto sobre fundo claro (o #c2a24a 'apaga' no branco)
  ink: "#1c1c21",
  muted: "#6b6b74",
  line: "#dcdce1",
  soft: "#fafaf8",
  bg: "#ffffff",
};

// Paleta de VOTOS (status/polaridade) — tons SÓBRIOS de documento institucional; sempre
// acompanhada de rótulo direto (não é cor-sozinha). O dourado da marca NÃO entra aqui.
export const REPORT_VOTE_COLORS = {
  favoravel: "#1f7a4d",
  desfavoravel: "#a3261f",
  abstencao: "#8a8a93",
  divergente: "#6d5a9c",
};

const SERIF_DISPLAY = "'Playfair Display', Georgia, 'Times New Roman', serif";
const SERIF_TEXT = "Georgia, 'Times New Roman', serif";
const SANS = "'Inter', -apple-system, 'Segoe UI', Roboto, Arial, sans-serif";

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function absoluteLogo(baseUrl?: string): string {
  const path = "/brand/newsletter-logo-wide.png";
  if (!baseUrl) return path;
  return `${baseUrl.replace(/\/$/, "")}${path}`;
}

export function reportPrintCss(): string {
  const c = REPORT_COLORS;
  return `
  *{box-sizing:border-box;}
  @page{margin:14mm 12mm;}
  body{font-family:${SERIF_TEXT};font-size:13.5px;line-height:1.55;color:${c.ink};margin:0;padding:0;background:${c.bg};-webkit-print-color-adjust:exact;print-color-adjust:exact;}
  .report{max-width:820px;margin:0 auto;padding:0 0 40px;}
  .rp-topbar{background:${c.navy};border-bottom:2px solid ${c.gold};padding:22px 40px;display:flex;align-items:center;justify-content:space-between;gap:20px;}
  .rp-topbar img{height:36px;width:auto;display:block;}
  .rp-topbar .meta{text-align:right;font-family:${SANS};font-size:9.5px;letter-spacing:0.18em;text-transform:uppercase;color:${c.gold};line-height:1.9;}
  .rp-topbar .meta span{color:rgba(255,255,255,0.6);letter-spacing:0.08em;}
  .rp-head{padding:32px 40px 10px;}
  .rp-eyebrow{font-family:${SANS};font-size:9.5px;font-weight:600;letter-spacing:0.28em;text-transform:uppercase;color:${c.goldInk};margin:0 0 10px;}
  .rp-title{font-family:${SERIF_DISPLAY};font-size:32px;font-weight:800;line-height:1.1;color:${c.navy};margin:0;letter-spacing:-0.01em;}
  .rp-sub{font-family:${SANS};font-size:12.5px;color:${c.muted};margin:10px 0 0;max-width:60ch;}
  section{padding:26px 40px 4px;page-break-inside:avoid;}
  h2{font-family:${SERIF_DISPLAY};font-size:19px;font-weight:800;color:${c.navy};margin:0 0 16px;padding-bottom:8px;border-bottom:1px solid ${c.line};position:relative;}
  h2::after{content:"";position:absolute;left:0;bottom:-1px;width:44px;border-bottom:2px solid ${c.gold};}
  h3{font-family:${SANS};font-size:11px;font-weight:600;letter-spacing:0.12em;text-transform:uppercase;color:${c.navy};margin:20px 0 8px;}
  p{margin:0 0 10px;}
  .lede{font-size:14.5px;line-height:1.6;color:${c.ink};max-width:66ch;}
  .kpis{display:flex;flex-wrap:wrap;gap:0 28px;margin:4px 0 6px;}
  .kpi{flex:1 1 140px;min-width:140px;border-top:2px solid ${c.navy};padding:9px 0 4px;background:transparent;}
  .kpi:first-child{border-top-color:${c.gold};}
  .kpi .v{font-family:${SERIF_DISPLAY};font-size:27px;font-weight:800;color:${c.navy};line-height:1;font-variant-numeric:tabular-nums lining-nums;}
  .kpi .l{font-family:${SANS};font-size:9px;letter-spacing:0.14em;text-transform:uppercase;color:${c.muted};margin-top:7px;}
  .kpi .h{font-family:${SANS};font-size:10.5px;color:${c.muted};margin-top:3px;}
  table{width:100%;border-collapse:collapse;font-family:${SANS};font-size:12px;margin-top:8px;font-variant-numeric:tabular-nums lining-nums;}
  th,td{padding:7px 10px;border-bottom:1px solid ${c.line};text-align:left;vertical-align:top;}
  th{background:transparent;font-size:9.5px;font-weight:600;text-transform:uppercase;letter-spacing:.1em;color:${c.muted};border-bottom:1.5px solid ${c.navy};}
  tbody tr:nth-child(even) td{background:${c.soft};}
  td.num,th.num{text-align:right;}
  td.nome{font-weight:600;color:${c.navy};}
  .pos{color:#1f7a4d;font-weight:600;}.neg{color:#a3261f;font-weight:600;}
  .lido{font-weight:600;}.inf{color:${c.muted};}
  .chartrow{display:flex;flex-wrap:wrap;gap:28px;align-items:center;margin:8px 0 4px;}
  .note{font-family:${SANS};font-size:10.5px;color:${c.muted};margin:10px 0 0;}
  .foot{margin-top:30px;padding:14px 40px 0;border-top:1px solid ${c.line};font-family:${SANS};font-size:10px;letter-spacing:0.04em;color:${c.muted};display:flex;justify-content:space-between;gap:16px;}
  .badge{display:inline-block;font-family:${SANS};font-size:9px;font-weight:600;letter-spacing:0.12em;text-transform:uppercase;color:${c.goldInk};}
  .noprint{padding:18px 40px 0;}
  .btn{background:${c.navy};color:#fff;border:0;border-radius:4px;padding:9px 16px;font-size:12.5px;font-weight:600;cursor:pointer;font-family:${SANS};}
  .btn.gold{background:${c.gold};color:${c.navy};}
  @media print{.noprint{display:none!important;}.report{max-width:none;}body{padding:0;} section{padding-left:26px;padding-right:26px;} .rp-topbar{padding-left:26px;padding-right:26px;} .rp-head{padding-left:26px;padding-right:26px;} .foot{padding-left:26px;padding-right:26px;}}
  `;
}

export interface ReportDocumentInput {
  title: string;
  subtitle?: string;
  eyebrow?: string;
  generatedAt?: string; // texto já formatado
  baseUrl?: string;
  contentHtml: string;
  /** Botões extra na barra .noprint (ex.: baixar Word/CSV) — HTML de <a>/<button>. */
  actionsHtml?: string;
  footerHtml?: string;
  /** CSS extra específico do relatório (classes próprias além do tema base). */
  extraCss?: string;
}

/** Documento HTML completo do relatório (cabeçalho IRIS + botão imprimir + conteúdo + rodapé). */
export function reportDocument(input: ReportDocumentInput): string {
  const logo = absoluteLogo(input.baseUrl);
  const gerado = input.generatedAt ?? "";
  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>${esc(input.title)} — IRIS</title>
<link href="https://fonts.googleapis.com/css2?family=Playfair+Display:wght@700;800;900&family=Inter:wght@400;600;700&display=swap" rel="stylesheet"/>
<style>${reportPrintCss()}${input.extraCss ?? ""}</style></head>
<body>
  <div class="report">
    <div class="rp-topbar">
      <img src="${esc(logo)}" alt="IRIS"/>
      <div class="meta">IRIS Regula&ccedil;&atilde;o<br/><span>${esc(gerado)}</span></div>
    </div>
    <div class="noprint">
      <button class="btn gold" onclick="window.print()">Imprimir / salvar PDF</button>
      ${input.actionsHtml ?? ""}
    </div>
    <div class="rp-head">
      ${input.eyebrow ? `<p class="rp-eyebrow">${esc(input.eyebrow)}</p>` : ""}
      <h1 class="rp-title">${esc(input.title)}</h1>
      ${input.subtitle ? `<p class="rp-sub">${esc(input.subtitle)}</p>` : ""}
    </div>
    ${input.contentHtml}
    <div class="foot">${input.footerHtml ?? `<span>IRIS-Regula&ccedil;&atilde;o &middot; Instituto de Regula&ccedil;&atilde;o, Inova&ccedil;&atilde;o e Sustentabilidade</span><span>irisregulacao.org</span>`}</div>
  </div>
</body></html>`;
}
