/**
 * GET /api/v1/relatorios/votos-diretores?agencia_id=&format=html|docx|csv
 *
 * Relatório dos votos de cada diretor (ANTT, ANM, ARTESP) — identidade IRIS.
 * Ago/2026 (QA "relatório rico"): ganhou CAPA com período coberto, SUMÁRIO EXECUTIVO
 * (KPIs gerais + comparativo entre agências + série temporal mensal), coluna de
 * MANDATO por diretor e a seção de DIVERGÊNCIAS nomeadas (deliberação · diretor).
 * Mesma agregação do dashboard; aqui só muda o empacotamento exportável.
 * Formatos: html (imprimir→PDF), docx (Word), csv (Excel). Admin-gated; demo ok.
 */

import { NextRequest, NextResponse } from "next/server";
import { isLocalMode, getSyncedDelibs } from "@/lib/server/local-data-store";
import { computeDiretoresOverview } from "@/lib/server/analytics-engine";
import { isDemo } from "@/lib/server/is-demo";
import { isDemoRequest } from "@/lib/server/request-guards";
import { reportDocument, REPORT_COLORS, REPORT_VOTE_COLORS } from "@/lib/report-theme";
import { svgDonut, svgBarsH, svgLine } from "@/lib/report-charts";
import { buildSimpleDocxFromHtml } from "@/lib/server/docx-export";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const COLEGIADO = ["ANTT", "ANM", "ARTESP"];

type Linha = {
  diretor_nome: string; total: number; favoravel: number; desfavoravel: number;
  divergente: number; nominais: number; inferidos: number; pct_favor: number;
  mandato: string | null;
};
type Divergencia = { deliberacao: string; diretor: string; tipo_voto: string; data: string | null };
type DelibStats = { finais: number; deferidas: number; indeferidas: number };
type Bloco = {
  sigla: string; linhas: Linha[]; divergencias: Divergencia[];
  delib: DelibStats; meses: Map<string, number>;
  periodoMin: string | null; periodoMax: string | null;
};

function esc(s: unknown): string {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
}

function kpi(v: string, l: string, h?: string): string {
  return `<div class="kpi"><div class="v">${esc(v)}</div><div class="l">${esc(l)}</div>${h ? `<div class="h">${esc(h)}</div>` : ""}</div>`;
}

function fmtData(iso: string | null): string {
  if (!iso) return "—";
  const [y, m, d] = iso.slice(0, 10).split("-");
  return `${d}/${m}/${y}`;
}

function mesLabel(ym: string): string {
  const [y, m] = ym.split("-");
  return `${m}/${y.slice(2)}`;
}

/** Sumário executivo: KPIs gerais + comparativo entre agências + série temporal. */
function renderSumario(blocos: Bloco[]): string {
  const soma = (f: (b: Bloco) => number) => blocos.reduce((s, b) => s + f(b), 0);
  const totalVotos = soma((b) => b.linhas.reduce((s, l) => s + l.total, 0));
  const totalNominais = soma((b) => b.linhas.reduce((s, l) => s + l.nominais, 0));
  const totalDiv = soma((b) => b.linhas.reduce((s, l) => s + l.divergente, 0));
  const totalFinais = soma((b) => b.delib.finais);
  const totalDef = soma((b) => b.delib.deferidas);
  const totalInd = soma((b) => b.delib.indeferidas);
  const taxaDef = totalDef + totalInd > 0 ? Math.round((totalDef / (totalDef + totalInd)) * 1000) / 10 : 0;
  const cobertura = totalVotos > 0 ? Math.round((totalNominais / totalVotos) * 1000) / 10 : 0;

  // Série mensal consolidada (votos/mês).
  const meses = new Map<string, number>();
  for (const b of blocos) for (const [ym, n] of b.meses) meses.set(ym, (meses.get(ym) ?? 0) + n);
  const serie = [...meses.entries()].sort(([a], [b]) => a.localeCompare(b))
    .map(([ym, n]) => ({ label: mesLabel(ym), value: n }));
  const linha = serie.length >= 2
    ? `<h3>Votos materializados por mês</h3>${svgLine(serie, { width: 640, height: 150, color: REPORT_COLORS.gold })}`
    : "";

  const comparativo = blocos.length > 1 ? `<h3>Comparativo entre agências</h3><table>
    <thead><tr><th>Agência</th><th class="num">Votos</th><th class="num">% Favorável</th><th class="num">Base nominal</th><th class="num">Deliberações finais</th><th class="num">Taxa de deferimento</th><th class="num">Divergentes</th></tr></thead>
    <tbody>${blocos.map((b) => {
      const t = b.linhas.reduce((s, l) => s + l.total, 0);
      const f = b.linhas.reduce((s, l) => s + l.favoravel, 0);
      const n = b.linhas.reduce((s, l) => s + l.nominais, 0);
      const dv = b.linhas.reduce((s, l) => s + l.divergente, 0);
      const decid = b.delib.deferidas + b.delib.indeferidas;
      return `<tr>
        <td class="nome">${esc(b.sigla)}</td>
        <td class="num">${t}</td>
        <td class="num">${t > 0 ? ((f / t) * 100).toFixed(1) : "0.0"}%</td>
        <td class="num">${t > 0 ? ((n / t) * 100).toFixed(0) : "0"}%</td>
        <td class="num">${b.delib.finais}</td>
        <td class="num">${decid > 0 ? ((b.delib.deferidas / decid) * 100).toFixed(1) : "—"}%</td>
        <td class="num" style="color:${REPORT_VOTE_COLORS.divergente};font-weight:600;">${dv}</td>
      </tr>`;
    }).join("")}</tbody></table>` : "";

  return `<section>
    <h2>Sumário executivo</h2>
    <div class="kpis">
      ${kpi(String(totalVotos), "Votos", `${cobertura.toFixed(0)}% base nominal`)}
      ${kpi(String(totalFinais), "Deliberações finais", "com decisão registrada")}
      ${kpi(`${taxaDef.toFixed(1)}%`, "Taxa de deferimento", `${totalDef} def. · ${totalInd} indef.`)}
      ${kpi(String(totalDiv), "Votos divergentes", "dissidências registradas")}
    </div>
    ${comparativo}
    ${linha}
  </section>`;
}

