"use client";

import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { api, listaDe } from "@/lib/api";
import type { MicrotemaStats, Agencia } from "@/types";
import { IrisBarChart } from "@/components/charts/IrisBarChart";
import { getMicrotemaLabel, getMicrotemaColor, getMicrotemaCategoriaLabel, formatNumber } from "@/lib/utils";
import { cn } from "@/lib/utils";
import { ModuleTabs } from "@/components/ui/ModuleTabs";
import { REGULATORIO_TABS } from "@/lib/module-tabs";

interface VotacaoSector {
  microtema: string;
  count: number;
}

const ANOS = Array.from({ length: 10 }, (_, i) => new Date().getFullYear() - i);

export default function SetoresPage() {
  const [agenciaId, setAgenciaId] = useState("");
  const [year, setYear]           = useState("");

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

  const { data: sectors = [] } = useQuery({
    queryKey: ["votacao", "sectors", agenciaId, year],
    queryFn: async () => listaDe<VotacaoSector>(await api.get(`/votacao/sectors${agenciaId ? `?agencia_id=${agenciaId}` : ""}`)),
  });

  // Vote count per sector map
  const votesMap = useMemo(() => {
    const m = new Map<string, number>();
    sectors.forEach((s) => m.set(s.microtema, s.count));
    return m;
  }, [sectors]);

  // Bar chart data for deliberações
  const deliberacoesBarData = microtemas.map((m) => ({
    name: m.microtema,
    value: m.total,
  }));

  // Bar chart data for votos
  const votosBarData = sectors.map((s) => ({
    name: s.microtema,
    value: s.count,
  }));

  const totalDelibs = microtemas.reduce((s, m) => s + m.total, 0);
  const totalVotos  = sectors.reduce((s, v) => s + v.count, 0);

  return (
    <div className="space-y-6 animate-fade-in">
      <ModuleTabs tabs={REGULATORIO_TABS} />
      {/* Header */}
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-xl font-semibold text-text-primary">Setores Regulados</h1>
          <p className="text-sm text-text-muted mt-0.5">
            Deliberações e votos por setor regulatório
          </p>
        </div>
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
          {(agenciaId || year) && (
            <button
              className="text-xs text-text-muted hover:text-brand transition-colors"
              onClick={() => { setAgenciaId(""); setYear(""); }}
            >
              Limpar
            </button>
          )}
        </div>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-3 gap-4">
        <div className="card">
          <p className="section-label mb-1">Total Deliberações</p>
          <p className="font-mono text-3xl text-text-primary">{formatNumber(totalDelibs)}</p>
        </div>
        <div className="card">
          <p className="section-label mb-1">Total Votos</p>
          <p className="font-mono text-3xl text-text-primary">{formatNumber(totalVotos)}</p>
        </div>
        <div className="card">
          <p className="section-label mb-1">Setores Ativos</p>
          <p className="font-mono text-3xl text-text-primary">{microtemas.filter((m) => m.total > 0).length}</p>
        </div>
      </div>

      {/* Charts */}
      <div className="grid grid-cols-2 gap-4">
        <div className="card">
          <p className="text-sm font-medium text-text-secondary mb-3">Deliberações por Setor</p>
          {deliberacoesBarData.length > 0 ? (
            <IrisBarChart
              data={deliberacoesBarData}
              horizontal
              height={Math.max(180, deliberacoesBarData.length * 36)}
              useMicrotemaColors
              formatLabel={getMicrotemaLabel}
            />
          ) : (
            <p className="text-sm text-text-muted text-center py-12">Sem dados</p>
          )}
        </div>
        <div className="card">
          <p className="text-sm font-medium text-text-secondary mb-3">Votos por Setor</p>
          {votosBarData.length > 0 ? (
            <IrisBarChart
              data={votosBarData}
              horizontal
              height={Math.max(180, votosBarData.length * 36)}
              useMicrotemaColors
              formatLabel={getMicrotemaLabel}
            />
          ) : (
            <p className="text-sm text-text-muted text-center py-12">Sem dados</p>
          )}
        </div>
      </div>

      {/* Sector cards grid */}
      <div>
        <p className="section-label mb-3">Detalhamento por Setor</p>
        {microtemas.length === 0 ? (
          <div className="card py-12 text-center text-sm text-text-muted">
            Nenhum setor encontrado para os filtros selecionados
          </div>
        ) : (
          <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
            {microtemas.map((m) => {
              const votos = votesMap.get(m.microtema) ?? 0;
              const color = getMicrotemaColor(m.microtema);
              return (
                <div key={m.microtema} className="card space-y-3">
                  <div className="flex items-start justify-between">
                    <div>
                      <div className="flex items-center gap-2 mb-1">
                        <div className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: color }} />
                        <span className="text-sm font-semibold text-text-primary">
                          {getMicrotemaLabel(m.microtema)}
                        </span>
                      </div>
                      <p className="text-xs text-text-muted ml-4.5">
                        {getMicrotemaCategoriaLabel(m.microtema)}
                      </p>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-2 text-center">
                    <div className="bg-bg-hover rounded-md py-2">
                      <p className="font-mono text-xl text-text-primary">{m.total}</p>
                      <p className="text-xs text-text-muted">deliberações</p>
                    </div>
                    <div className="bg-bg-hover rounded-md py-2">
                      <p className="font-mono text-xl text-text-primary">{votos}</p>
                      <p className="text-xs text-text-muted">votos</p>
                    </div>
                  </div>

                  <div className="space-y-1">
                    <div className="flex justify-between text-xs">
                      <span className="text-success">Deferido</span>
                      <span className="font-mono text-success">{m.deferido} ({m.pct_deferido.toFixed(0)}%)</span>
                    </div>
                    {m.indeferido > 0 && (
                      <div className="flex justify-between text-xs">
                        <span className="text-error">Indeferido</span>
                        <span className="font-mono text-error">{m.indeferido} ({m.pct_indeferido.toFixed(0)}%)</span>
                      </div>
                    )}
                    <div className="w-full bg-bg-hover rounded-full h-1.5 mt-1">
                      <div
                        className="h-1.5 rounded-full bg-success"
                        style={{ width: `${m.pct_deferido}%` }}
                      />
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
