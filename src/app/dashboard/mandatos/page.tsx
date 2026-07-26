"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { cn, formatDate, getMicrotemaLabel, isResultadoPositivo } from "@/lib/utils";
import type {
  Mandato, Agencia, MandatosStats, MandatosAnalytics,
  VotoMatrixRow, VotoDistribution, VotoSector,
} from "@/types";
import { IrisPieChart } from "@/components/charts/IrisPieChart";
import { IrisBarChart } from "@/components/charts/IrisBarChart";
import { IrisAreaChart } from "@/components/charts/IrisAreaChart";
import { MandatoGanttChart, type GanttRow } from "@/components/charts/MandatoGanttChart";
import Link from "next/link";
import { Users, AlertTriangle, CheckCircle, Shield, ChevronRight } from "lucide-react";
import { ModuleTabs } from "@/components/ui/ModuleTabs";
import { DIRETORES_TABS } from "@/lib/module-tabs";

// ─── Director Card ──────────────────────────────────────────────────────────

function DirectorCard({ mandato, participacoes }: { mandato: Mandato; participacoes: number }) {
  const initials = mandato.diretor_nome
    .split(" ").filter((w) => w.length > 2).slice(0, 2).map((w) => w[0]).join("") || "??";

  return (
    <Link
      href={`/dashboard/mandatos/${mandato.diretor_id}`}
      className="card-hover p-4 flex items-center gap-3 group"
    >
      <div className="w-10 h-10 rounded-full bg-brand/15 border border-brand/20 flex items-center justify-center shrink-0">
        <span className="font-mono text-xs font-semibold text-brand">{initials}</span>
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-0.5">
          <p className="text-sm font-semibold text-text-primary truncate">{mandato.diretor_nome}</p>
          <span className={cn("badge text-xs", mandato.status === "Ativo" ? "badge-green" : "badge-gray")}>
            {mandato.status}
          </span>
        </div>
        <p className="text-xs text-text-muted">{mandato.cargo ?? "Diretor"}</p>
        <p className="text-[10px] font-mono text-text-label mt-0.5">
          {formatDate(mandato.data_inicio)} → {formatDate(mandato.data_fim)}
          {participacoes > 0 && (
            <span className="ml-2 text-brand">{participacoes} participações</span>
          )}
        </p>
      </div>
      <ChevronRight className="w-4 h-4 text-text-label group-hover:text-brand transition-colors shrink-0" />
    </Link>
  );
}

// ─── KPI Card ───────────────────────────────────────────────────────────────

function KpiCard({
  label, value, sub, color = "default",
  icon: Icon,
}: {
  label: string; value: string | number; sub?: string;
  color?: "orange" | "green" | "red" | "purple" | "default";
  icon?: React.ElementType;
}) {
  const colorMap = {
    orange: "text-brand",
    green: "text-success",
    red: "text-danger",
    purple: "text-purple-400",
    default: "text-text-primary",
  };
  return (
    <div className="card text-center py-5">
      {Icon && (
        <div className={cn("w-8 h-8 rounded-lg flex items-center justify-center mx-auto mb-2",
          color === "orange" ? "bg-brand/10" :
          color === "green" ? "bg-success/10" :
          color === "red" ? "bg-danger/10" :
          color === "purple" ? "bg-purple-400/10" : "bg-bg-hover"
        )}>
          <Icon className={cn("w-4 h-4", colorMap[color])} />
        </div>
      )}
      <p className="section-label mb-1">{label}</p>
      <p className={cn("text-2xl font-bold font-mono", colorMap[color])}>{value}</p>
      {sub && <p className="text-xs text-text-muted mt-0.5">{sub}</p>}
    </div>
  );
}

// ─── Page ───────────────────────────────────────────────────────────────────

