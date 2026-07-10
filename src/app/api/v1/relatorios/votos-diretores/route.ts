/**
 * GET /api/v1/relatorios/votos-diretores[?agencia_id=...]
 *
 * Relatório IMPRIMÍVEL (HTML → PDF pelo navegador) dos votos de cada diretor das 3
 * agências colegiadas (ANTT, ANM, ARTESP): total, favoráveis, desfavoráveis,
 * divergentes, LIDOS vs INFERIDOS e % favorável. Mesma agregação do overview
 * (dashboard/diretores/overview) — a diferença é o empacotamento imprimível.
 * Respeita o modo demo (usa a engine local).
 */

import { NextRequest, NextResponse } from "next/server";
import { isLocalMode, getSyncedDelibs } from "@/lib/server/local-data-store";
import { computeDiretoresOverview } from "@/lib/server/analytics-engine";
import { isDemo } from "@/lib/server/is-demo";
import { isDemoRequest } from "@/lib/server/request-guards";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const COLEGIADO = ["ANTT", "ANM", "ARTESP"];

type Linha = {
  diretor_nome: string; total: number; favoravel: number; desfavoravel: number;
  divergente: number; nominais: number; inferidos: number; pct_favor: number;
};

function esc(s: unknown): string {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
}

function tabela(sigla: string, linhas: Linha[]): string {
  const totalVotos = linhas.reduce((s, l) => s + l.total, 0);
  const nominais = linhas.reduce((s, l) => s + l.nominais, 0);
  const cobertura = totalVotos > 0 ? Math.round((nominais / totalVotos) * 1000) / 10 : 0;
  const corpo = linhas.length === 0
    ? `<tr><td colspan="7" class="vazio">Sem votos materializados para esta agência.</td></tr>`
    : linhas.map((l) => `
      <tr>
        <td class="nome">${esc(l.diretor_nome)}</td>
        <td class="num">${l.total}</td>
        <td class="num pos">${l.favoravel}</td>
        <td class="num neg">${l.desfavoravel}</td>
        <td class="num">${l.divergente}</td>
        <td class="num"><span class="lido">${l.nominais}</span> · <span class="inf">${l.inferidos}</span></td>
        <td class="num">${l.pct_favor.toFixed(1)}%</td>
      </tr>`).join("");
  return `
    <section>
      <h2>${esc(sigla)}</h2>
      <table>
        <thead>
          <tr><th>Diretor</th><th>Votos</th><th>Favoráveis</th><th>Desfav.</th><th>Diverg.</th><th>Lidos · Inferidos</th><th>% Favorável</th></tr>
        </thead>
        <tbody>${corpo}</tbody>
      </table>
      <p class="rodape">${linhas.length} diretor(es) · ${totalVotos} voto(s) · base nominal (lidos) ${cobertura}%${cobertura < 30 && totalVotos > 0 ? " — consenso majoritariamente inferido, interpretar com cautela" : ""}.</p>
    </section>`;
}

async function linhasReais(db: any, sigla: string, agenciaId: string): Promise<Linha[]> {
  const [diretoresRes, votosRes, mandatosRes] = await Promise.all([
    db.from("diretores").select("id, nome").eq("agencia_id", agenciaId).eq("review_status", "aprovado").limit(5000),
    db.from("votos").select("tipo_voto, is_divergente, is_nominal, diretores!inner (id, nome, agencia_id)").eq("diretores.agencia_id", agenciaId),
    db.from("mandatos").select("diretor_id").limit(20000),
  ]);
  const comMandato = new Set((mandatosRes.data ?? []).map((m: any) => m.diretor_id));
  const stats = new Map<string, Linha & { _id: string }>();
  for (const d of (diretoresRes.data ?? []) as Array<{ id: string; nome: string }>) {
    stats.set(d.id, { _id: d.id, diretor_nome: d.nome, total: 0, favoravel: 0, desfavoravel: 0, divergente: 0, nominais: 0, inferidos: 0, pct_favor: 0 });
  }
  for (const row of votosRes.data ?? []) {
    const dir = (row as any).diretores; const id = dir?.id; if (!id) continue;
    if (!stats.has(id)) stats.set(id, { _id: id, diretor_nome: dir.nome ?? "—", total: 0, favoravel: 0, desfavoravel: 0, divergente: 0, nominais: 0, inferidos: 0, pct_favor: 0 });
    const s = stats.get(id)!;
    s.total++;
    if ((row as any).tipo_voto === "Favoravel") s.favoravel++;
    else if ((row as any).tipo_voto === "Desfavoravel") s.desfavoravel++;
    if ((row as any).is_divergente) s.divergente++;
    if ((row as any).is_nominal) s.nominais++; else s.inferidos++;
  }
  return [...stats.values()]
    .filter((s) => comMandato.has(s._id) || s.total > 0)
    .map((s) => ({ ...s, pct_favor: s.total > 0 ? parseFloat(((s.favoravel / s.total) * 100).toFixed(1)) : 0 }))
    .sort((a, b) => b.total - a.total);
}

