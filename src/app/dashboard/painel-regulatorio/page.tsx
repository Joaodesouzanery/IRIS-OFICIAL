"use client";

import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { api, listaDe } from "@/lib/api";
import type { MicrotemaStats, Agencia } from "@/types";
import { IrisBarChart } from "@/components/charts/IrisBarChart";
import { IrisPieChart } from "@/components/charts/IrisPieChart";
import { IrisAreaChart } from "@/components/charts/IrisAreaChart";
import {
  getMicrotemaLabel,
  getMicrotemaColor,
  CATEGORIAS_REGULATORIAS,
  formatNumber,
} from "@/lib/utils";
import { ModuleTabs } from "@/components/ui/ModuleTabs";
import { REGULATORIO_TABS } from "@/lib/module-tabs";

interface OverviewData {
  total_deliberacoes: number;
  deferidos: number;
  indeferidos: number;
  taxa_deferimento: string;
  top_microtema: string | null;
}

interface ReunioesStats {
  period: string;
  total: number;
  deferido: number;
  indeferido: number;
}

const ANOS = Array.from({ length: 10 }, (_, i) => new Date().getFullYear() - i);

const CATEGORIA_COLORS: Record<string, string> = {
  "economico-financeiro":    "#f97316",
  "contratos-concessoes":    "#3b82f6",
  "controle-sancoes":        "#ef4444",
  "seguranca-ambiente":      "#22c55e",
  "usuarios-administrativo": "#8b5cf6",
};

