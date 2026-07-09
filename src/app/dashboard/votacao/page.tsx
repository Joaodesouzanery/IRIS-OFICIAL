"use client";

import { useState } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { formatNumber, getMicrotemaLabel } from "@/lib/utils";
import type { VotoMatrixRow, VotoDistribution, Agencia } from "@/types";
import { IrisPieChart } from "@/components/charts/IrisPieChart";
import { IrisLineChart } from "@/components/charts/IrisLineChart";
import { ModuleTabs } from "@/components/ui/ModuleTabs";
import { DIRETORES_TABS } from "@/lib/module-tabs";

const TIPO_VOTO_COLORS: Record<string, string> = {
  Favoravel: "#22c55e",
  Desfavoravel: "#ef4444",
  Abstencao: "#eab308",
  Ausente: "#71717a",
};

const TIPO_VOTO_LABELS: Record<string, string> = {
  Favoravel: "Favorável",
  Desfavoravel: "Desfavorável",
  Abstencao: "Abstenção",
  Ausente: "Ausente",
};

const MICROTEMAS = [
  "tarifa", "obras", "multa", "contrato", "reequilibrio", "fiscalizacao", "seguranca",
  "ambiental", "desapropriacao", "adimplencia", "pessoal", "usuario",
  "lavra", "pesquisa", "licenciamento", "servidao", "cfem", "disponibilidade", "recursos", "outros",
];

type ConsensoPoint = { period: string; total_itens: number; consensuais: number; divergentes: number; pct_consenso: number; cobertura_nominal?: number };