function renderBloco(b: Bloco): string {
  const { sigla, linhas } = b;
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
    ? `<tr><td colspan="8" style="text-align:center;color:#a1a1aa;font-style:italic;">Sem votos materializados para esta agência.</td></tr>`
    : linhas.map((l) => `<tr>
        <td class="nome">${esc(l.diretor_nome)}</td>
        <td>${esc(l.mandato ?? "—")}</td>
        <td class="num">${l.total}</td>
        <td class="num pos">${l.favoravel}</td>
        <td class="num neg">${l.desfavoravel}</td>
        <td class="num" style="color:${REPORT_VOTE_COLORS.divergente};">${l.divergente}</td>
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

  const divergTable = b.divergencias.length > 0 ? `<h3>Divergências registradas</h3><table>
    <thead><tr><th>Deliberação</th><th>Diretor</th><th>Voto</th><th class="num">Data</th></tr></thead>
    <tbody>${b.divergencias.slice(0, 10).map((d) => `<tr>
      <td class="nome">${esc(d.deliberacao)}</td>
      <td>${esc(d.diretor)}</td>
      <td style="color:${REPORT_VOTE_COLORS.divergente};font-weight:600;">${esc(d.tipo_voto)}</td>
      <td class="num">${fmtData(d.data)}</td>
    </tr>`).join("")}</tbody></table>${b.divergencias.length > 10 ? `<p class="note">…e mais ${b.divergencias.length - 10} divergência(s) no CSV.</p>` : ""}` : "";

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
      <thead><tr><th>Diretor</th><th>Mandato</th><th class="num">Votos</th><th class="num">Favor.</th><th class="num">Desfav.</th><th class="num">Diverg.</th><th class="num">Lidos · Inf.</th><th class="num">% Favor.</th></tr></thead>
      <tbody>${corpo}</tbody>
    </table>
    <p class="note">${linhas.length} diretor(es) · ${total} voto(s) · base nominal (lidos) ${cobertura}%${cautela} · período ${fmtData(b.periodoMin)} a ${fmtData(b.periodoMax)}.</p>
    ${divergTable}
    ${bars}
  </section>`;
}

function csvCell(v: unknown): string {
  const s = String(v ?? "");
  return /[";\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
function buildCsv(blocos: Bloco[]): string {
  const head = ["Agencia", "Diretor", "Mandato", "Votos", "Favoraveis", "Desfavoraveis", "Divergentes", "Lidos", "Inferidos", "PctFavoravel"];
  const rows = [head.join(";")];
  for (const b of blocos) {
    for (const l of b.linhas) {
      rows.push([b.sigla, l.diretor_nome, l.mandato ?? "", l.total, l.favoravel, l.desfavoravel, l.divergente, l.nominais, l.inferidos, l.pct_favor.toFixed(1)].map(csvCell).join(";"));
    }
  }
  // Divergências nomeadas no fim (mesmo arquivo — Excel abre como blocos separados).
  const divs = blocos.flatMap((b) => b.divergencias.map((d) => [b.sigla, d.deliberacao, d.diretor, d.tipo_voto, d.data ?? ""]));
  if (divs.length > 0) {
    rows.push("", ["Agencia", "Deliberacao", "Diretor", "VotoDivergente", "Data"].join(";"));
    for (const d of divs) rows.push(d.map(csvCell).join(";"));
  }
  return `﻿${rows.join("\r\n")}`;
}

type MandatoRow = { diretor_id: string; cargo: string | null; data_inicio: string | null; data_fim: string | null };

// db: any — o client do Supabase não é tipado no projeto (mesmo padrão do upload-queue).
async function blocoReal(db: any, agenciaId: string, sigla: string, mandatos: MandatoRow[]): Promise<Bloco> {
  const [diretoresRes, votosRes, delibsRes] = await Promise.all([
    db.from("diretores").select("id, nome").eq("agencia_id", agenciaId).eq("review_status", "aprovado").limit(5000),
    db.from("votos")
      .select("tipo_voto, is_divergente, is_nominal, diretores!inner (id, nome, agencia_id), deliberacoes (numero_deliberacao, data_reuniao)")
      .eq("diretores.agencia_id", agenciaId)
      .limit(20000),
    db.from("deliberacoes")
      .select("resultado, data_reuniao, tipo_documento, documento_pai_id")
      .eq("agencia_id", agenciaId)
      .limit(10000),
  ]);

  const mandatoPorDiretor = new Map<string, MandatoRow>();
  for (const m of mandatos) {
    const atual = mandatoPorDiretor.get(m.diretor_id);
    // Mandato mais RECENTE representa o diretor no relatório.
    if (!atual || String(m.data_inicio ?? "") > String(atual.data_inicio ?? "")) mandatoPorDiretor.set(m.diretor_id, m);
  }
  const mandatoLabel = (id: string): string | null => {
    const m = mandatoPorDiretor.get(id);
    if (!m) return null;
    const cargo = m.cargo ? `${m.cargo} · ` : "";
    return `${cargo}${fmtData(m.data_inicio)}–${m.data_fim ? fmtData(m.data_fim) : "atual"}`;
  };

  const stats = new Map<string, Linha & { _id: string }>();
  for (const d of (diretoresRes.data ?? []) as Array<{ id: string; nome: string }>) {
    stats.set(d.id, { _id: d.id, diretor_nome: d.nome, total: 0, favoravel: 0, desfavoravel: 0, divergente: 0, nominais: 0, inferidos: 0, pct_favor: 0, mandato: mandatoLabel(d.id) });
  }
  const divergencias: Divergencia[] = [];
  const meses = new Map<string, number>();
  let periodoMin: string | null = null;
  let periodoMax: string | null = null;

  for (const row of votosRes.data ?? []) {
    const dir = (row as { diretores?: { id?: string; nome?: string } }).diretores;
    const id = dir?.id; if (!id) continue;
    if (!stats.has(id)) stats.set(id, { _id: id, diretor_nome: dir?.nome ?? "—", total: 0, favoravel: 0, desfavoravel: 0, divergente: 0, nominais: 0, inferidos: 0, pct_favor: 0, mandato: mandatoLabel(id) });
    const s = stats.get(id)!;
    const r = row as { tipo_voto?: string; is_divergente?: boolean; is_nominal?: boolean; deliberacoes?: { numero_deliberacao?: string | null; data_reuniao?: string | null } };
    s.total++;
    if (r.tipo_voto === "Favoravel") s.favoravel++;
    else if (r.tipo_voto === "Desfavoravel") s.desfavoravel++;
    if (r.is_divergente) {
      s.divergente++;
      divergencias.push({
        deliberacao: r.deliberacoes?.numero_deliberacao ?? "s/ nº",
        diretor: dir?.nome ?? "—",
        tipo_voto: String(r.tipo_voto ?? "—"),
        data: r.deliberacoes?.data_reuniao ?? null,
      });
    }
    if (r.is_nominal) s.nominais++; else s.inferidos++;
    const dt = r.deliberacoes?.data_reuniao;
    if (dt) {
      meses.set(dt.slice(0, 7), (meses.get(dt.slice(0, 7)) ?? 0) + 1);
      if (!periodoMin || dt < periodoMin) periodoMin = dt;
      if (!periodoMax || dt > periodoMax) periodoMax = dt;
    }
  }

  const NAO_FINAL = new Set(["pauta", "voto_individual", "documento_apoio"]);
  const delib: DelibStats = { finais: 0, deferidas: 0, indeferidas: 0 };
  for (const d of (delibsRes.data ?? []) as Array<{ resultado: string | null; tipo_documento: string | null; documento_pai_id: string | null }>) {
    if (NAO_FINAL.has(String(d.tipo_documento))) continue;
    if (d.tipo_documento === "ata" && !(d.documento_pai_id && d.resultado)) continue;
    delib.finais++;
    if (d.resultado === "Indeferido") delib.indeferidas++;
    else if (d.resultado && d.resultado !== "Retirado de Pauta") delib.deferidas++;
  }

  divergencias.sort((a, b) => String(b.data ?? "").localeCompare(String(a.data ?? "")));

  const linhas = [...stats.values()]
    .filter((s) => mandatoPorDiretor.has(s._id) || s.total > 0)
    .map((s) => ({ ...s, pct_favor: s.total > 0 ? parseFloat(((s.favoravel / s.total) * 100).toFixed(1)) : 0 }))
    .sort((a, b) => b.total - a.total);

  return { sigla, linhas, divergencias, delib, meses, periodoMin, periodoMax };
}

const BLOCO_VAZIO = { divergencias: [], delib: { finais: 0, deferidas: 0, indeferidas: 0 }, meses: new Map<string, number>(), periodoMin: null, periodoMax: null };

export async function GET(req: NextRequest) {
  const agenciaFiltro = req.nextUrl.searchParams.get("agencia_id");
  const format = (req.nextUrl.searchParams.get("format") ?? "html").toLowerCase();
  const geradoEm = new Date().toISOString().slice(0, 16).replace("T", " ");

  let blocos: Bloco[] = [];
  if (isDemo() || isDemoRequest(req)) {
    const overview = isLocalMode() ? computeDiretoresOverview(getSyncedDelibs(), agenciaFiltro) : [];
    blocos.push({
      sigla: "DEMO",
      linhas: (overview as Array<Record<string, number | string>>).map((o) => ({
        diretor_nome: String(o.diretor_nome), total: Number(o.total), favoravel: Number(o.favoravel), desfavoravel: Number(o.desfavoravel),
        divergente: Number(o.divergente), nominais: Number(o.nominais ?? 0), inferidos: Number(o.inferidos ?? 0), pct_favor: Number(o.pct_favor ?? 0),
        mandato: null,
      })),
      ...BLOCO_VAZIO,
    });
  } else {
    const { createSupabaseServerClient } = await import("@/lib/supabase/server");
    const db = createSupabaseServerClient();
    // mandatos carregados 1× (antes: a MESMA query rodava por agência).
    const [{ data: agencias }, { data: mandatosData }] = await Promise.all([
      db.from("agencias").select("id, sigla").in("sigla", COLEGIADO),
      db.from("mandatos").select("diretor_id, cargo, data_inicio, data_fim").limit(20000),
    ]);
    const mandatos = (mandatosData ?? []) as MandatoRow[];
    const alvo = ((agencias ?? []) as Array<{ id: string; sigla: string }>)
      .filter((a) => !agenciaFiltro || a.id === agenciaFiltro)
      .sort((a, b) => COLEGIADO.indexOf(a.sigla) - COLEGIADO.indexOf(b.sigla));
    // Agências em paralelo (antes: sequencial).
    blocos = await Promise.all(alvo.map((ag) => blocoReal(db, ag.id, ag.sigla, mandatos)));
  }

  if (format === "csv") {
    return new NextResponse(buildCsv(blocos), {
      headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": 'attachment; filename="iris-votos-por-diretor.csv"' },
    });
  }

  // Período coberto real (capa): min–max das datas de reunião com voto.
  const periodoMin = blocos.map((b) => b.periodoMin).filter(Boolean).sort()[0] ?? null;
  const periodoMax = blocos.map((b) => b.periodoMax).filter(Boolean).sort().at(-1) ?? null;
  const reunioesTotal = new Set(blocos.flatMap((b) => [...b.meses.keys()])).size;

  const sumario = blocos.some((b) => b.linhas.length > 0) ? renderSumario(blocos) : "";
  const contentHtml = `${sumario}\n${blocos.map(renderBloco).join("\n")}`;
  const periodoLabel = periodoMin ? `Período coberto: ${fmtData(periodoMin)} a ${fmtData(periodoMax)} · ${reunioesTotal} mês(es) com atividade` : "";
  const subtitle = `Agências colegiadas (${blocos.map((b) => b.sigla).join(", ")})${agenciaFiltro ? " · filtrado" : ""} · votos por diretor, mandatos, divergências e comparativo. ${periodoLabel}`;

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
    generatedAt: `Gerado em ${geradoEm} UTC${periodoLabel ? ` · ${periodoLabel}` : ""}`,
    baseUrl: req.nextUrl.origin,
    contentHtml,
    footerHtml: `"Lidos" = votos nominais extraídos do documento · "Inferidos" = completados por unanimidade/mandato. Uma % favorável sobre base majoritariamente inferida deve ser lida com cautela. &middot; IRIS-Regulação`,
  });
  return new NextResponse(html, { headers: { "content-type": "text/html; charset=utf-8" } });
}
