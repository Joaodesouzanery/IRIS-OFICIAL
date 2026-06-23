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
  DiretorVotoItem,
  MonitoramentoCheckResponse,
  MonitoramentoItem,
  MonitoramentoSite,
} from "@/types";
import {
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Download,
  ExternalLink,
  FileText,
  Gavel,
  Loader2,
  RefreshCw,
  Upload,
  Users,
  X,
} from "lucide-react";

const COLEGIADO_SIGLAS = ["ANTT", "ANM", "ARTESP"];

type BackfillResponse = {
  ano: number;
  fontes_processadas: number;
  novos_itens: number;
  documentos_enfileirados: number;
  demo?: boolean;
};

type VotosDiretoresResponse = {
  sources: MonitoramentoSite[];
  itens: MonitoramentoItem[];
  demo?: boolean;
};

type EnqueueResponse = {
  candidates: number;
  queued: number;
  enqueued_jobs: number;
};

export default function VotosDiretoresPage() {
  const queryClient = useQueryClient();
  const { demoEnabled } = useDataSyncContext();
  const [agenciaId, setAgenciaId] = useState("");
  const [selectedDirector, setSelectedDirector] = useState<DiretorOverviewItem | null>(null);

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

  const { data: drilldownVotos, isLoading: drilldownLoading } = useQuery({
    queryKey: ["diretor-votos", selectedDirector?.diretor_id, agenciaId],
    queryFn: () =>
      api.get<DiretorVotoItem[]>(
        `/dashboard/diretores/${selectedDirector!.diretor_id}/votos${agenciaId ? `?agencia_id=${agenciaId}` : ""}`
      ),
    enabled: !!selectedDirector,
  });

  const checkMutation = useMutation({
    mutationFn: () => api.get<MonitoramentoCheckResponse>("/monitoramento/check"),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["votos-diretores"] });
    },
  });

  const backfillMutation = useMutation({
    mutationFn: () => api.post<BackfillResponse>("/deliberacoes/votos-diretores/backfill"),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["votos-diretores"] });
      queryClient.invalidateQueries({ queryKey: ["dashboard", "diretores-overview", "votos"] });
    },
  });

  const enqueueMutation = useMutation({
    mutationFn: () => api.post<EnqueueResponse>("/deliberacoes/enqueue-pdfs", {}),
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

  function toggleDirector(d: DiretorOverviewItem) {
    setSelectedDirector((prev) => (prev?.diretor_id === d.diretor_id ? null : d));
  }

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
        <div className="flex flex-wrap gap-2">
          <button
            onClick={() => backfillMutation.mutate()}
            disabled={backfillMutation.isPending || checkMutation.isPending || demoEnabled}
            className="btn-primary"
            title="Busca e processa todas as deliberações de 2026 das 3 agências"
          >
            {backfillMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}
            Buscar todas de 2026
          </button>
          <button
            onClick={() => checkMutation.mutate()}
            disabled={checkMutation.isPending || backfillMutation.isPending || demoEnabled}
            className="btn-secondary"
          >
            {checkMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
            Verificar novos
          </button>
          <button
            onClick={() => enqueueMutation.mutate()}
            disabled={enqueueMutation.isPending || demoEnabled}
            className="btn-secondary"
            title="Baixa e enfileira os PDFs de atas/votos detectados para extração dos votos individuais"
          >
            {enqueueMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />}
            Processar atas/votos
          </button>
        </div>
      </div>

      {demoEnabled ? (
        <div className="border border-error/30 bg-error/10 rounded-card p-3 text-sm text-error">
          Modo DEMO ativo: a captura automática e a geração de métricas ficam bloqueadas em somente leitura.
        </div>
      ) : null}

      {backfillMutation.data ? (
        <div className="border border-success/30 bg-success/10 rounded-card p-3 text-sm text-success">
          Backfill {backfillMutation.data.ano}: {backfillMutation.data.fontes_processadas} fonte(s) ·{" "}
          {backfillMutation.data.novos_itens} novo(s) item(ns) · {backfillMutation.data.documentos_enfileirados} documento(s)
          enfileirado(s) para extração. Confirme os votos em{" "}
          <a href="/dashboard/upload" className="underline">Upload de PDFs</a>.
        </div>
      ) : null}
      {backfillMutation.error ? (
        <div className="border border-error/30 bg-error/10 rounded-card p-3 text-sm text-error">
          {backfillMutation.error instanceof Error ? backfillMutation.error.message : "Erro no backfill de 2026"}
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
      {enqueueMutation.data ? (
        <div className="border border-success/30 bg-success/10 rounded-card p-3 text-sm text-success">
          {enqueueMutation.data.candidates} PDF(s) de decisão encontrado(s) · {enqueueMutation.data.queued} enfileirado(s) para
          extração. Revise e confirme os votos individuais em{" "}
          <a href="/dashboard/upload" className="underline">Upload de PDFs</a>.
        </div>
      ) : null}
      {enqueueMutation.error ? (
        <div className="border border-error/30 bg-error/10 rounded-card p-3 text-sm text-error">
          {enqueueMutation.error instanceof Error ? enqueueMutation.error.message : "Erro ao processar atas/votos"}
        </div>
      ) : null}

      {/* ── Fontes monitoradas ───────────────────────────────────────────── */}
      <section className="card space-y-3">
        <p className="section-label">Fontes de reuniões colegiadas</p>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          {isLoading ? (
            <p className="text-sm text-text-muted">Carregando fontes...</p>
          ) : sources.length === 0 ? (
            <p className="text-sm text-text-muted">Nenhuma fonte cadastrada ainda. Clique em &ldquo;Verificar novos documentos&rdquo;.</p>
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
          <select className="select w-44" value={agenciaId} onChange={(e) => { setAgenciaId(e.target.value); setSelectedDirector(null); }}>
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
                  <th className="py-2 pl-3 font-medium w-8" />
                </tr>
              </thead>
              <tbody>
                {diretores.map((d) => (
                  <>
                    <tr
                      key={d.diretor_id}
                      className={cn(
                        "border-b border-border/60 cursor-pointer hover:bg-bg-hover transition-colors",
                        selectedDirector?.diretor_id === d.diretor_id && "bg-bg-hover",
                      )}
                      onClick={() => toggleDirector(d)}
                    >
                      <td className="py-2 pr-3 text-text-primary font-medium">{d.diretor_nome}</td>
                      <td className="py-2 px-3 text-right text-text-secondary">{formatNumber(d.total)}</td>
                      <td className="py-2 px-3 text-right text-success">{formatNumber(d.favoravel)}</td>
                      <td className="py-2 px-3 text-right text-text-secondary">{formatNumber(d.desfavoravel)}</td>
                      <td className="py-2 px-3 text-right text-warning">{formatNumber(d.divergente)}</td>
                      <td className="py-2 pl-3 text-right text-text-primary">{d.pct_favor.toFixed(1)}%</td>
                      <td className="py-2 pl-3 text-right text-text-muted">
                        {selectedDirector?.diretor_id === d.diretor_id
                          ? <ChevronUp className="w-3.5 h-3.5 inline" />
                          : <ChevronDown className="w-3.5 h-3.5 inline" />}
                      </td>
                    </tr>
                    {selectedDirector?.diretor_id === d.diretor_id ? (
                      <tr key={`${d.diretor_id}-drilldown`}>
                        <td colSpan={7} className="pb-3 pt-1 px-0">
                          <DrilldownPanel
                            diretor={d}
                            votos={drilldownVotos ?? []}
                            isLoading={drilldownLoading}
                            onClose={() => setSelectedDirector(null)}
                          />
                        </td>
                      </tr>
                    ) : null}
                  </>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="text-xs text-text-label">
          As métricas (tipo de voto, tema/microtema, contagem e divergência) são calculadas pelo mesmo
          pipeline das deliberações, agora alimentado também pelos votos individuais de cada diretor.
          Clique em um diretor para ver o histórico de deliberações.
        </p>
      </section>
    </div>
  );
}

function DrilldownPanel({
  diretor,
  votos,
  isLoading,
  onClose,
}: {
  diretor: DiretorOverviewItem;
  votos: DiretorVotoItem[];
  isLoading: boolean;
  onClose: () => void;
}) {
  return (
    <div className="mx-0 border border-brand/20 bg-bg-hover rounded-md p-3 space-y-2">
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs font-medium text-text-primary">
          Deliberações de <span className="text-brand">{diretor.diretor_nome}</span>
        </p>
        <button onClick={onClose} className="text-text-muted hover:text-text-primary">
          <X className="w-3.5 h-3.5" />
        </button>
      </div>

      {isLoading ? (
        <div className="flex items-center gap-2 py-3 text-text-muted text-sm">
          <Loader2 className="w-4 h-4 animate-spin" /> Carregando deliberações...
        </div>
      ) : votos.length === 0 ? (
        <p className="text-sm text-text-muted py-2">Nenhuma deliberação registrada para este diretor.</p>
      ) : (
        <div className="overflow-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="text-left text-text-label border-b border-border">
                <th className="py-1.5 pr-3 font-medium">Deliberação</th>
                <th className="py-1.5 px-2 font-medium">Agência</th>
                <th className="py-1.5 px-2 font-medium">Microtema</th>
                <th className="py-1.5 px-2 font-medium">Resultado</th>
                <th className="py-1.5 px-2 font-medium">Voto</th>
                <th className="py-1.5 pl-2 font-medium">Data</th>
              </tr>
            </thead>
            <tbody>
              {votos.map((v) => (
                <tr key={v.id} className="border-b border-border/40 hover:bg-bg-card transition-colors">
                  <td className="py-1.5 pr-3 text-text-secondary max-w-[200px] truncate">
                    {v.deliberacao?.numero_deliberacao ?? v.deliberacao?.assunto ?? "—"}
                  </td>
                  <td className="py-1.5 px-2 text-text-muted">{v.deliberacao?.agencia?.sigla ?? "—"}</td>
                  <td className="py-1.5 px-2 text-text-muted">
                    {v.deliberacao?.microtema ?? "—"}
                  </td>
                  <td className="py-1.5 px-2 text-text-secondary">{v.deliberacao?.resultado ?? "—"}</td>
                  <td className="py-1.5 px-2">
                    <span className={cn(
                      "badge text-[10px]",
                      v.tipo_voto === "Favoravel" && "badge-green",
                      v.tipo_voto === "Desfavoravel" && "badge-red",
                      v.is_divergente && "badge-orange",
                      !["Favoravel", "Desfavoravel"].includes(v.tipo_voto) && "badge-gray",
                    )}>
                      {v.tipo_voto}
                      {v.is_divergente ? " · div." : ""}
                    </span>
                  </td>
                  <td className="py-1.5 pl-2 text-text-muted whitespace-nowrap">
                    {v.deliberacao?.data_reuniao
                      ? new Date(v.deliberacao.data_reuniao).toLocaleDateString("pt-BR")
                      : v.created_at
                        ? new Date(v.created_at).toLocaleDateString("pt-BR")
                        : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
