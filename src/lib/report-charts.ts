/**
 * Gráficos como SVG-string para os RELATÓRIOS de impressão (PDF via navegador) e .docx.
 * Determinístico, sem React/DOM/Recharts — igual ao padrão do GaugeChart, porém serializável
 * num HTML estático. São gráficos de IMPRESSÃO: estáticos, sem hover; a identidade nunca é só
 * por cor — todo segmento/barra leva rótulo direto (resolve o par verde/vermelho no CVD).
 * Cores são passadas pelo chamador (cada cor carrega um "job": status/identidade).
 */

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

const INK = "#1c1c21";
const MUTED = "#6b6b74";
const NAVY = "#0a0e2a";
const GOLD = "#c2a24a";
const SANS = "'Inter', -apple-system, 'Segoe UI', Roboto, Arial, sans-serif";

export interface DonutSegment {
  label: string;
  value: number;
  color: string;
}

/** Donut de distribuição (com legenda rotulada ao lado — identidade não é só cor). */
export function svgDonut(segments: DonutSegment[], opts: { title?: string; size?: number } = {}): string {
  const size = opts.size ?? 168;
  const cx = size / 2;
  const cy = size / 2;
  const rOuter = size / 2 - 6;
  const rInner = rOuter * 0.6;
  const total = segments.reduce((s, x) => s + Math.max(0, x.value), 0);
  const legendW = 176;

  const arcPath = (a0: number, a1: number) => {
    const pt = (r: number, a: number) => `${(cx + r * Math.cos(a)).toFixed(2)},${(cy + r * Math.sin(a)).toFixed(2)}`;
    const large = a1 - a0 > Math.PI ? 1 : 0;
    return `M${pt(rOuter, a0)} A${rOuter},${rOuter} 0 ${large} 1 ${pt(rOuter, a1)} L${pt(rInner, a1)} A${rInner},${rInner} 0 ${large} 0 ${pt(rInner, a0)} Z`;
  };

  let acc = -Math.PI / 2;
  const slices = total > 0
    ? segments.filter((s) => s.value > 0).map((s) => {
        const a0 = acc;
        const a1 = acc + (s.value / total) * Math.PI * 2;
        acc = a1;
        // gap de 2px entre fatias via um stroke branco (marks spec)
        return `<path d="${arcPath(a0, a1)}" fill="${s.color}" stroke="#ffffff" stroke-width="2"/>`;
      }).join("")
    : `<circle cx="${cx}" cy="${cy}" r="${(rOuter + rInner) / 2}" fill="none" stroke="#e4e4e7" stroke-width="${rOuter - rInner}"/>`;

  const legend = segments.map((s) => {
    const pct = total > 0 ? Math.round((s.value / total) * 100) : 0;
    return `<div style="display:flex;align-items:center;gap:7px;margin:0 0 5px;font-family:${SANS};font-size:11px;color:${INK};">
      <span style="width:10px;height:10px;border-radius:2px;background:${s.color};flex:0 0 auto;"></span>
      <span style="flex:1 1 auto;">${esc(s.label)}</span>
      <span style="font-weight:700;">${s.value}</span>
      <span style="color:${MUTED};width:34px;text-align:right;">${pct}%</span>
    </div>`;
  }).join("");

  return `<table role="presentation" cellpadding="0" cellspacing="0" style="border-collapse:collapse;"><tr>
    <td style="vertical-align:middle;padding-right:14px;">
      <svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" xmlns="http://www.w3.org/2000/svg">${slices}
        <text x="${cx}" y="${cy - 3}" text-anchor="middle" font-family="${SANS}" font-size="20" font-weight="700" fill="${INK}">${total}</text>
        <text x="${cx}" y="${cy + 13}" text-anchor="middle" font-family="${SANS}" font-size="8.5" fill="${MUTED}" letter-spacing="0.06em">TOTAL</text>
      </svg>
    </td>
    <td style="vertical-align:middle;min-width:${legendW}px;">${opts.title ? `<p style="margin:0 0 7px;font-family:${SANS};font-size:10px;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;color:${MUTED};">${esc(opts.title)}</p>` : ""}${legend}</td>
  </tr></table>`;
}

