"use client";

import { useQuery } from "@tanstack/react-query";
import { api, listaDe } from "@/lib/api";
import type { VotoMatrixRow, MicrotemaStats } from "@/types";
import { getMicrotemaLabel, cn } from "@/lib/utils";
import { Lightbulb, TrendingUp, AlertTriangle } from "lucide-react";
import { ModuleTabs } from "@/components/ui/ModuleTabs";
import { ANALISE_TABS } from "@/lib/module-tabs";

export default function InsightsPage() {
  const { data: matrix } = useQuery({
    queryKey: ["votacao", "matrix"],
    queryFn: async () => listaDe<VotoMatrixRow>(await api.get("/votacao/matrix")),
  });

  const { data: microtemas } = useQuery({
    queryKey: ["dashboard", "microtemas"],
    queryFn: async () => listaDe<MicrotemaStats>(await api.get("/dashboard/microtemas")),
  });

  const totalVotos = (matrix ?? []).reduce((s, r) => s + r.total, 0);
  const totalDivergentes = (matrix ?? []).reduce((s, r) => s + r.divergente, 0);

  return (
    <div className="space-y-8 animate-fade-in">
      <ModuleTabs tabs={ANALISE_TABS} />
      <div>
        <h1 className="text-xl font-semibold text-text-primary">Insights Competitivos</h1>
        <p className="text-sm text-text-muted mt-1">
          Análise avançada e comparativa entre diretorias
        </p>
      </div>

      {/* Cards premium */}
      <div className="grid grid-cols-3 gap-4">
        <div className="card border-brand/20">
          <div className="flex items-center gap-2 mb-3">
            <Lightbulb className="w-4 h-4 text-brand" />
            <p className="section-label text-brand/70">Consenso Colegiado</p>
          </div>
          <p className="metric-value">
            {totalVotos > 0
              ? `${(((totalVotos - totalDivergentes) / totalVotos) * 100).toFixed(1)}%`
              : "—"}
          </p>
          <p className="text-xs text-text-muted mt-1">Taxa de votos unânimes</p>
        </div>

        <div className="card border-warning/20">
          <div className="flex items-center gap-2 mb-3">
            <AlertTriangle className="w-4 h-4 text-warning" />
            <p className="section-label text-warning/70">Votos Divergentes</p>
          </div>
          <p className="metric-value text-warning">{totalDivergentes}</p>
          <p className="text-xs text-text-muted mt-1">Total de votos em minoria</p>
        </div>

        <div className="card">
          <div className="flex items-center gap-2 mb-3">
            <TrendingUp className="w-4 h-4 text-text-secondary" />
            <p className="section-label">Temas Analisados</p>
          </div>
          <p className="metric-value">{microtemas?.length ?? "—"}</p>
          <p className="text-xs text-text-muted mt-1">Microtemas identificados</p>
        </div>
      </div>

      {/* Tabela comparativa */}
      <section>
        <p className="section-label mb-3">Tabela Comparativa de Diretorias</p>
        <div className="card p-0 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-border">
                  {["Diretor", "Total Votos", "Favoráveis", "Contrários", "Divergentes", "% Favor"].map((h) => (
                    <th key={h} className="px-4 py-3 text-left text-label text-text-muted font-mono">
                      {h.toUpperCase()}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {(matrix ?? []).length === 0 ? (
                  <tr>
                    <td colSpan={6} className="px-4 py-12 text-center text-text-muted text-sm">
                      Nenhum dado disponível
                    </td>
                  </tr>
                ) : (
                  (matrix ?? []).map((row) => {
                    const pctFavor = row.total > 0
                      ? ((row.favoravel / row.total) * 100).toFixed(1)
                      : "—";
                    return (
                      <tr key={row.diretor_id} className="border-b border-border/50 hover:bg-bg-hover">
                        <td className="px-4 py-3 text-sm font-medium text-text-primary">{row.diretor_nome}</td>
                        <td className="px-4 py-3 font-mono text-sm text-brand font-semibold">{row.total}</td>
                        <td className="px-4 py-3 font-mono text-sm text-success">{row.favoravel}</td>
                        <td className="px-4 py-3 font-mono text-sm text-error">{row.desfavoravel}</td>
                        <td className="px-4 py-3 font-mono text-sm">
                          {row.divergente > 0 ? (
                            <span className="badge-red">{row.divergente}</span>
                          ) : (
                            <span className="text-text-muted">0</span>
                          )}
                        </td>
                        <td className="px-4 py-3 font-mono text-sm text-text-primary">{pctFavor}%</td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>
      </section>

      {/* Relação tema × decisão */}
      <section>
        <p className="section-label mb-3">Matriz Tema × Decisão</p>
        <div className="card p-0 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-border">
                  {["Microtema", "Total", "Deferido", "Indeferido", "% Deferido", "% Indeferido"].map((h) => (
                    <th key={h} className="px-4 py-3 text-left text-label text-text-muted font-mono">
                      {h.toUpperCase()}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {(microtemas ?? []).length === 0 ? (
                  <tr>
                    <td colSpan={6} className="px-4 py-12 text-center text-text-muted text-sm">
                      Nenhum dado disponível
                    </td>
                  </tr>
                ) : (
                  (microtemas ?? []).map((m) => (
                    <tr key={m.microtema} className="border-b border-border/50 hover:bg-bg-hover">
                      <td className="px-4 py-3">
                        <span className="badge-orange">{getMicrotemaLabel(m.microtema)}</span>
                      </td>
                      <td className="px-4 py-3 font-mono text-sm text-text-primary font-semibold">{m.total}</td>
                      <td className="px-4 py-3 font-mono text-sm text-success">{m.deferido}</td>
                      <td className="px-4 py-3 font-mono text-sm text-error">{m.indeferido}</td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          <div className="flex-1 bg-bg-hover rounded-full h-1.5 w-20">
                            <div
                              className="h-1.5 rounded-full bg-success"
                              style={{ width: `${m.pct_deferido}%` }}
                            />
                          </div>
                          <span className="font-mono text-xs text-success w-12 text-right">
                            {m.pct_deferido.toFixed(1)}%
                          </span>
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          <div className="flex-1 bg-bg-hover rounded-full h-1.5 w-20">
                            <div
                              className="h-1.5 rounded-full bg-error"
                              style={{ width: `${m.pct_indeferido}%` }}
                            />
                          </div>
                          <span className="font-mono text-xs text-error w-12 text-right">
                            {m.pct_indeferido.toFixed(1)}%
                          </span>
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      </section>
    </div>
  );
}
