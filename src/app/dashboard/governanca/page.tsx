"use client";

import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import type { DashboardOverview, MandatosAnalytics, Agencia, Deliberacao, DeliberacaoPaginada } from "@/types";
import { IrisAreaChart } from "@/components/charts/IrisAreaChart";
import { ChartWrapper } from "@/components/charts/ChartWrapper";
import { IrisBarChart } from "@/components/charts/IrisBarChart";
import { formatNumber, cn } from "@/lib/utils";
import {
  ShieldCheck, AlertTriangle, CheckCircle, TrendingUp,
  Activity, Database, Users, Zap,
} from "lucide-react";
import { ModuleTabs } from "@/components/ui/ModuleTabs";
import { ANALISE_TABS } from "@/lib/module-tabs";

const ANOS = Array.from({ length: 6 }, (_, i) => new Date().getFullYear() - i);

/** Governança score formula:
 * score = (taxa_consenso × 0.30) + (pct_deferimento × 0.25) +
 *         (qualidade_ia × 0.25) + ((100 − taxa_sancao) × 0.20)
 */
function calcScore(consenso: number, deferimento: number, qualidade: number, sancao: number) {
  return Math.round(
    consenso * 0.3 + deferimento * 0.25 + qualidade * 0.25 + (100 - sancao) * 0.2
  );
}

function scoreColor(s: number) {
  if (s >= 80) return "text-success";
  if (s >= 60) return "text-warning";
  return "text-error";
}

function scoreBg(s: number) {
  if (s >= 80) return "bg-success/10 border-success/20";
  if (s >= 60) return "bg-warning/10 border-warning/20";
  return "bg-error/10 border-error/20";
}

function scoreLabel(s: number) {
  if (s >= 80) return "Excelente";
  if (s >= 70) return "Bom";
  if (s >= 60) return "Regular";
  return "Atenção";
}

interface AgenciaScore {
  id: string;
  sigla: string;
  nome: string;
  score: number;
  consenso: number;
  deferimento: number;
  qualidade: number;
  sancao: number;
  total: number;
}

