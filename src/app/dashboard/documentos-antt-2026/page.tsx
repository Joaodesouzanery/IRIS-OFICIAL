"use client";

import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";
import { useDataSyncContext } from "@/components/DataSyncProvider";
import type { AnttCollectResponse, AnttPreviewResponse, DocumentoColetado, DocumentoColetadoStatus } from "@/types";
import {
  CheckCircle,
  ExternalLink,
  FileDown,
  FileText,
  Loader2,
  RefreshCw,
  ShieldCheck,
  XCircle,
} from "lucide-react";

const PREVIEW_STORAGE_KEY = "iris_antt_2026_preview_pages_1_3";

const STATUS_LABELS: Record<DocumentoColetadoStatus, string> = {
  coletado: "Coletado",
  validado: "Validado",
  em_revisao: "Em revisao",
  importado: "Importado",
  ignorado: "Ignorado",
  erro: "Erro",
};

export default function DocumentosAntt2026Page() {
  const queryClient = useQueryClient();
  const { demoEnabled } = useDataSyncContext();
  const [status, setStatus] = useState<DocumentoColetadoStatus | "">("em_revisao");
  const [lastCollect, setLastCollect] = useState<AnttCollectResponse | null>(null);
  const [preview, setPreview] = useState<AnttPreviewResponse | null>(null);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(PREVIEW_STORAGE_KEY);
      if (raw) setPreview(JSON.parse(raw) as AnttPreviewResponse);
    } catch {
      localStorage.removeItem(PREVIEW_STORAGE_KEY);
    }
  }, []);

  const { data: documentos, isLoading } = useQuery({
    queryKey: ["antt-2026-documentos", status],
    queryFn: () => api.get<DocumentoColetado[]>(`/antt/2026/documentos${status ? `?status=${status}` : ""}`),
  });

  const collectMutation = useMutation({
    mutationFn: () => api.post<AnttCollectResponse>("/antt/2026/collect?max_pages=12&max_meetings=120"),
    onSuccess: (data) => {
      setLastCollect(data);
      queryClient.invalidateQueries({ queryKey: ["antt-2026-documentos"] });
      queryClient.invalidateQueries({ queryKey: ["monitoramento-runs"] });
    },
  });

  const previewMutation = useMutation({
    mutationFn: () => api.get<AnttPreviewResponse>("/antt/2026/collect?max_pages=3&max_meetings=60"),
    onSuccess: (data) => {
      setPreview(data);
      localStorage.setItem(PREVIEW_STORAGE_KEY, JSON.stringify(data));
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, nextStatus }: { id: string; nextStatus: DocumentoColetadoStatus }) =>
      api.patch<DocumentoColetado>(`/antt/2026/documentos/${id}`, { status: nextStatus }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["antt-2026-documentos"] });
    },
  });

  const downloadMutation = useMutation({
    mutationFn: (id: string) => api.get<{ url: string; expires_in: number }>(`/antt/2026/documentos/${id}/download`),
    onSuccess: (data) => {
      window.open(data.url, "_blank", "noopener,noreferrer");
    },
  });

  const stats = useMemo(() => {
    const docs = documentos ?? [];
    return {
      total: docs.length,
      pautas: docs.filter((doc) => doc.tipo === "pauta").length,
      votos: docs.filter((doc) => doc.tipo === "voto").length,
      erros: docs.filter((doc) => doc.status === "erro").length,
    };
  }, [documentos]);

  return (
    <div className="max-w-7xl mx-auto space-y-6 animate-fade-in">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <div className="flex items-center gap-2">
            <ShieldCheck className="w-5 h-5 text-brand" />
            <h1 className="text-xl font-semibold text-text-primary">Documentos ANTT 2026</h1>
          </div>
          <p className="text-sm text-text-muted mt-1">
            Pautas e votos coletados do portal oficial para revisao antes da importacao.
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <button
            onClick={() => previewMutation.mutate()}
            disabled={previewMutation.isPending}
            className="btn-primary"
          >
            {previewMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
            Coletar previa ANTT 2026
          </button>
          <button
            onClick={() => collectMutation.mutate()}
            disabled={collectMutation.isPending || demoEnabled}
            className="btn-secondary"
            title="Disponivel quando Supabase e login administrativo estiverem configurados"
          >
            {collectMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <FileDown className="w-4 h-4" />}
            Salvar no Supabase
          </button>
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Metric label="Documentos" value={stats.total} />
        <Metric label="Pautas" value={stats.pautas} />
        <Metric label="Votos" value={stats.votos} />
        <Metric label="Erros" value={stats.erros} tone={stats.erros ? "error" : "success"} />
      </div>

      {demoEnabled && (
        <div className="border border-violet-400/30 bg-violet-500/10 rounded-card p-3 text-sm text-violet-200">
          Modo DEMO ativo: a previa da ANTT funciona sem Supabase. Validacao, download salvo e alteracoes ficam bloqueados para proteger os dados reais.
        </div>
      )}

      {previewMutation.isError && (
        <div className="border border-error/30 bg-error/10 rounded-card p-3 text-sm text-error">
          {previewMutation.error instanceof Error ? previewMutation.error.message : "Falha ao coletar previa da ANTT"}
        </div>
      )}

      {lastCollect && (
        <div className="border border-border rounded-card p-4 bg-bg-card">
          <div className="grid grid-cols-2 md:grid-cols-6 gap-3 text-sm">
            <CollectMetric label="Reunioes" value={lastCollect.reunioes_encontradas} />
            <CollectMetric label="Salvas" value={lastCollect.reunioes_salvas} />
            <CollectMetric label="Processos" value={lastCollect.processos_salvos} />
            <CollectMetric label="Docs" value={lastCollect.documentos_encontrados} />
            <CollectMetric label="Baixados" value={lastCollect.documentos_baixados} />
            <CollectMetric label="Duplicados" value={lastCollect.documentos_duplicados} />
          </div>
          {lastCollect.errors.length > 0 && (
            <div className="mt-3 text-xs text-error space-y-1">
              {lastCollect.errors.slice(0, 4).map((error) => (
                <p key={error}>{error}</p>
              ))}
            </div>
          )}
        </div>
      )}

      {preview && (
        <section className="card space-y-4">
          <div className="flex items-start justify-between gap-3 flex-wrap">
            <div>
              <p className="section-label">Previa local da ANTT 2026</p>
              <p className="text-xs text-text-muted mt-1">
                Coleta sem persistencia: ano 2026, paginas 1 a {preview.max_pages}, excluindo reunioes administrativas.
              </p>
              <a className="text-xs text-brand hover:underline inline-flex items-center gap-1 mt-1" href={preview.source_url} target="_blank" rel="noreferrer">
                Portal oficial da ANTT <ExternalLink className="w-3 h-3" />
              </a>
            </div>
            <div className="text-right">
              <p className="text-xs text-text-label font-mono uppercase">Coletado em</p>
              <p className="text-sm text-text-primary">{new Date(preview.collected_at).toLocaleString("pt-BR")}</p>
            </div>
          </div>

          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <CollectMetric label="Reunioes" value={preview.reunioes_encontradas} />
            <CollectMetric label="Processos" value={preview.processos_salvos} />
            <CollectMetric label="Documentos" value={preview.documentos_encontrados} />
            <CollectMetric label="Votos" value={preview.reunioes.reduce((sum, reuniao) => sum + reuniao.documentos.filter((doc) => doc.tipo === "voto").length, 0)} />
          </div>

          <div className="space-y-4">
            {preview.reunioes.length === 0 ? (
              <p className="text-sm text-text-muted">Nenhuma reuniao de diretoria ou deliberativa eletronica de 2026 encontrada nas tres primeiras paginas.</p>
            ) : preview.reunioes.map((reuniao) => (
              <div key={reuniao.url_reuniao} className="border border-border rounded-card p-4 space-y-3">
                <div className="flex items-start justify-between gap-3 flex-wrap">
                  <div>
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="badge badge-gray text-xs">{reuniao.tipo}</span>
                      <span className="text-xs text-text-label font-mono">{reuniao.data_inicio ?? "sem data"}</span>
                    </div>
                    <h2 className="text-sm font-semibold text-text-primary mt-1">{reuniao.titulo}</h2>
                    <p className="text-xs text-text-muted mt-0.5">
                      {reuniao.processos.length} processo(s) | {reuniao.documentos.length} documento(s)
                    </p>
                  </div>
                  <a className="btn-secondary text-xs" href={reuniao.url_reuniao} target="_blank" rel="noreferrer">
                    <ExternalLink className="w-3.5 h-3.5" />
                    Reuniao
                  </a>
                </div>

                {reuniao.documentos.filter((doc) => doc.tipo === "pauta").length > 0 && (
                  <div className="flex flex-wrap gap-2">
                    {reuniao.documentos.filter((doc) => doc.tipo === "pauta").map((doc) => (
                      <a key={doc.url} className="btn-secondary text-xs" href={doc.url} target="_blank" rel="noreferrer">
                        <FileText className="w-3.5 h-3.5" />
                        {doc.titulo || "Pauta"}
                      </a>
                    ))}
                  </div>
                )}

                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="border-b border-border/60">
                        {["Item", "Processo", "Relator", "Interessado", "Assunto", "Votos"].map((header) => (
                          <th key={header} className="px-2 py-2 text-left text-[10px] font-mono uppercase tracking-wider text-text-muted">
                            {header}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {reuniao.processos.length === 0 ? (
                        <tr>
                          <td colSpan={6} className="px-2 py-4 text-text-muted">Nenhum processo separado nesta reuniao.</td>
                        </tr>
                      ) : reuniao.processos.map((processo) => (
                        <tr key={`${reuniao.url_reuniao}-${processo.item_numero}-${processo.processo}`} className="border-b border-border/30 align-top">
                          <td className="px-2 py-3 font-mono text-text-label">{processo.item_numero ?? "-"}</td>
                          <td className="px-2 py-3 font-mono text-text-primary min-w-[140px]">{processo.processo ?? "-"}</td>
                          <td className="px-2 py-3 text-text-secondary min-w-[120px]">{processo.relator ?? "-"}</td>
                          <td className="px-2 py-3 text-text-secondary min-w-[180px]">{processo.interessado ?? "-"}</td>
                          <td className="px-2 py-3 text-text-muted min-w-[260px]">{processo.assunto ?? "-"}</td>
                          <td className="px-2 py-3 min-w-[180px]">
                            <div className="flex flex-col gap-1.5">
                              {processo.documentos.length === 0 ? (
                                <span className="text-text-label">Sem voto detectado</span>
                              ) : processo.documentos.map((doc) => (
                                <a key={doc.url} className="text-brand hover:underline inline-flex items-center gap-1" href={doc.url} target="_blank" rel="noreferrer">
                                  <ExternalLink className="w-3 h-3" />
                                  {doc.titulo || "Voto"}
                                </a>
                              ))}
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      <div className="card space-y-3">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <p className="section-label">Fila de revisao</p>
          <select
            className="select w-48"
            value={status}
            onChange={(event) => setStatus(event.target.value as DocumentoColetadoStatus | "")}
          >
            <option value="">Todos</option>
            {Object.entries(STATUS_LABELS).map(([value, label]) => (
              <option key={value} value={value}>{label}</option>
            ))}
          </select>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-border">
                {["Documento", "Reuniao", "Processo", "Relator", "Hash", "Status", ""].map((header) => (
                  <th key={header} className="px-3 py-3 text-left font-mono text-text-muted uppercase tracking-wider text-[10px]">
                    {header}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                <tr>
                  <td colSpan={7} className="px-3 py-10 text-center text-text-muted">Carregando...</td>
                </tr>
              ) : (documentos ?? []).length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-3 py-10 text-center text-text-muted">Nenhum documento encontrado</td>
                </tr>
              ) : (
                (documentos ?? []).map((doc) => (
                  <tr key={doc.id} className="border-b border-border/40 hover:bg-bg-hover/50 transition-colors align-top">
                    <td className="px-3 py-3 min-w-[220px]">
                      <div className="flex items-start gap-2">
                        <FileText className="w-4 h-4 text-brand mt-0.5 shrink-0" />
                        <div className="min-w-0">
                          <p className="font-medium text-text-primary truncate max-w-[260px]">{doc.titulo}</p>
                          <p className="text-text-label font-mono mt-0.5">{doc.tipo.toUpperCase()} · {formatBytes(doc.tamanho_bytes)}</p>
                        </div>
                      </div>
                    </td>
                    <td className="px-3 py-3 min-w-[180px]">
                      <p className="text-text-secondary">{doc.reuniao?.titulo ?? "-"}</p>
                      <p className="text-text-label font-mono mt-0.5">{doc.reuniao?.data_inicio ?? "-"}</p>
                    </td>
                    <td className="px-3 py-3 max-w-[220px]">
                      <p className="text-text-primary">{doc.processo?.processo ?? "-"}</p>
                      <p className="text-text-muted truncate mt-0.5">{doc.processo?.interessado ?? ""}</p>
                    </td>
                    <td className="px-3 py-3 text-text-secondary whitespace-nowrap">{doc.processo?.relator ?? "-"}</td>
                    <td className="px-3 py-3 font-mono text-text-label">
                      {doc.file_hash ? `${doc.file_hash.slice(0, 10)}...` : "-"}
                    </td>
                    <td className="px-3 py-3">
                      <StatusBadge status={doc.status} />
                      {doc.error_message && <p className="text-error mt-1 max-w-[200px]">{doc.error_message}</p>}
                    </td>
                    <td className="px-3 py-3">
                      <div className="flex items-center gap-1.5 justify-end">
                        <button
                          className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-border bg-bg-card text-text-muted hover:text-brand disabled:opacity-50"
                          title="Abrir PDF salvo"
                          onClick={() => downloadMutation.mutate(doc.id)}
                          disabled={!doc.storage_path || downloadMutation.isPending}
                        >
                          <FileDown className="w-4 h-4" />
                        </button>
                        <a className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-border bg-bg-card text-text-muted hover:text-brand" title="Abrir origem" href={doc.url_original} target="_blank" rel="noreferrer">
                          <ExternalLink className="w-4 h-4" />
                        </a>
                        <button
                          className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-border bg-bg-card text-success hover:border-success/40 disabled:opacity-50"
                          title="Validar"
                          onClick={() => updateMutation.mutate({ id: doc.id, nextStatus: "validado" })}
                          disabled={updateMutation.isPending || demoEnabled}
                        >
                          <CheckCircle className="w-4 h-4" />
                        </button>
                        <button
                          className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-border bg-bg-card text-error hover:border-error/40 disabled:opacity-50"
                          title="Ignorar"
                          onClick={() => updateMutation.mutate({ id: doc.id, nextStatus: "ignorado" })}
                          disabled={updateMutation.isPending || demoEnabled}
                        >
                          <XCircle className="w-4 h-4" />
                        </button>
                      </div>
                    </td>
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

function Metric({ label, value, tone = "default" }: { label: string; value: number; tone?: "default" | "success" | "error" }) {
  return (
    <div className="card">
      <p className="text-xs text-text-label font-mono uppercase tracking-wider">{label}</p>
      <p className={cn(
        "text-2xl font-semibold mt-1",
        tone === "success" && "text-success",
        tone === "error" && "text-error",
        tone === "default" && "text-text-primary",
      )}>
        {value}
      </p>
    </div>
  );
}

function CollectMetric({ label, value }: { label: string; value: number }) {
  return (
    <div>
      <p className="text-[10px] text-text-label font-mono uppercase tracking-wider">{label}</p>
      <p className="text-lg text-text-primary font-mono font-semibold">{value}</p>
    </div>
  );
}

function StatusBadge({ status }: { status: DocumentoColetadoStatus }) {
  const good = status === "validado" || status === "importado";
  const bad = status === "erro" || status === "ignorado";
  return (
    <span className={cn(
      "badge text-xs",
      good && "bg-success/10 text-success",
      bad && "bg-error/10 text-error",
      !good && !bad && "bg-warning/10 text-warning",
    )}>
      {STATUS_LABELS[status] ?? status}
    </span>
  );
}

function formatBytes(value: number | null) {
  if (!value) return "-";
  if (value < 1024 * 1024) return `${Math.round(value / 1024)} KB`;
  return `${(value / 1024 / 1024).toFixed(1)} MB`;
}
