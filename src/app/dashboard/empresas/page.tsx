"use client";

import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import type { EmpresaStats, Agencia, Deliberacao, EmpresaDetalhe } from "@/types";
import { getMicrotemaLabel, getMicrotemaColor, formatDate, formatNumber, cn, isResultadoPositivo } from "@/lib/utils";
import { ChevronDown, ChevronUp, Search, Building2, TrendingUp, TrendingDown, Minus, AlertTriangle, ExternalLink } from "lucide-react";
import Link from "next/link";
import { HelpTooltip } from "@/components/ui/HelpTooltip";
import { ModuleTabs } from "@/components/ui/ModuleTabs";
import { REGULATORIO_TABS } from "@/lib/module-tabs";

const MICROTEMAS = [
  "tarifa", "obras", "multa", "contrato", "reequilibrio",
  "fiscalizacao", "seguranca", "ambiental", "desapropriacao",
  "adimplencia", "pessoal", "usuario", "outros",
];

export default function EmpresasPage() {
  const [agenciaId, setAgenciaId] = useState("");
  const [microtema, setMicrotema] = useState("");
  const [search, setSearch]       = useState("");
  const [expanded, setExpanded]   = useState<string | null>(null);

  const { data: agencias } = useQuery({
    queryKey: ["agencias"],
    queryFn: () => api.get<Agencia[]>("/agencias"),
  });

  const qs = new URLSearchParams();
  if (agenciaId) qs.set("agencia_id", agenciaId);
  if (microtema) qs.set("microtema", microtema);
  const qsStr = qs.toString() ? `?${qs.toString()}` : "";

  const { data: empresas = [], isLoading } = useQuery({
    queryKey: ["empresas", agenciaId, microtema],
    queryFn: () => api.get<EmpresaStats[]>(`/empresas${qsStr}`),
  });

  // Also fetch deliberacoes for expanded company details
  const { data: deliberacoesData } = useQuery({
    queryKey: ["deliberacoes", agenciaId, "all"],
    queryFn: () => api.get<{ data: Deliberacao[]; total: number; pages: number }>(`/deliberacoes?limit=100${agenciaId ? `&agencia_id=${agenciaId}` : ""}`),
    enabled: expanded !== null,
  });

  // Detalhe da empresa expandida (resolve via empresa_id; traz votos por diretor)
  const { data: empresaDetalhe } = useQuery({
    queryKey: ["empresa-detalhe", expanded],
    queryFn: () => api.get<EmpresaDetalhe>(`/empresas/${encodeURIComponent(expanded!)}`),
    enabled: expanded !== null,
  });

  const filtered = useMemo(() => {
    if (!search) return empresas;
    const q = search.toLowerCase();
    return empresas.filter((e) => e.nome.toLowerCase().includes(q));
  }, [empresas, search]);

  const topEmpresa = empresas[0] ?? null;
  const maisRecente = [...empresas].sort((a, b) =>
    (b.ultima_deliberacao ?? "").localeCompare(a.ultima_deliberacao ?? "")
  )[0] ?? null;

  const getDelibsForEmpresa = (nome: string) => {
    return (deliberacoesData?.data ?? [])
      .filter((d) => d.interessado === nome)
      .sort((a, b) => (b.data_reuniao ?? "").localeCompare(a.data_reuniao ?? ""))
      .slice(0, 5);
  };

  return (
    <div className="space-y-6 animate-fade-in">
      <ModuleTabs tabs={REGULATORIO_TABS} />
      {/* Header */}
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-xl font-semibold text-text-primary">Empresas Reguladas</h1>
            <HelpTooltip text="Empresas e concessionárias identificadas nas deliberações. Risco calculado pela taxa de aprovação histórica." />
          </div>
          <p className="text-sm text-text-muted mt-0.5">
            Empresas e concessionárias sob supervisão regulatória — extraídas das deliberações
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
            className="select w-44 text-xs"
            value={microtema}
            onChange={(e) => setMicrotema(e.target.value)}
          >
            <option value="">Todos os setores</option>
            {MICROTEMAS.map((m) => (
              <option key={m} value={m}>{getMicrotemaLabel(m)}</option>
            ))}
          </select>

          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-text-muted" />
            <input
              type="text"
              className="input pl-8 w-56 text-xs"
              placeholder="Buscar empresa..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>

          {(agenciaId || microtema || search) && (
            <button
              className="text-xs text-text-muted hover:text-brand transition-colors"
              onClick={() => { setAgenciaId(""); setMicrotema(""); setSearch(""); }}
            >
              Limpar
            </button>
          )}
        </div>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-3 gap-4">
        <div className="card">
          <p className="section-label mb-1">Total de Empresas</p>
          <p className="font-mono text-3xl text-text-primary">{formatNumber(empresas.length)}</p>
        </div>
        <div className="card">
          <p className="section-label mb-1">Mais Deliberações</p>
          {topEmpresa ? (
            <>
              <p className="text-base font-semibold text-text-primary leading-tight">{topEmpresa.nome}</p>
              <p className="text-xs text-text-muted mt-0.5">{topEmpresa.total_deliberacoes} deliberações</p>
            </>
          ) : (
            <p className="text-text-muted text-sm">—</p>
          )}
        </div>
        <div className="card">
          <p className="section-label mb-1">Atividade Recente</p>
          {maisRecente ? (
            <>
              <p className="text-base font-semibold text-text-primary leading-tight">{maisRecente.nome}</p>
              <p className="text-xs text-text-muted mt-0.5">{formatDate(maisRecente.ultima_deliberacao)}</p>
            </>
          ) : (
            <p className="text-text-muted text-sm">—</p>
          )}
        </div>
      </div>

      {/* Company list */}
      {isLoading ? (
        <div className="card py-16 text-center text-sm text-text-muted">Carregando empresas...</div>
      ) : filtered.length === 0 ? (
        <div className="card py-16 text-center">
          <Building2 className="w-8 h-8 text-text-muted mx-auto mb-2" />
          <p className="text-sm text-text-muted">Nenhuma empresa encontrada para os filtros selecionados</p>
        </div>
      ) : (
        <div className="space-y-3">
          {filtered.map((empresa) => {
            const isOpen = expanded === empresa.nome;
            const delibs = isOpen ? getDelibsForEmpresa(empresa.nome) : [];

            return (
              <div key={empresa.nome} className="card overflow-hidden">
                {/* Card header (always visible) */}
                <button
                  className="w-full text-left"
                  onClick={() => setExpanded(isOpen ? null : empresa.nome)}
                >
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <h3 className="font-semibold text-text-primary text-sm">{empresa.nome}</h3>
                        {/* Badge de risco */}
                        {empresa.risco_regulatorio && (
                          <span className={cn(
                            "text-xs px-2 py-0.5 rounded-full font-mono border",
                            empresa.risco_regulatorio === "alto"  ? "bg-red-500/15 text-red-400 border-red-500/25" :
                            empresa.risco_regulatorio === "medio" ? "bg-amber-500/15 text-amber-400 border-amber-500/25" :
                                                                    "bg-emerald-500/15 text-emerald-400 border-emerald-500/25"
                          )}>
                            {empresa.risco_regulatorio === "alto" ? "Risco Alto" : empresa.risco_regulatorio === "medio" ? "Risco Médio" : "Risco Baixo"}
                          </span>
                        )}
                        {/* Tendência */}
                        {empresa.tendencia_direcao && empresa.tendencia_direcao !== "estavel" && (
                          empresa.tendencia_direcao === "melhorando"
                            ? <TrendingUp className="w-3.5 h-3.5 text-emerald-400" />
                            : <TrendingDown className="w-3.5 h-3.5 text-red-400" />
                        )}
                        {empresa.microtema_principal && (
                          <span
                            className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium"
                            style={{
                              backgroundColor: getMicrotemaColor(empresa.microtema_principal) + "22",
                              color: getMicrotemaColor(empresa.microtema_principal),
                            }}
                          >
                            {getMicrotemaLabel(empresa.microtema_principal)}
                          </span>
                        )}
                        {empresa.microtemas.length > 1 && (
                          <span className="text-xs text-text-muted">
                            +{empresa.microtemas.length - 1} setor{empresa.microtemas.length > 2 ? "es" : ""}
                          </span>
                        )}
                      </div>
                      <div className="flex items-center gap-4 mt-2 flex-wrap">
                        <span className="text-xs text-text-muted">
                          <span className="font-mono text-text-primary font-medium">{empresa.total_deliberacoes}</span> deliberações
                        </span>
                        <span className="text-xs text-text-muted">
                          Última: <span className="text-text-secondary">{formatDate(empresa.ultima_deliberacao)}</span>
                        </span>
                      </div>
                    </div>

                    <div className="flex items-center gap-4 shrink-0">
                      {/* Deferimento bar */}
                      <div className="hidden sm:flex flex-col items-end gap-1 w-28">
                        <span className="text-xs text-text-muted">Taxa deferimento</span>
                        <div className="flex items-center gap-2 w-full">
                          <div className="flex-1 bg-bg-hover rounded-full h-1.5">
                            <div
                              className="h-1.5 rounded-full bg-success"
                              style={{ width: `${empresa.pct_deferido}%` }}
                            />
                          </div>
                          <span className="font-mono text-xs text-text-muted w-8 text-right">
                            {empresa.pct_deferido.toFixed(0)}%
                          </span>
                        </div>
                      </div>

                      {isOpen
                        ? <ChevronUp className="w-4 h-4 text-text-muted shrink-0" />
                        : <ChevronDown className="w-4 h-4 text-text-muted shrink-0" />
                      }
                    </div>
                  </div>
                </button>

                {/* Expanded content */}
                {isOpen && (
                  <div className="mt-4 pt-4 border-t border-border space-y-4">
                    {/* Diretores que decidiram os casos desta empresa */}
                    {(empresaDetalhe?.diretores?.length ?? 0) > 0 && (
                      <div>
                        <p className="text-xs text-text-muted mb-2 font-mono uppercase tracking-wider">Diretores que decidiram</p>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
                          {empresaDetalhe!.diretores.slice(0, 8).map((dir) => (
                            <Link
                              key={dir.id}
                              href={`/dashboard/diretores/${dir.id}`}
                              className="flex items-center justify-between gap-2 px-2 py-1 rounded border border-border/60 hover:bg-bg-hover transition-colors"
                            >
                              <span className="text-xs text-text-secondary truncate">{dir.nome}</span>
                              <span className="text-[10px] font-mono shrink-0 flex items-center gap-1.5">
                                <span className="text-emerald-400">{dir.favoravel}✓</span>
                                {(dir.desfavoravel ?? 0) > 0 && <span className="text-red-400">{dir.desfavoravel}✗</span>}
                                {(dir.divergente ?? 0) > 0 && <span className="text-amber-400">⚡{dir.divergente}</span>}
                              </span>
                            </Link>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* All microtemas */}
                    <div>
                      <p className="text-xs text-text-muted mb-2 font-mono uppercase tracking-wider">Setores</p>
                      <div className="flex flex-wrap gap-1.5">
                        {empresa.microtemas.map((mt) => (
                          <span
                            key={mt}
                            className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium"
                            style={{
                              backgroundColor: getMicrotemaColor(mt) + "22",
                              color: getMicrotemaColor(mt),
                            }}
                          >
                            {getMicrotemaLabel(mt)}
                          </span>
                        ))}
                      </div>
                    </div>

                    {/* Deferido vs Indeferido */}
                    <div>
                      <p className="text-xs text-text-muted mb-2 font-mono uppercase tracking-wider">Resultados</p>
                      <div className="flex items-center gap-3">
                        <div className="flex-1 bg-bg-hover rounded-full h-3 overflow-hidden">
                          <div
                            className="h-3 bg-success rounded-l-full"
                            style={{ width: `${empresa.pct_deferido}%` }}
                          />
                        </div>
                        <div className="flex gap-3 text-xs shrink-0">
                          <span className="text-success font-mono">{empresa.deferidos} deferidos</span>
                          {empresa.indeferidos > 0 && (
                            <span className="text-error font-mono">{empresa.indeferidos} indeferidos</span>
                          )}
                        </div>
                      </div>
                    </div>

                    {/* Recent deliberações */}
                    {delibs.length > 0 && (
                      <div>
                        <p className="text-xs text-text-muted mb-2 font-mono uppercase tracking-wider">
                          Deliberações Recentes
                        </p>
                        <table className="w-full text-xs">
                          <thead>
                            <tr className="border-b border-border">
                              {["Data", "Número", "Microtema", "Resultado"].map((h) => (
                                <th key={h} className="px-2 py-1.5 text-left text-text-muted font-mono uppercase tracking-wider">
                                  {h}
                                </th>
                              ))}
                            </tr>
                          </thead>
                          <tbody>
                            {delibs.map((d) => (
                              <tr key={d.id} className="border-b border-border/40 hover:bg-bg-hover transition-colors">
                                <td className="px-2 py-2 font-mono text-text-secondary">{formatDate(d.data_reuniao)}</td>
                                <td className="px-2 py-2">
                                  <Link
                                    href={`/dashboard/deliberacoes/${d.id}`}
                                    className="text-brand hover:underline"
                                  >
                                    {d.numero_deliberacao ?? d.id.slice(0, 8)}
                                  </Link>
                                </td>
                                <td className="px-2 py-2">
                                  {d.microtema && (
                                    <span
                                      className="px-1.5 py-0.5 rounded text-xs"
                                      style={{
                                        backgroundColor: getMicrotemaColor(d.microtema) + "22",
                                        color: getMicrotemaColor(d.microtema),
                                      }}
                                    >
                                      {getMicrotemaLabel(d.microtema)}
                                    </span>
                                  )}
                                </td>
                                <td className={cn(
                                  "px-2 py-2 font-medium",
                                  isResultadoPositivo(d.resultado) ? "text-success" : d.resultado === "Indeferido" ? "text-error" : "text-text-muted"
                                )}>
                                  {d.resultado ?? "—"}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}

                    {/* Links */}
                    <div className="flex items-center justify-end gap-4">
                      <Link
                        href={`/dashboard/deliberacoes?search=${encodeURIComponent(empresa.nome)}`}
                        className="text-xs text-text-muted hover:text-brand transition-colors"
                      >
                        Ver deliberações →
                      </Link>
                      <Link
                        href={`/dashboard/empresas/${encodeURIComponent(empresa.nome)}`}
                        className="text-xs text-brand hover:underline flex items-center gap-1"
                      >
                        <ExternalLink className="w-3 h-3" />
                        Perfil completo
                      </Link>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
