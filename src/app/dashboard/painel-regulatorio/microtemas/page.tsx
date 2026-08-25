"use client";

import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { api, listaDe } from "@/lib/api";
import type { MicrotemaStats, Agencia } from "@/types";
import { getMicrotemaLabel, getMicrotemaColor, CATEGORIAS_REGULATORIAS, formatNumber } from "@/lib/utils";
import { ModuleTabs } from "@/components/ui/ModuleTabs";
import { REGULATORIO_TABS } from "@/lib/module-tabs";

const ANOS = Array.from({ length: 10 }, (_, i) => new Date().getFullYear() - i);

const CATEGORIA_COLORS: Record<string, string> = {
  "economico-financeiro":    "#f97316",
  "contratos-concessoes":    "#3b82f6",
  "controle-sancoes":        "#ef4444",
  "seguranca-ambiente":      "#22c55e",
  "usuarios-administrativo": "#8b5cf6",
};

export default function MicrotemasPage() {
  const [agenciaId, setAgenciaId]   = useState("");
  const [year, setYear]             = useState("");
  const [categoriaId, setCategoriaId] = useState("");

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

  // Map for quick lookup
  const microtemaMap = useMemo(() => {
    const m = new Map<string, MicrotemaStats>();
    microtemas.forEach((mt) => m.set(mt.microtema, mt));
    return m;
  }, [microtemas]);

  // Categories to display (filtered if categoria selected)
  const visibleCats = categoriaId
    ? CATEGORIAS_REGULATORIAS.filter((c) => c.id === categoriaId)
    : CATEGORIAS_REGULATORIAS;

  const totalDelibs = microtemas.reduce((s, m) => s + m.total, 0);

  return (
    <div className="space-y-6 animate-fade-in">
      <ModuleTabs tabs={REGULATORIO_TABS} />
      {/* Header */}
      <div>
        <h1 className="text-xl font-semibold text-text-primary">Microtemas Regulatórios</h1>
        <p className="text-sm text-text-muted mt-0.5">
          Microtemas identificados nas deliberações, agrupados por categoria regulatória
        </p>
      </div>

      {/* Filtros */}
      <div className="card">
        <div className="flex flex-wrap gap-2 items-center">
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
          {(agenciaId || year || categoriaId) && (
            <button
              className="text-xs text-text-muted hover:text-brand transition-colors"
              onClick={() => { setAgenciaId(""); setYear(""); setCategoriaId(""); }}
            >
              Limpar
            </button>
          )}
        </div>
      </div>

      {/* Summary KPIs */}
      <div className="grid grid-cols-3 gap-4">
        <div className="card">
          <p className="section-label mb-1">Total Deliberações</p>
          <p className="font-mono text-3xl text-text-primary">{formatNumber(totalDelibs)}</p>
        </div>
        <div className="card">
          <p className="section-label mb-1">Microtemas com dados</p>
          <p className="font-mono text-3xl text-text-primary">{microtemas.length}</p>
        </div>
        <div className="card">
          <p className="section-label mb-1">Categorias ativas</p>
          <p className="font-mono text-3xl text-text-primary">
            {CATEGORIAS_REGULATORIAS.filter((cat) =>
              cat.microtemas.some((mt) => microtemaMap.has(mt))
            ).length}
          </p>
        </div>
      </div>

      {/* Categories with microtema tables */}
      <div className="space-y-6">
        {visibleCats.map((cat) => {
          const catMicrotemas = cat.microtemas
            .map((mt) => microtemaMap.get(mt))
            .filter((m): m is MicrotemaStats => m !== undefined && m.total > 0);

          if (catMicrotemas.length === 0 && categoriaId !== cat.id) return null;

          const catTotal    = catMicrotemas.reduce((s, m) => s + m.total, 0);
          const catDeferido = catMicrotemas.reduce((s, m) => s + m.deferido, 0);
          const catPct      = catTotal > 0 ? (catDeferido / catTotal) * 100 : 0;

          return (
            <div key={cat.id} className="card space-y-4">
              {/* Category header */}
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div
                    className="w-3 h-3 rounded-full shrink-0"
                    style={{ backgroundColor: CATEGORIA_COLORS[cat.id] }}
                  />
                  <div>
                    <h2 className="text-base font-semibold text-text-primary">{cat.label}</h2>
                    <p className="text-xs text-text-muted">
                      {catMicrotemas.length} microtema{catMicrotemas.length !== 1 ? "s" : ""} · {catTotal} deliberações
                    </p>
                  </div>
                </div>
                {catTotal > 0 && (
                  <div className="text-right">
                    <p className="text-xs text-text-muted">Taxa deferimento</p>
                    <p className="font-mono text-lg text-success">{catPct.toFixed(1)}%</p>
                  </div>
                )}
              </div>

              {catMicrotemas.length === 0 ? (
                <p className="text-sm text-text-muted text-center py-4">
                  Nenhuma deliberação nesta categoria para os filtros selecionados
                </p>
              ) : (
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border">
                      {["Microtema", "Total", "Deferido", "Indeferido", "Taxa Deferimento", "Representação"].map((h) => (
                        <th key={h} className="px-3 py-2 text-left text-xs text-text-muted font-mono uppercase tracking-wider whitespace-nowrap">
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {catMicrotemas.sort((a, b) => b.total - a.total).map((m) => {
                      const pctOfCat = catTotal > 0 ? (m.total / catTotal) * 100 : 0;
                      const pctOfAll = totalDelibs > 0 ? (m.total / totalDelibs) * 100 : 0;
                      const color = getMicrotemaColor(m.microtema);
                      return (
                        <tr
                          key={m.microtema}
                          className="border-b border-border/50 hover:bg-bg-hover transition-colors"
                        >
                          <td className="px-3 py-3">
                            <div className="flex items-center gap-2">
                              <div className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: color }} />
                              <span className="font-medium text-text-primary">{getMicrotemaLabel(m.microtema)}</span>
                            </div>
                          </td>
                          <td className="px-3 py-3 font-mono text-text-primary">{m.total}</td>
                          <td className="px-3 py-3 font-mono text-success">{m.deferido}</td>
                          <td className="px-3 py-3 font-mono text-error">{m.indeferido}</td>
                          <td className="px-3 py-3">
                            <div className="flex items-center gap-2">
                              <div className="w-20 bg-bg-hover rounded-full h-1.5">
                                <div
                                  className="h-1.5 rounded-full bg-success"
                                  style={{ width: `${m.pct_deferido}%` }}
                                />
                              </div>
                              <span className="font-mono text-xs text-text-muted w-9 text-right">
                                {m.pct_deferido.toFixed(0)}%
                              </span>
                            </div>
                          </td>
                          <td className="px-3 py-3">
                            <div className="flex items-center gap-2">
                              <div className="w-20 bg-bg-hover rounded-full h-1.5">
                                <div
                                  className="h-1.5 rounded-full"
                                  style={{ width: `${pctOfAll}%`, backgroundColor: color }}
                                />
                              </div>
                              <span className="font-mono text-xs text-text-muted w-9 text-right">
                                {pctOfAll.toFixed(0)}%
                              </span>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
