"use client";

import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import type { EmpresaDetalhe } from "@/types";
import { cn, formatDate, getMicrotemaLabel, getMicrotemaColor } from "@/lib/utils";
import {
  ArrowLeft, Building, AlertTriangle, TrendingUp, TrendingDown,
  Minus, CheckCircle, XCircle, Users, ExternalLink,
} from "lucide-react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { HelpTooltip } from "@/components/ui/HelpTooltip";
import { IrisBarChart } from "@/components/charts/IrisBarChart";
import { ChartWrapper } from "@/components/charts/ChartWrapper";

// ─── Helpers ─────────────────────────────────────────────────────────────────

function RiscoBadge({ risco }: { risco: "alto" | "medio" | "baixo" }) {
  const cfg = {
    alto:  { label: "Risco Alto",  cls: "bg-red-500/15 text-red-400 border-red-500/30" },
    medio: { label: "Risco Médio", cls: "bg-amber-500/15 text-amber-400 border-amber-500/30" },
    baixo: { label: "Risco Baixo", cls: "bg-emerald-500/15 text-emerald-400 border-emerald-500/30" },
  }[risco];
  return (
    <span className={cn("text-xs px-2.5 py-1 rounded-full font-mono font-semibold border", cfg.cls)}>
      {cfg.label}
    </span>
  );
}

function TendenciaIcon({ direcao }: { direcao: "melhorando" | "estavel" | "piorando" }) {
  if (direcao === "melhorando") return <TrendingUp className="w-4 h-4 text-emerald-400" />;
  if (direcao === "piorando")   return <TrendingDown className="w-4 h-4 text-red-400" />;
  return <Minus className="w-4 h-4 text-zinc-400" />;
}

function ResultadoBadge({ resultado }: { resultado: string | null }) {
  if (!resultado) return <span className="text-text-muted text-xs">—</span>;
  const positivos = ["Deferido", "Aprovado", "Aprovado com Ressalvas", "Aprovado por Unanimidade", "Ratificado", "Autorizado", "Recomendado", "Determinado"];
  const isPos = positivos.includes(resultado);
  const isNeg = resultado === "Indeferido";
  return (
    <span className={cn(
      "text-xs px-2 py-0.5 rounded font-mono",
      isPos ? "bg-emerald-500/15 text-emerald-400 border border-emerald-500/30" :
      isNeg ? "bg-red-500/15 text-red-400 border border-red-500/30" :
              "bg-zinc-500/15 text-zinc-400 border border-zinc-500/30"
    )}>
      {resultado}
    </span>
  );
}

// ─── Página ───────────────────────────────────────────────────────────────────