export default function PainelRegulatorioPage() {
  const [agenciaId, setAgenciaId]   = useState("");
  const [year, setYear]             = useState("");
  const [categoriaId, setCategoriaId] = useState("");
  const [resultado, setResultado]   = useState("");

  const params = new URLSearchParams();
  if (agenciaId) params.set("agencia_id", agenciaId);
  if (year)      params.set("year", year);
  const qs = params.toString() ? `?${params.toString()}` : "";

  const { data: agencias } = useQuery({
    queryKey: ["agencias"],
    queryFn: async () => listaDe<Agencia>(await api.get("/agencias")),
  });

  const { data: microtemas = [] } = useQuery({
    queryKey: ["dashboard", "microtemas", agenciaId, year],
    queryFn: async () => listaDe<MicrotemaStats>(await api.get(`/dashboard/microtemas${qs}`)),
  });

  const { data: overview } = useQuery({
    queryKey: ["dashboard", "overview", agenciaId, year],
    queryFn: () => api.get<OverviewData>(`/dashboard/overview${qs}`),
  });

  const { data: reunioesStats = [] } = useQuery({
    queryKey: ["dashboard", "reunioes-stats", agenciaId],
    queryFn: async () => listaDe<ReunioesStats>(await api.get(`/dashboard/reunioes/stats${agenciaId ? `?agencia_id=${agenciaId}` : ""}`)),
  });

  // Group microtemas by categoria
  const byCategoria = useMemo(() =>
    CATEGORIAS_REGULATORIAS.map((cat) => {
      const rows = microtemas.filter((m) => cat.microtemas.includes(m.microtema));
      const total    = rows.reduce((s, m) => s + m.total, 0);
      const deferido = rows.reduce((s, m) => s + m.deferido, 0);
      const indeferido = rows.reduce((s, m) => s + (m.indeferido ?? 0), 0);
      return { ...cat, rows, total, deferido, indeferido, pct_deferido: total > 0 ? (deferido / total) * 100 : 0 };
    }),
    [microtemas]
  );

  // Filter microtemas by selected categoria + resultado
  const filteredMicrotemas = useMemo(() => {
    let rows = microtemas;
    if (categoriaId) {
      const cat = CATEGORIAS_REGULATORIAS.find((c) => c.id === categoriaId);
      if (cat) rows = rows.filter((m) => cat.microtemas.includes(m.microtema));
    }
    if (resultado === "Deferido")    rows = rows.filter((m) => m.deferido > 0);
    if (resultado === "Indeferido")  rows = rows.filter((m) => m.indeferido > 0);
    return rows;
  }, [microtemas, categoriaId, resultado]);

  // Pie chart data
  const pieData = byCategoria
    .filter((c) => c.total > 0)
    .map((c) => ({
      name: c.label,
      value: c.total,
      color: CATEGORIA_COLORS[c.id],
    }));

  // Bar chart: microtemas ranking (filtered)
  const barData = filteredMicrotemas.map((m) => ({
    name: m.microtema,
    value: m.total,
  }));

  // Area chart: monthly evolution
  const areaData = reunioesStats.map((r) => ({
    name: r.period,
    deferido: r.deferido,
    indeferido: r.indeferido,
  }));

  const areaAreas = [
    { key: "deferido",   color: "#22c55e", label: "Deferido" },
    { key: "indeferido", color: "#ef4444", label: "Indeferido" },
  ];

  // Bar chart: deferimento rate by categoria
  const catBarData = byCategoria
    .filter((c) => c.total > 0)
    .map((c) => ({
      name: c.id,
      value: Math.round(c.pct_deferido),
    }));

  // KPIs
  const totalDelibs    = overview?.total_deliberacoes ?? microtemas.reduce((s, m) => s + m.total, 0);
  const taxaDeferimento = overview?.taxa_deferimento ?? "—";
  const topMicrotema   = overview?.top_microtema ?? null;
  const topCategoria   = byCategoria.reduce(
    (max, c) => (c.total > (max?.total ?? 0) ? c : max),
    null as (typeof byCategoria[0]) | null
  );

  return (
    <div className="space-y-6 animate-fade-in">
      <ModuleTabs tabs={REGULATORIO_TABS} />
      {/* Header */}
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-xl font-semibold text-text-primary">Observatório da Regulação</h1>
          <p className="text-sm text-text-muted mt-0.5">Visão estatística e filtrável das normas regulatórias</p>
        </div>
      </div>

      {/* Filtros */}
      <div className="card space-y-3">
        <p className="section-label">Filtros</p>
        <div className="flex flex-wrap gap-2">
          <select
            className="select w-44 text-xs"
            value={agenciaId}
            onChange={(e) => setAgenciaId(e.target.value)}
          >
            <option value="">Todas as agências</option>
            {(agencias ?? []).map((a) => (
              <option key={a.id} value={a.id}>{a.sigla}</option>
            ))}
          </select>

          <select
            className="select w-28 text-xs"
            value={year}
            onChange={(e) => setYear(e.target.value)}
          >
            <option value="">Todos os anos</option>
            {ANOS.map((a) => (
              <option key={a} value={String(a)}>{a}</option>
            ))}
          </select>

          <select
            className="select w-52 text-xs"
            value={categoriaId}
            onChange={(e) => setCategoriaId(e.target.value)}
          >
            <option value="">Todas as categorias</option>
            {CATEGORIAS_REGULATORIAS.map((c) => (
              <option key={c.id} value={c.id}>{c.label}</option>
            ))}
          </select>

          <select
            className="select w-36 text-xs"
            value={resultado}
            onChange={(e) => setResultado(e.target.value)}
          >
            <option value="">Todos os resultados</option>
            <option value="Deferido">Deferido</option>
            <option value="Indeferido">Indeferido</option>
          </select>

          {(agenciaId || year || categoriaId || resultado) && (
            <button
              className="text-xs text-text-muted hover:text-brand transition-colors"
              onClick={() => { setAgenciaId(""); setYear(""); setCategoriaId(""); setResultado(""); }}
            >
              Limpar filtros
            </button>
          )}
        </div>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="card">
          <p className="section-label mb-1">Total Deliberações</p>
          <p className="font-mono text-3xl text-text-primary">{formatNumber(totalDelibs)}</p>
        </div>
        <div className="card">
          <p className="section-label mb-1">Taxa de Deferimento</p>
          <p className="font-mono text-3xl text-success">{taxaDeferimento}%</p>
        </div>
        <div className="card">
          <p className="section-label mb-1">Microtema Dominante</p>
          <p className="text-lg font-semibold text-text-primary">
            {topMicrotema ? getMicrotemaLabel(topMicrotema) : "—"}
          </p>
        </div>
        <div className="card">
          <p className="section-label mb-1">Categoria Dominante</p>
          <p className="text-sm font-semibold text-text-primary leading-tight">
            {topCategoria?.label ?? "—"}
          </p>
          {topCategoria && (
            <p className="text-xs text-text-muted mt-0.5">{topCategoria.total} deliberações</p>
          )}
        </div>
      </div>

      {/* Charts row 1 */}
      <div className="grid grid-cols-2 gap-4">
        <div className="card">
          <p className="text-sm font-medium text-text-secondary mb-3">Deliberações por Categoria Regulatória</p>
          {pieData.length > 0 ? (
            <IrisPieChart data={pieData} height={240} innerRadius={50} showLegend />
          ) : (
            <p className="text-sm text-text-muted text-center py-12">Sem dados</p>
          )}
        </div>
        <div className="card">
          <p className="text-sm font-medium text-text-secondary mb-3">
            Deliberações por Microtema
            {categoriaId && (
              <span className="ml-1 text-brand text-xs">
                — {CATEGORIAS_REGULATORIAS.find((c) => c.id === categoriaId)?.label}
              </span>
            )}
          </p>
          {barData.length > 0 ? (
            <IrisBarChart
              data={barData}
              horizontal
              height={Math.max(180, barData.length * 34)}
              useMicrotemaColors
              formatLabel={getMicrotemaLabel}
            />
          ) : (
            <p className="text-sm text-text-muted text-center py-12">Sem dados</p>
          )}
        </div>
      </div>

      {/* Charts row 2 */}
      <div className="grid grid-cols-2 gap-4">
        <div className="card">
          <p className="text-sm font-medium text-text-secondary mb-3">Evolução Mensal de Decisões</p>
          {areaData.length > 0 ? (
            <IrisAreaChart
              data={areaData}
              areas={areaAreas}
              height={220}
            />
          ) : (
            <p className="text-sm text-text-muted text-center py-12">Sem dados</p>
          )}
        </div>
        <div className="card">
          <p className="text-sm font-medium text-text-secondary mb-3">Taxa de Deferimento por Categoria (%)</p>
          {catBarData.length > 0 ? (
            <IrisBarChart
              data={catBarData}
              horizontal
              height={Math.max(160, catBarData.length * 36)}
              formatLabel={(id) => CATEGORIAS_REGULATORIAS.find((c) => c.id === id)?.label ?? id}
            />
          ) : (
            <p className="text-sm text-text-muted text-center py-12">Sem dados</p>
          )}
        </div>
      </div>

      {/* Category breakdown table */}
      <div className="card">
        <p className="text-sm font-medium text-text-secondary mb-4">Resumo por Categoria Regulatória</p>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border">
                {["Categoria", "Total", "Deferido", "Indeferido", "Taxa Deferimento"].map((h) => (
                  <th key={h} className="px-3 py-2 text-left text-xs text-text-muted font-mono uppercase tracking-wider whitespace-nowrap">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {byCategoria.filter((c) => c.total > 0).map((cat) => (
                <tr
                  key={cat.id}
                  className="border-b border-border/50 hover:bg-bg-hover transition-colors cursor-pointer"
                  onClick={() => setCategoriaId(categoriaId === cat.id ? "" : cat.id)}
                >
                  <td className="px-3 py-2.5">
                    <div className="flex items-center gap-2">
                      <div className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: CATEGORIA_COLORS[cat.id] }} />
                      <span className={categoriaId === cat.id ? "text-brand font-medium" : "text-text-primary"}>
                        {cat.label}
                      </span>
                    </div>
                  </td>
                  <td className="px-3 py-2.5 font-mono text-text-primary">{cat.total}</td>
                  <td className="px-3 py-2.5 font-mono text-success">{cat.deferido}</td>
                  <td className="px-3 py-2.5 font-mono text-error">{cat.indeferido}</td>
                  <td className="px-3 py-2.5">
                    <div className="flex items-center gap-2">
                      <div className="flex-1 bg-bg-hover rounded-full h-1.5 w-20">
                        <div
                          className="h-1.5 rounded-full bg-success"
                          style={{ width: `${cat.pct_deferido}%` }}
                        />
                      </div>
                      <span className="font-mono text-xs text-text-muted w-10 text-right">
                        {cat.pct_deferido.toFixed(0)}%
                      </span>
                    </div>
                  </td>
                </tr>
              ))}
              {byCategoria.every((c) => c.total === 0) && (
                <tr>
                  <td colSpan={5} className="px-3 py-8 text-center text-text-muted text-sm">
                    Nenhuma deliberação encontrada para os filtros selecionados
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
