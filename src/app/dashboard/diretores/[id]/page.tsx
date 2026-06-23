"use client";

import { useQuery } from "@tanstack/react-query";
import { useParams } from "next/navigation";
import Link from "next/link";
import { api } from "@/lib/api";
import type { DiretorProfile } from "@/types";
import { formatDate, getMicrotemaLabel, cn } from "@/lib/utils";
import { calcularMandato } from "@/lib/mandatos";
import { IrisLineChart } from "@/components/charts/IrisLineChart";
import { IrisBarChart } from "@/components/charts/IrisBarChart";
import { ArrowLeft, Gavel, Users } from "lucide-react";

export default function DiretorPerfilPage() {
  const params = useParams<{ id: string }>();
  const { data: perfil, isLoading } = useQuery({
    queryKey: ["diretor-perfil", params.id],
    queryFn: () => api.get<DiretorProfile>(`/diretores/${params.id}`),
  });

  if (isLoading) {
    return <div className="p-8 text-center text-text-muted text-sm">Carregando perfil...</div>;
  }
  if (!perfil) {
    return <div className="p-8 text-center text-text-muted text-sm">Diretor não encontrado.</div>;
  }

  const mandato = calcularMandato(perfil.mandato.data_inicio || null, perfil.mandato.data_fim);
  const serie = (perfil.serie_temporal ?? []).map((m) => ({
    name: m.period, favoravel: m.favoravel, desfavoravel: m.desfavoravel, divergente: m.divergente,
  }));
  const divTema = (perfil.divergencia_por_tema ?? [])
    .filter((t) => t.total > 0)
    .slice(0, 8)
    .map((t) => ({ name: t.microtema, value: t.pct_divergente }));

  return (
    <div className="space-y-6 animate-fade-in">
      <Link href="/dashboard/analytics/diretores" className="inline-flex items-center gap-1.5 text-sm text-text-muted hover:text-brand">
        <ArrowLeft className="w-4 h-4" /> Diretores
      </Link>

      {/* Cabeçalho */}
      <div className="card flex items-start justify-between gap-4 flex-wrap">
        <div className="flex items-center gap-3">
          <div className="w-12 h-12 rounded-full bg-brand/15 flex items-center justify-center">
            <Users className="w-6 h-6 text-brand" />
          </div>
          <div>
            <h1 className="text-xl font-semibold text-text-primary">{perfil.nome}</h1>
            <p className="text-sm text-text-muted">
              {perfil.cargo ?? "Diretor"} · {perfil.agencia_sigla ?? "—"}
            </p>
          </div>
        </div>
        <div className="text-right">
          <span className={cn("badge text-xs", perfil.mandato.status === "Ativo" ? "badge-green" : "badge-gray")}>
            {perfil.mandato.status}
          </span>
          <p className="text-xs text-text-muted mt-1 font-mono">
            {formatDate(perfil.mandato.data_inicio)} → {perfil.mandato.data_fim ? formatDate(perfil.mandato.data_fim) : "—"}
          </p>
          {mandato.percentualConcluido != null && (
            <p className="text-xs text-text-label mt-0.5">{mandato.percentualConcluido}% do mandato concluído</p>
          )}
        </div>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Kpi label="Total de votos" value={perfil.stats.total_votos} />
        <Kpi label="Favoráveis" value={perfil.stats.favoravel} tone="success" />
        <Kpi label="Divergentes" value={perfil.stats.divergente} tone={perfil.stats.divergente ? "warning" : "default"} />
        <Kpi label="% Divergência" value={`${perfil.stats.pct_divergente.toFixed(1)}%`} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Série temporal */}
        <div className="card">
          <p className="section-label mb-3">Votação ao longo do tempo</p>
          {serie.length > 0 ? (
            <IrisLineChart
              data={serie}
              lines={[
                { key: "favoravel", color: "#22c55e", label: "Favorável" },
                { key: "desfavoravel", color: "#ef4444", label: "Desfavorável" },
                { key: "divergente", color: "#f59e0b", label: "Divergente" },
              ]}
            />
          ) : (
            <p className="text-sm text-text-muted">Sem histórico suficiente.</p>
          )}
        </div>

        {/* Divergência por tema */}
        <div className="card">
          <p className="section-label mb-3">Divergência por tema (%)</p>
          {divTema.length > 0 ? (
            <IrisBarChart data={divTema} horizontal useMicrotemaColors formatLabel={getMicrotemaLabel} />
          ) : (
            <p className="text-sm text-text-muted">Sem divergências registradas.</p>
          )}
        </div>
      </div>

      {/* Histórico */}
      <div className="card p-0 overflow-hidden">
        <div className="px-4 py-3 border-b border-border flex items-center gap-2">
          <Gavel className="w-4 h-4 text-text-muted" />
          <p className="section-label">Histórico de votos</p>
        </div>
        <div className="overflow-x-auto max-h-[480px]">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-label text-text-muted font-mono">
                <th className="px-4 py-2 text-left">DELIBERAÇÃO</th>
                <th className="px-4 py-2 text-left">DATA</th>
                <th className="px-4 py-2 text-left">TEMA</th>
                <th className="px-4 py-2 text-left">RESULTADO</th>
                <th className="px-4 py-2 text-left">VOTO</th>
              </tr>
            </thead>
            <tbody>
              {perfil.historico.map((h) => (
                <tr key={h.deliberacao_id} className="border-b border-border/50 hover:bg-bg-hover">
                  <td className="px-4 py-2">
                    <Link href={`/dashboard/deliberacoes/${h.deliberacao_id}`} className="text-text-secondary hover:text-brand font-mono text-xs">
                      {h.numero_deliberacao ?? "—"}
                    </Link>
                  </td>
                  <td className="px-4 py-2 font-mono text-xs text-text-muted">{formatDate(h.data_reuniao)}</td>
                  <td className="px-4 py-2">{h.microtema ? <span className="badge-orange">{getMicrotemaLabel(h.microtema)}</span> : "—"}</td>
                  <td className="px-4 py-2 text-text-secondary text-xs">{h.resultado ?? "—"}</td>
                  <td className="px-4 py-2">
                    <span className={cn(
                      "badge text-[10px]",
                      h.tipo_voto === "Favoravel" && "badge-green",
                      h.tipo_voto === "Desfavoravel" && "badge-red",
                      h.is_divergente && "badge-orange",
                      !["Favoravel", "Desfavoravel"].includes(h.tipo_voto) && "badge-gray",
                    )}>
                      {h.tipo_voto}{h.is_divergente ? " · div." : ""}
                    </span>
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

function Kpi({ label, value, tone = "default" }: { label: string; value: number | string; tone?: "default" | "success" | "warning" }) {
  return (
    <div className="card">
      <p className="text-xs text-text-label font-mono uppercase tracking-wider">{label}</p>
      <p className={cn(
        "text-2xl font-semibold mt-1",
        tone === "success" && "text-success",
        tone === "warning" && "text-warning",
        tone === "default" && "text-text-primary",
      )}>{value}</p>
    </div>
  );
}
