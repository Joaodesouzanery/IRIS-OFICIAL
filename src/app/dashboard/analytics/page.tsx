"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api, listaDe } from "@/lib/api";
import type { MicrotemaStats, DiretorOverviewItem, Agencia } from "@/types";
import { IrisBarChart } from "@/components/charts/IrisBarChart";
import { GaugeChart } from "@/components/charts/GaugeChart";
import { getMicrotemaLabel, formatNumber } from "@/lib/utils";
import Link from "next/link";
import { BarChart3, Users, Building2 } from "lucide-react";
import { ModuleTabs } from "@/components/ui/ModuleTabs";
import { ANALISE_TABS } from "@/lib/module-tabs";

const ANOS = Array.from({ length: 10 }, (_, i) => new Date().getFullYear() - i);

export default function AnalyticsPage() {
  const [agenciaId, setAgenciaId] = useState("");
  const [year, setYear] = useState("");

  const params = new URLSearchParams();
  if (agenciaId) params.set("agencia_id", agenciaId);
  if (year) params.set("year", year);
  const qs = params.toString() ? `?${params.toString()}` : "";

  const { data: agencias } = useQuery({
    queryKey: ["agencias"],
    queryFn: async () => listaDe<Agencia>(await api.get("/agencias")),
  });

  const { data: microtemas } = useQuery({
    queryKey: ["dashboard", "microtemas", agenciaId, year],
    queryFn: async () => listaDe<MicrotemaStats>(await api.get(`/dashboard/microtemas${qs}`)),
  });

  const { data: diretores } = useQuery({
    queryKey: ["dashboard", "diretores-overview", agenciaId],
    queryFn: async () => listaDe<DiretorOverviewItem>(await api.get(`/dashboard/diretores/overview${agenciaId ? `?agencia_id=${agenciaId}` : ""}`)),
  });

  const maisIndeferido = (microtemas ?? []).reduce(
    (max, m) => (m.pct_indeferido > (max?.pct_indeferido ?? 0) ? m : max),
    null as MicrotemaStats | null
  );

  const maisDeferido = (microtemas ?? []).reduce(
    (max, m) => (m.pct_deferido > (max?.pct_deferido ?? 0) ? m : max),
    null as MicrotemaStats | null
  );

  const rankingData = (microtemas ?? []).map((m) => ({
    name: m.microtema,
    value: m.total,
  }));

  return (
    <div className="space-y-8 animate-fade-in">
      <ModuleTabs tabs={ANALISE_TABS} />
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-xl font-semibold text-text-primary">Analytics</h1>
          <p className="text-sm text-text-muted mt-1">Métricas analíticas por tema e diretor</p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {/* Filtros */}
          <select
            className="select w-40 text-xs"
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
          <Link href="/dashboard/analytics/diretores" className="btn-secondary text-xs">
            <Users className="w-3.5 h-3.5" /> Por Diretor
          </Link>
          <Link href="/dashboard/analytics/temas" className="btn-secondary text-xs">
            <BarChart3 className="w-3.5 h-3.5" /> Por Tema
          </Link>
          <Link href="/dashboard/analytics/institucional" className="btn-secondary text-xs">
            <Building2 className="w-3.5 h-3.5" /> Institucional
          </Link>
        </div>
      </div>

      {/* SEÇÃO: Métricas por Tema */}
      <section>
        <p className="section-label mb-4">Métricas por Tema</p>

        <div className="grid grid-cols-2 gap-4 mb-4">
          {maisIndeferido && (
            <div className="card border-error/30">
              <p className="section-label text-error/70 mb-2">Tema com mais indeferimentos</p>
              <p className="text-lg font-semibold text-text-primary">
                {getMicrotemaLabel(maisIndeferido.microtema)}
              </p>
              <p className="font-mono text-2xl text-error mt-1">
                {maisIndeferido.pct_indeferido.toFixed(1)}%
              </p>
              <p className="text-xs text-text-muted mt-1">
                {formatNumber(maisIndeferido.indeferido)} de {formatNumber(maisIndeferido.total)} deliberações
              </p>
            </div>
          )}
          {maisDeferido && (
            <div className="card border-success/30">
              <p className="section-label text-success/70 mb-2">Tema com mais deferimentos</p>
              <p className="text-lg font-semibold text-text-primary">
                {getMicrotemaLabel(maisDeferido.microtema)}
              </p>
              <p className="font-mono text-2xl text-success mt-1">
                {maisDeferido.pct_deferido.toFixed(1)}%
              </p>
              <p className="text-xs text-text-muted mt-1">
                {formatNumber(maisDeferido.deferido)} de {formatNumber(maisDeferido.total)} deliberações
              </p>
            </div>
          )}
        </div>

        <div className="card">
          <p className="text-sm font-medium text-text-secondary mb-4">
            Ranking: Temas mais recorrentes
          </p>
          <IrisBarChart
            data={rankingData}
            horizontal
            height={Math.max(200, rankingData.length * 36)}
            useMicrotemaColors
            formatLabel={getMicrotemaLabel}
          />
        </div>
      </section>

      {/* SEÇÃO: Métricas por Diretor */}
      <section>
        <p className="section-label mb-4">Métricas por Diretor</p>
        <div className="grid grid-cols-3 gap-4">
          {(diretores ?? []).slice(0, 3).map((d) => (
            <div key={d.diretor_id} className="card-hover">
              <p className="text-sm font-semibold text-text-primary mb-3 truncate">
                {d.diretor_nome}
              </p>
              <GaugeChart
                value={d.pct_favor}
                label="Taxa Favorável"
                size={150}
              />
              <div className="mt-3 space-y-1">
                <div className="flex justify-between text-xs">
                  <span className="text-text-muted">Total de votos</span>
                  <span className="font-mono text-text-primary">{formatNumber(d.total)}</span>
                </div>
                <div className="flex justify-between text-xs">
                  <span className="text-text-muted">Favoráveis</span>
                  <span className="font-mono text-success">{formatNumber(d.favoravel)}</span>
                </div>
              </div>
            </div>
          ))}
        </div>
        <div className="mt-3 text-right">
          <Link href="/dashboard/analytics/diretores" className="text-xs text-brand hover:underline">
            Ver análise completa por diretor →
          </Link>
        </div>
      </section>
    </div>
  );
}
