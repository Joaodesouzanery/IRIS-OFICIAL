"use client";

import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { cn, formatDateLong, formatNumber } from "@/lib/utils";
import { ModuleTabs } from "@/components/ui/ModuleTabs";
import { DELIBERACOES_TABS } from "@/lib/module-tabs";
import { useDataSyncContext } from "@/components/DataSyncProvider";
import type {
  Agencia,
  DiretorOverviewItem,
  MonitoramentoCheckResponse,
  MonitoramentoItem,
  MonitoramentoSite,
} from "@/types";
import {
  CheckCircle2,
  ExternalLink,
  FileText,
  Gavel,
  Loader2,
  RefreshCw,
  Upload,
  Users,
} from "lucide-react";

const COLEGIADO_SIGLAS = ["ANTT", "ANM", "ARTESP"];

type VotosDiretoresResponse = {
  sources: MonitoramentoSite[];
  itens: MonitoramentoItem[];
  demo?: boolean;
};

export default function VotosDiretoresPage() {
  const queryClient = useQueryClient();
  const { demoEnabled } = useDataSyncContext();
  const [agenciaId, setAgenciaId] = useState("");

  const { data, isLoading } = useQuery({
    queryKey: ["votos-diretores", "fontes"],
    queryFn: () => api.get<VotosDiretoresResponse>("/deliberacoes/votos-diretores"),
  });

  const { data: agencias } = useQuery({
    queryKey: ["agencias"],
    queryFn: () => api.get<Agencia[]>("/agencias"),
  });

  const { data: diretores } = useQuery({
    queryKey: ["dashboard", "diretores-overview", "votos", agenciaId],
    queryFn: () => api.get<DiretorOverviewItem[]>(`/dashboard/diretores/overview${agenciaId ? `?agencia_id=${agenciaId}` : ""}`),
  });

  const checkMutation = useMutation({
    mutationFn: () => api.get<MonitoramentoCheckResponse>("/monitoramento/check"),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["votos-diretores"] });
    },
  });

  const colegiadoAgencias = useMemo(
    () => (agencias ?? []).filter((a) => COLEGIADO_SIGLAS.includes(a.sigla)),
    [agencias],
  );

  const sources = data?.sources ?? [];
  const itens = data?.itens ?? [];

  return (
    <div className="space-y-6 animate-fade-in">
      <ModuleTabs tabs={DELIBERACOES_TABS} />

      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <div className="flex items-center gap-2">
            <Gavel className="w-5 h-5 text-brand" />
            <h1 className="text-xl font-semibold text-text-primary">Votos dos Diretores</h1>
          </div>
          <p className="text-sm text-text-muted mt-1">
            Captura automática das decisões das reuniões colegiadas (ANTT, ANM e ARTESP) e métricas por diretor.
          </p>
        </div>
        <button
          onClick={() => checkMutation.mutate()}
          disabled={checkMutation.isPending || demoEnabled}
          className="btn-primary"
        >
          {checkMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
          Verificar novos documentos
        </button>
      </div>

      {demoEnabled ? (
        <div className="border border-error/30 bg-error/10 rounded-card p-3 text-sm text-error">
          Modo DEMO ativo: a captura automática e a geração de métricas ficam bloqueadas em somente leitura.
        </div>
      ) : null}

      {checkMutation.data ? (
        <div className="border border-success/30 bg-success/10 rounded-card p-3 text-sm text-success">
          {checkMutation.data.checked} fonte(s) verificada(s) · {checkMutation.data.novos_detectados} novo(s) documento(s) detectado(s) e enfileirado(s) para extração.
        </div>
      ) : null}
      {checkMutation.error ? (
        <div className="border border-error/30 bg-error/10 rounded-card p-3 text-sm text-error">
          {checkMutation.error instanceof Error ? checkMutation.error.message : "Erro ao verificar documentos"}
        </div>
      ) : null}

      {/* ── Fontes monitoradas ───────────────────────────────────────────── */}
      <section className="card space-y-3">
        <p className="section-label">Fontes de reuniões colegiadas</p>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          {isLoading ? (
            <p className="text-sm text-text-muted">Carregando fontes...</p>
          ) : sources.length === 0 ? (
            <p className="text-sm text-text-muted">Nenhuma fonte cadastrada ainda. Clique em “Verificar novos documentos”.</p>
          ) : sources.map((site) => (
            <div key={site.id} className="rounded-md border border-border bg-bg-hover p-3">
              <div className="flex items-center justify-between gap-2">
                <p className="text-sm font-medium text-text-primary">{site.agencia?.sigla ?? site.nome}</p>
                <span className={cn(
                  "badge text-xs",
                  site.ultimo_status === "ok" && "badge-green",
                  site.ultimo_status === "error" && "badge-red",
                  (site.ultimo_status === "never" || site.ultimo_status === "needs_headless") && "badge-gray",
                )}>
                  {site.ultimo_status === "ok" ? "ok" : site.ultimo_status === "error" ? "falha" : site.ultimo_status === "needs_headless" ? "requer navegação" : "sem verificação"}
                </span>
              </div>
              <p className="text-xs text-text-muted mt-1 truncate">{site.nome}</p>
              <p className="text-xs text-text-label mt-1">
                Última verificação: {site.ultimo_check ? new Date(site.ultimo_check).toLocaleString("pt-BR") : "nunca"}
              </p>
              <a href={site.url} target="_blank" rel="noreferrer" className="text-xs text-brand hover:underline inline-flex items-center gap-1 mt-2">
                Abrir site <ExternalLink className="w-3 h-3" />
              </a>
            </div>
          ))}
        </div>
      </section>

      {/* ── Documentos detectados ────────────────────────────────────────── */}
      <section className="card space-y-3">
        <div className="flex items-center justify-between gap-2">
          <p className="section-label">Documentos de decisão detectados (2026)</p>
          <span className="text-xs text-text-muted">{itens.length} itens</span>
        </div>
        {itens.length === 0 ? (
          <p className="text-sm text-text-muted">
            Nenhum documento detectado ainda. Os votos individuais e métricas são gerados automaticamente
            quando novos documentos colegiados forem encontrados e processados.
          </p>
        ) : (
          <div className="space-y-2">
            {itens.map((item) => (
              <div key={item.id} className="flex items-start gap-3 p-3 border border-border rounded-md hover:bg-bg-hover transition-colors">
                <FileText className="w-4 h-4 text-text-muted shrink-0 mt-0.5" />
                <div className="flex-1 min-w-0">
                  <p className="text-sm text-text-primary font-medium line-clamp-2">{item.titulo}</p>
                  <p className="text-xs text-text-muted mt-0.5">
                    {item.agencia?.sigla ?? "—"} · {item.tipo}
                    {item.data_reuniao ? ` · ${formatDateLong(item.data_reuniao)}` : ""}
                  </p>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  {item.enfileirado_em ? (
                    <span className="badge badge-green text-xs inline-flex items-center gap-1">
                      <CheckCircle2 className="w-3 h-3" /> processado
                    </span>
                  ) : (
                    <span className="badge badge-gray text-xs">detectado</span>
                  )}
                  <a href={item.url_item} target="_blank" rel="noreferrer" className="text-brand hover:underline">
                    <ExternalLink className="w-3.5 h-3.5" />
                  </a>
                </div>
              </div>
            ))}
          </div>
        )}
        <div className="flex items-center gap-2 pt-2 border-t border-border">
          <Upload className="w-4 h-4 text-text-muted" />
          <p className="text-xs text-text-muted">
            Inserção de PDFs e ZIPs: para enviar documentos já baixados e revisar os votos antes de gerar métricas, use o{" "}
            <a href="/dashboard/upload" className="text-brand hover:underline">Upload de PDFs</a>.
          </p>
        </div>
      </section>

      {/* ── Métricas por diretor ─────────────────────────────────────────── */}
      <section className="card space-y-3">
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <div className="flex items-center gap-2">
            <Users className="w-4 h-4 text-brand" />
            <p className="section-label">Métricas por diretor</p>
          </div>
          <select className="select w-44" value={agenciaId} onChange={(e) => setAgenciaId(e.target.value)}>
            <option value="">Todas as agências</option>
            {colegiadoAgencias.map((a) => <option key={a.id} value={a.id}>{a.sigla}</option>)}
          </select>
        </div>
        {!diretores || diretores.length === 0 ? (
          <p className="text-sm text-text-muted">
            Sem métricas ainda. Elas aparecem aqui após o processamento dos documentos colegiados.
          </p>
        ) : (
          <div className="overflow-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-text-muted border-b border-border">
                  <th className="py-2 pr-3 font-medium">Diretor</th>
                  <th className="py-2 px-3 font-medium text-right">Votos</th>
                  <th className="py-2 px-3 font-medium text-right">Favoráveis</th>
                  <th className="py-2 px-3 font-medium text-right">Desfavoráveis</th>
                  <th className="py-2 px-3 font-medium text-right">Divergentes</th>
                  <th className="py-2 pl-3 font-medium text-right">% Favorável</th>
                </tr>
              </thead>
              <tbody>
                {diretores.map((d) => (
                  <tr key={d.diretor_id} className="border-b border-border/60">
                    <td className="py-2 pr-3 text-text-primary">{d.diretor_nome}</td>
                    <td className="py-2 px-3 text-right text-text-secondary">{formatNumber(d.total)}</td>
                    <td className="py-2 px-3 text-right text-success">{formatNumber(d.favoravel)}</td>
                    <td className="py-2 px-3 text-right text-text-secondary">{formatNumber(d.desfavoravel)}</td>
                    <td className="py-2 px-3 text-right text-warning">{formatNumber(d.divergente)}</td>
                    <td className="py-2 pl-3 text-right text-text-primary">{d.pct_favor.toFixed(1)}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="text-xs text-text-label">
          As métricas (tipo de voto, tema/microtema, contagem e divergência) são calculadas pelo mesmo
          pipeline das deliberações, agora alimentado também pelos votos individuais de cada diretor.
        </p>
      </section>
    </div>
  );
}