export default function GovernancaPage() {
  const [agenciaId, setAgenciaId] = useState("");
  const [year, setYear]           = useState("");

  const qs = new URLSearchParams();
  if (agenciaId) qs.set("agencia_id", agenciaId);
  if (year)      qs.set("year", year);
  const qstr = qs.toString() ? `?${qs.toString()}` : "";

  const { data: agencias } = useQuery({
    queryKey: ["agencias"],
    queryFn: () => api.get<Agencia[]>("/agencias"),
  });

  const { data: overview } = useQuery({
    queryKey: ["dashboard", "overview", agenciaId, year],
    queryFn: () => api.get<DashboardOverview>(`/dashboard/overview${qstr}`),
  });

  const { data: analytics } = useQuery({
    queryKey: ["mandatos", "analytics", agenciaId],
    queryFn: () => api.get<MandatosAnalytics>(`/mandatos/analytics${agenciaId ? `?agencia_id=${agenciaId}` : ""}`),
  });

  const { data: deliberacoesPag } = useQuery({
    queryKey: ["deliberacoes-gov", agenciaId],
    queryFn: () => api.get<DeliberacaoPaginada>(`/deliberacoes?limit=100${agenciaId ? `&agencia_id=${agenciaId}` : ""}`),
  });
  const deliberacoes: Deliberacao[] = deliberacoesPag?.data ?? [];

  // Indicadores REAIS por agência (não repete o global). Só agências com dados.
  const { data: govAgencias } = useQuery({
    queryKey: ["governanca-agencias"],
    queryFn: () => api.get<{ por_agencia: Array<{ agencia_id: string; sigla: string; nome: string; total: number; consenso: number; deferimento: number; qualidade: number; sancao: number }> }>("/dashboard/governanca-agencias"),
  });

  // ── Derived KPIs ─────────────────────────────────────────────────────────

  const taxaConsenso   = parseFloat(analytics?.taxa_consenso ?? "0");
  const taxaSancao     = parseFloat(analytics?.taxa_sancao   ?? "0");
  const pctDeferimento = parseFloat(overview?.taxa_deferimento ?? "0");
  const avgConf        = (overview?.avg_confidence ?? 0) * 100;

  const globalScore = calcScore(taxaConsenso, pctDeferimento, avgConf, taxaSancao);

  // Cobertura documental: % com resumo_pleito OU fundamento_decisao preenchidos
  const coberturaDoc = useMemo(() => {
    if (!deliberacoes.length) return 0;
    const withDoc = deliberacoes.filter((d) => d.resumo_pleito || d.fundamento_decisao).length;
    return Math.round((withDoc / deliberacoes.length) * 100);
  }, [deliberacoes]);

  // ── Per-agency scores ─────────────────────────────────────────────────────

  // Fetch individual agency data only when "all agencies" selected
  const agencyScores = useMemo((): AgenciaScore[] => {
    if (!agencias?.length) return [];

    // In demo/single-agency view we show a single-row table
    if (agenciaId) {
      const ag = agencias.find((a) => a.id === agenciaId);
      if (!ag) return [];
      const sc = calcScore(taxaConsenso, pctDeferimento, avgConf, taxaSancao);
      return [{
        id: ag.id, sigla: ag.sigla, nome: ag.nome,
        score: sc, consenso: taxaConsenso, deferimento: pctDeferimento,
        qualidade: avgConf, sancao: taxaSancao, total: overview?.total_deliberacoes ?? 0,
      }];
    }

    // Global: uma linha por agência com números REAIS (endpoint por-agência).
    // Só mostra agências que têm deliberações — evita o antigo "68 idêntico" para
    // ANA/ANAC/... sem dados.
    const porAgencia = govAgencias?.por_agencia ?? [];
    return porAgencia
      .filter((a) => a.total > 0)
      .map((a) => ({
        id: a.agencia_id, sigla: a.sigla, nome: a.nome,
        score: calcScore(a.consenso, a.deferimento, a.qualidade, a.sancao),
        consenso: a.consenso, deferimento: a.deferimento,
        qualidade: a.qualidade, sancao: a.sancao, total: a.total,
      }))
      .sort((x, y) => y.total - x.total);
  }, [agencias, agenciaId, taxaConsenso, pctDeferimento, avgConf, taxaSancao, overview, govAgencias]);

  // ── Alerts ───────────────────────────────────────────────────────────────

  const alerts: { label: string; detail: string; level: "warn" | "error" }[] = [];
  if (globalScore < 70)       alerts.push({ label: "Score abaixo do limiar", detail: `Score de governança: ${globalScore}/100`, level: "warn" });
  if (taxaSancao > 30)        alerts.push({ label: "Alta taxa de sanções", detail: `${taxaSancao.toFixed(1)}% de multas/indeferimentos`, level: "error" });
  if (avgConf < 70)           alerts.push({ label: "Qualidade IA baixa", detail: `Confiança média: ${avgConf.toFixed(0)}%`, level: "warn" });
  if (taxaConsenso < 80)      alerts.push({ label: "Baixo consenso no colegiado", detail: `Taxa de consenso: ${taxaConsenso.toFixed(1)}%`, level: "warn" });
  if (coberturaDoc < 60)      alerts.push({ label: "Cobertura documental insuficiente", detail: `${coberturaDoc}% com resumo/fundamento preenchidos`, level: "warn" });

  // ── Tendência (evolução mensal) ───────────────────────────────────────────
  const evolucao = analytics?.evolucao_mensal ?? [];
  const scoreEvolution = evolucao.map((e) => {
    const pctDef = e.total > 0 ? (e.deferido / e.total) * 100 : 0;
    // Approx score per period (no per-period consenso/sancao, use global)
    const s = calcScore(taxaConsenso, pctDef, avgConf, taxaSancao);
    return { name: e.period, score: s, total: e.total };
  });

  const kpis = [
    { label: "Score de Qualidade",    value: `${globalScore}`,               suffix: "/100", icon: ShieldCheck, color: scoreColor(globalScore) },
    { label: "Taxa de Consenso",      value: `${taxaConsenso.toFixed(1)}`,   suffix: "%",    icon: Users,       color: taxaConsenso >= 80 ? "text-success" : "text-warning" },
    { label: "Taxa de Deferimento",   value: `${pctDeferimento.toFixed(1)}`, suffix: "%",    icon: TrendingUp,  color: pctDeferimento >= 60 ? "text-success" : "text-warning" },
    { label: "Qualidade IA",          value: `${avgConf.toFixed(0)}`,        suffix: "%",    icon: Zap,         color: avgConf >= 70 ? "text-success" : "text-warning" },
    { label: "Taxa de Sanções",       value: `${taxaSancao.toFixed(1)}`,     suffix: "%",    icon: AlertTriangle, color: taxaSancao <= 20 ? "text-success" : taxaSancao <= 30 ? "text-warning" : "text-error" },
    { label: "Cobertura Documental",  value: `${coberturaDoc}`,              suffix: "%",    icon: Database,    color: coberturaDoc >= 60 ? "text-success" : "text-warning" },
  ];

  return (
    <div className="space-y-8 animate-fade-in">
      <ModuleTabs tabs={ANALISE_TABS} />
      {/* Header */}
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-xl font-semibold text-text-primary">Governança Regulatória</h1>
          <p className="text-sm text-text-muted mt-1">Qualidade institucional e conformidade das agências reguladoras</p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <select className="input text-sm h-9 py-0" value={agenciaId} onChange={(e) => setAgenciaId(e.target.value)}>
            <option value="">Todas as agências</option>
            {(agencias ?? []).map((a) => <option key={a.id} value={a.id}>{a.sigla}</option>)}
          </select>
          <select className="input text-sm h-9 py-0" value={year} onChange={(e) => setYear(e.target.value)}>
            <option value="">Todos os anos</option>
            {ANOS.map((y) => <option key={y} value={String(y)}>{y}</option>)}
          </select>
        </div>
      </div>

      {/* Score Hero */}
      <div className={cn("card border flex items-center gap-5", scoreBg(globalScore))}>
        <div className="w-16 h-16 rounded-full flex items-center justify-center bg-bg-card border border-border shrink-0">
          <ShieldCheck className={cn("w-8 h-8", scoreColor(globalScore))} />
        </div>
        <div>
          <p className="text-xs text-text-muted font-mono uppercase tracking-wider">Score de Governança</p>
          <div className="flex items-baseline gap-2 mt-0.5">
            <span className={cn("text-4xl font-mono font-bold", scoreColor(globalScore))}>{globalScore}</span>
            <span className="text-text-muted text-sm">/100</span>
            <span className={cn("badge text-xs ml-2", scoreColor(globalScore), scoreBg(globalScore))}>{scoreLabel(globalScore)}</span>
          </div>
          <p className="text-xs text-text-muted mt-1">
            Consenso 30% · Deferimento 25% · Qualidade IA 25% · Sanções 20%
          </p>
        </div>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
        {kpis.map((k) => {
          const Icon = k.icon;
          return (
            <div key={k.label} className="card">
              <div className="flex items-center gap-2 mb-2">
                <Icon className={cn("w-4 h-4", k.color)} />
                <p className="text-xs text-text-muted font-mono uppercase tracking-wider">{k.label}</p>
              </div>
              <div className="flex items-baseline gap-1">
                <span className={cn("text-2xl font-mono font-bold", k.color)}>{k.value}</span>
                <span className="text-text-muted text-sm">{k.suffix}</span>
              </div>
            </div>
          );
        })}
      </div>

      {/* Alertas de Conformidade */}
      {alerts.length > 0 && (
        <div className="card space-y-2">
          <div className="flex items-center gap-2 mb-2">
            <AlertTriangle className="w-4 h-4 text-warning" />
            <p className="text-sm font-medium text-text-secondary">
              Alertas de Conformidade ({alerts.length})
            </p>
          </div>
          {alerts.map((a, i) => (
            <div
              key={i}
              className={cn(
                "flex items-start gap-3 p-3 rounded-md border text-sm",
                a.level === "error"
                  ? "bg-error/10 border-error/20 text-error"
                  : "bg-warning/10 border-warning/20 text-warning"
              )}
            >
              <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
              <div>
                <p className="font-medium">{a.label}</p>
                <p className="text-xs opacity-80 mt-0.5">{a.detail}</p>
              </div>
            </div>
          ))}
          {alerts.length === 0 && (
            <div className="flex items-center gap-2 p-3 rounded-md bg-success/10 border border-success/20 text-success text-sm">
              <CheckCircle className="w-4 h-4" />
              Nenhum alerta. Todos os indicadores dentro do limiar.
            </div>
          )}
        </div>
      )}
      {alerts.length === 0 && (
        <div className="flex items-center gap-2 p-4 rounded-md bg-success/10 border border-success/20 text-success text-sm">
          <CheckCircle className="w-4 h-4 shrink-0" />
          <span>Todos os indicadores dentro dos limiares. Nenhum alerta de conformidade.</span>
        </div>
      )}

      {/* Evolução do Score */}
      {scoreEvolution.length > 0 && (
        <ChartWrapper
          title="Evolução do Score de Governança"
          subtitle="Estimativa mensal baseada em deferimento e qualidade dos dados"
          availableTypes={["area", "line", "bar"]}
          defaultType="area"
        >
          {(type) => {
            if (type === "bar") return <IrisBarChart data={scoreEvolution.map((e) => ({ name: e.name, value: e.score }))} height={240} />;
            return (
              <IrisAreaChart
                data={scoreEvolution.map((e) => ({ name: e.name, score: e.score }))}
                areas={[{ key: "score", color: "#f97316", label: "Score" }]}
                height={240}
              />
            );
          }}
        </ChartWrapper>
      )}

      {/* Indicadores por Agência */}
      <div className="card">
        <div className="flex items-center gap-2 mb-4">
          <Activity className="w-4 h-4 text-brand" />
          <p className="text-sm font-medium text-text-secondary">Indicadores por Agência</p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border">
                <th className="text-left text-xs text-text-muted font-mono uppercase tracking-wider py-2 pr-4">Agência</th>
                <th className="text-right text-xs text-text-muted font-mono uppercase tracking-wider py-2 px-3">Score</th>
                <th className="text-right text-xs text-text-muted font-mono uppercase tracking-wider py-2 px-3">Consenso</th>
                <th className="text-right text-xs text-text-muted font-mono uppercase tracking-wider py-2 px-3">Deferimento</th>
                <th className="text-right text-xs text-text-muted font-mono uppercase tracking-wider py-2 px-3">Qualidade IA</th>
                <th className="text-right text-xs text-text-muted font-mono uppercase tracking-wider py-2 px-3">Sanções</th>
                <th className="text-left text-xs text-text-muted font-mono uppercase tracking-wider py-2 px-3">Status</th>
              </tr>
            </thead>
            <tbody>
              {agencyScores.map((ag) => (
                <tr key={ag.id} className="border-b border-border/50 hover:bg-bg-hover transition-colors">
                  <td className="py-2.5 pr-4">
                    <div>
                      <p className="text-text-primary font-medium">{ag.sigla}</p>
                      <p className="text-xs text-text-muted">{ag.nome}</p>
                    </div>
                  </td>
                  <td className="py-2.5 px-3 text-right">
                    <span className={cn("font-mono font-bold text-base", scoreColor(ag.score))}>{ag.score}</span>
                  </td>
                  <td className="py-2.5 px-3 text-right font-mono text-text-secondary">{ag.consenso.toFixed(0)}%</td>
                  <td className="py-2.5 px-3 text-right font-mono text-text-secondary">{ag.deferimento.toFixed(0)}%</td>
                  <td className="py-2.5 px-3 text-right font-mono text-text-secondary">{ag.qualidade.toFixed(0)}%</td>
                  <td className="py-2.5 px-3 text-right font-mono text-text-secondary">{ag.sancao.toFixed(0)}%</td>
                  <td className="py-2.5 px-3">
                    <span className={cn("badge text-xs", scoreColor(ag.score), ag.score >= 80 ? "bg-success/10" : ag.score >= 60 ? "bg-warning/10" : "bg-error/10")}>
                      {scoreLabel(ag.score)}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="text-xs text-text-muted mt-3">
          Score = Consenso × 0,30 + Deferimento × 0,25 + Qualidade IA × 0,25 + (100 − Sanções) × 0,20
        </p>
      </div>
    </div>
  );
}
