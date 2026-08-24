"use client";

import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { api, listaDe } from "@/lib/api";
import type {
  MicrotemaStats, DiretorOverviewItem, Agencia, Mandato,
  EmpresaStats,
} from "@/types";
import { IrisBarChart } from "@/components/charts/IrisBarChart";
import { IrisPieChart } from "@/components/charts/IrisPieChart";
import { IrisAreaChart } from "@/components/charts/IrisAreaChart";
import { getMicrotemaLabel, formatNumber, formatDate, cn, isResultadoPositivo } from "@/lib/utils";
import { SlidersHorizontal, Settings, ChevronDown, ChevronUp } from "lucide-react";
import Link from "next/link";
import { ModuleTabs } from "@/components/ui/ModuleTabs";
import { ANALISE_TABS } from "@/lib/module-tabs";

const ANOS = Array.from({ length: 10 }, (_, i) => new Date().getFullYear() - i);
const MICROTEMAS = [
  "tarifa", "obras", "multa", "contrato", "reequilibrio",
  "fiscalizacao", "seguranca", "ambiental", "desapropriacao",
  "adimplencia", "pessoal", "usuario", "outros",
];

interface OverviewData {
  total_deliberacoes: number;
  deferidos: number;
  indeferidos: number;
  taxa_deferimento: string;
  taxa_consenso?: string;
  taxa_sancao?: string;
}

interface ReunioesStats {
  period: string;
  total: number;
  deferido: number;
  indeferido: number;
}

interface ChartPrefs {
  horizontal?: boolean;
  showLegend?: boolean;
  innerRadius?: number;
}

