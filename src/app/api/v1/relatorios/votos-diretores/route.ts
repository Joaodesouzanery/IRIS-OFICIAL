/**
 * GET /api/v1/relatorios/votos-diretores?agencia_id=&format=html|docx|csv
 *
 * Relatório dos votos de cada diretor (ANTT, ANM, ARTESP) — identidade IRIS, com
 * SUMÁRIO (KPIs), GRÁFICOS (distribuição de votos, % favorável por diretor) e tabelas
 * lidos-vs-inferidos. Mesma agregação do dashboard/diretores/overview; aqui só muda o
 * empacotamento exportável. Formatos: html (imprimir→PDF), docx (Word), csv (Excel).
 * Admin-gated pelo middleware; respeita o modo demo.
 */

import { NextRequest, NextResponse } from "next/server";
import { isLocalMode, getSyncedDelibs } from "@/lib/server/local-data-store";
import { computeDiretoresOverview } from "@/lib/server/analytics-engine";
import { isDemo } from "@/lib/server/is-demo";
import { isDemoRequest } from "@/lib/server/request-guards";
import { reportDocument, REPORT_VOTE_COLORS } from "@/lib/report-theme";
import { svgDonut, svgBarsH } from "@/lib/report-charts";
import { buildSimpleDocxFromHtml } from "@/lib/server/docx-export";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const COLEGIADO = ["ANTT", "ANM", "ARTESP"];

type Linha = {
  diretor_nome: string; total: number; favoravel: number; desfavoravel: number;
  divergente: number; nominais: number; inferidos: number; pct_favor: number;
};
type Bloco = { sigla: string; linhas: Linha[] };

function esc(s: unknown): string {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
}

function kpi(v: string, l: string, h?: string): string {
  return `<div class="kpi"><div class="v">${esc(v)}</div><div class="l">${esc(l)}</div>${h ? `<div class="h">${esc(h)}</div>` : ""}</div>`;
}

function renderBloco({ sigla, linhas }: Bloco): string {
  const total = linhas.reduce((s, l) => s + l.total, 0);
  const fav = linhas.reduce((s, l) => s + l.favoravel, 0);
  const desf = linhas.reduce((s, l) => s + l.desfavoravel, 0);
  const div = linhas.reduce((s, l) => s + l.divergente, 0);
  const nominais = linhas.reduce((s, l) => s + l.nominais, 0);
  const outros = Math.max(0, total - fav - desf);
  const cobertura = total > 0 ? Math.round((nominais / total) * 1000) / 10 : 0;
  const pctFav = total > 0 ? Math.round((fav / total) * 1000) / 10 : 0;
  const cautela = cobertura < 30 && total > 0 ? " — consenso majoritariamente inferido, interpretar com cautela" : "";

  const corpo = linhas.length === 0
    ? `<tr><td colspan="7" style="text-align:center;color:#a1a1aa;font-style:italic;">Sem votos materializados para esta agência.</td></tr>`
    : linhas.map((l) => `<tr>
        <td class="nome">${esc(l.diretor_nome)}</td>
        <td class="num">${l.total}</td>
        <td class="num pos">${l.favoravel}</td>
        <td class="num neg">${l.desfavoravel}</td>
        <td class="num">${l.divergente}</td>
        <td class="num"><span class="lido">${l.nominais}</span> · <span class="inf">${l.inferidos}</span></td>
        <td class="num">${l.pct_favor.toFixed(1)}%</td>
      </tr>`).join("");

  const donut = total > 0 ? svgDonut([
    { label: "Favorável", value: fav, color: REPORT_VOTE_COLORS.favoravel },
    { label: "Desfavorável", value: desf, color: REPORT_VOTE_COLORS.desfavoravel },
    { label: "Abstenção/ausente", value: outros, color: REPORT_VOTE_COLORS.abstencao },
  ], { title: "Distribuição de votos" }) : "";

  const barsData = linhas.filter((l) => l.total > 0).slice(0, 12)
    .map((l) => ({ label: l.diretor_nome, value: l.pct_favor, suffix: "%", color: REPORT_VOTE_COLORS.favoravel }));
  const bars = barsData.length
    ? `<h3>% favorável por diretor</h3>${svgBarsH(barsData, { width: 500, max: 100 })}`
    : "";

  return `<section>
    <h2>${esc(sigla)}</h2>
    <div class="kpis">
      ${kpi(String(total), "Votos", `${linhas.length} diretor(es)`)}
      ${kpi(`${pctFav.toFixed(1)}%`, "% Favorável", "do colegiado")}
      ${kpi(`${cobertura.toFixed(0)}%`, "Base nominal", "lidos vs inferidos")}
      ${kpi(String(div), "Divergentes", "votos dissidentes")}
    </div>
    ${donut ? `<div class="chartrow">${donut}</div>` : ""}
    <table>
      <thead><tr><th>Diretor</th><th class="num">Votos</th><th class="num">Favor.</th><th class="num">Desfav.</th><th class="num">Diverg.</th><th class="num">Lidos · Inf.</th><th class="num">% Favor.</th></tr></thead>
      <tbody>${corpo}</tbody>
    </table>
    <p class="note">${linhas.length} diretor(es) · ${total} voto(s) · base nominal (lidos) ${cobertura}%${cautela}.</p>
    ${bars}
  </section>`;
}

