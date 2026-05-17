"use client";

import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";
import Link from "next/link";
import { useDataSyncContext } from "@/components/DataSyncProvider";
import type {
  Agencia,
  DiretorCandidato,
  MonitoramentoAlerta,
  MonitoramentoCheckResponse,
  MonitoramentoRun,
  MonitoramentoSite,
  RuntimeStatus,
} from "@/types";
import {
  CheckCircle,
  ExternalLink,
  FileText,
  Loader2,
  Plus,
  Radar,
  RefreshCw,
  ShieldAlert,
  UserCheck,
} from "lucide-react";

type MonitorTestResponse = {
  site_id: string;
  status: "ok" | "error" | "needs_headless";
  itens_encontrados: number;
  sample?: Array<{ titulo: string; tipo: string; url_item: string }>;
  error?: string;
};

export default function MonitoramentoPage() {
  const queryClient = useQueryClient();
  const { demoEnabled } = useDataSyncContext();
  const [agenciaId, setAgenciaId] = useState("");
  const [nome, setNome] = useState("");
  const [url, setUrl] = useState("");
  const [createError, setCreateError] = useState<string | null>(null);

  const { data: agencias } = useQuery({
    queryKey: ["agencias"],
    queryFn: () => api.get<Agencia[]>("/agencias"),
  });

  const { data: sites } = useQuery({
    queryKey: ["monitoramento-sites"],
    queryFn: () => api.get<MonitoramentoSite[]>("/monitoramento/sites"),
  });

  const { data: alertas } = useQuery({
    queryKey: ["monitoramento-alertas"],
    queryFn: () => api.get<MonitoramentoAlerta[]>("/monitoramento/alertas"),
  });

  const { data: runs } = useQuery({
    queryKey: ["monitoramento-runs"],
    queryFn: () => api.get<MonitoramentoRun[]>("/monitoramento/runs"),
  });

  const { data: runtimeStatus } = useQuery({
    queryKey: ["system-status"],
    queryFn: () => api.get<RuntimeStatus>("/system/status"),
  });

  const { data: candidatos } = useQuery({
    queryKey: ["diretores-candidatos"],
    queryFn: () => api.get<DiretorCandidato[]>("/diretores/candidatos?status=pendente"),
  });

  const checkMutation = useMutation({
    mutationFn: () => api.get<MonitoramentoCheckResponse>("/monitoramento/check"),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["monitoramento-sites"] });
      queryClient.invalidateQueries({ queryKey: ["monitoramento-alertas"] });
      queryClient.invalidateQueries({ queryKey: ["monitoramento-runs"] });
    },
  });

  const createMutation = useMutation({
    mutationFn: () => api.post<MonitoramentoSite>("/monitoramento/sites", {
      agencia_id: agenciaId || null,
      nome,
      url,
      seletor_links: "a[href]",
    }),
    onSuccess: () => {
      setNome("");
      setUrl("");
      setCreateError(null);
      queryClient.invalidateQueries({ queryKey: ["monitoramento-sites"] });
    },
    onError: (err) => setCreateError(err instanceof Error ? err.message : "Erro ao cadastrar site"),
  });

  const testMutation = useMutation({
    mutationFn: (siteId: string) => api.post<MonitorTestResponse>(`/monitoramento/sites/${siteId}/test`),
  });

  const stats = useMemo(() => {
    const unread = (alertas ?? []).filter((a) => !a.lido && !a.resolvido).length;
    const needsHeadless = (sites ?? []).filter((s) => s.ultimo_status === "needs_headless").length;
    const errors = (sites ?? []).filter((s) => s.ultimo_status === "error").length;
    return { unread, needsHeadless, errors, candidatos: (candidatos ?? []).length };
  }, [alertas, candidatos, sites]);

  function handleCreate() {
    if (!nome.trim() || !url.trim()) return;
    createMutation.mutate();
  }

  return (
    <div className="max-w-6xl mx-auto space-y-6 animate-fade-in">
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <Radar className="w-5 h-5 text-brand" />
            <h1 className="text-xl font-semibold text-text-primary">Monitoramento</h1>
          </div>
          <p className="text-sm text-text-muted mt-1">
            Detecte novas reunioes, pautas, atas, deliberacoes, diretoria e mandatos. A importacao continua revisavel.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Link href="/dashboard/documentos-antt-2026" className="btn-secondary">
            <FileText className="w-4 h-4" />
            ANTT 2026
          </Link>
          <button
            onClick={() => checkMutation.mutate()}
            disabled={checkMutation.isPending || demoEnabled}
            className="btn-primary"
          >
            {checkMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
            Verificar agora
          </button>
        </div>
      </div>

      {runtimeStatus?.warnings?.length ? (
        <div className="border border-warning/30 bg-warning/10 rounded-card p-3 flex items-start gap-3">
          <ShieldAlert className="w-4 h-4 text-warning mt-0.5 shrink-0" />
          <div>
            <p className="text-sm font-medium text-text-primary">Persistencia em modo demo</p>
            <p className="text-xs text-text-muted mt-1">
              {runtimeStatus.warnings.join(" ")} O cron so grava runs e alertas quando Supabase estiver completo.
            </p>
          </div>
        </div>
      ) : null}

      {demoEnabled ? (
        <div className="border border-violet-400/30 bg-violet-500/10 rounded-card p-3 text-sm text-violet-200">
          Modo DEMO ativo: verificacoes, testes e cadastros de monitores ficam bloqueados em somente leitura.
        </div>
      ) : null}

      <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
        <Metric label="Sites ativos" value={(sites ?? []).filter((s) => s.ativo).length} />
        <Metric label="Alertas abertos" value={stats.unread} tone={stats.unread ? "warning" : "success"} />
        <Metric label="Pedem headless" value={stats.needsHeadless} tone={stats.needsHeadless ? "warning" : "default"} />
        <Metric label="Diretores pendentes" value={stats.candidatos} tone={stats.candidatos ? "warning" : "success"} />
      </div>

      <div className="card space-y-3">
        <p className="section-label">Novo site monitorado</p>
        <div className="grid grid-cols-1 md:grid-cols-[1fr_1fr_1.2fr_auto] gap-3">
          <select className="input" value={agenciaId} onChange={(e) => setAgenciaId(e.target.value)}>
            <option value="">Agencia opcional</option>
            {(agencias ?? []).map((a) => (
              <option key={a.id} value={a.id}>{a.sigla} - {a.nome}</option>
            ))}
          </select>
          <input className="input" value={nome} onChange={(e) => setNome(e.target.value)} placeholder="Nome do monitor" />
          <input className="input" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://..." />
          <button
            onClick={handleCreate}
            disabled={createMutation.isPending || demoEnabled || !nome.trim() || !url.trim()}
            className="btn-secondary"
          >
            {createMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
            Adicionar
          </button>
        </div>
        {createError && <p className="text-sm text-error">{createError}</p>}
      </div>

      <section className="grid grid-cols-1 xl:grid-cols-2 gap-6">
        <div className="card space-y-3">
          <p className="section-label">Alertas recentes</p>
          <div className="space-y-2 max-h-[520px] overflow-y-auto">
            {(alertas ?? []).length === 0 ? (
              <Empty text="Nenhum alerta detectado ainda." />
            ) : (
              (alertas ?? []).map((alerta) => (
                <div key={alerta.id} className="border border-border rounded-card p-3 space-y-2">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-text-primary truncate">{alerta.titulo}</p>
                      <p className="text-xs text-text-muted mt-0.5">
                        {alerta.agencia?.sigla ?? "Agencia nao definida"} · {alerta.site?.nome ?? "Site"}
                      </p>
                    </div>
                    <StatusBadge label={alerta.resolvido ? "resolvido" : alerta.lido ? "lido" : "novo"} />
                  </div>
                  <div className="flex items-center gap-2">
                    <a href={alerta.url_item} target="_blank" rel="noreferrer" className="btn-secondary text-xs">
                      <ExternalLink className="w-3.5 h-3.5" />
                      Abrir documento
                    </a>
                    <a href="/dashboard/upload" className="btn-primary text-xs">
                      Revisar/importar
                    </a>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>

        <div className="space-y-6">
          <div className="card space-y-3">
            <p className="section-label">Sites monitorados</p>
            {testMutation.data && (
              <div className="border border-border rounded-card p-3 bg-bg-elevated">
                <p className="text-sm text-text-primary">
                  Teste: {testMutation.data.itens_encontrados} itens encontrados · {testMutation.data.status}
                </p>
                {testMutation.data.error && <p className="text-xs text-error mt-1">{testMutation.data.error}</p>}
                {(testMutation.data.sample ?? []).slice(0, 3).map((item) => (
                  <p key={`${item.tipo}-${item.url_item}`} className="text-xs text-text-muted truncate mt-1">
                    {item.tipo} · {item.titulo}
                  </p>
                ))}
              </div>
            )}
            <div className="space-y-2">
              {(sites ?? []).map((site) => (
                <div key={site.id} className="border border-border rounded-card p-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-text-primary truncate">{site.nome}</p>
                      <p className="text-xs text-text-muted truncate">{site.url}</p>
                    </div>
                    <StatusBadge label={site.ultimo_status} />
                  </div>
                  <p className="text-xs text-text-label mt-2">
                    {site.agencia?.sigla ?? "Todas"} · {site.estrategia} · ultimo check: {site.ultimo_check ? new Date(site.ultimo_check).toLocaleString("pt-BR") : "nunca"}
                  </p>
                  <button
                    onClick={() => testMutation.mutate(site.id)}
                    disabled={testMutation.isPending || demoEnabled}
                    className="btn-secondary text-xs mt-3"
                  >
                    {testMutation.isPending && testMutation.variables === site.id ? (
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    ) : (
                      <RefreshCw className="w-3.5 h-3.5" />
                    )}
                    Testar monitor
                  </button>
                  {site.ultimo_erro && <p className="text-xs text-error mt-2">{site.ultimo_erro}</p>}
                </div>
              ))}
            </div>
          </div>

          <div className="card space-y-3">
            <div className="flex items-center justify-between gap-3">
              <p className="section-label">Diretores pendentes</p>
              <UserCheck className="w-4 h-4 text-text-muted" />
            </div>
            <div className="space-y-2 max-h-72 overflow-y-auto">
              {(candidatos ?? []).length === 0 ? (
                <Empty text="Nenhum diretor pendente de revisao." />
              ) : (
                (candidatos ?? []).map((candidato) => (
                  <div key={candidato.id} className="border border-border rounded-card p-3">
                    <p className="text-sm font-medium text-text-primary">{candidato.nome_detectado}</p>
                    <p className="text-xs text-text-muted mt-1">
                      {candidato.agencia?.sigla ?? "Agencia nao definida"} · fonte: {candidato.source_type} · {Math.round(candidato.confidence * 100)}%
                    </p>
                    <p className="text-xs text-text-label mt-2">
                      LGPD: somente nome, cargo/funcao publica, mandato e fonte oficial; sem CPF ou contato.
                    </p>
                  </div>
                ))
              )}
            </div>
          </div>

          <div className="card space-y-3">
            <p className="section-label">Historico de execucoes</p>
            <div className="space-y-2 max-h-72 overflow-y-auto">
              {(runs ?? []).length === 0 ? (
                <Empty text="Nenhuma execucao registrada." />
              ) : (
                (runs ?? []).map((run) => (
                  <div key={run.id} className="flex items-center justify-between gap-3 border border-border rounded-card p-3">
                    <div>
                      <p className="text-sm text-text-primary">{run.site?.nome ?? "Monitor"}</p>
                      <p className="text-xs text-text-muted">
                        {new Date(run.started_at).toLocaleString("pt-BR")} · {run.itens_encontrados} itens · {run.novos_itens} novos
                      </p>
                    </div>
                    <StatusBadge label={run.status} />
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}

function Metric({ label, value, tone = "default" }: { label: string; value: number; tone?: "default" | "success" | "warning" | "error" }) {
  return (
    <div className="card">
      <p className="text-xs text-text-label font-mono uppercase tracking-wider">{label}</p>
      <p className={cn(
        "text-2xl font-semibold mt-1",
        tone === "success" && "text-success",
        tone === "warning" && "text-warning",
        tone === "error" && "text-error",
        tone === "default" && "text-text-primary",
      )}>
        {value}
      </p>
    </div>
  );
}

function StatusBadge({ label }: { label: string }) {
  const normalized = label.replace("-", "_");
  const ok = ["ok", "importado", "resolvido", "aprovado"].includes(normalized);
  const warning = ["novo", "never", "running", "needs_headless", "needs-headless", "pendente"].includes(label);
  return (
    <span className={cn(
      "badge text-xs",
      ok && "bg-success/10 text-success",
      warning && "bg-warning/10 text-warning",
      !ok && !warning && "bg-error/10 text-error",
    )}>
      {label}
    </span>
  );
}

function Empty({ text }: { text: string }) {
  return (
    <div className="flex items-center gap-2 text-sm text-text-muted p-4 border border-dashed border-border rounded-card">
      <CheckCircle className="w-4 h-4 text-success" />
      {text}
    </div>
  );
}