export default function Dashboard360Page() {
  // ── Filters ────────────────────────────────────────────────────────────
  const [agenciaId, setAgenciaId]   = useState("");
  const [year, setYear]             = useState("");
  const [microtema, setMicrotema]   = useState("");
  const [resultado, setResultado]   = useState("");
  const [filtersOpen, setFiltersOpen] = useState(true);

  // ── Chart prefs ────────────────────────────────────────────────────────
  const [chartPrefs, setChartPrefs] = useState<Record<string, ChartPrefs>>({});
  const [openPref, setOpenPref]     = useState<string | null>(null);

  const setChartPref = (chartId: string, patch: Partial<ChartPrefs>) => {
    setChartPrefs((prev) => ({ ...prev, [chartId]: { ...prev[chartId], ...patch } }));
  };

  const hasActiveFilter = !!(agenciaId || year || microtema || resultado);

  // ── Query string ───────────────────────────────────────────────────────
  const qs = useMemo(() => {
    const p = new URLSearchParams();
    if (agenciaId) p.set("agencia_id", agenciaId);
    if (year) p.set("year", year);
    return p.toString() ? `?${p.toString()}` : "";
  }, [agenciaId, year]);

  // ── Data queries ───────────────────────────────────────────────────────
  const { data: agencias } = useQuery({
    queryKey: ["agencias"],
    queryFn: async () => listaDe<Agencia>(await api.get("/agencias")),
  });

  const { data: overview } = useQuery({
    queryKey: ["dashboard", "overview", agenciaId, year],
    queryFn: () => api.get<OverviewData>(`/dashboard/overview${qs}`),
  });

  const { data: microtemas = [] } = useQuery({
    queryKey: ["dashboard", "microtemas", agenciaId, year],
    queryFn: async () => listaDe<MicrotemaStats>(await api.get(`/dashboard/microtemas${qs}`)),
  });

  const { data: reunioes = [] } = useQuery({
    queryKey: ["dashboard", "reunioes-stats", agenciaId],
    queryFn: async () => listaDe<ReunioesStats>(await api.get(`/dashboard/reunioes/stats${agenciaId ? `?agencia_id=${agenciaId}` : ""}`)),
  });

  const { data: empresas = [] } = useQuery({
    queryKey: ["empresas", agenciaId],
    queryFn: async () => listaDe<EmpresaStats>(await api.get(`/empresas${agenciaId ? `?agencia_id=${agenciaId}` : ""}`)),
  });

  const { data: diretores = [] } = useQuery({
    queryKey: ["dashboard", "diretores-overview", agenciaId],
    queryFn: async () => listaDe<DiretorOverviewItem>(await api.get(`/dashboard/diretores/overview${agenciaId ? `?agencia_id=${agenciaId}` : ""}`)),
  });

  const { data: mandatos = [] } = useQuery({
    queryKey: ["mandatos", agenciaId],
    queryFn: async () => listaDe<Mandato>(await api.get(`/mandatos${agenciaId ? `?agencia_id=${agenciaId}` : ""}`)),
  });

  const { data: deliberacoesPage } = useQuery({
    queryKey: ["deliberacoes-360", agenciaId, year, microtema, resultado],
    queryFn: () => {
      const p = new URLSearchParams();
      if (agenciaId) p.set("agencia_id", agenciaId);
      if (year) p.set("year", year);
      if (microtema) p.set("microtema", microtema);
      if (resultado) p.set("resultado", resultado);
      p.set("limit", "20");
      return api.get<{ data: Array<{
        id: string; numero_deliberacao: string | null; data_reuniao: string | null;
        interessado: string | null; microtema: string | null; resultado: string | null;
      }>; total: number }>(`/deliberacoes?${p.toString()}`);
    },
  });

  // ── KPIs ───────────────────────────────────────────────────────────────
  const totalDelibs     = overview?.total_deliberacoes ?? 0;
  const taxaDeferimento = overview?.taxa_deferimento ?? "—";
  const empresasUnicas  = empresas.length;
  const diretoresAtivos = mandatos.filter((m) => m.status === "Ativo").length;

  // Taxa consenso: from mandatosAnalytics approximation (delibs without divergência / total)
  const pctDeferido = totalDelibs > 0 && overview?.deferidos != null
    ? ((overview.deferidos / totalDelibs) * 100).toFixed(1)
    : "—";

  // Taxa sanção (multa + indeferido roughly)
  const taxaSancao = microtemas.find((m) => m.microtema === "multa")
    ? `${microtemas.filter((m) => m.microtema === "multa").reduce((s, m) => s + m.total, 0)} multas`
    : "—";

  // ── Chart data ─────────────────────────────────────────────────────────
  const areaData = reunioes.map((r) => ({
    name: r.period,
    deferido: r.deferido,
    indeferido: r.indeferido,
  }));

  const areaAreas = [
    { key: "deferido",   color: "#22c55e", label: "Favoráveis" },
    { key: "indeferido", color: "#ef4444", label: "Indeferido" },
  ];

  // Filter microtemas by selected microtema filter
  const filteredMicrotemas = microtema
    ? microtemas.filter((m) => m.microtema === microtema)
    : microtemas;

  const microtemaBarData = filteredMicrotemas.map((m) => ({
    name: m.microtema,
    value: m.total,
  }));

  // Pie: resultados (deferido / indeferido)
  const pieResultados = [
    ...(overview?.deferidos ? [{ name: "Favoráveis", value: overview.deferidos, color: "#22c55e" }] : []),
    ...(overview?.indeferidos ? [{ name: "Indeferido", value: overview.indeferidos, color: "#ef4444" }] : []),
    ...(() => {
      const outros = totalDelibs - (overview?.deferidos ?? 0) - (overview?.indeferidos ?? 0);
      return outros > 0 ? [{ name: "Outros", value: outros, color: "#6b7280" }] : [];
    })(),
  ];

  // Top 8 companies
  const top8Empresas = empresas.slice(0, 8).map((e) => ({
    name: e.nome,
    value: e.total_deliberacoes,
  }));

  // Directors participation
  const dirBarData = diretores.map((d) => ({
    name: d.diretor_nome,
    value: d.total,
  }));

  // Vote distribution pie
  const votePieData = diretores.length > 0 ? [
    { name: "Favorável", value: diretores.reduce((s, d) => s + d.favoravel, 0), color: "#22c55e" },
    { name: "Desfavorável", value: diretores.reduce((s, d) => s + d.desfavoravel, 0), color: "#ef4444" },
  ] : [];

  // Chart preference helpers
  const prefs = (id: string): ChartPrefs => chartPrefs[id] ?? {};

  const ChartSettingsMenu = ({ chartId, hasHorizontal, hasPie }: {
    chartId: string; hasHorizontal?: boolean; hasPie?: boolean;
  }) => (
    <div className="relative">
      <button
        className="p-1 rounded hover:bg-bg-hover text-text-muted transition-colors"
        onClick={(e) => { e.stopPropagation(); setOpenPref(openPref === chartId ? null : chartId); }}
      >
        <Settings className="w-3.5 h-3.5" />
      </button>
      {openPref === chartId && (
        <div
          className="absolute right-0 top-6 z-20 bg-bg-card border border-border rounded-lg shadow-xl p-3 w-44 space-y-2 text-xs"
          onClick={(e) => e.stopPropagation()}
        >
          {hasHorizontal && (
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                className="w-3.5 h-3.5 accent-brand"
                checked={prefs(chartId).horizontal !== false}
                onChange={(e) => setChartPref(chartId, { horizontal: e.target.checked })}
              />
              <span className="text-text-secondary">Horizontal</span>
            </label>
          )}
          {hasPie && (
            <div>
              <p className="text-text-muted mb-1">Raio interno</p>
              <input
                type="range" min={0} max={80} step={10}
                className="w-full"
                value={prefs(chartId).innerRadius ?? 50}
                onChange={(e) => setChartPref(chartId, { innerRadius: Number(e.target.value) })}
              />
              <span className="text-text-muted">{prefs(chartId).innerRadius ?? 50}px</span>
            </div>
          )}
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              className="w-3.5 h-3.5 accent-brand"
              checked={prefs(chartId).showLegend ?? true}
              onChange={(e) => setChartPref(chartId, { showLegend: e.target.checked })}
            />
            <span className="text-text-secondary">Mostrar legenda</span>
          </label>
          <button
            className="text-xs text-text-muted hover:text-brand transition-colors"
            onClick={() => setChartPrefs((p) => { const n = { ...p }; delete n[chartId]; return n; })}
          >
            Restaurar padrão
          </button>
        </div>
      )}
    </div>
  );

  return (
    <div
      className="space-y-6 animate-fade-in"
      onClick={() => { if (openPref) setOpenPref(null); }}
    >
      <ModuleTabs tabs={ANALISE_TABS} />
      {/* Header */}
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-xl font-semibold text-text-primary">Dashboard 360°</h1>
          <p className="text-sm text-text-muted mt-0.5">Visão completa e interativa com todos os filtros disponíveis</p>
        </div>
      </div>

      {/* Filtros */}
      <div className="card">
        <button
          className="flex items-center gap-2 w-full text-left"
          onClick={() => setFiltersOpen(!filtersOpen)}
        >
          <SlidersHorizontal className="w-4 h-4 text-text-muted" />
          <span className="text-sm font-medium text-text-secondary">Filtros</span>
          {hasActiveFilter && (
            <span className="ml-1 px-1.5 py-0.5 bg-brand/20 text-brand text-xs rounded-full font-medium">
              Ativos
            </span>
          )}
          <span className="ml-auto text-text-muted">
            {filtersOpen ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
          </span>
        </button>

        {filtersOpen && (
          <div className="mt-3 flex flex-wrap gap-2 items-center">
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
              className="select w-44 text-xs"
              value={microtema}
              onChange={(e) => setMicrotema(e.target.value)}
            >
              <option value="">Todos os microtemas</option>
              {MICROTEMAS.map((m) => (
                <option key={m} value={m}>{getMicrotemaLabel(m)}</option>
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

            {hasActiveFilter && (
              <button
                className="text-xs text-text-muted hover:text-brand transition-colors"
                onClick={() => {
                  setAgenciaId(""); setYear(""); setMicrotema(""); setResultado("");
                }}
              >
                Limpar todos
              </button>
            )}
          </div>
        )}
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
        {[
          { label: "Total Deliberações", value: formatNumber(totalDelibs), color: "text-text-primary" },
          { label: "Taxa Deferimento", value: `${taxaDeferimento}%`, color: "text-success" },
          { label: "Empresas Reguladas", value: formatNumber(empresasUnicas), color: "text-text-primary" },
          { label: "Diretores Ativos", value: formatNumber(diretoresAtivos), color: "text-brand" },
          { label: "Taxa Favorável", value: `${pctDeferido}%`, color: "text-success" },
          { label: "Sanções (Multas)", value: taxaSancao, color: "text-error" },
        ].map((kpi) => (
          <div key={kpi.label} className="card py-3">
            <p className="section-label mb-1">{kpi.label}</p>
            <p className={cn("font-mono text-xl font-semibold", kpi.color)}>{kpi.value}</p>
          </div>
        ))}
      </div>

      {/* Charts row 1: area + pie */}
      <div className="grid grid-cols-2 gap-4">
        <div className="card">
          <div className="flex items-center justify-between mb-3">
            <p className="text-sm font-medium text-text-secondary">Evolução Mensal de Decisões</p>
            <ChartSettingsMenu chartId="area-evolucao" />
          </div>
          {areaData.length > 0 ? (
            <IrisAreaChart data={areaData} areas={areaAreas} height={220} />
          ) : (
            <p className="text-sm text-text-muted text-center py-12">Sem dados</p>
          )}
        </div>

        <div className="card">
          <div className="flex items-center justify-between mb-3">
            <p className="text-sm font-medium text-text-secondary">Distribuição de Resultados</p>
            <ChartSettingsMenu chartId="pie-resultados" hasPie />
          </div>
          {pieResultados.length > 0 ? (
            <IrisPieChart
              data={pieResultados}
              height={220}
              innerRadius={prefs("pie-resultados").innerRadius ?? 50}
              showLegend={prefs("pie-resultados").showLegend !== false}
            />
          ) : (
            <p className="text-sm text-text-muted text-center py-12">Sem dados</p>
          )}
        </div>
      </div>

      {/* Charts row 2: top empresas + microtemas */}
      <div className="grid grid-cols-2 gap-4">
        <div className="card">
          <div className="flex items-center justify-between mb-3">
            <p className="text-sm font-medium text-text-secondary">Top 8 Empresas por Deliberações</p>
            <ChartSettingsMenu chartId="bar-empresas" hasHorizontal />
          </div>
          {top8Empresas.length > 0 ? (
            <IrisBarChart
              data={top8Empresas}
              horizontal={prefs("bar-empresas").horizontal !== false}
              height={Math.max(180, top8Empresas.length * 36)}
            />
          ) : (
            <p className="text-sm text-text-muted text-center py-12">Sem dados</p>
          )}
        </div>

        <div className="card">
          <div className="flex items-center justify-between mb-3">
            <p className="text-sm font-medium text-text-secondary">
              Deliberações por Microtema
              {microtema && <span className="ml-1 text-brand text-xs">— {getMicrotemaLabel(microtema)}</span>}
            </p>
            <ChartSettingsMenu chartId="bar-microtemas" hasHorizontal />
          </div>
          {microtemaBarData.length > 0 ? (
            <IrisBarChart
              data={microtemaBarData}
              horizontal={prefs("bar-microtemas").horizontal !== false}
              height={Math.max(180, microtemaBarData.length * 34)}
              useMicrotemaColors
              formatLabel={getMicrotemaLabel}
            />
          ) : (
            <p className="text-sm text-text-muted text-center py-12">Sem dados</p>
          )}
        </div>
      </div>

      {/* Charts row 3: directors + vote distribution */}
      <div className="grid grid-cols-2 gap-4">
        <div className="card">
          <div className="flex items-center justify-between mb-3">
            <p className="text-sm font-medium text-text-secondary">Participação por Diretor</p>
            <ChartSettingsMenu chartId="bar-diretores" hasHorizontal />
          </div>
          {dirBarData.length > 0 ? (
            <IrisBarChart
              data={dirBarData}
              horizontal={prefs("bar-diretores").horizontal !== false}
              height={Math.max(160, dirBarData.length * 40)}
            />
          ) : (
            <p className="text-sm text-text-muted text-center py-12">Sem dados</p>
          )}
        </div>

        <div className="card">
          <div className="flex items-center justify-between mb-3">
            <p className="text-sm font-medium text-text-secondary">Distribuição de Votos</p>
            <ChartSettingsMenu chartId="pie-votos" hasPie />
          </div>
          {votePieData.length > 0 ? (
            <IrisPieChart
              data={votePieData}
              height={220}
              innerRadius={prefs("pie-votos").innerRadius ?? 60}
              showLegend={prefs("pie-votos").showLegend !== false}
            />
          ) : (
            <p className="text-sm text-text-muted text-center py-12">Sem dados</p>
          )}
        </div>
      </div>

      {/* Recent deliberações table */}
      <div className="card">
        <div className="flex items-center justify-between mb-4">
          <p className="text-sm font-medium text-text-secondary">
            Deliberações Recentes
            {deliberacoesPage?.total != null && (
              <span className="ml-2 text-xs text-text-muted font-normal">
                ({formatNumber(deliberacoesPage.total)} no total)
              </span>
            )}
          </p>
          <Link href="/dashboard/deliberacoes" className="text-xs text-brand hover:underline">
            Ver todas →
          </Link>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border">
                {["Data", "Número", "Interessado", "Microtema", "Resultado"].map((h) => (
                  <th key={h} className="px-3 py-2 text-left text-xs text-text-muted font-mono uppercase tracking-wider whitespace-nowrap">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {(deliberacoesPage?.data ?? []).map((d) => (
                <tr key={d.id} className="border-b border-border/50 hover:bg-bg-hover transition-colors">
                  <td className="px-3 py-2.5 font-mono text-text-secondary text-xs">{formatDate(d.data_reuniao)}</td>
                  <td className="px-3 py-2.5">
                    <Link href={`/dashboard/deliberacoes/${d.id}`} className="text-brand hover:underline text-xs">
                      {d.numero_deliberacao ?? d.id.slice(0, 8)}
                    </Link>
                  </td>
                  <td className="px-3 py-2.5 text-text-primary text-xs max-w-[180px] truncate">
                    {d.interessado ?? <span className="text-text-muted italic">Pauta Interna</span>}
                  </td>
                  <td className="px-3 py-2.5 text-xs">
                    {d.microtema ? getMicrotemaLabel(d.microtema) : "—"}
                  </td>
                  <td className={cn(
                    "px-3 py-2.5 text-xs font-medium",
                    isResultadoPositivo(d.resultado) ? "text-success" : d.resultado === "Indeferido" ? "text-error" : "text-text-muted"
                  )}>
                    {d.resultado ?? "—"}
                  </td>
                </tr>
              ))}
              {(deliberacoesPage?.data ?? []).length === 0 && (
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