export default function MandatosPage() {
  const [agenciaId, setAgenciaId] = useState<string>("");
  const agP = agenciaId ? `?agencia_id=${agenciaId}` : "";

  const { data: agencias } = useQuery({
    queryKey: ["agencias"],
    queryFn: () => api.get<Agencia[]>("/agencias"),
  });

  // All mandatos (ativo + inativo) for Gantt
  const { data: todosOsMandatos } = useQuery({
    queryKey: ["mandatos-todos", agenciaId],
    queryFn: () => api.get<Mandato[]>(`/mandatos${agenciaId ? `?agencia_id=${agenciaId}` : ""}`),
  });

  // Active only for director cards
  const { data: mandatosAtivos, isLoading } = useQuery({
    queryKey: ["mandatos-ativos", agenciaId],
    queryFn: () => api.get<Mandato[]>(`/mandatos?status=Ativo${agenciaId ? `&agencia_id=${agenciaId}` : ""}`),
  });

  const { data: stats } = useQuery({
    queryKey: ["mandatos-stats", agenciaId],
    queryFn: () => api.get<MandatosStats>(`/mandatos/stats${agP}`),
  });

  const { data: analytics } = useQuery({
    queryKey: ["mandatos-analytics", agenciaId],
    queryFn: () => api.get<MandatosAnalytics>(`/mandatos/analytics${agP}`),
  });

  const { data: matrix } = useQuery({
    queryKey: ["votacao-matrix", agenciaId],
    queryFn: () => api.get<VotoMatrixRow[]>(`/votacao/matrix${agP}`),
  });

  const { data: distribution } = useQuery({
    queryKey: ["votacao-distribution", agenciaId],
    queryFn: () => api.get<VotoDistribution[]>(`/votacao/distribution${agP}`),
  });

  const { data: sectors } = useQuery({
    queryKey: ["votacao-sectors", agenciaId],
    queryFn: () => api.get<VotoSector[]>(`/votacao/sectors${agP}`),
  });

  // Map diretor_id → total participações
  const participacoesMap = new Map<string, number>();
  for (const row of matrix ?? []) participacoesMap.set(row.diretor_id, row.total);

  // Gantt rows — all mandatos sorted by start date
  const ganttRows: GanttRow[] = (todosOsMandatos ?? []).map((m) => ({
    id: m.diretor_id,
    nome: m.diretor_nome,
    cargo: m.cargo,
    data_inicio: m.data_inicio,
    data_fim: m.data_fim,
    status: m.status,
  }));

  // Dashboard 1 — pie de distribuição de decisões
  const decisaoPieData = (analytics?.distribuicao_decisao ?? []).map((d, i) => ({
    name: d.resultado,
    value: d.count,
    color: isResultadoPositivo(d.resultado) ? "#22c55e"
         : d.resultado === "Indeferido" ? "#ef4444"
         : ["#f97316", "#8b5cf6", "#06b6d4", "#f59e0b"][i % 4],
  }));

  // Dashboard 2a — consenso vs divergência (por diretor)
  const consensoBarData = (matrix ?? []).map((row) => ({
    name: row.diretor_nome.split(" ").slice(0, 2).join(" "),
    value: row.total,
    consenso: row.total - row.divergente,
    divergente: row.divergente,
  }));

  // Dashboard 2b — setores
  const setoresData = (sectors ?? []).map((s) => ({ name: s.microtema, value: s.count }));

  // Dashboard 2c — participações por diretor
  const participacoesData = (matrix ?? []).map((row) => ({
    name: row.diretor_nome.split(" ").slice(0, 2).join(" "),
    value: row.total,
  }));

  // Dashboard 2d — distribuição de votos (pie já existe)
  const votoLabels: Record<string, string> = { Favoravel: "Favorável", Desfavoravel: "Desfavorável", Abstencao: "Abstenção", Ausente: "Ausente" };
  const votoColors: Record<string, string> = { Favoravel: "#22c55e", Desfavoravel: "#ef4444", Abstencao: "#f59e0b", Ausente: "#71717a" };
  const pieData = (distribution ?? []).map((d) => ({
    name: votoLabels[d.tipo_voto] ?? d.tipo_voto,
    value: d.count,
    color: votoColors[d.tipo_voto],
  }));

  // Dashboard 3 — evolução mensal
  const evolucaoData = (analytics?.evolucao_mensal ?? []).map((m) => ({
    name: m.period.slice(5) + "/" + m.period.slice(0, 4),
    total: m.total,
    deferido: m.deferido,
    indeferido: m.indeferido,
  }));

  return (
    <div className="space-y-8 animate-fade-in">
      <ModuleTabs tabs={DIRETORES_TABS} />
      {/* Header */}
      <div className="flex items-start justify-between flex-wrap gap-4">
        <div>
          <h1 className="text-xl font-semibold text-text-primary">Mandatos</h1>
          <p className="text-sm text-text-muted mt-1">
            Análise regulatória por agência — diretores, votos e tendências decisórias
          </p>
        </div>
        <select className="select w-48" value={agenciaId} onChange={(e) => setAgenciaId(e.target.value)}>
          <option value="">Todas as agências</option>
          {(agencias ?? []).map((a) => (
            <option key={a.id} value={a.id}>{a.sigla} — {a.nome}</option>
          ))}
        </select>
      </div>

      {/* Top KPIs */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <KpiCard label="Diretores Ativos" value={stats?.diretores_ativos ?? "—"} icon={Users} color="orange" />
        <KpiCard label="Participações" value={stats?.participacoes_colegiadas ?? "—"} sub="votos colegiados" />
        <KpiCard label="Taxa de Consenso" value={analytics?.taxa_consenso ?? stats?.taxa_consenso ?? "—"} icon={CheckCircle} color="green" />
        <KpiCard label="Deliberações" value={analytics?.total_deliberacoes ?? stats?.total_deliberacoes ?? "—"} />
      </div>

      {/* ── ALERTAS & INTELIGÊNCIA ── */}
      {(() => {
        const hoje = Date.now();
        const alertas = (mandatosAtivos ?? []).map((m) => {
          const diasRestantes = m.data_fim
            ? Math.round((new Date(m.data_fim).getTime() - hoje) / 86400000)
            : null;
          const rowMatrix = (matrix ?? []).find((r) => r.diretor_id === m.diretor_id);
          const pctDiv = rowMatrix && rowMatrix.total > 0
            ? (rowMatrix.divergente / rowMatrix.total) * 100
            : 0;
          return { ...m, diasRestantes, pctDiv };
        }).filter((m) => (m.diasRestantes !== null && m.diasRestantes <= 180) || m.pctDiv >= 15);

        if (alertas.length === 0) return null;

        return (
          <section>
            <p className="section-label mb-3">Alertas & Inteligência</p>
            <div className="space-y-2">
              {alertas.map((alerta) => {
                const expirando = alerta.diasRestantes !== null && alerta.diasRestantes <= 180;
                const critico   = alerta.diasRestantes !== null && alerta.diasRestantes <= 30;
                const altaDiv   = alerta.pctDiv >= 15;

                return (
                  <div key={alerta.id}>
                    {expirando && (
                      <div className={cn(
                        "flex items-start gap-3 px-4 py-3 rounded-lg border text-sm",
                        critico
                          ? "bg-error/10 border-error/30 text-error"
                          : "bg-warning/10 border-warning/30 text-warning"
                      )}>
                        <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
                        <div>
                          <p className="font-semibold">{alerta.diretor_nome}</p>
                          <p className="text-xs opacity-80 mt-0.5">
                            {alerta.diasRestantes !== null && alerta.diasRestantes > 0
                              ? `Mandato expira em ${alerta.diasRestantes} dias (${formatDate(alerta.data_fim)})`
                              : `Mandato encerrado em ${formatDate(alerta.data_fim)}`}
                          </p>
                        </div>
                        <Link href={`/dashboard/mandatos/${alerta.diretor_id}`} className="ml-auto text-xs underline opacity-70 hover:opacity-100 shrink-0">
                          Ver perfil
                        </Link>
                      </div>
                    )}
                    {altaDiv && (
                      <div className="flex items-start gap-3 px-4 py-3 rounded-lg border bg-orange-500/10 border-orange-500/30 text-orange-400 text-sm mt-2 first:mt-0">
                        <Shield className="w-4 h-4 mt-0.5 shrink-0" />
                        <div>
                          <p className="font-semibold">{alerta.diretor_nome}</p>
                          <p className="text-xs opacity-80 mt-0.5">
                            Perfil divergente — {alerta.pctDiv.toFixed(1)}% de votos divergentes do colegiado
                          </p>
                        </div>
                        <Link href={`/dashboard/mandatos/${alerta.diretor_id}`} className="ml-auto text-xs underline opacity-70 hover:opacity-100 shrink-0">
                          Ver perfil
                        </Link>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </section>
        );
      })()}

      {/* Gantt */}
      {ganttRows.length > 0 && (
        <section className="card">
          <h2 className="section-label mb-4">Linha do Tempo de Mandatos</h2>
          <MandatoGanttChart rows={ganttRows} />
        </section>
      )}

      {/* ── DASHBOARD 1: Indicadores Gerais ── */}
      <section>
        <p className="section-label mb-3">Dashboard 1 — Indicadores Gerais</p>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-4 mb-4">
          <KpiCard label="Taxa de Litígio" value={analytics?.taxa_litigio ?? "—"} sub="deliberações contestadas" icon={AlertTriangle} color="red" />
          <KpiCard label="Taxa de Consenso" value={analytics?.taxa_consenso ?? "—"} sub="unanimidade" icon={CheckCircle} color="green" />
          <KpiCard label="Taxa de Sanção" value={analytics?.taxa_sancao ?? "—"} sub="multa ou indeferimento" icon={Shield} color="purple" />
        </div>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <div className="card">
            <h3 className="section-label mb-3">Distribuição por Tipo de Decisão</h3>
            {decisaoPieData.length > 0 ? (
              <IrisPieChart data={decisaoPieData} height={220} innerRadius={55} />
            ) : (
              <div className="h-[220px] flex items-center justify-center text-text-muted text-sm">Sem dados</div>
            )}
          </div>
          <div className="card">
            <h3 className="section-label mb-3">Distribuição de Votos</h3>
            {pieData.length > 0 ? (
              <IrisPieChart data={pieData} height={220} innerRadius={55} />
            ) : (
              <div className="h-[220px] flex items-center justify-center text-text-muted text-sm">Sem dados</div>
            )}
          </div>
        </div>
      </section>

      {/* ── DASHBOARD 2: Análise de Votos ── */}
      <section>
        <p className="section-label mb-3">Dashboard 2 — Análise de Votos</p>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-4">
          <div className="card">
            <h3 className="section-label mb-3">Consenso vs Divergência por Diretor</h3>
            {consensoBarData.length > 0 ? (
              <IrisBarChart
                data={consensoBarData}
                height={220}
                multibar={[
                  { key: "consenso", color: "#22c55e", label: "Consenso" },
                  { key: "divergente", color: "#ef4444", label: "Divergente" },
                ]}
                xKey="name"
              />
            ) : (
              <div className="h-[220px] flex items-center justify-center text-text-muted text-sm">Sem dados</div>
            )}
          </div>
          <div className="card">
            <h3 className="section-label mb-3">Participações por Diretor</h3>
            {participacoesData.length > 0 ? (
              <IrisBarChart data={participacoesData} height={220} color="#f97316" horizontal />
            ) : (
              <div className="h-[220px] flex items-center justify-center text-text-muted text-sm">Sem dados</div>
            )}
          </div>
        </div>
        <div className="card">
          <h3 className="section-label mb-3">Deliberações por Setor (Microtema)</h3>
          {setoresData.length > 0 ? (
            <IrisBarChart
              data={setoresData}
              horizontal
              useMicrotemaColors
              height={240}
              formatLabel={getMicrotemaLabel}
            />
          ) : (
            <div className="h-[240px] flex items-center justify-center text-text-muted text-sm">Sem dados</div>
          )}
        </div>
      </section>

      {/* ── DASHBOARD 3: Evolução Mensal ── */}
      <section>
        <p className="section-label mb-3">Dashboard 3 — Evolução Mensal de Decisões</p>
        <div className="card">
          {evolucaoData.length > 0 ? (
            <IrisAreaChart
              data={evolucaoData}
              areas={[
                { key: "total", color: "#f97316", label: "Total" },
                { key: "deferido", color: "#22c55e", label: "Deferidos" },
                { key: "indeferido", color: "#ef4444", label: "Indeferidos" },
              ]}
              height={260}
            />
          ) : (
            <div className="h-[260px] flex items-center justify-center text-text-muted text-sm">Sem dados</div>
          )}
        </div>
      </section>

      {/* ── DIRETORES ── */}
      <section>
        <p className="section-label mb-3">Diretores em Exercício</p>
        {isLoading ? (
          <div className="text-center py-10 text-text-muted text-sm">Carregando...</div>
        ) : (mandatosAtivos ?? []).length === 0 ? (
          <div className="text-center py-10 text-text-muted text-sm">Nenhum mandato ativo</div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {(mandatosAtivos ?? []).map((m) => (
              <DirectorCard
                key={m.id}
                mandato={m}
                participacoes={participacoesMap.get(m.diretor_id) ?? 0}
              />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
