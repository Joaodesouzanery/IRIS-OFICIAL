"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api, listaDe } from "@/lib/api";
import type { MicrotemaStats, EmpresaStats, MandatosAnalytics, Agencia } from "@/types";
import { IrisBarChart } from "@/components/charts/IrisBarChart";
import { IrisPieChart } from "@/components/charts/IrisPieChart";
import { IrisAreaChart } from "@/components/charts/IrisAreaChart";
import { IrisLineChart } from "@/components/charts/IrisLineChart";
import { ChartWrapper } from "@/components/charts/ChartWrapper";
import { getMicrotemaLabel, formatNumber, cn } from "@/lib/utils";
import { TrendingUp, Building2, Tag, ArrowUpRight, ArrowDownRight } from "lucide-react";
import { ModuleTabs } from "@/components/ui/ModuleTabs";
import { ANALISE_TABS } from "@/lib/module-tabs";

const ANOS = Array.from({ length: 8 }, (_, i) => new Date().getFullYear() - i);
const MICROTEMA_COLORS = [
  "#f97316","#3b82f6","#22c55e","#8b5cf6","#ef4444",
  "#06b6d4","#f59e0b","#10b981","#ec4899","#84cc16",
  "#0ea5e9","#a78bfa","#fb7185",
];

function pctBar(pct: number, color: string) {
  return (
    <div className="flex items-center gap-2">
      <div className="flex-1 bg-bg-hover rounded-full h-1.5">
        <div className="h-1.5 rounded-full transition-all" style={{ width: `${Math.min(pct,100)}%`, background: color }} />
      </div>
      <span className="text-xs font-mono text-text-secondary w-10 text-right">{pct.toFixed(0)}%</span>
    </div>
  );
}

