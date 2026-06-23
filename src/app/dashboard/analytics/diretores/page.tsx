"use client";

import { useState, useMemo } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import type { DiretorOverviewItem, Deliberacao, DeliberacaoPaginada, Agencia, VotoMatrixRow } from "@/types";
import { IrisBarChart } from "@/components/charts/IrisBarChart";
import { IrisPieChart } from "@/components/charts/IrisPieChart";
import { IrisHeatmap } from "@/components/charts/IrisHeatmap";
import { ChartWrapper } from "@/components/charts/ChartWrapper";
import { getMicrotemaLabel, formatNumber, cn } from "@/lib/utils";
import { RadarChart, Radar, PolarGrid, PolarAngleAxis, ResponsiveContainer, Tooltip, Legend } from "recharts";
import { Users, Grid3x3, Handshake, BarChart3 } from "lucide-react";
import { ModuleTabs } from "@/components/ui/ModuleTabs";
import { DIRETORES_TABS } from "@/lib/module-tabs";

const MICROTEMA_COLORS = [
  "#f97316","#3b82f6","#22c55e","#8b5cf6","#ef4444",
  "#06b6d4","#f59e0b","#10b981","#ec4899","#84cc16",
  "#0ea5e9","#a78bfa","#fb7185",
];

function shortName(nome: string) {
  const parts = nome.trim().split(" ");
  if (parts.length <= 2) return nome;
  return `${parts[0]} ${parts[parts.length - 1]}`;
}