function csvCell(v: unknown): string {
  const s = String(v ?? "");
  return /[";\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
function buildCsv(blocos: Bloco[]): string {
  const head = ["Agencia", "Diretor", "Votos", "Favoraveis", "Desfavoraveis", "Divergentes", "Lidos", "Inferidos", "PctFavoravel"];
  const rows = [head.join(";")];
  for (const b of blocos) {
    for (const l of b.linhas) {
      rows.push([b.sigla, l.diretor_nome, l.total, l.favoravel, l.desfavoravel, l.divergente, l.nominais, l.inferidos, l.pct_favor.toFixed(1)].map(csvCell).join(";"));
    }
  }
  return `﻿${rows.join("\r\n")}`;
}

// db: any — o client do Supabase não é tipado no projeto (mesmo padrão do upload-queue).
async function linhasReais(db: any, agenciaId: string): Promise<Linha[]> {
  const [diretoresRes, votosRes, mandatosRes] = await Promise.all([
    db.from("diretores").select("id, nome").eq("agencia_id", agenciaId).eq("review_status", "aprovado").limit(5000),
    db.from("votos").select("tipo_voto, is_divergente, is_nominal, diretores!inner (id, nome, agencia_id)").eq("diretores.agencia_id", agenciaId),
    db.from("mandatos").select("diretor_id").limit(20000),
  ]);
  const comMandato = new Set((mandatosRes.data ?? []).map((m: { diretor_id: string }) => m.diretor_id));
  const stats = new Map<string, Linha & { _id: string }>();
  for (const d of (diretoresRes.data ?? []) as Array<{ id: string; nome: string }>) {
    stats.set(d.id, { _id: d.id, diretor_nome: d.nome, total: 0, favoravel: 0, desfavoravel: 0, divergente: 0, nominais: 0, inferidos: 0, pct_favor: 0 });
  }
  for (const row of votosRes.data ?? []) {
    const dir = (row as { diretores?: { id?: string; nome?: string } }).diretores;
    const id = dir?.id; if (!id) continue;
    if (!stats.has(id)) stats.set(id, { _id: id, diretor_nome: dir?.nome ?? "—", total: 0, favoravel: 0, desfavoravel: 0, divergente: 0, nominais: 0, inferidos: 0, pct_favor: 0 });
    const s = stats.get(id)!;
    const r = row as { tipo_voto?: string; is_divergente?: boolean; is_nominal?: boolean };
    s.total++;
    if (r.tipo_voto === "Favoravel") s.favoravel++;
    else if (r.tipo_voto === "Desfavoravel") s.desfavoravel++;
    if (r.is_divergente) s.divergente++;
    if (r.is_nominal) s.nominais++; else s.inferidos++;
  }
  return [...stats.values()]
    .filter((s) => comMandato.has(s._id) || s.total > 0)
    .map((s) => ({ ...s, pct_favor: s.total > 0 ? parseFloat(((s.favoravel / s.total) * 100).toFixed(1)) : 0 }))
    .sort((a, b) => b.total - a.total);
}

export async function GET(req: NextRequest) {
  const agenciaFiltro = req.nextUrl.searchParams.get("agencia_id");
  const format = (req.nextUrl.searchParams.get("format") ?? "html").toLowerCase();
  const geradoEm = new Date().toISOString().slice(0, 16).replace("T", " ");

  const blocos: Bloco[] = [];
  if (isDemo() || isDemoRequest(req)) {
    const overview = isLocalMode() ? computeDiretoresOverview(getSyncedDelibs(), agenciaFiltro) : [];
    blocos.push({
      sigla: "DEMO",
      linhas: (overview as Array<Record<string, number | string>>).map((o) => ({
        diretor_nome: String(o.diretor_nome), total: Number(o.total), favoravel: Number(o.favoravel), desfavoravel: Number(o.desfavoravel),
        divergente: Number(o.divergente), nominais: Number(o.nominais ?? 0), inferidos: Number(o.inferidos ?? 0), pct_favor: Number(o.pct_favor ?? 0),
      })),
    });
  } else {
    const { createSupabaseServerClient } = await import("@/lib/supabase/server");
    const db = createSupabaseServerClient();
    const { data: agencias } = await db.from("agencias").select("id, sigla").in("sigla", COLEGIADO);
    const alvo = ((agencias ?? []) as Array<{ id: string; sigla: string }>)
      .filter((a) => !agenciaFiltro || a.id === agenciaFiltro)
      .sort((a, b) => COLEGIADO.indexOf(a.sigla) - COLEGIADO.indexOf(b.sigla));
    for (const ag of alvo) blocos.push({ sigla: ag.sigla, linhas: await linhasReais(db, ag.id) });
  }

  if (format === "csv") {
    return new NextResponse(buildCsv(blocos), {
      headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": 'attachment; filename="iris-votos-por-diretor.csv"' },
    });
  }

  const contentHtml = blocos.map(renderBloco).join("\n");
  const subtitle = `Agências colegiadas (ANTT, ANM, ARTESP)${agenciaFiltro ? " · filtrado" : ""} · votos por diretor: total, favoráveis, divergentes, lidos vs inferidos`;

  if (format === "docx") {
    const buffer = buildSimpleDocxFromHtml({ title: "Relatório de Votos por Diretor — IRIS", html: contentHtml, landscape: false });
    return new NextResponse(new Uint8Array(buffer), {
      headers: {
        "content-type": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        "content-disposition": 'attachment; filename="iris-votos-por-diretor.docx"',
      },
    });
  }

  const html = reportDocument({
    title: "Relatório de Votos por Diretor",
    eyebrow: "Esteira de Votos dos Diretores",
    subtitle,
    generatedAt: `Gerado em ${geradoEm} UTC`,
    baseUrl: req.nextUrl.origin,
    contentHtml,
    footerHtml: `"Lidos" = votos nominais extraídos do documento · "Inferidos" = completados por unanimidade/mandato. Uma % favorável sobre base majoritariamente inferida deve ser lida com cautela. &middot; IRIS-Regulação`,
  });
  return new NextResponse(html, { headers: { "content-type": "text/html; charset=utf-8" } });
}