export default function AnalyticsTemasPage() {
  const [agenciaId, setAgenciaId] = useState("");
  const [year, setYear]         = useState("");

  const qs = new URLSearchParams();
  if (agenciaId) qs.set("agencia_id", agenciaId);
  if (year)      qs.set("year", year);
  const qstr = qs.toString() ? `?${qs.toString()}` : "";

  const { data: agencias } = useQuery({
    queryKey: ["agencias"],
    queryFn: async () => listaDe<Agencia>(await api.get("/agencias")),
  });

  const { data: microtemas, isLoading: loadMicro } = useQuery({
    queryKey: ["dashboard", "microtemas", agenciaId, year],
    queryFn: async () => listaDe<MicrotemaStats>(await api.get(`/dashboard/microtemas${qstr}`)),
  });

  const { data: empresas, isLoading: loadEmpresas } = useQuery({
    queryKey: ["empresas", agenciaId],
    queryFn: async () => listaDe<EmpresaStats>(await api.get(`/empresas${agenciaId ? `?agencia_id=${agenciaId}` : ""}`)),
  });

  const { data: analytics, isLoading: loadAnalytics } = useQuery({
    queryKey: ["mandatos", "analytics", agenciaId],
    queryFn: () => api.get<MandatosAnalytics>(`/mandatos/analytics${agenciaId ? `?agencia_id=${agenciaId}` : ""}`),
  });

  // ── Derived data ──────────────────────────────────────────────────────────

  const microSorted = [...(microtemas ?? [])].sort((a, b) => b.total - a.total);

  const microBarData = microSorted.map((m) => ({
    name: getMicrotemaLabel(m.microtema),
    value: m.total,
  }));

  const microPieData = microSorted.slice(0, 10).map((m, i) => ({
    name: getMicrotemaLabel(m.microtema),
    value: m.total,
    color: MICROTEMA_COLORS[i % MICROTEMA_COLORS.length],
  }));

  // Tendência mensal: evolucao_mensal from analytics
  const evolucao = analytics?.evolucao_mensal ?? [];
  const trendAreaData = evolucao.map((e) => ({
    name: e.period,
    deferido: e.deferido,
    indeferido: e.indeferido,
    total: e.total,
  }));
  const trendAreas = [
    { key: "deferido",    color: "#22c55e", label: "Favoráveis" },
    { key: "indeferido",  color: "#ef4444", label: "Indeferidos" },
    { key: "total",       color: "#f97316", label: "Total" },
  ];
  const trendLines = trendAreas;

  // Ranking empresas
  const topEmpresas = [...(empresas ?? [])].sort((a, b) => b.total_deliberacoes - a.total_deliberacoes).slice(0, 15);
  const empresaBarData = topEmpresas.map((e) => ({
    name: e.nome.length > 30 ? e.nome.slice(0, 28) + "…" : e.nome,
    value: e.total_deliberacoes,
  }));
  const empresaPieData = topEmpresas.slice(0, 8).map((e, i) => ({
    name: e.nome.length > 25 ? e.nome.slice(0, 23) + "…" : e.nome,
    value: e.total_deliberacoes,
    color: MICROTEMA_COLORS[i % MICROTEMA_COLORS.length],
  }));

  // KPIs
  const totalDelibs  = microSorted.reduce((s, m) => s + m.total, 0) || 1;
  const topMicro     = microSorted[0];
  const topEmpresa   = topEmpresas[0];
  const mesesTrend   = evolucao.length;

  return (
    <div className="space-y-8 animate-fade-in">
      <ModuleTabs tabs={ANALISE_TABS} />
      {/* Header */}
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-xl font-semibold text-text-primary">Analytics por Tema</h1>
          <p className="text-sm text-text-muted mt-1">Tendências, rankings e distribuição temática das deliberações</p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <select className="input text-sm h-9 py-0" value={agenciaId} onChange={(e) => setAgenciaId(e.target.value)}>
            <option value="">Todas as agências</option>
            {(agencias ?? []).map((a) => (
              <option key={a.id} value={a.id}>{a.sigla}</option>
            ))}
          </select>
          <select className="input text-sm h-9 py-0" value={year} onChange={(e) => setYear(e.target.value)}>
            <option value="">Todos os anos</option>
            {ANOS.map((y) => <option key={y} value={String(y)}>{y}</option>)}
          </select>
        </div>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <div className="card">
          <p className="text-xs text-text-muted font-mono uppercase tracking-wider mb-1">Total Temas</p>
          <p className="text-2xl font-mono font-semibold text-text-primary">{microSorted.length}</p>
          <p className="text-xs text-text-muted mt-1">{formatNumber(totalDelibs)} deliberações</p>
        </div>
        <div className="card">
          <p className="text-xs text-text-muted font-mono uppercase tracking-wider mb-1">Tema Líder</p>
          <p className="text-lg font-semibold text-brand truncate">{topMicro ? getMicrotemaLabel(topMicro.microtema) : "—"}</p>
          <p className="text-xs text-text-muted mt-1">{topMicro ? formatNumber(topMicro.total) + " deliberações" : ""}</p>
        </div>
        <div className="card">
          <p className="text-xs text-text-muted font-mono uppercase tracking-wider mb-1">Top Empresa</p>
          <p className="text-sm font-semibold text-text-primary truncate">{topEmpresa?.nome ?? "—"}</p>
          <p className="text-xs text-text-muted mt-1">{topEmpresa ? formatNumber(topEmpresa.total_deliberacoes) + " deliberações" : ""}</p>
        </div>
        <div className="card">
          <p className="text-xs text-text-muted font-mono uppercase tracking-wider mb-1">Meses Analisados</p>
          <p className="text-2xl font-mono font-semibold text-text-primary">{mesesTrend}</p>
          <p className="text-xs text-text-muted mt-1">histórico disponível</p>
        </div>
      </div>

      {/* Tendência Mensal */}
      <ChartWrapper
        title="Tendência Mensal de Deliberações"
        subtitle="Evolução histórica de deferidos, indeferidos e total"
        availableTypes={["area", "line", "bar"]}
        defaultType="area"
      >
        {(type) => {
          if (loadAnalytics) return <div className="h-56 flex items-center justify-center text-text-muted text-sm">Carregando...</div>;
          if (!evolucao.length) return <div className="h-56 flex items-center justify-center text-text-muted text-sm">Sem dados de tendência</div>;
          if (type === "area") return <IrisAreaChart data={trendAreaData} areas={trendAreas} height={240} />;
          if (type === "line") return <IrisLineChart data={trendAreaData} lines={trendLines} height={240} />;
          return <IrisBarChart data={trendAreaData.map((d) => ({ name: d.name, value: d.total }))} height={240} />;
        }}
      </ChartWrapper>

      {/* Distribuição Temática */}
      <ChartWrapper
        title="Distribuição Temática"
        subtitle="Participação de cada microtema no total de deliberações"
        availableTypes={["bar", "pie", "area"]}
        defaultType="bar"
      >
        {(type) => {
          if (loadMicro) return <div className="h-56 flex items-center justify-center text-text-muted text-sm">Carregando...</div>;
          if (!microSorted.length) return <div className="h-56 flex items-center justify-center text-text-muted text-sm">Sem dados</div>;
          if (type === "bar") return <IrisBarChart data={microBarData} horizontal height={280} />;
          if (type === "pie") return <IrisPieChart data={microPieData} height={280} showLegend />;
          // area: % acumulado
          const cumData = microSorted.map((m, i) => ({
            name: getMicrotemaLabel(m.microtema),
            pct: Math.round((m.total / totalDelibs) * 100),
            total: microSorted.slice(0, i + 1).reduce((s, x) => s + x.total, 0),
          }));
          return <IrisAreaChart data={cumData} areas={[{ key: "pct", color: "#f97316", label: "% do total" }]} height={280} />;
        }}
      </ChartWrapper>

      {/* Ranking de Empresas */}
      <ChartWrapper
        title="Ranking de Empresas Reguladas"
        subtitle="Top empresas por volume de deliberações"
        availableTypes={["bar", "pie"]}
        defaultType="bar"
      >
        {(type) => {
          if (loadEmpresas) return <div className="h-56 flex items-center justify-center text-text-muted text-sm">Carregando...</div>;
          if (!topEmpresas.length) return <div className="h-56 flex items-center justify-center text-text-muted text-sm">Sem dados de empresas</div>;
          if (type === "bar") return <IrisBarChart data={empresaBarData} horizontal height={320} />;
          return <IrisPieChart data={empresaPieData} height={320} showLegend />;
        }}
      </ChartWrapper>

      {/* Tabela detalhada de temas */}
      <div className="card">
        <div className="flex items-center gap-2 mb-4">
          <Tag className="w-4 h-4 text-brand" />
          <p className="text-sm font-medium text-text-secondary">Análise Detalhada por Microtema</p>
        </div>
        {loadMicro ? (
          <p className="text-sm text-text-muted">Carregando...</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border">
                  <th className="text-left text-xs text-text-muted font-mono uppercase tracking-wider py-2 pr-4">Microtema</th>
                  <th className="text-right text-xs text-text-muted font-mono uppercase tracking-wider py-2 px-3">Total</th>
                  <th className="text-right text-xs text-text-muted font-mono uppercase tracking-wider py-2 px-3">Deferidos</th>
                  <th className="text-right text-xs text-text-muted font-mono uppercase tracking-wider py-2 px-3">Indeferidos</th>
                  <th className="text-left text-xs text-text-muted font-mono uppercase tracking-wider py-2 px-3 min-w-[140px]">Taxa Deferimento</th>
                  <th className="text-left text-xs text-text-muted font-mono uppercase tracking-wider py-2 px-3 min-w-[100px]">Tendência</th>
                </tr>
              </thead>
              <tbody>
                {microSorted.map((m, i) => {
                  const color = MICROTEMA_COLORS[i % MICROTEMA_COLORS.length];
                  const prevTotal = microSorted[i + 1]?.total;
                  const trend = prevTotal !== undefined
                    ? m.total > prevTotal ? "up" : m.total < prevTotal ? "down" : "same"
                    : "same";
                  return (
                    <tr key={m.microtema} className="border-b border-border/50 hover:bg-bg-hover transition-colors">
                      <td className="py-2.5 pr-4">
                        <div className="flex items-center gap-2">
                          <div className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: color }} />
                          <span className="text-text-primary font-medium">{getMicrotemaLabel(m.microtema)}</span>
                        </div>
                      </td>
                      <td className="py-2.5 px-3 text-right font-mono text-text-secondary">{formatNumber(m.total)}</td>
                      <td className="py-2.5 px-3 text-right font-mono text-success">{formatNumber(m.deferido)}</td>
                      <td className="py-2.5 px-3 text-right font-mono text-error">{formatNumber(m.indeferido)}</td>
                      <td className="py-2.5 px-3 min-w-[140px]">{pctBar(m.pct_deferido, "#22c55e")}</td>
                      <td className="py-2.5 px-3">
                        {trend === "up" ? (
                          <span className="flex items-center gap-1 text-success text-xs"><ArrowUpRight className="w-3.5 h-3.5" />Maior</span>
                        ) : trend === "down" ? (
                          <span className="flex items-center gap-1 text-error text-xs"><ArrowDownRight className="w-3.5 h-3.5" />Menor</span>
                        ) : (
                          <span className="text-text-muted text-xs">—</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Tabela detalhada de empresas */}
      <div className="card">
        <div className="flex items-center gap-2 mb-4">
          <Building2 className="w-4 h-4 text-brand" />
          <p className="text-sm font-medium text-text-secondary">Empresas com Mais Deliberações</p>
        </div>
        {loadEmpresas ? (
          <p className="text-sm text-text-muted">Carregando...</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border">
                  <th className="text-left text-xs text-text-muted font-mono uppercase tracking-wider py-2 pr-4">#</th>
                  <th className="text-left text-xs text-text-muted font-mono uppercase tracking-wider py-2 pr-4">Empresa</th>
                  <th className="text-right text-xs text-text-muted font-mono uppercase tracking-wider py-2 px-3">Deliberações</th>
                  <th className="text-right text-xs text-text-muted font-mono uppercase tracking-wider py-2 px-3">Deferidos</th>
                  <th className="text-right text-xs text-text-muted font-mono uppercase tracking-wider py-2 px-3">Indeferidos</th>
                  <th className="text-left text-xs text-text-muted font-mono uppercase tracking-wider py-2 px-3 min-w-[140px]">% Deferido</th>
                  <th className="text-left text-xs text-text-muted font-mono uppercase tracking-wider py-2 px-3">Tema Principal</th>
                </tr>
              </thead>
              <tbody>
                {topEmpresas.map((e, i) => (
                  <tr key={e.nome} className="border-b border-border/50 hover:bg-bg-hover transition-colors">
                    <td className="py-2.5 pr-4 text-text-muted font-mono text-xs">{i + 1}</td>
                    <td className="py-2.5 pr-4 text-text-primary font-medium max-w-[220px] truncate">{e.nome}</td>
                    <td className="py-2.5 px-3 text-right font-mono text-text-secondary">{formatNumber(e.total_deliberacoes)}</td>
                    <td className="py-2.5 px-3 text-right font-mono text-success">{formatNumber(e.deferidos)}</td>
                    <td className="py-2.5 px-3 text-right font-mono text-error">{formatNumber(e.indeferidos)}</td>
                    <td className="py-2.5 px-3 min-w-[140px]">{pctBar(e.pct_deferido, "#22c55e")}</td>
                    <td className="py-2.5 px-3">
                      {e.microtema_principal ? (
                        <span className="badge badge-gray text-xs">{getMicrotemaLabel(e.microtema_principal)}</span>
                      ) : <span className="text-text-muted">—</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