export default function VotacaoPage() {
  const [agenciaId, setAgenciaId] = useState("");
  const [microtema, setMicrotema] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");

  const qs = new URLSearchParams();
  if (agenciaId) qs.set("agencia_id", agenciaId);
  if (microtema) qs.set("microtema", microtema);
  if (dateFrom) qs.set("date_from", dateFrom);
  if (dateTo) qs.set("date_to", dateTo);
  const qsStr = qs.toString() ? `?${qs.toString()}` : "";

  const { data: agencias } = useQuery({
    queryKey: ["agencias"],
    queryFn: () => api.get<Agencia[]>("/agencias"),
  });

  const { data: matrix } = useQuery({
    queryKey: ["votacao", "matrix", qsStr],
    queryFn: () => api.get<VotoMatrixRow[]>(`/votacao/matrix${qsStr}`),
  });

  const { data: distribution } = useQuery({
    queryKey: ["votacao", "distribution", qsStr],
    queryFn: () => api.get<VotoDistribution[]>(`/votacao/distribution${qsStr}`),
  });

  const { data: timeline } = useQuery({
    queryKey: ["votacao", "consenso-timeline", qsStr],
    queryFn: () => api.get<ConsensoPoint[]>(`/votacao/consenso-timeline${qsStr}`),
  });

  const pieData = (distribution ?? []).map((d) => ({
    name: TIPO_VOTO_LABELS[d.tipo_voto] ?? d.tipo_voto,
    value: d.count,
    color: TIPO_VOTO_COLORS[d.tipo_voto] ?? "#71717a",
  }));

  const timelineData = (timeline ?? []).map((p) => ({ name: p.period, "Consenso (%)": p.pct_consenso }));

  return (
    <div className="space-y-6 animate-fade-in">
      <ModuleTabs tabs={DIRETORES_TABS} />
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-xl font-semibold text-text-primary">Votação</h1>
          <p className="text-sm text-text-muted mt-1">
            Análise de votos e posicionamentos dos diretores
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <select className="select w-36" value={agenciaId} onChange={(e) => setAgenciaId(e.target.value)}>
            <option value="">Todas as agências</option>
            {(agencias ?? []).map((a) => <option key={a.id} value={a.id}>{a.sigla}</option>)}
          </select>
          <select className="select w-40" value={microtema} onChange={(e) => setMicrotema(e.target.value)}>
            <option value="">Todos os microtemas</option>
            {MICROTEMAS.map((m) => <option key={m} value={m}>{getMicrotemaLabel(m)}</option>)}
          </select>
          <input type="date" className="input w-36 text-xs font-mono" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} title="De" />
          <input type="date" className="input w-36 text-xs font-mono" value={dateTo} onChange={(e) => setDateTo(e.target.value)} title="Até" />
        </div>
      </div>

      {/* Tendência de consenso */}
      <div className="card">
        <p className="section-label mb-3">Tendência de consenso do colegiado (% sem divergência)</p>
        {timelineData.length > 0 ? (
          <IrisLineChart data={timelineData} lines={[{ key: "Consenso (%)", color: "#22c55e", label: "Consenso (%)" }]} />
        ) : (
          <p className="text-sm text-text-muted">Sem dados de consenso no período.</p>
        )}
        {(() => {
          // Confiabilidade: média ponderada da cobertura nominal. Sem base nominal, o
          // consenso é majoritariamente inferido (favorável por unanimidade) → avisa.
          const pts = timeline ?? [];
          const tot = pts.reduce((s, p) => s + p.total_itens, 0);
          const cob = tot ? Math.round((pts.reduce((s, p) => s + ((p.cobertura_nominal ?? 0) / 100) * p.total_itens, 0) / tot) * 1000) / 10 : null;
          if (cob == null || cob >= 30) return null;
          return (
            <p className="text-[11px] text-warning mt-2">
              Base nominal de apenas {cob.toFixed(0)}% — o consenso é majoritariamente <strong>inferido</strong> (voto favorável por unanimidade, não lido individualmente). Interprete com cautela.
            </p>
          );
        })()}
      </div>

      {/* Gráficos superiores */}
      <div className="grid grid-cols-3 gap-4">
        {/* Distribuição por tipo */}
        <div className="card col-span-1">
          <p className="section-label mb-3">Distribuição de Votos</p>
          <IrisPieChart data={pieData} height={200} innerRadius={55} />
          <div className="mt-3 space-y-1.5">
            {(distribution ?? []).map((d) => (
              <div key={d.tipo_voto} className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <div
                    className="w-2 h-2 rounded-full"
                    style={{ background: TIPO_VOTO_COLORS[d.tipo_voto] ?? "#71717a" }}
                  />
                  <span className="text-xs text-text-secondary">
                    {TIPO_VOTO_LABELS[d.tipo_voto] ?? d.tipo_voto}
                  </span>
                </div>
                <span className="font-mono text-xs text-text-primary font-medium">
                  {formatNumber(d.count)}
                </span>
              </div>
            ))}
          </div>
        </div>

        {/* Resumo */}
        <div className="card col-span-2">
          <p className="section-label mb-1">Resumo do Colegiado</p>
          <div className="grid grid-cols-2 gap-4 mt-3">
            <div className="text-center p-4 rounded-md bg-bg-hover">
              <p className="metric-value text-text-primary">
                {(distribution ?? []).reduce((s, d) => s + d.count, 0).toLocaleString("pt-BR")}
              </p>
              <p className="text-xs text-text-muted mt-1">Total de Votos</p>
            </div>
            <div className="text-center p-4 rounded-md bg-bg-hover">
              <p className="metric-value text-success">
                {distribution?.find((d) => d.tipo_voto === "Favoravel")?.count ?? 0}
              </p>
              <p className="text-xs text-text-muted mt-1">Votos Favoráveis</p>
            </div>
          </div>
        </div>
      </div>

      {/* Matriz de Votação */}
      <div className="card p-0 overflow-hidden">
        <div className="px-4 py-3 border-b border-border">
          <p className="section-label">Matriz de Votação por Diretor</p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-border">
                {["Diretor", "Favorável", "Desfavorável", "Abstenção", "Divergente", "Total"].map((h) => (
                  <th key={h} className="px-4 py-3 text-left text-label text-text-muted font-mono whitespace-nowrap">
                    {h.toUpperCase()}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {(matrix ?? []).length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-4 py-12 text-center text-text-muted text-sm">
                    Nenhum dado de votação disponível
                  </td>
                </tr>
              ) : (
                (matrix ?? []).map((row) => (
                  <tr key={row.diretor_id} className="border-b border-border/50 hover:bg-bg-hover transition-colors">
                    <td className="px-4 py-3 text-sm text-text-primary font-medium max-w-[200px] truncate">
                      <Link href={`/dashboard/diretores/${row.diretor_id}`} className="hover:text-brand transition-colors">
                        {row.diretor_nome}
                      </Link>
                    </td>
                    <td className="px-4 py-3 font-mono text-sm text-success">{row.favoravel}</td>
                    <td className="px-4 py-3 font-mono text-sm text-error">{row.desfavoravel}</td>
                    <td className="px-4 py-3 font-mono text-sm text-warning">{row.abstencao}</td>
                    <td className="px-4 py-3 font-mono text-sm">
                      {row.divergente > 0 ? (
                        <span className="badge-red">{row.divergente}</span>
                      ) : (
                        <span className="text-text-muted">0</span>
                      )}
                    </td>
                    <td className="px-4 py-3 font-mono text-sm font-semibold text-brand">{row.total}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