export async function GET(req: NextRequest) {
  const agenciaFiltro = req.nextUrl.searchParams.get("agencia_id");
  const geradoEm = new Date().toISOString().slice(0, 16).replace("T", " ");

  const blocos: string[] = [];

  if (isDemo() || isDemoRequest(req)) {
    const overview = isLocalMode() ? computeDiretoresOverview(getSyncedDelibs(), agenciaFiltro) : [];
    blocos.push(tabela("DEMO", (overview as any[]).map((o) => ({
      diretor_nome: o.diretor_nome, total: o.total, favoravel: o.favoravel, desfavoravel: o.desfavoravel,
      divergente: o.divergente, nominais: o.nominais ?? 0, inferidos: o.inferidos ?? 0, pct_favor: o.pct_favor ?? 0,
    }))));
  } else {
    const { createSupabaseServerClient } = await import("@/lib/supabase/server");
    const db = createSupabaseServerClient();
    const { data: agencias } = await db.from("agencias").select("id, sigla").in("sigla", COLEGIADO);
    const alvo = (agencias ?? []).filter((a: any) => !agenciaFiltro || a.id === agenciaFiltro);
    // Ordena ANTT, ANM, ARTESP.
    alvo.sort((a: any, b: any) => COLEGIADO.indexOf(a.sigla) - COLEGIADO.indexOf(b.sigla));
    for (const ag of alvo as Array<{ id: string; sigla: string }>) {
      blocos.push(tabela(ag.sigla, await linhasReais(db, ag.sigla, ag.id)));
    }
  }

  const html = `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8">
<title>Relatório de Votos por Diretor — IRIS</title>
<style>
  * { box-sizing: border-box; }
  body { font-family: -apple-system, Segoe UI, Roboto, Arial, sans-serif; color: #18181b; margin: 0; padding: 32px; background: #fff; }
  header { border-bottom: 2px solid #ea580c; padding-bottom: 12px; margin-bottom: 24px; }
  h1 { font-size: 20px; margin: 0 0 4px; }
  .sub { color: #71717a; font-size: 13px; }
  section { margin: 0 0 28px; page-break-inside: avoid; }
  h2 { font-size: 15px; color: #ea580c; margin: 0 0 8px; }
  table { width: 100%; border-collapse: collapse; font-size: 13px; }
  th, td { padding: 7px 10px; border-bottom: 1px solid #e4e4e7; text-align: left; }
  th { background: #fafafa; font-size: 11px; text-transform: uppercase; letter-spacing: .04em; color: #52525b; }
  td.num, th:not(:first-child) { text-align: right; }
  td.nome { font-weight: 600; }
  .pos { color: #16a34a; } .neg { color: #dc2626; }
  .lido { font-weight: 600; } .inf { color: #a1a1aa; }
  .vazio { color: #a1a1aa; text-align: center; font-style: italic; }
  .rodape { font-size: 11px; color: #71717a; margin: 6px 0 0; }
  .aviso { font-size: 11px; color: #71717a; margin-top: 24px; border-top: 1px solid #e4e4e7; padding-top: 12px; }
  @media print { body { padding: 0; } .noprint { display: none; } }
  .noprint { margin-bottom: 16px; }
  .btn { background: #ea580c; color: #fff; border: 0; border-radius: 6px; padding: 8px 14px; font-size: 13px; cursor: pointer; }
</style></head>
<body>
  <div class="noprint"><button class="btn" onclick="window.print()">Imprimir / salvar PDF</button></div>
  <header>
    <h1>Relatório de Votos por Diretor</h1>
    <div class="sub">IRIS-Regulação · agências colegiadas (ANTT, ANM, ARTESP) · gerado em ${esc(geradoEm)} UTC</div>
  </header>
  ${blocos.join("\n")}
  <p class="aviso">"Lidos" = votos nominais extraídos do documento (ex.: voto do relator). "Inferidos" = completados por unanimidade/mandato (não lidos individualmente). Uma % favorável sobre base majoritariamente inferida deve ser lida com cautela.</p>
</body></html>`;

  return new NextResponse(html, {
    headers: { "content-type": "text/html; charset=utf-8" },
  });
}