/** Medidor semicircular (0–100) — reusa a matemática do GaugeChart. */
export function svgGauge(value: number, opts: { label?: string; color?: string; size?: number } = {}): string {
  const size = opts.size ?? 150;
  // Default NAVY (redesign ago/2026): o dourado é marca, não cor de dado.
  const color = opts.color ?? NAVY;
  const label = opts.label ?? "";
  const v = Math.max(0, Math.min(100, value));
  const radius = 56;
  const stroke = 12;
  const center = size / 2;
  const circ = Math.PI * radius;
  const progress = (v / 100) * circ;
  const startX = center - radius;
  const endX = center + radius;
  const y = center + 18;
  return `<svg width="${size}" height="${(size * 0.62).toFixed(0)}" viewBox="0 0 ${size} ${(size * 0.62).toFixed(0)}" xmlns="http://www.w3.org/2000/svg">
    <path d="M ${startX} ${y} A ${radius} ${radius} 0 0 1 ${endX} ${y}" fill="none" stroke="#e4e4e7" stroke-width="${stroke}" stroke-linecap="round"/>
    <path d="M ${startX} ${y} A ${radius} ${radius} 0 0 1 ${endX} ${y}" fill="none" stroke="${color}" stroke-width="${stroke}" stroke-linecap="round" stroke-dasharray="${progress.toFixed(1)} ${circ.toFixed(1)}"/>
    <text x="${center}" y="${y - 8}" text-anchor="middle" font-family="${SANS}" font-size="21" font-weight="700" fill="${INK}">${v.toFixed(0)}%</text>
    ${label ? `<text x="${center}" y="${y + 12}" text-anchor="middle" font-family="${SANS}" font-size="9" fill="${MUTED}" letter-spacing="0.06em">${esc(label.toUpperCase())}</text>` : ""}
  </svg>`;
}

export interface BarItem {
  label: string;
  value: number;
  color?: string;
  suffix?: string; // ex.: "%"
}

/** Barras horizontais rotuladas (rótulo à esquerda, valor à direita, extremidade arredondada). */
export function svgBarsH(items: BarItem[], opts: { width?: number; barColor?: string; max?: number } = {}): string {
  const width = opts.width ?? 480;
  const rowH = 26;
  const labelW = 150;
  const valueW = 46;
  const trackW = width - labelW - valueW - 12;
  const max = opts.max ?? Math.max(1, ...items.map((i) => i.value));
  const height = items.length * rowH + 4;
  const rows = items.map((it, i) => {
    const y = i * rowH + 2;
    const w = Math.max(2, Math.round((Math.max(0, it.value) / max) * trackW));
    // Default NAVY (redesign ago/2026): dourado é marca, não série; barra fina, canto discreto.
    const color = it.color ?? opts.barColor ?? NAVY;
    return `<g transform="translate(0 ${y})">
      <text x="0" y="${rowH / 2 + 4}" font-family="${SANS}" font-size="11.5" fill="${INK}">${esc(it.label)}</text>
      <rect x="${labelW}" y="${rowH / 2 - 5}" width="${trackW}" height="10" rx="2" fill="#f0f0ee"/>
      <rect x="${labelW}" y="${rowH / 2 - 5}" width="${w}" height="10" rx="2" fill="${color}"/>
      <text x="${width}" y="${rowH / 2 + 4}" text-anchor="end" font-family="${SANS}" font-size="11.5" font-weight="700" fill="${INK}">${it.value}${esc(it.suffix ?? "")}</text>
    </g>`;
  }).join("");
  return `<svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg">${rows}</svg>`;
}

export interface LinePoint {
  label: string;
  value: number;
}

/** Linha/sparkline de evolução (com pontos e rótulos min/max) — evolução mensal. */
export function svgLine(points: LinePoint[], opts: { width?: number; height?: number; color?: string; suffix?: string } = {}): string {
  const width = opts.width ?? 480;
  const height = opts.height ?? 130;
  const color = opts.color ?? "#0a0e2a";
  const padX = 30;
  const padTop = 14;
  const padBottom = 26;
  if (points.length === 0) return `<svg width="${width}" height="${height}"></svg>`;
  const max = Math.max(1, ...points.map((p) => p.value));
  const min = Math.min(0, ...points.map((p) => p.value));
  const span = max - min || 1;
  const plotW = width - padX * 2;
  const plotH = height - padTop - padBottom;
  const x = (i: number) => padX + (points.length === 1 ? plotW / 2 : (i / (points.length - 1)) * plotW);
  const yv = (v: number) => padTop + plotH - ((v - min) / span) * plotH;
  const line = points.map((p, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(1)},${yv(p.value).toFixed(1)}`).join(" ");
  // Ponto FINAL em dourado (marca sinaliza "onde estamos"); os demais discretos na cor da série.
  const dots = points.map((p, i) => {
    const last = i === points.length - 1;
    return `<circle cx="${x(i).toFixed(1)}" cy="${yv(p.value).toFixed(1)}" r="${last ? 4 : 2.5}" fill="${last ? GOLD : color}"${last ? ` stroke="${color}" stroke-width="1.5"` : ""}/>`;
  }).join("");
  const labels = points.map((p, i) => `<text x="${x(i).toFixed(1)}" y="${height - 8}" text-anchor="middle" font-family="${SANS}" font-size="8.5" fill="${MUTED}">${esc(p.label)}</text>`).join("");
  const valTop = `<text x="${x(points.map((p) => p.value).indexOf(max)).toFixed(1)}" y="${(yv(max) - 6).toFixed(1)}" text-anchor="middle" font-family="${SANS}" font-size="9" font-weight="700" fill="${INK}">${max}${esc(opts.suffix ?? "")}</text>`;
  return `<svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg">
    <path d="${line}" fill="none" stroke="${color}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
    ${dots}${valTop}${labels}
  </svg>`;
}
