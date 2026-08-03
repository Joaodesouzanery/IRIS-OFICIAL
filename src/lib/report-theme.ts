/**
 * Tema de IMPRESSÃO dos relatórios IRIS: fundo BRANCO (economiza tinta) + faixa de cabeçalho
 * navy com o logo + títulos navy + acento dourado + serifada (Playfair). CSS com `@media print`
 * (.noprint, page-break) e botão "Imprimir / salvar PDF". Reutilizado por todos os relatórios.
 */

export const REPORT_COLORS = {
  navy: "#0a0e2a",
  gold: "#c2a24a",
  ink: "#18181b",
  muted: "#71717a",
  line: "#e4e4e7",
  soft: "#fafafa",
  bg: "#ffffff",
};

// Paleta de VOTOS (status/polaridade) — sempre acompanhada de rótulo direto (não é cor-sozinha).
export const REPORT_VOTE_COLORS = {
  favoravel: "#16a34a",
  desfavoravel: "#dc2626",
  abstencao: "#a1a1aa",
  divergente: "#7c3aed",
};

const SERIF = "'Playfair Display', Georgia, 'Times New Roman', serif";
const SANS = "-apple-system, Segoe UI, Roboto, Arial, sans-serif";

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
  body{font-family:${SANS};color:${c.ink};margin:0;padding:0;background:${c.bg};-webkit-print-color-adjust:exact;print-color-adjust:exact;}
  .report{max-width:820px;margin:0 auto;padding:0 0 40px;}
  .rp-topbar{background:${c.navy};border-bottom:3px solid ${c.gold};padding:20px 32px;display:flex;align-items:center;justify-content:space-between;gap:20px;}
  .rp-topbar img{height:38px;width:auto;display:block;}
  .rp-topbar .meta{text-align:right;font-size:10px;letter-spacing:0.14em;text-transform:uppercase;color:${c.gold};line-height:1.7;}
  .rp-topbar .meta span{color:rgba(255,255,255,0.66);}
  .rp-head{padding:26px 32px 6px;}
  .rp-eyebrow{font-family:${SANS};font-size:10px;font-weight:700;letter-spacing:0.22em;text-transform:uppercase;color:${c.gold};margin:0 0 8px;}
  .rp-title{font-family:${SERIF};font-size:30px;font-weight:800;line-height:1.08;color:${c.navy};margin:0;}
  .rp-sub{font-size:13px;color:${c.muted};margin:8px 0 0;}
  section{padding:22px 32px 4px;page-break-inside:avoid;}
  h2{font-family:${SERIF};font-size:18px;font-weight:800;color:${c.navy};margin:0 0 14px;padding-bottom:7px;border-bottom:2px solid ${c.gold};}
  h3{font-family:${SANS};font-size:13px;font-weight:700;color:${c.navy};margin:18px 0 8px;}
  .kpis{display:flex;flex-wrap:wrap;gap:10px;}
  .kpi{flex:1 1 150px;min-width:150px;border:1px solid ${c.line};border-radius:10px;padding:12px 14px;background:${c.soft};}
  .kpi .v{font-family:${SERIF};font-size:24px;font-weight:800;color:${c.navy};line-height:1;}
  .kpi .l{font-size:10px;letter-spacing:0.06em;text-transform:uppercase;color:${c.muted};margin-top:6px;}
  .kpi .h{font-size:11px;color:${c.muted};margin-top:3px;}
  table{width:100%;border-collapse:collapse;font-size:12.5px;margin-top:6px;}
  th,td{padding:7px 10px;border-bottom:1px solid ${c.line};text-align:left;}
  th{background:${c.soft};font-size:10.5px;text-transform:uppercase;letter-spacing:.04em;color:${c.muted};}
  td.num,th.num{text-align:right;}
  td.nome{font-weight:600;color:${c.navy};}
  .pos{color:#16a34a;font-weight:600;}.neg{color:#dc2626;font-weight:600;}
  .lido{font-weight:600;}.inf{color:#a1a1aa;}
  .chartrow{display:flex;flex-wrap:wrap;gap:24px;align-items:center;margin:6px 0 4px;}
  .note{font-size:11px;color:${c.muted};margin:10px 0 0;}
  .foot{margin-top:26px;padding:14px 32px 0;border-top:1px solid ${c.line};font-size:11px;color:${c.muted};text-align:center;}
  .badge{display:inline-block;font-size:10px;font-weight:700;letter-spacing:0.04em;padding:2px 8px;border-radius:999px;border:1px solid ${c.line};color:${c.muted};}
  .noprint{padding:16px 32px 0;}
  .btn{background:${c.navy};color:#fff;border:0;border-radius:7px;padding:9px 16px;font-size:13px;font-weight:600;cursor:pointer;font-family:${SANS};}
  .btn.gold{background:${c.gold};color:${c.navy};}
  @media print{.noprint{display:none!important;}.report{max-width:none;}body{padding:0;} section{padding-left:26px;padding-right:26px;}}
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
}

/** Documento HTML completo do relatório (cabeçalho IRIS + botão imprimir + conteúdo + rodapé). */
export function reportDocument(input: ReportDocumentInput): string {
  const logo = absoluteLogo(input.baseUrl);
  const gerado = input.generatedAt ?? "";
  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>${esc(input.title)} — IRIS</title>
<link href="https://fonts.googleapis.com/css2?family=Playfair+Display:wght@700;800;900&display=swap" rel="stylesheet"/>
<style>${reportPrintCss()}</style></head>
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
    <div class="foot">${input.footerHtml ?? `IRIS-Regula&ccedil;&atilde;o &middot; Instituto de Regula&ccedil;&atilde;o, Inova&ccedil;&atilde;o e Sustentabilidade &middot; irisregulacao.org`}</div>
  </div>
</body></html>`;
}