export default function EmpresaDetailPage() {
  const params = useParams<{ id: string }>();
  const nome = decodeURIComponent(params.id);

  const { data: empresa, isLoading } = useQuery({
    queryKey: ["empresa", nome],
    queryFn: () => api.get<EmpresaDetalhe>(`/empresas/${encodeURIComponent(nome)}`),
  });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-24 text-text-muted text-sm">
        Carregando perfil da empresa...
      </div>
    );
  }

  if (!empresa) {
    return (
      <div className="text-center py-24">
        <p className="text-text-muted">Empresa não encontrada</p>
        <Link href="/dashboard/empresas" className="text-brand text-sm hover:underline mt-2 block">
          Voltar às empresas
        </Link>
      </div>
    );
  }

  const pct = empresa.pct_deferido;
  const tendenciaLabel = {
    melhorando: "Melhorando",
    estavel: "Estável",
    piorando: "Piorando",
  }[empresa.tendencia.direcao];

  const evolucaoData = empresa.evolucao_mensal.map((m) => ({
    name: m.period.slice(5) + "/" + m.period.slice(2, 4),
    value: m.positivo,
    positivo: m.positivo,
    negativo: m.negativo,
  }));

  return (
    <div className="max-w-4xl space-y-5 animate-fade-in">

      {/* ── Header ─────────────────────────────────────────────────────── */}
      <div className="flex items-start gap-3 flex-wrap">
        <Link href="/dashboard/empresas" className="btn-secondary py-1 px-2 mt-0.5">
          <ArrowLeft className="w-4 h-4" />
        </Link>

        <div className="flex-1 min-w-0">
          <p className="text-xs text-text-muted font-mono">Empresa Regulada</p>
          <div className="flex items-center gap-3 flex-wrap mt-0.5">
            <Building className="w-5 h-5 text-brand shrink-0" />
            <h1 className="text-xl font-semibold text-text-primary">{empresa.nome}</h1>
            <RiscoBadge risco={empresa.risco_regulatorio} />
            <HelpTooltip text="Risco Alto: < 40% aprovação. Risco Médio: 40-70%. Risco Baixo: > 70%. Tendência compara a primeira metade vs. segunda metade do histórico." />
          </div>
          <div className="flex items-center gap-3 mt-1.5 text-xs text-text-muted flex-wrap">
            <span>{empresa.total_deliberacoes} deliberações</span>
            <span>·</span>
            <span>Última: {formatDate(empresa.ultima_deliberacao)}</span>
            {empresa.alertas.length > 0 && (
              <>
                <span>·</span>
                <span className="text-amber-400 flex items-center gap-1">
                  <AlertTriangle className="w-3.5 h-3.5" />
                  {empresa.alertas.length} {empresa.alertas.length === 1 ? "alerta" : "alertas"}
                </span>
              </>
            )}
          </div>
        </div>
      </div>

      {/* ── Alertas ──────────────────────────────────────────────────────── */}
      {empresa.alertas.length > 0 && (
        <div className="space-y-2">
          {empresa.alertas.map((msg, i) => (
            <div key={i} className="flex items-center gap-2 px-3 py-2 rounded-lg bg-amber-500/10 border border-amber-500/20">
              <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0" />
              <span className="text-xs text-amber-300">{msg}</span>
            </div>
          ))}
        </div>
      )}

      {/* ── KPIs ─────────────────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {/* Taxa de aprovação */}
        <div className="card text-center">
          <p className="text-xs text-text-muted font-mono mb-1">APROVAÇÃO</p>
          <p className={cn(
            "text-2xl font-bold",
            pct >= 70 ? "text-emerald-400" : pct >= 40 ? "text-amber-400" : "text-red-400"
          )}>
            {pct.toFixed(0)}%
          </p>
          <div className="mt-1.5 h-1 bg-bg-hover rounded-full overflow-hidden">
            <div
              className={cn("h-full rounded-full", pct >= 70 ? "bg-emerald-500" : pct >= 40 ? "bg-amber-500" : "bg-red-500")}
              style={{ width: `${Math.min(100, pct)}%` }}
            />
          </div>
        </div>

        {/* Deferidos */}
        <div className="card text-center">
          <p className="text-xs text-text-muted font-mono mb-1">APROVADOS</p>
          <p className="text-2xl font-bold text-emerald-400">{empresa.deferidos}</p>
          <p className="text-xs text-text-muted mt-0.5">de {empresa.total_deliberacoes}</p>
        </div>

        {/* Indeferidos */}
        <div className="card text-center">
          <p className="text-xs text-text-muted font-mono mb-1">INDEFERIDOS</p>
          <p className="text-2xl font-bold text-red-400">{empresa.indeferidos}</p>
          <p className="text-xs text-text-muted mt-0.5">de {empresa.total_deliberacoes}</p>
        </div>

        {/* Tendência */}
        <div className="card text-center">
          <p className="text-xs text-text-muted font-mono mb-1">TENDÊNCIA</p>
          <div className="flex items-center justify-center gap-1.5 mt-1">
            <TendenciaIcon direcao={empresa.tendencia.direcao} />
            <span className={cn(
              "text-sm font-semibold",
              empresa.tendencia.direcao === "melhorando" ? "text-emerald-400" :
              empresa.tendencia.direcao === "piorando" ? "text-red-400" : "text-zinc-400"
            )}>
              {tendenciaLabel}
            </span>
          </div>
          <p className="text-xs text-text-muted mt-1">
            {empresa.tendencia.pct_anterior.toFixed(0)}% → {empresa.tendencia.pct_recente.toFixed(0)}%
          </p>
        </div>
      </div>

      {/* ── Evolução mensal ──────────────────────────────────────────────── */}
      {evolucaoData.length > 1 && (
        <ChartWrapper title="Evolução Mensal" availableTypes={["bar"]} defaultType="bar">
          {() => (
            <IrisBarChart
              data={evolucaoData}
              multibar={[
                { key: "positivo", label: "Aprovados", color: "#22c55e" },
                { key: "negativo", label: "Indeferidos", color: "#ef4444" },
              ]}
              height={160}
            />
          )}
        </ChartWrapper>
      )}

      {/* ── Microtemas e Diretores ───────────────────────────────────────── */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {/* Microtemas */}
        <div className="card">
          <p className="section-label mb-3">Temas de Atuação</p>
          <div className="space-y-2">
            {empresa.microtemas_breakdown.map(({ microtema, count }) => (
              <div key={microtema} className="flex items-center gap-2">
                <span
                  className="text-xs px-2 py-0.5 rounded font-mono"
                  style={{ background: getMicrotemaColor(microtema) + "25", color: getMicrotemaColor(microtema) }}
                >
                  {getMicrotemaLabel(microtema)}
                </span>
                <div className="flex-1 h-1.5 bg-bg-hover rounded-full overflow-hidden">
                  <div
                    className="h-full rounded-full"
                    style={{
                      width: `${(count / empresa.total_deliberacoes) * 100}%`,
                      background: getMicrotemaColor(microtema),
                    }}
                  />
                </div>
                <span className="text-xs text-text-muted font-mono w-4 text-right">{count}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Diretores */}
        {empresa.diretores.length > 0 && (
          <div className="card">
            <div className="flex items-center gap-2 mb-3">
              <Users className="w-4 h-4 text-brand" />
              <p className="section-label">Diretores Envolvidos</p>
            </div>
            <div className="space-y-2">
              {empresa.diretores.slice(0, 6).map((dir) => (
                <div key={dir.id} className="flex items-center gap-2">
                  <div className="w-7 h-7 rounded-full bg-brand/15 flex items-center justify-center shrink-0">
                    <span className="text-xs font-bold text-brand font-mono">
                      {dir.nome.split(" ").filter(p => p.length > 2).slice(0, 2).map(p => p[0]).join("")}
                    </span>
                  </div>
                  <span className="text-xs text-text-secondary flex-1 truncate">{dir.nome}</span>
                  <div className="flex items-center gap-1 shrink-0">
                    <CheckCircle className="w-3 h-3 text-emerald-400" />
                    <span className="text-xs text-emerald-400 font-mono">{dir.favoravel}</span>
                    {dir.total - dir.favoravel > 0 && (
                      <>
                        <XCircle className="w-3 h-3 text-red-400 ml-1" />
                        <span className="text-xs text-red-400 font-mono">{dir.total - dir.favoravel}</span>
                      </>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* ── Histórico de deliberações ────────────────────────────────────── */}
      <div className="card p-0 overflow-hidden">
        <div className="px-4 py-3 border-b border-border flex items-center gap-2">
          <p className="section-label">Histórico de Deliberações</p>
          <span className="ml-auto text-xs text-text-muted font-mono">{empresa.historico.length}</span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-border">
                {["Data", "Número", "Microtema", "Resultado", ""].map((h) => (
                  <th key={h} className="px-4 py-2 text-left text-xs text-text-muted font-mono">
                    {h.toUpperCase()}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {empresa.historico.map((d) => (
                <tr key={d.id} className="border-b border-border/50 hover:bg-bg-hover transition-colors">
                  <td className="px-4 py-2.5 font-mono text-xs text-text-secondary whitespace-nowrap">
                    {formatDate(d.data_reuniao)}
                  </td>
                  <td className="px-4 py-2.5 font-mono text-xs text-text-secondary">
                    {d.numero_deliberacao ?? "—"}
                  </td>
                  <td className="px-4 py-2.5">
                    {d.microtema && (
                      <span className="text-xs px-1.5 py-0.5 rounded font-mono"
                        style={{ background: getMicrotemaColor(d.microtema) + "20", color: getMicrotemaColor(d.microtema) }}>
                        {getMicrotemaLabel(d.microtema)}
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-2.5">
                    <ResultadoBadge resultado={d.resultado} />
                  </td>
                  <td className="px-4 py-2.5">
                    <Link
                      href={`/dashboard/deliberacoes/${d.id}`}
                      className="text-text-muted hover:text-brand transition-colors"
                    >
                      <ExternalLink className="w-3.5 h-3.5" />
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