export default function AnalyticsDiretoresPage() {
  const [agenciaId, setAgenciaId] = useState("");

  const { data: agencias } = useQuery({
    queryKey: ["agencias"],
    queryFn: () => api.get<Agencia[]>("/agencias"),
  });

  const { data: diretores, isLoading: loadDir } = useQuery({
    queryKey: ["dashboard", "diretores-overview", agenciaId],
    queryFn: () => api.get<DiretorOverviewItem[]>(
      `/dashboard/diretores/overview${agenciaId ? `?agencia_id=${agenciaId}` : ""}`
    ),
  });

  const { data: matrix, isLoading: loadMatrix } = useQuery({
    queryKey: ["votacao", "matrix", agenciaId],
    queryFn: () => api.get<VotoMatrixRow[]>(
      `/votacao/matrix${agenciaId ? `?agencia_id=${agenciaId}` : ""}`
    ),
  });

  // Fetch deliberações with votos for heatmap + correlation
  const { data: deliberacoesPag, isLoading: loadDelibs } = useQuery({
    queryKey: ["deliberacoes-heatmap", agenciaId],
    queryFn: () => api.get<DeliberacaoPaginada>(
      `/deliberacoes?limit=200${agenciaId ? `&agencia_id=${agenciaId}` : ""}`
    ),
  });
  const deliberacoes: Deliberacao[] = deliberacoesPag?.data ?? [];

  // ── Heatmap: Diretor × Microtema ─────────────────────────────────────────
  const heatmapData = useMemo(() => {
    const counts = new Map<string, number>();
    for (const d of deliberacoes) {
      const tema = d.microtema;
      if (!tema || !d.votos?.length) continue;
      for (const v of d.votos) {
        if (!v.diretor_nome) continue;
        const key = `${v.diretor_nome}::${tema}`;
        counts.set(key, (counts.get(key) ?? 0) + 1);
      }
    }
    return Array.from(counts.entries()).map(([key, value]) => {
      const [row, col] = key.split("::");
      return { row, col, value };
    });
  }, [deliberacoes]);

  const heatRows = useMemo(() => [...new Set(heatmapData.map((d) => d.row))].sort(), [heatmapData]);
  const heatCols = useMemo(() => [...new Set(heatmapData.map((d) => d.col))].sort(), [heatmapData]);

  // ── Diversidade Temática ──────────────────────────────────────────────────
  const diversidadeData = useMemo(() => {
    const dirMap = new Map<string, Set<string>>();
    for (const d of deliberacoes) {
      if (!d.microtema || !d.votos?.length) continue;
      for (const v of d.votos) {
        const nome = v.diretor_nome ?? "";
        if (!nome) continue;
        if (!dirMap.has(nome)) dirMap.set(nome, new Set());
        dirMap.get(nome)!.add(d.microtema);
      }
    }
    return [...dirMap.entries()]
      .map(([name, temas]) => ({ name: shortName(name), value: temas.size }))
      .sort((a, b) => b.value - a.value);
  }, [deliberacoes]);

  // ── Correlação entre Diretores ────────────────────────────────────────────
  const correlacaoData = useMemo(() => {
    // For each deliberação, collect the set of directors who voted
    // Concordance: both voted, AND voted same direction (favorável = deferido; else = desfavorável)
    const pairs = new Map<string, { concordam: number; total: number }>();

    for (const d of deliberacoes) {
      const votos = d.votos ?? [];
      if (votos.length < 2) continue;
      for (let i = 0; i < votos.length; i++) {
        for (let j = i + 1; j < votos.length; j++) {
          const a = votos[i];
          const b = votos[j];
          if (!a.diretor_nome || !b.diretor_nome) continue;
          const pairKey = [shortName(a.diretor_nome), shortName(b.diretor_nome)].sort().join(" × ");
          const entry = pairs.get(pairKey) ?? { concordam: 0, total: 0 };
          entry.total++;
          // Consider concordance: same is_divergente flag means they diverged together (both against majority) or both with majority
          const sameDir = a.is_divergente === b.is_divergente;
          if (sameDir) entry.concordam++;
          pairs.set(pairKey, entry);
        }
      }
    }

    return [...pairs.entries()]
      .filter(([, v]) => v.total >= 2)
      .map(([pair, v]) => ({
        pair,
        concordam: v.concordam,
        total: v.total,
        pct: Math.round((v.concordam / v.total) * 100),
      }))
      .sort((a, b) => b.total - a.total)
      .slice(0, 20);
  }, [deliberacoes]);

  // ── Perfil Comparativo (Radar) ────────────────────────────────────────────
  const radarData = useMemo(() => {
    const dirs = diretores ?? [];
    if (!dirs.length) return { metrics: [], dirs: [] };

    const maxTotal = Math.max(1, ...dirs.map((d) => d.total));

    const metrics = ["Participações", "% Favorável", "% Divergente", "Diversidade"];
    const diversMap = new Map(diversidadeData.map((d) => [d.name, d.value]));
    const maxDiv = Math.max(1, ...diversidadeData.map((d) => d.value));

    const radarRows = metrics.map((metric) => {
      const row: Record<string, string | number> = { metric };
      dirs.slice(0, 5).forEach((d) => {
        const sn = shortName(d.diretor_nome);
        if (metric === "Participações")   row[sn] = Math.round((d.total / maxTotal) * 100);
        if (metric === "% Favorável")     row[sn] = d.pct_favor;
        if (metric === "% Divergente")    row[sn] = Math.round(((d.divergente / Math.max(1, d.total)) * 100));
        if (metric === "Diversidade")     row[sn] = Math.round(((diversMap.get(sn) ?? 0) / maxDiv) * 100);
      });
      return row;
    });

    return {
      metrics: radarRows,
      dirs: dirs.slice(0, 5).map((d, i) => ({
        key: shortName(d.diretor_nome),
        color: MICROTEMA_COLORS[i % MICROTEMA_COLORS.length],
      })),
    };
  }, [diretores, diversidadeData]);

  const RADAR_COLORS = MICROTEMA_COLORS;

  return (
    <div className="space-y-8 animate-fade-in">
      <ModuleTabs tabs={DIRETORES_TABS} />
      {/* Header */}
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-xl font-semibold text-text-primary">Analytics por Diretor</h1>
          <p className="text-sm text-text-muted mt-1">Heatmap, correlações e perfil comparativo dos diretores</p>
        </div>
        <select className="input text-sm h-9 py-0" value={agenciaId} onChange={(e) => setAgenciaId(e.target.value)}>
          <option value="">Todas as agências</option>
          {(agencias ?? []).map((a) => (
            <option key={a.id} value={a.id}>{a.sigla}</option>
          ))}
        </select>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <div className="card">
          <p className="text-xs text-text-muted font-mono uppercase tracking-wider mb-1">Diretores</p>
          <p className="text-2xl font-mono font-semibold text-text-primary">{(diretores ?? []).length}</p>
        </div>
        <div className="card">
          <p className="text-xs text-text-muted font-mono uppercase tracking-wider mb-1">Total Votos</p>
          <p className="text-2xl font-mono font-semibold text-text-primary">
            {formatNumber((diretores ?? []).reduce((s, d) => s + d.total, 0))}
          </p>
        </div>
        <div className="card">
          <p className="text-xs text-text-muted font-mono uppercase tracking-wider mb-1">Pares Analisados</p>
          <p className="text-2xl font-mono font-semibold text-text-primary">{correlacaoData.length}</p>
        </div>
        <div className="card">
          <p className="text-xs text-text-muted font-mono uppercase tracking-wider mb-1">Temas Cobertos</p>
          <p className="text-2xl font-mono font-semibold text-text-primary">{heatCols.length}</p>
        </div>
      </div>

      {/* Heatmap Diretor × Tema */}
      <div className="card">
        <div className="flex items-center gap-2 mb-4">
          <Grid3x3 className="w-4 h-4 text-brand" />
          <div>
            <p className="text-sm font-medium text-text-secondary">Heatmap: Diretor × Microtema</p>
            <p className="text-xs text-text-muted mt-0.5">Número de deliberações em que cada diretor votou por tema</p>
          </div>
        </div>
        {loadDelibs ? (
          <p className="text-sm text-text-muted">Carregando...</p>
        ) : heatmapData.length === 0 ? (
          <p className="text-sm text-text-muted">Sem dados de votação disponíveis</p>
        ) : (
          <IrisHeatmap
            rows={heatRows}
            cols={heatCols}
            data={heatmapData}
            formatColLabel={(c) => getMicrotemaLabel(c)}
            formatValue={(v) => String(v)}
            cellSize={44}
          />
        )}
      </div>

      {/* Diversidade Temática */}
      <ChartWrapper
        title="Diversidade Temática por Diretor"
        subtitle="Quantidade de microtemas distintos em que cada diretor atuou"
        availableTypes={["bar", "pie"]}
        defaultType="bar"
      >
        {(type) => {
          if (loadDelibs) return <div className="h-48 flex items-center justify-center text-text-muted text-sm">Carregando...</div>;
          if (!diversidadeData.length) return <div className="h-48 flex items-center justify-center text-text-muted text-sm">Sem dados</div>;
          if (type === "bar") return <IrisBarChart data={diversidadeData} horizontal height={240} />;
          return <IrisPieChart data={diversidadeData.map((d, i) => ({ ...d, color: MICROTEMA_COLORS[i % MICROTEMA_COLORS.length] }))} height={240} showLegend />;
        }}
      </ChartWrapper>

      {/* Perfil Comparativo — Radar */}
      <div className="card">
        <div className="flex items-center gap-2 mb-4">
          <BarChart3 className="w-4 h-4 text-brand" />
          <div>
            <p className="text-sm font-medium text-text-secondary">Perfil Comparativo (Top 5 Diretores)</p>
            <p className="text-xs text-text-muted mt-0.5">Participações, aprovação, divergência e diversidade normalizados 0-100</p>
          </div>
        </div>
        {loadDir ? (
          <div className="h-72 flex items-center justify-center text-text-muted text-sm">Carregando...</div>
        ) : radarData.dirs.length === 0 ? (
          <div className="h-72 flex items-center justify-center text-text-muted text-sm">Sem dados</div>
        ) : (
          <ResponsiveContainer width="100%" height={300}>
            <RadarChart data={radarData.metrics}>
              <PolarGrid stroke="#2a2a2a" />
              <PolarAngleAxis
                dataKey="metric"
                tick={{ fill: "#71717a", fontSize: 11, fontFamily: "JetBrains Mono" }}
              />
              <Tooltip
                contentStyle={{
                  background: "#1c1c1c",
                  border: "1px solid #2a2a2a",
                  borderRadius: 8,
                  fontSize: 12,
                }}
                labelStyle={{ color: "#a1a1aa" }}
                itemStyle={{ color: "#e4e4e7" }}
              />
              <Legend
                wrapperStyle={{ fontSize: 11, fontFamily: "JetBrains Mono", color: "#71717a" }}
              />
              {radarData.dirs.map((d, i) => (
                <Radar
                  key={d.key}
                  name={d.key}
                  dataKey={d.key}
                  stroke={d.color}
                  fill={d.color}
                  fillOpacity={0.08}
                  strokeWidth={2}
                />
              ))}
            </RadarChart>
          </ResponsiveContainer>
        )}
      </div>

      {/* Correlação entre Diretores */}
      <div className="card">
        <div className="flex items-center gap-2 mb-4">
          <Handshake className="w-4 h-4 text-brand" />
          <div>
            <p className="text-sm font-medium text-text-secondary">Correlação entre Diretores</p>
            <p className="text-xs text-text-muted mt-0.5">Taxa de concordância em deliberações com votação conjunta</p>
          </div>
        </div>
        {loadDelibs ? (
          <p className="text-sm text-text-muted">Carregando...</p>
        ) : correlacaoData.length === 0 ? (
          <p className="text-sm text-text-muted">Sem dados de votação conjunta suficientes</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border">
                  <th className="text-left text-xs text-text-muted font-mono uppercase tracking-wider py-2 pr-4">Par de Diretores</th>
                  <th className="text-right text-xs text-text-muted font-mono uppercase tracking-wider py-2 px-3">Deliberações</th>
                  <th className="text-right text-xs text-text-muted font-mono uppercase tracking-wider py-2 px-3">Concordam</th>
                  <th className="text-left text-xs text-text-muted font-mono uppercase tracking-wider py-2 px-3 min-w-[160px]">Taxa Concordância</th>
                </tr>
              </thead>
              <tbody>
                {correlacaoData.map((c) => (
                  <tr key={c.pair} className="border-b border-border/50 hover:bg-bg-hover transition-colors">
                    <td className="py-2.5 pr-4 text-text-primary font-medium">{c.pair}</td>
                    <td className="py-2.5 px-3 text-right font-mono text-text-secondary">{c.total}</td>
                    <td className="py-2.5 px-3 text-right font-mono text-text-secondary">{c.concordam}</td>
                    <td className="py-2.5 px-3 min-w-[160px]">
                      <div className="flex items-center gap-2">
                        <div className="flex-1 bg-bg-hover rounded-full h-1.5">
                          <div
                            className="h-1.5 rounded-full"
                            style={{
                              width: `${c.pct}%`,
                              background: c.pct >= 80 ? "#22c55e" : c.pct >= 60 ? "#f97316" : "#ef4444",
                            }}
                          />
                        </div>
                        <span className={cn(
                          "text-xs font-mono w-10 text-right",
                          c.pct >= 80 ? "text-success" : c.pct >= 60 ? "text-warning" : "text-error"
                        )}>
                          {c.pct}%
                        </span>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Tabela de Overview */}
      <div className="card">
        <div className="flex items-center gap-2 mb-4">
          <Users className="w-4 h-4 text-brand" />
          <p className="text-sm font-medium text-text-secondary">Visão Geral dos Diretores</p>
        </div>
        {loadDir || loadMatrix ? (
          <p className="text-sm text-text-muted">Carregando...</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border">
                  <th className="text-left text-xs text-text-muted font-mono uppercase tracking-wider py-2 pr-4">Diretor</th>
                  <th className="text-right text-xs text-text-muted font-mono uppercase tracking-wider py-2 px-3">Votos</th>
                  <th className="text-right text-xs text-text-muted font-mono uppercase tracking-wider py-2 px-3">Favoráveis</th>
                  <th className="text-right text-xs text-text-muted font-mono uppercase tracking-wider py-2 px-3">Divergentes</th>
                  <th className="text-left text-xs text-text-muted font-mono uppercase tracking-wider py-2 px-3 min-w-[140px]">% Favorável</th>
                </tr>
              </thead>
              <tbody>
                {(diretores ?? []).map((d) => (
                  <tr key={d.diretor_id} className="border-b border-border/50 hover:bg-bg-hover transition-colors">
                    <td className="py-2.5 pr-4 text-text-primary font-medium">
                      <Link href={`/dashboard/diretores/${d.diretor_id}`} className="hover:text-brand transition-colors">
                        {d.diretor_nome}
                      </Link>
                    </td>
                    <td className="py-2.5 px-3 text-right font-mono text-text-secondary">{formatNumber(d.total)}</td>
                    <td className="py-2.5 px-3 text-right font-mono text-success">{formatNumber(d.favoravel)}</td>
                    <td className="py-2.5 px-3 text-right font-mono text-error">{formatNumber(d.divergente)}</td>
                    <td className="py-2.5 px-3 min-w-[140px]">
                      <div className="flex items-center gap-2">
                        <div className="flex-1 bg-bg-hover rounded-full h-1.5">
                          <div
                            className="h-1.5 rounded-full"
                            style={{
                              width: `${d.pct_favor}%`,
                              background: d.pct_favor >= 70 ? "#22c55e" : "#f97316",
                            }}
                          />
                        </div>
                        <span className="text-xs font-mono text-text-secondary w-10 text-right">
                          {d.pct_favor.toFixed(0)}%
                        </span>
                      </div>
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
