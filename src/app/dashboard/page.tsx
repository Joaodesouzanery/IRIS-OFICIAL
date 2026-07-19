"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import type { DashboardOverview, MicrotemaStats, DiretorOverviewItem, Agencia, Alerta } from "@/types";
import { MetricCard } from "@/components/dashboard/MetricCard";
import { IrisBarChart } from "@/components/charts/IrisBarChart";
import { IrisPieChart } from "@/components/charts/IrisPieChart";
import { IrisAreaChart } from "@/components/charts/IrisAreaChart";
import { ChartWrapper } from "@/components/charts/ChartWrapper";
import { getMicrotemaLabel, getMicrotemaColor, formatNumber, cn } from "@/lib/utils";
import { FileText, CheckCircle, Tag, Cpu, TrendingUp, Users, AlertTriangle } from "lucide-react";
import Link from "next/link";
import { HelpTooltip } from "@/components/ui/HelpTooltip";
import { ModuleTabs } from "@/components/ui/ModuleTabs";
import { DELIBERACOES_TABS } from "@/lib/module-tabs";

interface ReunioesStats {
  period: string;
  total: number;
  deferido: number;
  indeferido: number;
}

export default function DashboardPage() {
  const [agenciaId, setAgenciaId] = useState<string>("");

  const agenciaParam = agenciaId ? `?agencia_id=${agenciaId}` : "";

  const { data: agencias } = useQuery({
    queryKey: ["agencias"],
    queryFn: () => api.get<Agencia[]>("/agencias"),
  });

  const { data: overview, isLoading: loadingOverview } = useQuery({
    queryKey: ["dashboard", "overview", agenciaId],
    queryFn: () => api.get<DashboardOverview>(`/dashboard/overview${agenciaParam}`),
  });

  const { data: microtemas } = useQuery({
    queryKey: ["dashboard", "microtemas", agenciaId],
    queryFn: () => api.get<MicrotemaStats[]>(`/dashboard/microtemas${agenciaParam}`),
  });

  const { data: diretores } = useQuery({
    queryKey: ["dashboard", "diretores-overview", agenciaId],
    queryFn: () => api.get<DiretorOverviewItem[]>(`/dashboard/diretores/overview${agenciaParam}`),
  });

  const { data: reunioes = [] } = useQuery({
    queryKey: ["dashboard", "reunioes-stats", agenciaId],
    queryFn: () => api.get<ReunioesStats[]>(`/dashboard/reunioes/stats${agenciaParam}`),
  });

  const { data: alertas = [] } = useQuery({
    queryKey: ["alertas", agenciaId],
    queryFn: () => api.get<Alerta[]>(`/alertas${agenciaParam}`),
  });

  // ── Chart data ────────────────────────────────────────────────────────
  const microtemasBarData = (microtemas ?? []).map((m) => ({
    name: m.microtema,
    value: m.total,
  }));

  const microtemasPieData = (microtemas ?? [])
    .filter((m) => m.total > 0)
    .map((m) => ({
      name: getMicrotemaLabel(m.microtema),
      value: m.total,
      color: getMicrotemaColor(m.microtema),
    }));

  const microtemasAreaData = reunioes.map((r) => ({
    name: r.period.slice(5) + "/" + r.period.slice(2, 4),
    deferido: r.deferido,
    indeferido: r.indeferido,
  }));

  const resultadosPieData = overview
    ? [
        { name: "Favoráveis",     value: overview.deferidos,     color: "#22c55e" },
        { name: "Indeferidos",   value: overview.indeferidos,   color: "#ef4444" },
        { name: "Sem resultado", value: overview.sem_resultado, color: "#71717a" },
      ].filter((d) => d.value > 0)
    : [];

  const pautaPieData = overview
    ? [
        { name: "Pauta Externa",  value: overview.pauta_externa,       color: "#f97316" },
        { name: "Pauta Interna",  value: overview.pauta_interna_count, color: "#8b5cf6" },
      ].filter((d) => d.value > 0)
    : [];

  // ── Top setores (sorted by total) ──────────────────────────────────
  const topSetores = [...(microtemas ?? [])].sort((a, b) => b.total - a.total).slice(0, 5);

  // ── Diretores mais ativos ─────────────────────────────────────────
  const diretoresAtivos = [...(diretores ?? [])].sort((a, b) => b.total - a.total).slice(0, 4);

  return (
    <div className="space-y-8 animate-fade-in">
      <ModuleTabs tabs={DELIBERACOES_TABS} />
      {/* Header */}
      <div className="flex items-start justify-between flex-wrap gap-4">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-semibold text-text-primary">Inteligência Regulatória</h1>
            <HelpTooltip text="Visão geral consolidada de todas as deliberações, taxas de deferimento, votações de diretores e evolução temporal." />
          </div>
          <p className="text-sm text-text-muted mt-1">
            Análise de deliberações de agências reguladoras brasileiras
          </p>
        </div>
        <select
          className="select w-44"
          value={agenciaId}
          onChange={(e) => setAgenciaId(e.target.value)}
        >
          <option value="">Todas as agências</option>
          {(agencias ?? []).map((a) => (
            <option key={a.id} value={a.id}>{a.sigla}</option>
          ))}
        </select>
      </div>

      {/* KPIs */}
      <section>
        <div className="flex items-center gap-2 mb-3">
          <p className="section-label">Visão Geral</p>
          <HelpTooltip text="KPIs principais: total de deliberações, taxa de deferimento, reuniões únicas e % classificadas automaticamente." />
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          <MetricCard
            label="Total de Deliberações"
            value={loadingOverview ? "—" : overview?.total_deliberacoes ?? 0}
            subvalue="deliberações"
            icon={FileText}
            variant="orange"
          />
          <MetricCard
            label="Taxa de Deferimento"
            value={loadingOverview ? "—" : `${overview?.taxa_deferimento ?? 0}%`}
            icon={CheckCircle}
            variant="green"
          />
          <MetricCard
            label="Reuniões Únicas"
            value={loadingOverview ? "—" : overview?.reunioes_unicas ?? 0}
            subvalue="reuniões"
            icon={Tag}
            variant="default"
          />
          <MetricCard
            label="Auto-Classificadas"
            value={loadingOverview ? "—" : `${overview?.auto_classified_pct ?? 0}%`}
            subvalue="por IA"
            icon={Cpu}
            variant="default"
          />
        </div>
      </section>

      {/* Métricas de Valor Regulatório */}
      <section>
        <p className="section-label mb-3">Métricas de Valor Regulatório</p>
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          {/* Distribuição de resultados */}
          <ChartWrapper
            title="Distribuição de Resultados"
            availableTypes={["pie", "bar"]}
            defaultType="pie"
          >
            {(type) => type === "pie"
              ? <IrisPieChart data={resultadosPieData} height={200} innerRadius={38} />
              : <IrisBarChart data={resultadosPieData.map((d) => ({ name: d.name, value: d.value }))} height={200} />
            }
          </ChartWrapper>

          {/* Pauta Interna vs Externa */}
          <ChartWrapper
            title="Pauta Interna vs Externa"
            availableTypes={["pie", "bar"]}
            defaultType="pie"
          >
            {(type) => pautaPieData.length > 0
              ? type === "pie"
                ? <IrisPieChart data={pautaPieData} height={200} innerRadius={38} />
                : <IrisBarChart data={pautaPieData.map((d) => ({ name: d.name, value: d.value }))} height={200} />
              : <div className="h-[200px] flex items-center justify-center text-text-muted text-sm">Sem dados</div>
            }
          </ChartWrapper>

          {/* Votos por diretor */}
          <div className="card p-3 overflow-hidden">
            <p className="section-label mb-2">Votos por Diretor</p>
            {diretores && diretores.length > 0 ? (
              <div className="space-y-2 mt-2 max-h-[200px] overflow-hidden">
                {diretores.slice(0, 5).map((d) => (
                  <div key={d.diretor_id} className="flex items-center justify-between">
                    <span className="text-xs text-text-secondary truncate max-w-[180px]">
                      {d.diretor_nome.split(" ").slice(0, 2).join(" ")}
                    </span>
                    <span className="font-mono text-sm text-brand font-medium">
                      {formatNumber(d.total)}
                    </span>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-xs text-text-muted mt-2">Nenhum dado disponível</p>
            )}
          </div>

          {/* Deliberações por microtema — 3 tipos */}
          <ChartWrapper
            title="Deliberações por Microtema"
            availableTypes={["bar", "pie", "area"]}
            defaultType="bar"
            className="lg:col-span-2"
          >
            {(type) => {
              if (type === "pie") return <IrisPieChart data={microtemasPieData} height={210} innerRadius={48} showLegend />;
              if (type === "area") return (
                <IrisAreaChart
                  data={microtemasAreaData}
                  areas={[
                    { key: "deferido",   color: "#22c55e", label: "Favoráveis" },
                    { key: "indeferido", color: "#ef4444", label: "Indeferido" },
                  ]}
                  height={210}
                />
              );
              return (
                <IrisBarChart
                  data={microtemasBarData}
                  useMicrotemaColors
                  horizontal
                  // Altura proporcional ao nº de microtemas para as barras não colarem.
                  height={Math.max(210, microtemasBarData.length * 34)}
                  formatLabel={getMicrotemaLabel}
                />
              );
            }}
          </ChartWrapper>

          {/* Confiança da IA */}
          <div className="card p-3">
            <p className="section-label mb-3">Confiança da IA</p>
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-xs text-text-muted">Média de confiança</span>
                <span className="font-mono text-brand font-medium">
                  {overview?.avg_confidence ? `${(overview.avg_confidence * 100).toFixed(0)}%` : "—"}
                </span>
              </div>
              <div className="w-full bg-bg-hover rounded-full h-1.5">
                <div
                  className="h-1.5 rounded-full bg-brand transition-all duration-700"
                  style={{ width: `${(overview?.avg_confidence ?? 0) * 100}%` }}
                />
              </div>
              <div className="flex items-center justify-between">
                <span className="text-xs text-text-muted">Microtemas identificados</span>
                <span className="font-mono text-sm text-brand font-medium">{microtemas?.length ?? "—"}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-xs text-text-muted">Top microtema</span>
                {overview?.top_microtema && (
                  <span className="badge-orange text-xs">{getMicrotemaLabel(overview.top_microtema)}</span>
                )}
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Inteligência em Destaque */}
      <section>
        <div className="flex items-center justify-between mb-3">
          <p className="section-label">Inteligência em Destaque</p>
          <Link href="/dashboard/analytics" className="text-xs text-brand hover:underline">
            Ver análise completa →
          </Link>
        </div>
        <div className="grid grid-cols-3 gap-4">

          {/* Setores Mais Afetados */}
          <div className="card">
            <div className="flex items-center gap-2 mb-3">
              <AlertTriangle className="w-4 h-4 text-brand" />
              <p className="text-sm font-medium text-text-secondary">Setores Mais Afetados</p>
            </div>
            {topSetores.length === 0 ? (
              <p className="text-xs text-text-muted">Sem dados</p>
            ) : (
              <div className="space-y-2">
                {topSetores.map((m, i) => {
                  const pct = microtemas && microtemas.length > 0
                    ? (m.total / microtemas.reduce((s, x) => s + x.total, 0)) * 100
                    : 0;
                  return (
                    <div key={m.microtema}>
                      <div className="flex items-center justify-between mb-0.5">
                        <span className="text-xs text-text-secondary flex items-center gap-1">
                          <span className="font-mono text-text-muted">#{i + 1}</span>
                          {getMicrotemaLabel(m.microtema)}
                        </span>
                        <span className="text-xs font-mono text-text-muted">{m.total}</span>
                      </div>
                      <div className="w-full bg-bg-hover rounded-full h-1.5">
                        <div
                          className="h-1.5 rounded-full transition-all"
                          style={{ width: `${pct}%`, backgroundColor: getMicrotemaColor(m.microtema) }}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Temas Dominantes */}
          <div className="card">
            <div className="flex items-center gap-2 mb-3">
              <TrendingUp className="w-4 h-4 text-brand" />
              <p className="text-sm font-medium text-text-secondary">Temas Dominantes</p>
            </div>
            {(microtemas ?? []).length === 0 ? (
              <p className="text-xs text-text-muted">Sem dados</p>
            ) : (
              <div className="space-y-1.5">
                {[...(microtemas ?? [])].sort((a, b) => b.pct_deferido - a.pct_deferido).slice(0, 5).map((m) => (
                  <div key={m.microtema} className="flex items-center justify-between py-1 border-b border-border/40 last:border-0">
                    <span className="text-xs text-text-secondary">{getMicrotemaLabel(m.microtema)}</span>
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-mono text-success">{m.deferido}✓</span>
                      {m.indeferido > 0 && (
                        <span className="text-xs font-mono text-error">{m.indeferido}✗</span>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Diretores Mais Ativos */}
          <div className="card">
            <div className="flex items-center gap-2 mb-3">
              <Users className="w-4 h-4 text-brand" />
              <p className="text-sm font-medium text-text-secondary">Diretores Mais Ativos</p>
            </div>
            {diretoresAtivos.length === 0 ? (
              <p className="text-xs text-text-muted">Sem dados</p>
            ) : (
              <div className="space-y-2">
                {diretoresAtivos.map((d) => (
                  <Link
                    key={d.diretor_id}
                    href={`/dashboard/mandatos/${d.diretor_id}`}
                    className="flex items-center gap-2 py-1.5 hover:bg-bg-hover rounded px-1 transition-colors group"
                  >
                    <div className="w-7 h-7 rounded-full bg-brand/15 flex items-center justify-center shrink-0">
                      <span className="text-[10px] font-mono font-bold text-brand">
                        {d.diretor_nome.split(" ").filter((w) => w.length > 2).slice(0, 2).map((w) => w[0]).join("")}
                      </span>
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-medium text-text-primary truncate group-hover:text-brand transition-colors">
                        {d.diretor_nome.split(" ").slice(0, 2).join(" ")}
                      </p>
                      <div className="flex items-center gap-1 mt-0.5">
                        <div className="flex-1 bg-bg-hover rounded-full h-1">
                          <div className="h-1 rounded-full bg-success" style={{ width: `${d.pct_favor}%` }} />
                        </div>
                        <span className="text-[10px] font-mono text-text-muted">{d.pct_favor.toFixed(0)}%</span>
                      </div>
                    </div>
                    <span className="font-mono text-xs text-brand shrink-0">{d.total}</span>
                  </Link>
                ))}
              </div>
            )}
            <Link href="/dashboard/mandatos" className="text-[10px] text-text-muted hover:text-brand mt-2 block text-right transition-colors">
              Ver todos →
            </Link>
          </div>
        </div>
      </section>

      {/* ── Alertas Inteligentes ──────────────────────────────────────── */}
      {alertas.length > 0 && (
        <section>
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <p className="section-label">Alertas Regulatórios</p>
              <HelpTooltip text="Alertas automáticos: empresas com múltiplos indeferimentos, temas em crescimento e diretores com alta divergência." />
              <span className={cn(
                "text-xs px-2 py-0.5 rounded-full font-mono border",
                alertas.some((a) => a.severity === "high")
                  ? "bg-red-500/15 text-red-400 border-red-500/25"
                  : "bg-amber-500/15 text-amber-400 border-amber-500/25"
              )}>
                {alertas.length}
              </span>
            </div>
          </div>
          <div className="space-y-2">
            {alertas.map((alerta) => {
              const isHigh = alerta.severity === "high";
              const href =
                alerta.tipo === "empresa_risco"
                  ? `/dashboard/empresas/${encodeURIComponent(alerta.entidade)}`
                  : alerta.tipo === "diretor_divergente"
                  ? `/dashboard/mandatos/${alerta.entidade}`
                  : null;

              return (
                <div
                  key={alerta.id}
                  className={cn(
                    "flex items-start gap-3 px-4 py-3 rounded-lg border",
                    isHigh
                      ? "bg-red-500/10 border-red-500/20"
                      : "bg-amber-500/10 border-amber-500/20"
                  )}
                >
                  <AlertTriangle className={cn(
                    "w-4 h-4 shrink-0 mt-0.5",
                    isHigh ? "text-red-400" : "text-amber-400"
                  )} />
                  <div className="flex-1 min-w-0">
                    <p className={cn(
                      "text-xs font-semibold",
                      isHigh ? "text-red-300" : "text-amber-300"
                    )}>
                      {alerta.titulo}
                    </p>
                    <p className="text-xs text-text-muted mt-0.5">{alerta.mensagem}</p>
                  </div>
                  {href && (
                    <Link
                      href={href}
                      className={cn(
                        "text-xs shrink-0 hover:underline",
                        isHigh ? "text-red-400" : "text-amber-400"
                      )}
                    >
                      Ver →
                    </Link>
                  )}
                </div>
              );
            })}
          </div>
        </section>
      )}

      {/* Evolução Temporal */}
      {reunioes.length > 0 && (
        <section>
          <ChartWrapper
            title="Evolução Temporal de Decisões"
            subtitle="Deferidos vs Indeferidos ao longo do tempo"
            availableTypes={["area", "bar", "line"]}
            defaultType="area"
          >
            {(type) => {
              if (type === "bar") return (
                <IrisBarChart
                  data={microtemasAreaData.map((r) => ({ name: r.name, value: r.deferido, indeferido: r.indeferido }))}
                  multibar={[
                    { key: "deferido",   color: "#22c55e", label: "Favoráveis" },
                    { key: "indeferido", color: "#ef4444", label: "Indeferido" },
                  ]}
                  xKey="name"
                  height={220}
                />
              );
              return (
                <IrisAreaChart
                  data={microtemasAreaData}
                  areas={[
                    { key: "deferido",   color: "#22c55e", label: "Favoráveis" },
                    { key: "indeferido", color: "#ef4444", label: "Indeferido" },
                  ]}
                  height={220}
                />
              );
            }}
          </ChartWrapper>
        </section>
      )}
    </div>
  );
}
