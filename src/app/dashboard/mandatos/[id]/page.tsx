"use client";

import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useParams } from "next/navigation";
import { api, listaDe } from "@/lib/api";
import { cn, formatDate, getMicrotemaLabel, getMicrotemaColor, isResultadoPositivo } from "@/lib/utils";
import type { DiretorProfile, DiretorOverviewItem } from "@/types";
import { GaugeChart } from "@/components/charts/GaugeChart";
import { IrisPieChart } from "@/components/charts/IrisPieChart";
import { IrisBarChart } from "@/components/charts/IrisBarChart";
import Link from "next/link";
import { ArrowLeft, Calendar, Building2, Award, TrendingUp, AlertTriangle, Shield } from "lucide-react";

function initials(nome: string): string {
  return nome.split(" ").filter((w) => w.length > 2).slice(0, 2).map((w) => w[0]).join("") || "??";
}

function tendenciaBadgeColor(perfil: string) {
  if (perfil === "Consensual") return "badge-green";
  if (perfil === "Moderadamente divergente") return "text-warning border border-warning/30 bg-warning/10 px-2 py-0.5 rounded text-xs font-mono";
  return "badge-red";
}

export default function DiretorProfilePage() {
  const { id } = useParams<{ id: string }>();

  const { data: profile, isLoading, isError } = useQuery({
    queryKey: ["diretor-profile", id],
    queryFn: () => api.get<DiretorProfile>(`/diretores/${id}`),
    enabled: !!id,
  });

  // Fetch all directors of same agency for comparison
  const { data: todosDiretores } = useQuery({
    queryKey: ["dashboard", "diretores-overview", profile?.agencia_id ?? ""],
    queryFn: async () => listaDe<DiretorOverviewItem>(await api.get(`/dashboard/diretores/overview${profile?.agencia_id ? `?agencia_id=${profile.agencia_id}` : ""}`)),
    enabled: !!profile?.agencia_id,
  });

  // Monthly vote timeline from historico
  const monthlyTimeline = useMemo(() => {
    if (!profile) return [];
    const byMonth = new Map<string, { favoravel: number; desfavoravel: number }>();
    for (const v of profile.historico) {
      if (!v.data_reuniao) continue;
      const period = v.data_reuniao.slice(0, 7);
      if (!byMonth.has(period)) byMonth.set(period, { favoravel: 0, desfavoravel: 0 });
      const s = byMonth.get(period)!;
      if (v.tipo_voto === "Favoravel") s.favoravel++;
      else if (v.tipo_voto === "Desfavoravel") s.desfavoravel++;
    }
    return [...byMonth.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([period, s]) => ({
        name: period.slice(5) + "/" + period.slice(2, 4),
        value: s.favoravel + s.desfavoravel,
        favoravel: s.favoravel,
        desfavoravel: s.desfavoravel,
      }));
  }, [profile]);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-20 text-text-muted text-sm animate-fade-in">
        Carregando perfil...
      </div>
    );
  }

  if (isError || !profile) {
    return (
      <div className="flex flex-col items-center justify-center py-20 gap-3 animate-fade-in">
        <p className="text-text-muted text-sm">Diretor não encontrado.</p>
        <Link href="/dashboard/mandatos" className="btn-secondary text-xs">← Voltar para Mandatos</Link>
      </div>
    );
  }

  const { stats, tendencias, historico, por_microtema, mandato, base } = profile;

  // ── Alert banners ──────────────────────────────────────────────────────
  const diasRestantes = mandato.dias_restantes;
  const expirando180 = mandato.status === "Ativo" && diasRestantes !== null && diasRestantes <= 180;
  const expirando30  = expirando180 && diasRestantes !== null && diasRestantes <= 30;
  // Só alerta divergência com base nominal — vide Risk Score.
  const altaDiv      = (base?.base_nominal ?? 0) > 0 && (base?.pct_divergente_nominal ?? 0) >= 15;

  // ── Risk Score ─────────────────────────────────────────────────────────
  // Etapa61: NÃO RENDERIZA sem base nominal. Metade do score vem de `pct_divergente`, e sobre voto
  // INFERIDO essa divergência é sempre zero — por construção, não por conduta. O resultado era um
  // veredito público ("Risco Baixo — 0/100") sobre um agente público, calculado a partir de dados
  // que o sistema nunca leu. Ausência de dado não é atestado de bom comportamento.
  const baseNominal = base?.base_nominal ?? 0;
  const temBaseComportamento = baseNominal > 0;
  const pctDivergenteNominal = base?.pct_divergente_nominal ?? 0;
  const riskScore = Math.round(
    (pctDivergenteNominal * 0.5) +
    (expirando180 ? 30 : 0) +
    (pctDivergenteNominal > 20 ? 20 : 0)
  );
  const riskLabel = riskScore < 20 ? "Baixo" : riskScore < 50 ? "Moderado" : "Elevado";
  const riskColor = riskScore < 20 ? "text-success" : riskScore < 50 ? "text-warning" : "text-error";
  const riskBarColor = riskScore < 20 ? "bg-success" : riskScore < 50 ? "bg-warning" : "bg-error";

  // ── Colegiado comparison ───────────────────────────────────────────────
  const colegiado = (todosDiretores ?? []).filter((d) => d.diretor_id !== id);
  const mediaFavorPct = colegiado.length > 0
    ? colegiado.reduce((s, d) => s + d.pct_favor, 0) / colegiado.length
    : null;
  const mediaDivPct = colegiado.length > 0
    ? colegiado.reduce((s, d) => s + (d.total > 0 ? (d.divergente / d.total) * 100 : 0), 0) / colegiado.length
    : null;

  // Pie data for vote distribution
  const pieData = [
    { name: "Favorável",     value: stats.favoravel,    color: "#22c55e" },
    { name: "Desfavorável",  value: stats.desfavoravel, color: "#ef4444" },
    { name: "Abstenção",     value: stats.abstencao,    color: "#f59e0b" },
  ].filter((d) => d.value > 0);

  return (
    <div className="space-y-6 animate-fade-in">
      {/* Back */}
      <Link
        href="/dashboard/mandatos"
        className="inline-flex items-center gap-1.5 text-sm text-text-muted hover:text-brand transition-colors"
      >
        <ArrowLeft className="w-4 h-4" />
        Voltar para Mandatos
      </Link>

      {/* Alert banners */}
      {(expirando180 || altaDiv) && (
        <div className="space-y-2">
          {expirando30 && (
            <div className="flex items-center gap-3 px-4 py-3 rounded-lg border bg-error/10 border-error/30 text-error text-sm">
              <AlertTriangle className="w-4 h-4 shrink-0" />
              <span>Mandato expira em {diasRestantes} dias ({formatDate(mandato.data_fim)}) — renovação urgente necessária</span>
            </div>
          )}
          {expirando180 && !expirando30 && (
            <div className="flex items-center gap-3 px-4 py-3 rounded-lg border bg-warning/10 border-warning/30 text-warning text-sm">
              <AlertTriangle className="w-4 h-4 shrink-0" />
              <span>Mandato expira em {diasRestantes} dias ({formatDate(mandato.data_fim)})</span>
            </div>
          )}
          {altaDiv && (
            <div className="flex items-center gap-3 px-4 py-3 rounded-lg border bg-orange-500/10 border-orange-500/30 text-orange-400 text-sm">
              <Shield className="w-4 h-4 shrink-0" />
              <span>Perfil moderadamente divergente — {stats.pct_divergente.toFixed(1)}% de votos divergentes do colegiado</span>
            </div>
          )}
        </div>
      )}

      {/* Hero */}
      <div className="card p-6">
        <div className="flex items-start gap-5 flex-wrap">
          {/* Avatar */}
          <div className="w-16 h-16 rounded-full bg-brand/15 border-2 border-brand/30 flex items-center justify-center shrink-0">
            <span className="font-mono text-xl font-bold text-brand">{initials(profile.nome)}</span>
          </div>

          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-3 flex-wrap mb-1">
              <h1 className="text-xl font-bold text-text-primary">{profile.nome}</h1>
              <span className={cn(
                "badge",
                mandato.status === "Ativo" ? "badge-green" : "badge-gray"
              )}>
                {mandato.status}
              </span>
            </div>
            <p className="text-sm text-text-secondary mb-3">
              {profile.cargo ?? "Diretor"} — {profile.agencia_sigla ?? "—"}
            </p>

            {/* Mandate summary */}
            <div className="flex items-center gap-4 text-xs font-mono text-text-muted flex-wrap">
              <span className="flex items-center gap-1">
                <Calendar className="w-3.5 h-3.5" />
                {formatDate(mandato.data_inicio)} → {formatDate(mandato.data_fim)}
              </span>
              {mandato.status === "Ativo" && diasRestantes !== null && (
                <span className={cn(
                  "font-semibold",
                  expirando30 ? "text-error" : expirando180 ? "text-warning" : "text-brand"
                )}>
                  {diasRestantes > 0 ? `${diasRestantes} dias restantes` : "Encerra hoje"}
                </span>
              )}
            </div>
          </div>

          {/* Tendência badge */}
          <div className="shrink-0 text-right">
            <p className="text-[10px] text-text-label font-mono uppercase tracking-wider mb-1">Perfil</p>
            <span className={cn("font-mono text-xs font-semibold", tendenciaBadgeColor(tendencias.perfil ?? ""))}>
              {/* Etapa61: sem base nominal não há perfil. Dizer "Consensual" ali seria afirmar
                  conduta a partir de voto INFERIDO — que, por construção, nunca diverge. */}
              {tendencias.perfil ?? "Sem base nominal"}
            </span>
          </div>
        </div>
      </div>

      {/* Perfil Jurídico */}
      <section className="card">
        <h2 className="section-label mb-4 flex items-center gap-2">
          <Building2 className="w-4 h-4" />
          Perfil Jurídico
        </h2>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-4 text-xs">
          {[
            { label: "Cargo", value: profile.cargo ?? "—" },
            { label: "Agência", value: profile.agencia_sigla ?? "—" },
            { label: "Início", value: formatDate(mandato.data_inicio) },
            { label: "Término", value: formatDate(mandato.data_fim) },
            { label: "Status", value: mandato.status },
            { label: "Dias restantes", value: mandato.status === "Ativo" && diasRestantes !== null
              ? `${diasRestantes}d`
              : "—" },
          ].map((item) => (
            <div key={item.label} className="bg-bg-hover rounded-lg p-3 text-center">
              <p className="text-text-label font-mono uppercase tracking-wider text-[10px] mb-1">{item.label}</p>
              <p className={cn(
                "font-mono font-semibold",
                item.label === "Status" && mandato.status === "Ativo" ? "text-success" :
                item.label === "Status" ? "text-text-muted" :
                item.label === "Dias restantes" && mandato.status === "Ativo" ? "text-brand" :
                "text-text-primary"
              )}>
                {item.value}
              </p>
            </div>
          ))}
        </div>
      </section>

      {/* Estatísticas de Votação */}
      <section>
        <h2 className="section-label mb-3 flex items-center gap-2">
          <Award className="w-4 h-4" />
          Estatísticas de Votação
        </h2>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-4">
          {[
            { label: "Total de Votos", value: stats.total_votos, color: "text-text-primary" },
            { label: "Favorável", value: stats.favoravel, color: "text-success" },
            { label: "Desfavorável", value: stats.desfavoravel, color: "text-error" },
            { label: "Divergente", value: stats.divergente, color: "text-brand" },
          ].map((item) => (
            <div key={item.label} className="card text-center py-4">
              <p className="section-label mb-1">{item.label}</p>
              <p className={cn("text-2xl font-bold font-mono", item.color)}>{item.value}</p>
            </div>
          ))}
        </div>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <div className="card flex flex-col items-center">
            <p className="section-label mb-3">% Votos Favoráveis</p>
            <GaugeChart
              value={Math.round(stats.pct_favoravel)}
              label="Favorável"
              color="#22c55e"
              size={160}
            />
          </div>
          <div className="card">
            <p className="section-label mb-2">Distribuição de Votos</p>
            <IrisPieChart data={pieData} height={200} innerRadius={50} />
          </div>
        </div>
      </section>

      {/* Score de Risco */}
      <section className="card">
        <h2 className="section-label mb-4 flex items-center gap-2">
          <Shield className="w-4 h-4" />
          Score de Risco
        </h2>
        <div className="flex items-center gap-6 flex-wrap">
          <div className="flex-1 min-w-0 space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-sm text-text-secondary">Nível de risco</span>
              {temBaseComportamento ? (
                <span className={cn("font-mono text-lg font-bold", riskColor)}>
                  {riskLabel} — {riskScore}/100
                </span>
              ) : (
                <span className="font-mono text-sm text-text-muted">Sem base nominal</span>
              )}
            </div>
            {temBaseComportamento ? (
              <div className="w-full bg-bg-hover rounded-full h-3">
                <div
                  className={cn("h-3 rounded-full transition-all", riskBarColor)}
                  style={{ width: `${Math.min(100, riskScore)}%` }}
                />
              </div>
            ) : (
              <p className="text-xs text-text-muted">
                Nenhum voto deste diretor foi lido nominalmente nos documentos. Os votos existentes
                foram inferidos da decisão do colegiado e, por construção, nunca divergem — não há
                base para um score de comportamento.
              </p>
            )}
            <div className="grid grid-cols-3 gap-2 text-xs text-text-muted mt-2">
              <div className="text-center">
                <p className="text-success font-mono font-semibold">0–19</p>
                <p>Baixo</p>
              </div>
              <div className="text-center">
                <p className="text-warning font-mono font-semibold">20–49</p>
                <p>Moderado</p>
              </div>
              <div className="text-center">
                <p className="text-error font-mono font-semibold">50+</p>
                <p>Elevado</p>
              </div>
            </div>
          </div>
          <div className="space-y-2 text-xs text-text-muted shrink-0 w-48">
            <p className="font-mono uppercase tracking-wider text-[10px] mb-2">Fatores de risco</p>
            <div className="flex justify-between">
              <span>Divergência</span>
              <span className={cn("font-mono", stats.pct_divergente >= 15 ? "text-error" : "text-text-secondary")}>
                {stats.pct_divergente.toFixed(1)}% × 0.5
              </span>
            </div>
            <div className="flex justify-between">
              <span>Mandato expirando</span>
              <span className={cn("font-mono", expirando180 ? "text-warning" : "text-text-secondary")}>
                {expirando180 ? "+30" : "0"}
              </span>
            </div>
            <div className="flex justify-between">
              <span>Alta divergência (&gt;20%)</span>
              <span className={cn("font-mono", stats.pct_divergente > 20 ? "text-error" : "text-text-secondary")}>
                {stats.pct_divergente > 20 ? "+20" : "0"}
              </span>
            </div>
          </div>
        </div>
      </section>

      {/* Comparativo com Colegiado */}
      {colegiado.length > 0 && mediaFavorPct !== null && (
        <section className="card">
          <h2 className="section-label mb-4 flex items-center gap-2">
            <TrendingUp className="w-4 h-4" />
            Comparativo com o Colegiado
          </h2>
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border">
                <th className="px-3 py-2 text-left text-xs text-text-muted font-mono uppercase tracking-wider"></th>
                <th className="px-3 py-2 text-left text-xs text-text-muted font-mono uppercase tracking-wider">Este Diretor</th>
                <th className="px-3 py-2 text-left text-xs text-text-muted font-mono uppercase tracking-wider">Média Colegiado</th>
                <th className="px-3 py-2 text-left text-xs text-text-muted font-mono uppercase tracking-wider">Diferença</th>
              </tr>
            </thead>
            <tbody>
              {[
                {
                  label: "Taxa Favorável",
                  mine: stats.pct_favoravel,
                  media: mediaFavorPct,
                  unit: "%",
                  higherIsBetter: true,
                },
                {
                  label: "Taxa Divergente",
                  mine: stats.pct_divergente,
                  media: mediaDivPct ?? 0,
                  unit: "%",
                  higherIsBetter: false,
                },
              ].map((row) => {
                const diff = row.mine - row.media;
                const isGood = row.higherIsBetter ? diff >= 0 : diff <= 0;
                return (
                  <tr key={row.label} className="border-b border-border/50">
                    <td className="px-3 py-3 text-text-muted font-medium text-xs">{row.label}</td>
                    <td className="px-3 py-3 font-mono text-text-primary">{row.mine.toFixed(1)}{row.unit}</td>
                    <td className="px-3 py-3 font-mono text-text-secondary">{row.media.toFixed(1)}{row.unit}</td>
                    <td className={cn("px-3 py-3 font-mono font-semibold text-xs", isGood ? "text-success" : "text-error")}>
                      {diff >= 0 ? "+" : ""}{diff.toFixed(1)}{row.unit}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </section>
      )}

      {/* Tendências */}
      <section className="card">
        <h2 className="section-label mb-4 flex items-center gap-2">
          <TrendingUp className="w-4 h-4" />
          Tendências e Análise
        </h2>
        <div className="flex items-start gap-4 flex-wrap">
          <div>
            <span className={cn("text-sm font-semibold font-mono", tendenciaBadgeColor(tendencias.perfil ?? ""))}>
              {tendencias.perfil ?? "Sem base nominal"}
            </span>
            <p className="text-sm text-text-secondary mt-2">{tendencias.descricao}</p>
            <p className="text-xs text-text-muted mt-1">
              Taxa de aprovação: <span className="text-brand font-mono font-semibold">{tendencias.taxa_aprovacao}</span>
            </p>
          </div>

          {por_microtema.length > 0 && (
            <div className="ml-auto">
              <p className="text-[10px] font-mono uppercase tracking-wider text-text-label mb-2">Top microtemas</p>
              <div className="flex flex-wrap gap-1.5">
                {por_microtema.slice(0, 5).map((m) => (
                  <span
                    key={m.microtema}
                    className="text-xs font-mono px-2 py-0.5 rounded-full"
                    style={{
                      background: getMicrotemaColor(m.microtema) + "22",
                      color: getMicrotemaColor(m.microtema),
                      border: `1px solid ${getMicrotemaColor(m.microtema)}44`,
                    }}
                  >
                    {getMicrotemaLabel(m.microtema)} ({m.total})
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>
      </section>

      {/* Timeline Mensal de Votos */}
      {monthlyTimeline.length > 0 && (
        <section>
          <h2 className="section-label mb-3">Timeline Mensal de Votos</h2>
          <div className="card">
            <IrisBarChart
              data={monthlyTimeline}
              height={220}
              xKey="name"
              multibar={[
                { key: "favoravel",    color: "#22c55e", label: "Favorável" },
                { key: "desfavoravel", color: "#ef4444", label: "Desfavorável" },
              ]}
            />
          </div>
        </section>
      )}

      {/* Histórico de Votos */}
      <section>
        <h2 className="section-label mb-3">Histórico de Votos</h2>
        <div className="card p-0 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-border">
                  {["Data", "Deliberação", "Interessado", "Setor", "Decisão", "Voto"].map((h) => (
                    <th key={h} className="px-4 py-3 text-left font-mono text-text-muted uppercase tracking-wider text-[10px]">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {historico.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="px-4 py-10 text-center text-text-muted">
                      Nenhum voto registrado
                    </td>
                  </tr>
                ) : (
                  historico.map((v) => (
                    <tr
                      key={v.deliberacao_id}
                      className={cn(
                        "border-b border-border/40 hover:bg-bg-hover/50 transition-colors",
                        v.is_divergente && "bg-error/5"
                      )}
                    >
                      <td className="px-4 py-2.5 font-mono text-text-secondary whitespace-nowrap">
                        {formatDate(v.data_reuniao)}
                      </td>
                      <td className="px-4 py-2.5 font-mono text-text-secondary whitespace-nowrap">
                        {v.numero_deliberacao ?? "—"}
                      </td>
                      <td className="px-4 py-2.5 text-text-primary max-w-[180px] truncate">
                        {v.interessado ?? "—"}
                      </td>
                      <td className="px-4 py-2.5">
                        {v.microtema ? (
                          <span
                            className="text-xs font-mono px-1.5 py-0.5 rounded"
                            style={{
                              background: getMicrotemaColor(v.microtema) + "22",
                              color: getMicrotemaColor(v.microtema),
                            }}
                          >
                            {getMicrotemaLabel(v.microtema)}
                          </span>
                        ) : "—"}
                      </td>
                      <td className="px-4 py-2.5">
                        {v.resultado ? (
                          <span className={cn(
                            "badge",
                            isResultadoPositivo(v.resultado) ? "badge-green" :
                            v.resultado === "Indeferido" ? "badge-red" : "badge-gray"
                          )}>
                            {v.resultado}
                          </span>
                        ) : "—"}
                      </td>
                      <td className="px-4 py-2.5">
                        <span className={cn(
                          "font-mono text-xs font-semibold",
                          v.tipo_voto === "Favoravel" ? "text-success" :
                          v.tipo_voto === "Desfavoravel" ? "text-error" : "text-text-muted"
                        )}>
                          {v.tipo_voto === "Favoravel" ? "Favorável" :
                           v.tipo_voto === "Desfavoravel" ? "Desfavorável" :
                           v.tipo_voto}
                          {v.is_divergente && (
                            <span className="ml-1 text-brand text-[10px]">↗ div.</span>
                          )}
                        </span>
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
