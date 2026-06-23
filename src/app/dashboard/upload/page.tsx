"use client";

import { useState, useCallback } from "react";
import { useDropzone } from "react-dropzone";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { useDataSyncContext } from "@/components/DataSyncProvider";
import { AREAS_REGULATORIAS, cn, getAreaRegulatoriaLabel } from "@/lib/utils";
import type {
  Agencia,
  PreviewResult,
  PreviewResultFields,
  BatchPreviewResponse,
  BatchUploadResponse,
  DocumentoRegulatorio,
  DocumentoRegulatorioListResponse,
  BatchConfirmResponse,
  ConfirmDelib,
} from "@/types";
import {
  Upload, FileText, CheckCircle, XCircle, Loader2,
  ChevronDown, ChevronRight, Trash2, RefreshCw, Copy, AlertTriangle,
} from "lucide-react";
import { appendLocalDelibs, getLocalDelibs } from "@/lib/local-store";
import { HelpTooltip } from "@/components/ui/HelpTooltip";
import { ModuleTabs } from "@/components/ui/ModuleTabs";
import { DELIBERACOES_TABS } from "@/lib/module-tabs";

// ─── Constantes ─────────────────────────────────────────────────────────────

const BATCH_SIZE = 1; // processa pela fila; evita perder lotes grandes quando um arquivo falha
const PREVIEW_MAX_TOTAL_SIZE = 150 * 1024 * 1024;
const ASYNC_UPLOAD_MAX_BYTES = 120 * 1024 * 1024;
const ASYNC_UPLOAD_MAX_FILES = 50;

const RESULTADOS = [
  "Deferido", "Indeferido", "Parcialmente Deferido", "Retirado de Pauta",
  "Ratificado", "Aprovado", "Aprovado com Ressalvas", "Aprovado por Unanimidade",
  "Recomendado", "Determinado", "Autorizado",
] as const;

const MICROTEMAS = [
  "tarifa", "obras", "multa", "contrato", "reequilibrio",
  "fiscalizacao", "seguranca", "ambiental", "desapropriacao",
  "adimplencia", "pessoal", "usuario", "outros",
] as const;

// ─── Tipos locais ────────────────────────────────────────────────────────────

type Stage = "queue" | "analyzing" | "review" | "confirming" | "done";

interface QueuedFile {
  id: string;
  file: File;
  status: "pending" | "analyzing" | "done" | "error";
}

interface ReviewItem extends PreviewResult {
  id: string;
  documento_id?: string | null;
  upload_job_id?: string | null;
  documento_status?: DocumentoRegulatorio["status"] | null;
  signed_url?: string | null;
  texto_extraido?: string | null;
  rejected: boolean;
  edited: Partial<PreviewResultFields>;
  duplicate_reason?: string;
}

interface AnalyzeProgress {
  done: number;
  total: number;
}

// ─── Utilitários ─────────────────────────────────────────────────────────────

function confidenceColor(c: number) {
  if (c >= 0.8) return "text-success bg-success/10";
  if (c >= 0.5) return "text-warning bg-warning/10";
  return "text-error bg-error/10";
}

function confidenceLabel(c: number) {
  if (c >= 0.8) return "Alta";
  if (c >= 0.5) return "Média";
  return "Baixa";
}

function fmt(n: number) { return Math.round(n * 100) + "%"; }

function fmtSize(bytes: number) {
  if (bytes < 1024) return bytes + " B";
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + " KB";
  return (bytes / 1024 / 1024).toFixed(1) + " MB";
}

function chunkQueuedFiles(files: QueuedFile[]) {
  const chunks: QueuedFile[][] = [];
  let current: QueuedFile[] = [];
  let currentBytes = 0;

  for (const file of files) {
    const wouldExceedBytes = current.length > 0 && currentBytes + file.file.size > ASYNC_UPLOAD_MAX_BYTES;
    const wouldExceedCount = current.length >= ASYNC_UPLOAD_MAX_FILES;
    if (wouldExceedBytes || wouldExceedCount) {
      chunks.push(current);
      current = [];
      currentBytes = 0;
    }
    current.push(file);
    currentBytes += file.file.size;
  }

  if (current.length > 0) chunks.push(current);
  return chunks;
}

function errorPreviewResult(filename: string): PreviewResult {
  return {
    filename,
    status: "error",
    fields: {
      numero_deliberacao: null,
      numero_reuniao: null,
      reuniao_ordinaria: null,
      tipo_reuniao: null,
      tipo_documento: "documento_apoio",
      data_reuniao: null,
      data_publicacao: null,
      interessado: null,
      assunto: null,
      procedencia: null,
      relator: null,
      item_numero: null,
      processo: null,
      resultado: null,
      decisoes_todas: [],
      microtema: "outros",
      area_regulatoria: "outros",
      pauta_interna: false,
      resumo_pleito: null,
      fundamento_decisao: null,
      diretores_detectados: [],
      nomes_votacao: [],
      nomes_votacao_contra: [],
      nomes_votacao_abstencao: [],
      nomes_votacao_ausente: [],
      votos_sugeridos: [],
    },
    confidence: 0,
    page_count: 0,
    chars_per_page: 0,
    file_hash: "",
    is_duplicate: false,
    duplicate_job_id: null,
    agencia_id_detected: null,
    agencia_sigla_detected: null,
    import_counts_as_final: false,
  };
}

function missingFields(fields: PreviewResultFields, anttType?: string) {
  if (anttType && anttType !== "voto_individual") {
    const requiredAntt: Array<[keyof PreviewResultFields, string]> = [
      ["data_reuniao", "data"],
      ["processo", "processo"],
      ["interessado", "interessado"],
      ["assunto", "assunto"],
      ["relator", "relator"],
    ];
    return requiredAntt.filter(([key]) => !fields[key]).map(([, label]) => label);
  }
  const required: Array<[keyof PreviewResultFields, string]> = [
    ["numero_deliberacao", "número"],
    ["data_reuniao", "data"],
    ["resultado", "resultado"],
    ["processo", "processo"],
    ["assunto", "assunto"],
  ];
  return required.filter(([key]) => !fields[key]).map(([, label]) => label);
}

function formatAnttTypeLabel(type?: string | null) {
  switch (type) {
    case "reuniao_deliberativa_eletronica":
      return "Reunião Deliberativa Eletrônica";
    case "reuniao_diretoria_publica":
      return "Reunião de Diretoria Pública";
    case "reuniao_extraordinaria":
      return "Reunião Extraordinária";
    case "voto_individual":
      return "Voto Individual";
    case "ata":
      return "Ata";
    case "pauta":
      return "Pauta";
    default:
      return type ? type.replaceAll("_", " ") : "";
  }
}

function mostCommon<T>(arr: T[]): T | null {
  if (!arr.length) return null;
  const freq = new Map<T, number>();
  for (const v of arr) freq.set(v, (freq.get(v) ?? 0) + 1);
  return [...freq.entries()].sort((a, b) => b[1] - a[1])[0][0];
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ─── Componente: linha de arquivo na fila ──────────────────────────────────

function QueueRow({
  qf,
  onRemove,
}: {
  qf: QueuedFile;
  onRemove: (id: string) => void;
}) {
  return (
    <div className="flex items-center gap-3 px-3 py-2 rounded-md hover:bg-bg-hover transition-colors group">
      {qf.status === "analyzing" ? (
        <Loader2 className="w-4 h-4 shrink-0 text-brand animate-spin" />
      ) : qf.status === "done" ? (
        <CheckCircle className="w-4 h-4 shrink-0 text-success" />
      ) : qf.status === "error" ? (
        <XCircle className="w-4 h-4 shrink-0 text-error" />
      ) : (
        <FileText className="w-4 h-4 shrink-0 text-text-label" />
      )}
      <span className="flex-1 text-sm text-text-secondary truncate">{qf.file.name}</span>
      <span className="text-xs text-text-label font-mono shrink-0">{fmtSize(qf.file.size)}</span>
      {qf.status === "pending" && (
        <button
          onClick={() => onRemove(qf.id)}
          className="w-6 h-6 flex items-center justify-center rounded text-text-label
                     hover:text-error hover:bg-error/10 opacity-0 group-hover:opacity-100 transition-all"
          aria-label={`Remover ${qf.file.name}`}
        >
          <Trash2 className="w-3.5 h-3.5" />
        </button>
      )}
    </div>
  );
}

// ─── Componente: card de revisão por arquivo ──────────────────────────────

function documentToReviewItem(doc: DocumentoRegulatorio, index: number): ReviewItem {
  const preview = doc.preview ?? errorPreviewResult(doc.filename);
  const errorState = doc.status === "failed";
  const pendingState = ["queued", "processing"].includes(doc.status);
  return {
    ...preview,
    filename: doc.filename,
    source_archive: doc.source_archive ?? preview.source_archive,
    status: errorState ? "error" : pendingState ? "low_confidence" : preview.status,
    error: errorState ? doc.error_message ?? "Falha ao processar documento" : preview.error,
    file_hash: doc.file_hash || preview.file_hash,
    is_duplicate: Boolean(doc.is_duplicate || preview.is_duplicate),
    duplicate_reason: preview.duplicate_reason ?? (doc.is_duplicate ? "Possivel duplicata ja registrada" : undefined),
    agencia_id_detected: doc.agencia_id ?? preview.agencia_id_detected,
    agencia_sigla_detected: doc.agencia_sigla_detected ?? preview.agencia_sigla_detected,
    documento_subtipo: doc.documento_subtipo ?? preview.documento_subtipo,
    semantic_duplicate_key: doc.semantic_duplicate_key ?? preview.semantic_duplicate_key,
    confidence: doc.extraction_confidence ?? preview.confidence,
    page_count: doc.page_count ?? preview.page_count,
    chars_per_page: doc.chars_per_page ?? preview.chars_per_page,
    ata_items: doc.ata_items ?? preview.ata_items,
    warnings: doc.warnings ?? preview.warnings,
    id: doc.id || `${doc.file_hash}-${index}`,
    documento_id: doc.id,
    upload_job_id: doc.upload_job_id,
    documento_status: doc.status,
    signed_url: doc.signed_url,
    texto_extraido: doc.texto_extraido,
    rejected: false,
    edited: {},
  };
}

function ReviewCard({
  item,
  onUpdate,
  onReject,
  onReprocess,
}: {
  item: ReviewItem;
  onUpdate: (id: string, patch: Partial<PreviewResultFields>) => void;
  onReject: (id: string) => void;
  onReprocess: (item: ReviewItem) => void;
}) {
  const [open, setOpen] = useState(item.status !== "ok" && !item.rejected);
  const fields: PreviewResultFields = { ...item.fields, ...item.edited };
  const anttType = item.documento_antt_tipo ?? (item.extraction_raw?.documento_antt_tipo as string | undefined);
  const missing = missingFields(fields, anttType);
  const anttRaw = item.extraction_raw?.antt as Record<string, unknown> | undefined;
  const warnings = item.warnings ?? (item.extraction_raw?.warnings as string[] | undefined) ?? [];
  const detectedDirectors = [
    ...new Set([
      ...(fields.diretores_detectados ?? []),
      ...fields.nomes_votacao,
      ...(fields.relator ? fields.relator.split(",").map((name) => name.trim()).filter(Boolean) : []),
    ]),
  ];

  function set<K extends keyof PreviewResultFields>(k: K, v: PreviewResultFields[K]) {
    onUpdate(item.id, { [k]: v } as Partial<PreviewResultFields>);
  }

  function updateVotoSugerido(index: number, tipoVoto: "Favoravel" | "Desfavoravel" | "Abstencao" | "Ausente") {
    const votos = [...(fields.votos_sugeridos ?? [])];
    if (!votos[index]) return;
    votos[index] = {
      ...votos[index],
      tipo_voto: tipoVoto,
      origem: tipoVoto === "Ausente"
        ? "ausente"
        : tipoVoto === "Abstencao"
          ? "abstencao"
          : tipoVoto === "Desfavoravel"
            ? "contrario"
            : votos[index].is_nominal
              ? "nominal"
              : "inferido_mandato",
    };
    set("votos_sugeridos", votos);
  }

  const conf = item.confidence;

  return (
    <div
      className={cn(
        "border rounded-card transition-all",
        item.rejected
          ? "border-border opacity-50"
          : item.is_duplicate
          ? "border-warning/40"
          : "border-border hover:border-brand/30"
      )}
    >
      {/* Header */}
      <div
        className="flex items-center gap-2 px-4 py-3 cursor-pointer select-none flex-wrap"
        onClick={() => setOpen((o) => !o)}
      >
        {open ? (
          <ChevronDown className="w-4 h-4 shrink-0 text-text-label" />
        ) : (
          <ChevronRight className="w-4 h-4 shrink-0 text-text-label" />
        )}

        <FileText className="w-4 h-4 shrink-0 text-text-label" />
        <span className="flex-1 text-sm text-text-primary font-medium truncate min-w-0">
          {item.source_archive ? `${item.source_archive} / ${item.filename}` : item.filename}
        </span>

        {/* Badge duplicado */}
        {item.is_duplicate && (
          <span
            className="badge bg-warning/15 text-warning text-xs flex items-center gap-1"
            title={item.duplicate_reason ?? "Arquivo já processado"}
          >
            <Copy className="w-3 h-3" /> Duplicata
          </span>
        )}

        {/* Agência detectada */}
        {item.agencia_sigla_detected && (
          <span className="badge badge-green text-xs">{item.agencia_sigla_detected}</span>
        )}

        {anttType && (
          <span className="badge bg-warning/15 text-warning text-xs uppercase">
            ANTT {formatAnttTypeLabel(anttType)}
          </span>
        )}

        {/* Tipo de documento */}
        {fields.tipo_documento && fields.tipo_documento !== "deliberacao" && (
          <span className="badge bg-brand/15 text-brand text-xs uppercase">
            {fields.tipo_documento}
          </span>
        )}

        {/* Items de ata extraídos */}
        {(item as any).ata_items?.length > 0 && (
          <span className="badge bg-brand/15 text-brand text-xs">
            {(item as any).ata_items.length} processos
          </span>
        )}

        {/* Badge de confiança */}
        <span className={cn("badge text-xs font-mono px-2 py-0.5", confidenceColor(conf))}>
          {fmt(conf)} · {confidenceLabel(conf)}
        </span>

        {/* Resultado */}
        {fields.resultado && (
          <span className="badge badge-gray text-xs hidden sm:inline-flex">{fields.resultado}</span>
        )}

        {/* Botão rejeitar/restaurar */}
        <button
          onClick={(e) => { e.stopPropagation(); onReject(item.id); }}
          className={cn(
            "ml-1 px-2 py-1 rounded text-xs font-medium transition-colors shrink-0",
            item.rejected
              ? "bg-bg-hover text-text-secondary hover:text-text-primary"
              : "text-error hover:bg-error/10"
          )}
        >
          {item.rejected ? "Restaurar" : "Rejeitar"}
        </button>
      </div>

      {/* Formulário expandido */}
      {open && !item.rejected && (
        <div className="px-4 pb-4 border-t border-border space-y-4 pt-4">
          {["queued", "processing"].includes(item.documento_status ?? "") && (
            <div className="flex items-start gap-2 p-3 rounded-md bg-brand/10 border border-brand/20 text-sm text-brand">
              <Loader2 className="w-4 h-4 shrink-0 mt-0.5 animate-spin" />
              Este PDF está na fila ou em processamento. Clique em &quot;Processar pendentes&quot; para atualizar a análise.
            </div>
          )}

          {item.status === "error" && item.error && (
            <div className="flex items-start justify-between gap-3 p-3 rounded-md bg-error/10 border border-error/20 text-sm text-error">
              <div className="flex items-start gap-2">
                <XCircle className="w-4 h-4 shrink-0 mt-0.5" />
                <span>{item.error}</span>
              </div>
              {item.documento_id && (
                <button
                  onClick={() => onReprocess(item)}
                  className="btn-secondary text-xs shrink-0"
                >
                  <RefreshCw className="w-3.5 h-3.5" />
                  Reprocessar
                </button>
              )}
            </div>
          )}

          {item.is_duplicate && (
            <div className="flex items-start gap-2 p-3 rounded-md bg-warning/10 border border-warning/20 text-sm text-warning">
              <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
              <span>
                <strong>Duplicata detectada:</strong>{" "}
                {item.duplicate_reason ?? "Este PDF já foi processado anteriormente."}{" "}
                Confirme mesmo assim ou clique em &quot;Rejeitar&quot;.
              </span>
            </div>
          )}

          {warnings.length > 0 && (
            <div className="flex items-start gap-2 p-3 rounded-md bg-warning/10 border border-warning/20 text-sm text-warning">
              <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
              <div>
                <strong>Revisão ANTT necessária:</strong>
                <ul className="list-disc pl-4 mt-1 space-y-0.5">
                  {warnings.map((warning) => (
                    <li key={warning}>{warning}</li>
                  ))}
                </ul>
              </div>
            </div>
          )}

          {item.import_counts_as_final === false && (
            <div className="flex items-start gap-2 p-3 rounded-md bg-brand/10 border border-brand/20 text-sm text-brand">
              <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
              <span>
                Documento de apoio: sera salvo para contexto/dossie, mas nao deve alimentar dashboards como decisao final.
              </span>
            </div>
          )}

          <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
            <div className="rounded-md bg-surface-secondary p-3">
              <p className="text-xs text-text-label font-mono uppercase tracking-wider">QA extração</p>
              <p className={cn("text-sm mt-1", missing.length ? "text-warning" : "text-success")}>
                {missing.length ? `Revisar: ${missing.join(", ")}` : "Campos essenciais completos"}
              </p>
            </div>
            <div className="rounded-md bg-surface-secondary p-3">
              <p className="text-xs text-text-label font-mono uppercase tracking-wider">Agência</p>
              <p className="text-sm text-text-secondary mt-1">
                {item.agencia_sigla_detected ?? "Não detectada"}
              </p>
            </div>
            <div className="rounded-md bg-surface-secondary p-3">
              <p className="text-xs text-text-label font-mono uppercase tracking-wider">Documento</p>
              <p className="text-sm text-text-secondary mt-1">
                {fields.tipo_documento} · {item.chars_per_page > 0 ? `${item.chars_per_page.toLocaleString("pt-BR")} chars/pág` : "sem texto"}
              </p>
            </div>
          </div>

          <div className="grid grid-cols-1 xl:grid-cols-[minmax(280px,1fr)_minmax(280px,1fr)_minmax(260px,0.8fr)] gap-3">
            <div className="rounded-md border border-border bg-surface-secondary overflow-hidden min-h-[320px]">
              <div className="px-3 py-2 border-b border-border text-xs text-text-label font-mono uppercase tracking-wider">
                PDF original
              </div>
              {item.signed_url ? (
                <iframe
                  src={item.signed_url}
                  title={`PDF ${item.filename}`}
                  className="w-full h-[320px] bg-white"
                />
              ) : (
                <div className="h-[320px] flex items-center justify-center text-sm text-text-muted px-4 text-center">
                  PDF indisponivel para preview. O arquivo segue salvo no Storage.
                </div>
              )}
            </div>

            <div className="rounded-md border border-border bg-surface-secondary overflow-hidden min-h-[320px]">
              <div className="px-3 py-2 border-b border-border text-xs text-text-label font-mono uppercase tracking-wider">
                Texto extraido
              </div>
              <pre className="h-[320px] overflow-auto whitespace-pre-wrap p-3 text-xs leading-relaxed text-text-secondary">
                {item.texto_extraido || String(item.extraction_raw?.raw_text ?? "") || "Texto ainda nao disponivel."}
              </pre>
            </div>

            <div className="rounded-md border border-border bg-surface-secondary overflow-hidden min-h-[320px]">
              <div className="px-3 py-2 border-b border-border text-xs text-text-label font-mono uppercase tracking-wider">
                Campos detectados
              </div>
              <dl className="p-3 space-y-2 text-xs">
                <div>
                  <dt className="text-text-label">Agencia</dt>
                  <dd className="text-text-primary">{item.agencia_sigla_detected ?? "Nao detectada"}</dd>
                </div>
                <div>
                  <dt className="text-text-label">Tipo</dt>
                  <dd className="text-text-primary">{fields.tipo_documento}</dd>
                </div>
                <div>
                  <dt className="text-text-label">Processo</dt>
                  <dd className="text-text-primary break-words">{fields.processo ?? "-"}</dd>
                </div>
                <div>
                  <dt className="text-text-label">Relator / diretor</dt>
                  <dd className="text-text-primary break-words">{fields.relator ?? "-"}</dd>
                </div>
                <div>
                  <dt className="text-text-label">Resultado</dt>
                  <dd className="text-text-primary">{fields.resultado ?? "-"}</dd>
                </div>
                <div>
                  <dt className="text-text-label">Confianca</dt>
                  <dd className="text-text-primary">{fmt(conf)} - {confidenceLabel(conf)}</dd>
                </div>
              </dl>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div className="space-y-1">
              <label className="text-xs text-text-label font-mono uppercase tracking-wider">Nº Deliberação</label>
              <input
                className="input"
                value={fields.numero_deliberacao ?? ""}
                onChange={(e) => set("numero_deliberacao", e.target.value || null)}
                placeholder="ex: 02"
              />
            </div>

            <div className="space-y-1">
              <label className="text-xs text-text-label font-mono uppercase tracking-wider">Reunião</label>
              <input
                className="input"
                value={fields.reuniao_ordinaria ?? ""}
                onChange={(e) => set("reuniao_ordinaria", e.target.value || null)}
                placeholder="ex: 230ª Reunião Extraordinária"
              />
            </div>

            <div className="space-y-1">
              <label className="text-xs text-text-label font-mono uppercase tracking-wider">Data da Reunião</label>
              <input
                type="date"
                className="input"
                value={fields.data_reuniao ?? ""}
                onChange={(e) => set("data_reuniao", e.target.value || null)}
              />
            </div>

            <div className="space-y-1">
              <label className="text-xs text-text-label font-mono uppercase tracking-wider">Data de Publicação</label>
              <input
                type="date"
                className="input"
                value={fields.data_publicacao ?? ""}
                onChange={(e) => set("data_publicacao", e.target.value || null)}
              />
            </div>

            <div className="space-y-1">
              <label className="text-xs text-text-label font-mono uppercase tracking-wider">Processo</label>
              <input
                className="input"
                value={fields.processo ?? ""}
                onChange={(e) => set("processo", e.target.value || null)}
                placeholder="ex: SEI! nº 001.0036/2024-51"
              />
            </div>

            <div className="space-y-1">
              <label className="text-xs text-text-label font-mono uppercase tracking-wider">Relator / diretor</label>
              <textarea
                className="input min-h-[74px] resize-y"
                value={fields.relator ?? ""}
                onChange={(e) => set("relator", e.target.value || null)}
                placeholder="ex: Mauro Henrique Moreira Sousa, Caio Mario Trivellato Seabra Filho"
              />
              {fields.tipo_documento === "pauta" && detectedDirectors.length > 0 && (
                <p className="text-[11px] text-text-label">
                  Pauta: nomes detectados como relatoria/autoria do item, ainda nao como voto nominal confirmado.
                </p>
              )}
            </div>

            <div className="space-y-1">
              <label className="text-xs text-text-label font-mono uppercase tracking-wider">Item</label>
              <input
                className="input"
                value={fields.item_numero ?? ""}
                onChange={(e) => set("item_numero", e.target.value || null)}
                placeholder="ex: 1.1"
              />
            </div>

            <div className="space-y-1 md:col-span-2">
              <label className="text-xs text-text-label font-mono uppercase tracking-wider">Interessado</label>
              <input
                className="input"
                value={fields.interessado ?? ""}
                onChange={(e) => set("interessado", e.target.value || null)}
                placeholder="ex: Empresa XYZ Ltda."
              />
            </div>

            <div className="space-y-1 md:col-span-2">
              <label className="text-xs text-text-label font-mono uppercase tracking-wider">Assunto</label>
              <input
                className="input"
                value={fields.assunto ?? ""}
                onChange={(e) => set("assunto", e.target.value || null)}
                placeholder="ex: Ratificação de Termo Aditivo..."
              />
            </div>

            <div className="space-y-1">
              <label className="text-xs text-text-label font-mono uppercase tracking-wider">Resultado</label>
              <select
                className="input"
                value={fields.resultado ?? ""}
                onChange={(e) =>
                  set("resultado", (e.target.value as PreviewResultFields["resultado"]) || null)
                }
              >
                <option value="">— não classificado —</option>
                {RESULTADOS.map((r) => (
                  <option key={r} value={r}>{r}</option>
                ))}
              </select>
            </div>

            <div className="space-y-1">
              <label className="text-xs text-text-label font-mono uppercase tracking-wider">Microtema</label>
              <select
                className="input"
                value={fields.microtema}
                onChange={(e) => set("microtema", e.target.value)}
              >
                {MICROTEMAS.map((m) => (
                  <option key={m} value={m}>{m}</option>
                ))}
              </select>
            </div>

            <div className="space-y-1">
              <label className="text-xs text-text-label font-mono uppercase tracking-wider">Área regulatória</label>
              <select
                className="input"
                value={fields.area_regulatoria ?? "outros"}
                onChange={(e) => set("area_regulatoria", e.target.value)}
              >
                {AREAS_REGULATORIAS.map((area) => (
                  <option key={area} value={area}>{getAreaRegulatoriaLabel(area)}</option>
                ))}
              </select>
            </div>

            <div className="space-y-1 md:col-span-2">
              <label className="flex items-center gap-2 cursor-pointer mt-1">
                <input
                  type="checkbox"
                  checked={fields.pauta_interna}
                  onChange={(e) => set("pauta_interna", e.target.checked)}
                  className="w-4 h-4 accent-brand"
                />
                <span className="text-sm text-text-secondary">Pauta interna / administrativa</span>
              </label>
            </div>
          </div>

          {/* Métricas somente-leitura */}
          <div className="grid grid-cols-3 gap-3 pt-2 border-t border-border">
            <div>
              <p className="text-xs text-text-label font-mono uppercase tracking-wider mb-1">Páginas</p>
              <p className="text-sm text-text-secondary font-mono">
                {item.page_count > 0 ? item.page_count : "—"}
              </p>
            </div>
            <div>
              <p className="text-xs text-text-label font-mono uppercase tracking-wider mb-1">Chars/pág</p>
              <p className="text-sm text-text-secondary font-mono">
                {item.chars_per_page > 0 ? item.chars_per_page.toLocaleString("pt-BR") : "—"}
              </p>
            </div>
            <div>
              <p className="text-xs text-text-label font-mono uppercase tracking-wider mb-1">Confiança IA</p>
              <p className={cn("text-sm font-mono font-medium", confidenceColor(conf))}>{fmt(conf)}</p>
            </div>
          </div>

          {anttType && (
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3 pt-2 border-t border-border">
              <div>
                <p className="text-xs text-text-label font-mono uppercase tracking-wider mb-1">Tipo ANTT</p>
                <p className="text-sm text-text-secondary">{formatAnttTypeLabel(anttType)}</p>
              </div>
              <div>
                <p className="text-xs text-text-label font-mono uppercase tracking-wider mb-1">
                  {anttType === "voto_individual" ? "Autor do voto" : "Relator"}
                </p>
                <p className="text-sm text-text-secondary">
                  {String(anttRaw?.diretor_autor_voto ?? fields.relator ?? "não identificado")}
                </p>
              </div>
              <div>
                <p className="text-xs text-text-label font-mono uppercase tracking-wider mb-1">Chave revisável</p>
                <p className="text-xs text-text-secondary font-mono truncate" title={item.semantic_duplicate_key ?? undefined}>
                  {item.semantic_duplicate_key ?? "sem chave"}
                </p>
              </div>
            </div>
          )}

          {/* Diretores detectados */}
          {detectedDirectors.length > 0 && (
            <div className="pt-2 border-t border-border">
              <p className="text-xs text-text-label font-mono uppercase tracking-wider mb-2">
                Diretores detectados
              </p>
              <div className="flex flex-wrap gap-1.5">
                {detectedDirectors.map((nome, i) => (
                  <span key={i} className="badge badge-gray text-xs">{nome}</span>
                ))}
              </div>
      {fields.nomes_votacao.length > 0 && (
                <p className="mt-2 text-[11px] text-text-label">
                  Votos nominais usados para a base historica: {fields.nomes_votacao.join(", ")}.
                </p>
              )}
            </div>
          )}

          {fields.votos_sugeridos && fields.votos_sugeridos.length > 0 && (
            <div className="pt-2 border-t border-border">
              <p className="text-xs text-text-label font-mono uppercase tracking-wider mb-2">
                Votos sugeridos
              </p>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                {fields.votos_sugeridos.map((voto, i) => (
                  <div key={`${voto.diretor_id ?? voto.nome}-${i}`} className="flex items-center justify-between gap-2 rounded bg-surface-secondary px-2 py-1.5 text-xs">
                    <span className="text-text-secondary truncate">{voto.nome}</span>
                    <div className="flex gap-1 shrink-0">
                      <select
                        className="input h-7 py-0 px-2 text-[11px]"
                        value={voto.tipo_voto}
                        onChange={(event) => updateVotoSugerido(i, event.target.value as "Favoravel" | "Desfavoravel" | "Abstencao" | "Ausente")}
                      >
                        <option value="Favoravel">Favoravel</option>
                        <option value="Desfavoravel">Desfavoravel</option>
                        <option value="Abstencao">Abstenção</option>
                        <option value="Ausente">Ausente</option>
                      </select>
                      <span className="badge badge-gray text-[10px]">
                        {voto.is_nominal ? "nominal" : "inferido"}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Items de ata (ANM e similares) */}
          {(item as any).ata_items?.length > 0 && (
            <div className="pt-2 border-t border-border">
              <p className="text-xs text-text-label font-mono uppercase tracking-wider mb-2">
                Processos extraídos ({(item as any).ata_items.length})
              </p>
              <div className="space-y-1.5 max-h-60 overflow-y-auto">
                {((item as any).ata_items as Array<{
                  item_numero: string; processo: string | null;
                  assunto: string | null; interessado: string | null;
                  relator: string | null; resultado: string | null;
                  decisao?: string | null; microtema: string; area_regulatoria?: string;
                  votos_detectados?: string[]; unanimidade_detectada?: boolean;
                  votos_sugeridos?: PreviewResultFields["votos_sugeridos"];
                }>).map((ai, i) => (
                  <div key={i} className="flex items-start gap-2 text-xs p-1.5 rounded bg-surface-secondary">
                    <span className="font-mono text-brand shrink-0 w-8">{ai.item_numero}</span>
                    <div className="flex-1 min-w-0">
                      {ai.processo && <span className="font-mono text-text-label">{ai.processo}</span>}
                      {ai.assunto && <span className="block text-text-primary truncate">{ai.assunto}</span>}
                      {ai.interessado && <span className="block text-text-label truncate">{ai.interessado}</span>}
                      {ai.relator && <span className="block text-text-label truncate">Relator: {ai.relator}</span>}
                      {ai.decisao && <span className="block text-text-label truncate">Decisão: {ai.decisao}</span>}
                      {ai.votos_detectados && ai.votos_detectados.length > 0 && (
                        <span className="block text-text-label truncate">
                          Votos detectados: {ai.votos_detectados.join(", ")}
                        </span>
                      )}
                      {ai.votos_sugeridos && ai.votos_sugeridos.length > 0 && (
                        <span className="block text-text-label truncate">
                          Votos sugeridos: {ai.votos_sugeridos.length}
                        </span>
                      )}
                    </div>
                    <div className="flex gap-1 shrink-0">
                      {ai.unanimidade_detectada && <span className="badge badge-green text-[10px]">unanimidade</span>}
                      {ai.resultado && <span className="badge badge-gray text-[10px]">{ai.resultado}</span>}
                      <span className="badge badge-gray text-[10px]">{ai.microtema}</span>
                      <span className="badge badge-gray text-[10px]">{getAreaRegulatoriaLabel(ai.area_regulatoria)}</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Página principal ─────────────────────────────────────────────────────

export default function UploadPage() {
  const { demoEnabled } = useDataSyncContext();
  const queryClient = useQueryClient();
  const [stage, setStage] = useState<Stage>("queue");
  const [queue, setQueue] = useState<QueuedFile[]>([]);
  const [agenciaId, setAgenciaId] = useState<string>("");
  const [reviewItems, setReviewItems] = useState<ReviewItem[]>([]);
  const [analyzeProgress, setAnalyzeProgress] = useState<AnalyzeProgress>({ done: 0, total: 0 });
  const [currentBatchFile, setCurrentBatchFile] = useState<string | null>(null);
  const [analyzeError, setAnalyzeError] = useState<string | null>(null);
  const [confirmResults, setConfirmResults] = useState<BatchConfirmResponse | null>(null);
  const [clearQueueLoading, setClearQueueLoading] = useState(false);

  const { data: agencias } = useQuery({
    queryKey: ["agencias"],
    queryFn: () => api.get<Agencia[]>("/agencias"),
  });

  // ── Etapa 1: Dropzone → fila ─────────────────────────────────────────
  const onDrop = useCallback((acceptedFiles: File[]) => {
    if (!acceptedFiles.length) return;
    setQueue((prev) => [
      ...prev,
      ...acceptedFiles.map((file) => ({
        id: crypto.randomUUID(),
        file,
        status: "pending" as const,
      })),
    ]);
  }, []);

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: {
      "application/pdf": [".pdf"],
      "application/zip": [".zip"],
      "application/x-zip-compressed": [".zip"],
    },
    maxFiles: 500,
    maxSize: 157_286_400,
    disabled: stage !== "queue",
  });

  function removeFromQueue(id: string) {
    setQueue((prev) => prev.filter((f) => f.id !== id));
  }

  function resetAll() {
    setStage("queue");
    setQueue([]);
    setAgenciaId("");
    setReviewItems([]);
    setAnalyzeError(null);
    setConfirmResults(null);
    setAnalyzeProgress({ done: 0, total: 0 });
    setCurrentBatchFile(null);
  }

  async function handleClearTestQueue() {
    const ok = window.confirm("Limpar apenas a fila de testes? Deliberações já confirmadas serão preservadas.");
    if (!ok) return;
    setClearQueueLoading(true);
    setAnalyzeError(null);
    try {
      await api.post("/upload/clear-test-queue", { confirm: "LIMPAR FILA DE TESTES" });
      resetAll();
      for (const key of [["deliberacoes"], ["dashboard"], ["diretores"], ["votacao"], ["monitoramento"], ["empresas"]]) {
        queryClient.invalidateQueries({ queryKey: key });
      }
    } catch (err) {
      setAnalyzeError(err instanceof Error ? err.message : "Erro ao limpar fila de testes");
    } finally {
      setClearQueueLoading(false);
    }
  }

  // ── Etapa 2: Análise em lotes de BATCH_SIZE ──────────────────────────
  async function handleAnalyze() {
    if (!queue.length) return;
    setStage("analyzing");
    setAnalyzeError(null);

    const allFiles = [...queue];
    const allResults: PreviewResult[] = [];
    setAnalyzeProgress({ done: 0, total: allFiles.length });
    setQueue((prev) => prev.map((f) => ({ ...f, status: "analyzing" })));

    try {
      for (let i = 0; i < allFiles.length; i += BATCH_SIZE) {
        const batch = allFiles.slice(i, i + BATCH_SIZE);
        const batchBytes = batch.reduce((sum, qf) => sum + qf.file.size, 0);
        if (batchBytes > PREVIEW_MAX_TOTAL_SIZE) {
          allResults.push(...batch.map((qf) => ({
            ...errorPreviewResult(qf.file.name),
            error: `Arquivo/lote excede ${fmtSize(PREVIEW_MAX_TOTAL_SIZE)} (${fmtSize(batchBytes)}).`,
          })));
          setQueue((prev) => prev.map((f) => batch.some((b) => b.id === f.id) ? { ...f, status: "error" } : f));
          setAnalyzeProgress({ done: Math.min(i + batch.length, allFiles.length), total: allFiles.length });
          continue;
        }
        // Mostra o nome do primeiro arquivo do lote como indicador de progresso
        setCurrentBatchFile(batch[0]?.file.name ?? null);

        const formData = new FormData();
        batch.forEach((qf) => formData.append("files", qf.file));

        try {
          const res = await api.upload<BatchPreviewResponse>("/upload/preview", formData);
          allResults.push(...res.results);

          setAnalyzeProgress({ done: i + batch.length, total: allFiles.length });
          setQueue((prev) =>
            prev.map((f) => {
              const batchIdx = batch.findIndex((b) => b.id === f.id);
              if (batchIdx === -1) return f;
              const hasError = res.results.length > 0 && res.results.every((r) => r.status === "error");
              return { ...f, status: hasError ? "error" : "done" };
            })
          );
        } catch (err) {
          const message = err instanceof Error ? err.message : "Erro ao analisar arquivo";
          allResults.push(...batch.map((qf) => ({ ...errorPreviewResult(qf.file.name), error: message })));
          setQueue((prev) => prev.map((f) => batch.some((b) => b.id === f.id) ? { ...f, status: "error" } : f));
          setAnalyzeProgress({ done: Math.min(i + batch.length, allFiles.length), total: allFiles.length });
        }
      }
      setCurrentBatchFile(null);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Erro ao analisar PDFs";
      setAnalyzeError(msg);
      setQueue((prev) =>
        prev.map((f) => ({ ...f, status: f.status === "analyzing" ? "error" : f.status }))
      );
      setStage("queue");
      return;
    }

    // ── Dedup client-side: hash de sessão + número já salvo em local ────────
    const dedupReasons: (string | undefined)[] = new Array(allResults.length);
    try {
      const localNumbers = demoEnabled ? new Set<string>(
        getLocalDelibs()
          .map((d) => d.numero_deliberacao)
          .filter((n): n is string => !!n)
      ) : new Set<string>();
      const batchHashes = new Set<string>();
      const batchNumbers = new Set<string>();

      for (let i = 0; i < allResults.length; i++) {
        const r = allResults[i];
        if (r.is_duplicate) { dedupReasons[i] = r.duplicate_reason ?? "Ja processado ou duplicado"; continue; }
        const hash = r.file_hash ?? "";
        const agenciaKey = r.agencia_id_detected ?? "sem-agencia";
        const semantic = typeof r.semantic_duplicate_key === "string" ? r.semantic_duplicate_key : "";
        const num = semantic || (r.fields?.numero_deliberacao
          ? `${agenciaKey}:${r.fields.numero_deliberacao}`
          : "");
        if      (num  && localNumbers.has(num))  dedupReasons[i] = `Nº ${num} já existe na base local`;
        else if (hash && batchHashes.has(hash))  dedupReasons[i] = "Arquivo duplicado neste lote";
        else if (num  && batchNumbers.has(num))  dedupReasons[i] = `Nº ${num} duplicado neste lote`;
        if (hash) batchHashes.add(hash);
        if (num)  batchNumbers.add(num);
      }
    } catch { /* não crítico */ }

    // Auto-seleciona agência majoritária detectada (só se usuário não selecionou)
    const detectedSiglas = allResults
      .map((r) => r.agencia_sigla_detected)
      .filter(Boolean) as string[];
    const majority = mostCommon(detectedSiglas);
    if (majority && !agenciaId) {
      const matched = (agencias ?? []).find((a) => a.sigla === majority);
      if (matched) setAgenciaId(matched.id);
    }

    // Monta review: duplicados auto-rejeitados mas restauráveis
    setReviewItems(
      allResults.map((r, i) => {
        const isDup = r.is_duplicate || !!dedupReasons[i];
        return {
          ...r,
          id: `${r.file_hash || r.filename}-${i}`,
          is_duplicate: isDup,
          rejected: isDup,
          duplicate_reason: dedupReasons[i] ?? r.duplicate_reason,
          edited: {},
        };
      })
    );
    setAnalyzeProgress({ done: allFiles.length, total: allFiles.length });
    setStage("review");
  }

  // ── Etapa 3: Revisão ─────────────────────────────────────────────────
  async function handleAsyncAnalyze() {
    if (!queue.length) return;
    setStage("analyzing");
    setAnalyzeError(null);

    const allFiles = [...queue];
    setAnalyzeProgress({ done: 0, total: allFiles.length });
    setQueue((prev) => prev.map((f) => ({ ...f, status: "analyzing" })));

    try {
      const chunks = chunkQueuedFiles(allFiles);
      const enqueueResults: BatchUploadResponse["results"] = [];
      let uploadedCount = 0;

      for (let index = 0; index < chunks.length; index++) {
        const chunk = chunks[index];
        const chunkBytes = chunk.reduce((sum, qf) => sum + qf.file.size, 0);
        if (chunkBytes > PREVIEW_MAX_TOTAL_SIZE) {
          enqueueResults.push(...chunk.map((qf) => ({
            filename: qf.file.name,
            job_id: null,
            document_id: null,
            status: "rejected" as const,
            message: `Arquivo/lote excede ${fmtSize(PREVIEW_MAX_TOTAL_SIZE)} (${fmtSize(chunkBytes)}).`,
          })));
          uploadedCount += chunk.length;
          setAnalyzeProgress({ done: uploadedCount, total: allFiles.length });
          continue;
        }

        const formData = new FormData();
        if (agenciaId) formData.append("agencia_id", agenciaId);
        chunk.forEach((qf) => formData.append("files", qf.file));
        setCurrentBatchFile(`Salvando sublote ${index + 1}/${chunks.length} no Storage...`);

        const enqueue = await api.upload<BatchUploadResponse>("/upload/batch", formData);
        enqueueResults.push(...enqueue.results);
        uploadedCount += chunk.length;
        setAnalyzeProgress({ done: uploadedCount, total: allFiles.length });
      }

      const enqueue = { results: enqueueResults };
      const documentIds = enqueue.results
        .map((result) => result.document_id)
        .filter((id): id is string => Boolean(id));
      const duplicateDocumentIds = new Set(
        enqueue.results
          .filter((result) => result.status === "duplicate_confirmed" && result.document_id)
          .map((result) => result.document_id as string)
      );
      const rejectedItems: ReviewItem[] = enqueue.results
        .filter((result) => !result.document_id && result.status !== "queued")
        .map((result, index) => ({
          ...errorPreviewResult(result.filename),
          id: `rejected-${index}-${result.filename}`,
          error: result.message ?? "Documento rejeitado",
          rejected: true,
          edited: {},
        }));

      if (documentIds.length === 0) {
        setReviewItems(rejectedItems);
        setAnalyzeProgress({ done: rejectedItems.length, total: rejectedItems.length });
        setStage("review");
        return;
      }

      let docs: DocumentoRegulatorio[] = [];
      const maxAttempts = 6;
      for (let attempt = 0; attempt < maxAttempts; attempt++) {
        setCurrentBatchFile(attempt === 0
          ? "Processando primeira fatia da fila..."
          : `Atualizando status da fila (${attempt + 1}/${maxAttempts})...`);
        if (attempt === 0) {
          await api.post<{ processed: number; job_ids: string[] }>("/upload/process?limit=8");
        }
        const docsRes = await api.get<DocumentoRegulatorioListResponse>(
          `/upload/documentos?ids=${encodeURIComponent(documentIds.join(","))}&limit=500`
        );
        docs = docsRes.data;
        const terminal = docs.filter((doc) =>
          ["review_pending", "failed", "confirmed", "ignored"].includes(doc.status)
        ).length;
        setAnalyzeProgress({ done: terminal + rejectedItems.length, total: documentIds.length + rejectedItems.length });
        setQueue((prev) => prev.map((qf) => {
          const matched = docs.find((doc) => doc.filename === qf.file.name);
          if (!matched) return qf;
          if (matched.status === "failed") return { ...qf, status: "error" };
          if (["review_pending", "confirmed", "ignored"].includes(matched.status)) return { ...qf, status: "done" };
          return { ...qf, status: "analyzing" };
        }));
        if (terminal >= documentIds.length) break;
        await sleep(1500);
      }

      const reviewFromDocs = docs.map((doc, index) => {
        const item = documentToReviewItem(doc, index);
        if (duplicateDocumentIds.has(doc.id)) {
          item.is_duplicate = true;
          item.rejected = true;
          item.duplicate_reason = item.duplicate_reason ?? "PDF ja consolidado no sistema";
        }
        return item;
      });
      const detectedSiglas = reviewFromDocs
        .map((r) => r.agencia_sigla_detected)
        .filter(Boolean) as string[];
      const majority = mostCommon(detectedSiglas);
      if (majority && !agenciaId) {
        const matched = (agencias ?? []).find((a) => a.sigla === majority);
        if (matched) setAgenciaId(matched.id);
      }

      setReviewItems([...reviewFromDocs, ...rejectedItems]);
      setAnalyzeProgress({ done: documentIds.length + rejectedItems.length, total: documentIds.length + rejectedItems.length });
      setCurrentBatchFile(null);
      setStage("review");
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Erro ao enfileirar/processar PDFs";
      setAnalyzeError(msg);
      setQueue((prev) => prev.map((f) => ({ ...f, status: f.status === "analyzing" ? "error" : f.status })));
      setStage("queue");
    }
  }

  function updateReviewItem(id: string, patch: Partial<PreviewResultFields>) {
    setReviewItems((prev) =>
      prev.map((item) =>
        item.id === id ? { ...item, edited: { ...item.edited, ...patch } } : item
      )
    );
  }

  function toggleReject(id: string) {
    setReviewItems((prev) =>
      prev.map((item) => (item.id === id ? { ...item, rejected: !item.rejected } : item))
    );
  }

  async function handleReprocessItem(item: ReviewItem) {
    if (!item.documento_id) return;
    setAnalyzeError(null);
    setReviewItems((prev) => prev.map((current) =>
      current.id === item.id ? { ...current, status: "low_confidence", error: undefined, rejected: false } : current
    ));
    try {
      await api.post("/upload/reprocess", { ids: [item.documento_id] });
      for (let attempt = 0; attempt < 30; attempt++) {
        await api.post<{ processed: number; job_ids: string[] }>("/upload/process?limit=20");
        const docsRes = await api.get<DocumentoRegulatorioListResponse>(
          `/upload/documentos?ids=${encodeURIComponent(item.documento_id)}&limit=1`
        );
        const doc = docsRes.data[0];
        if (doc && ["review_pending", "failed", "confirmed", "ignored"].includes(doc.status)) {
          const next = documentToReviewItem(doc, 0);
          setReviewItems((prev) => prev.map((current) => current.id === item.id ? next : current));
          return;
        }
        await sleep(1500);
      }
    } catch (err) {
      setAnalyzeError(err instanceof Error ? err.message : "Erro ao reprocessar documento");
    }
  }

  async function handleProcessPendingReviewItems() {
    const documentIds = reviewItems
      .map((item) => item.documento_id)
      .filter((id): id is string => Boolean(id));
    if (documentIds.length === 0) return;
    setAnalyzeError(null);
    try {
      const failedIds = reviewItems
        .filter((item) => item.documento_id && ["failed", "ignored"].includes(item.documento_status ?? ""))
        .map((item) => item.documento_id as string);
      if (failedIds.length > 0) {
        await api.post("/upload/reprocess", { ids: failedIds });
      }
      await api.post<{ processed: number; job_ids: string[] }>("/upload/process?limit=8");
      const docsRes = await api.get<DocumentoRegulatorioListResponse>(
        `/upload/documentos?ids=${encodeURIComponent(documentIds.join(","))}&limit=500`
      );
      const docsById = new Map(docsRes.data.map((doc, index) => [doc.id, documentToReviewItem(doc, index)]));
      setReviewItems((prev) => prev.map((item) =>
        item.documento_id && docsById.has(item.documento_id) ? docsById.get(item.documento_id)! : item
      ));
    } catch (err) {
      setAnalyzeError(err instanceof Error ? err.message : "Erro ao processar pendentes");
    }
  }

  const isReadyForConfirmation = (item: ReviewItem) =>
    !item.documento_status || ["review_pending", "confirmed"].includes(item.documento_status);
  const activeItems = reviewItems.filter((r) => !r.rejected && r.status !== "error" && isReadyForConfirmation(r));
  const activeItemsWithoutAgency = activeItems.filter((item) => !item.agencia_id_detected && !agenciaId);

  // ── Etapa 4: Confirmar ───────────────────────────────────────────────
  async function handleConfirm() {
    if (!activeItems.length) return;
    setStage("confirming");

    const deliberacoes: ConfirmDelib[] = activeItems.map((item) => {
      const fields: PreviewResultFields = { ...item.fields, ...item.edited };
      return {
        filename: item.filename,
        documento_id: item.documento_id ?? null,
        upload_job_id: item.upload_job_id ?? null,
        agencia_id: item.agencia_id_detected || agenciaId || null,
        numero_deliberacao: fields.numero_deliberacao,
        numero_reuniao: fields.numero_reuniao,
        reuniao_ordinaria: fields.reuniao_ordinaria,
        tipo_reuniao: fields.tipo_reuniao,
        tipo_documento: fields.tipo_documento ?? "deliberacao",
        data_reuniao: fields.data_reuniao,
        data_publicacao: fields.data_publicacao,
        interessado: fields.interessado,
        assunto: fields.assunto,
        procedencia: fields.procedencia,
        relator: fields.relator ?? null,
        item_numero: fields.item_numero ?? null,
        processo: fields.processo,
        resultado: fields.resultado,
        decisoes_todas: fields.decisoes_todas ?? [],
        microtema: fields.microtema,
        area_regulatoria: fields.area_regulatoria ?? "outros",
        pauta_interna: fields.pauta_interna,
        resumo_pleito: fields.resumo_pleito,
        fundamento_decisao: fields.fundamento_decisao,
        nomes_votacao: fields.nomes_votacao,
        nomes_votacao_contra: fields.nomes_votacao_contra ?? [],
        nomes_votacao_abstencao: fields.nomes_votacao_abstencao ?? [],
        nomes_votacao_ausente: fields.nomes_votacao_ausente ?? [],
        votos_sugeridos: fields.votos_sugeridos ?? [],
        extraction_confidence: item.confidence,
        documento_antt_tipo: item.documento_antt_tipo ?? null,
        documento_subtipo: item.documento_subtipo ?? null,
        import_counts_as_final: item.import_counts_as_final !== false,
        semantic_duplicate_key: item.semantic_duplicate_key ?? null,
        warnings: item.warnings ?? [],
        extraction_raw: {
          ...(item.extraction_raw ?? {}),
          documento_antt_tipo: item.documento_antt_tipo ?? item.extraction_raw?.documento_antt_tipo,
          documento_subtipo: item.documento_subtipo ?? item.extraction_raw?.documento_subtipo,
          import_counts_as_final: item.import_counts_as_final !== false,
          semantic_duplicate_key: item.semantic_duplicate_key ?? item.extraction_raw?.semantic_duplicate_key,
          warnings: item.warnings ?? item.extraction_raw?.warnings,
          area_regulatoria: fields.area_regulatoria ?? item.extraction_raw?.area_regulatoria,
        },
        // Para atas: enviar items extraídos para split no backend
        ...((item as any).ata_items ? { ata_items: (item as any).ata_items } : {}),
      };
    });

    try {
      const formData = new FormData();
      formData.append("payload", JSON.stringify({ agencia_id: agenciaId, deliberacoes }));
      const res = await api.upload<BatchConfirmResponse>("/upload/confirm", formData);
      // Demo mode: persist returned deliberações in localStorage
      if (res.deliberacoes && res.deliberacoes.length > 0) {
        appendLocalDelibs(res.deliberacoes);
        // Sync updated localStorage to server so dashboards reflect new data
        try {
          await fetch("/api/v1/sync", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ deliberacoes: getLocalDelibs(), mode: "local" }),
          });
        } catch { /* sync non-critical */ }
      }
      // Invalida apenas os domínios afetados por um upload de deliberações.
      for (const key of [["deliberacoes"], ["dashboard"], ["diretores"], ["votacao"], ["monitoramento"], ["empresas"]]) {
        queryClient.invalidateQueries({ queryKey: key });
      }
      setConfirmResults(res);
      setStage("done");
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Erro ao confirmar deliberações";
      setAnalyzeError(msg);
      setStage("review");
    }
  }

  // ── Progresso de análise em % ─────────────────────────────────────────
  const progressPct =
    analyzeProgress.total > 0
      ? (analyzeProgress.done / analyzeProgress.total) * 100
      : 0;

  // ── Render ─────────────────────────────────────────────────────────────

  return (
    <div className="max-w-4xl mx-auto space-y-6 animate-fade-in">
      <ModuleTabs tabs={DELIBERACOES_TABS} />
      {/* Cabeçalho */}
      <div className="flex items-start justify-between">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-xl font-semibold text-text-primary">Upload de PDFs e ZIPs</h1>
            <HelpTooltip text="Envie PDFs ou ZIPs para extração assistida. O sistema separa deliberação, ata, pauta e voto antes da confirmação." />
          </div>
          <p className="text-sm text-text-muted mt-1">
            Arraste documentos → analise com IA → revise os campos → confirme no sistema.
          </p>
        </div>

        {/* Indicador de etapa */}
        <div className="flex items-center gap-2 text-xs font-mono text-text-label">
          {(["queue", "review", "done"] as Stage[]).map((s, i) => (
            <span key={s} className="flex items-center gap-2">
              {i > 0 && <span>›</span>}
              <span
                className={cn(
                  "px-2 py-0.5 rounded-full",
                  stage === s ||
                    (stage === "analyzing" && s === "queue") ||
                    (stage === "confirming" && s === "review")
                    ? "bg-brand/15 text-brand"
                    : "text-text-label"
                )}
              >
                {s === "queue" ? "1 Fila" : s === "review" ? "2 Revisão" : "3 Concluído"}
              </span>
            </span>
          ))}
        </div>
      </div>

      {demoEnabled && (
        <div className="border border-violet-400/30 bg-violet-500/10 rounded-card p-3 text-sm text-violet-200">
          Modo DEMO ativo: a analise de documentos funciona para teste, mas confirmacao e gravacao ficam bloqueadas.
        </div>
      )}
      {/* ── ETAPA 1 + 2: Fila e Análise ──────────────────────────────────── */}
      {(stage === "queue" || stage === "analyzing") && (
        <>
          {/* Seletor de agência */}
          <div className="card space-y-2">
            <label className="text-xs text-text-muted font-mono uppercase tracking-wider">
              Agência Reguladora
              {agenciaId && (
                <span className="ml-2 text-success normal-case tracking-normal font-sans">
                  ✓ auto-detectada
                </span>
              )}
            </label>
            <select
              className="input w-full"
              value={agenciaId}
              onChange={(e) => setAgenciaId(e.target.value)}
              disabled={stage === "analyzing"}
            >
              <option value="">Selecione a agência... (detectada automaticamente do PDF)</option>
              {(agencias ?? []).map((a) => (
                <option key={a.id} value={a.id}>
                  {a.sigla} — {a.nome}
                </option>
              ))}
            </select>
          </div>

          {/* Dropzone */}
          <div
            {...getRootProps()}
            className={cn(
              "border-2 border-dashed rounded-card p-12 text-center transition-all duration-200 cursor-pointer",
              isDragActive
                ? "border-brand bg-brand/5"
                : "border-border hover:border-brand/40 hover:bg-bg-card",
              stage === "analyzing" && "opacity-60 cursor-not-allowed"
            )}
          >
            <input {...getInputProps()} />
            <Upload
              className={cn("w-10 h-10 mx-auto mb-4", isDragActive ? "text-brand" : "text-text-label")}
            />
            {isDragActive ? (
              <p className="text-brand font-medium">Solte os PDFs ou ZIPs aqui</p>
            ) : stage === "analyzing" ? (
              <div className="space-y-3">
                <div className="flex items-center justify-center gap-2 text-text-secondary">
                  <Loader2 className="w-4 h-4 animate-spin text-brand" />
                  <span className="truncate max-w-xs">
                    {currentBatchFile
                      ? `Analisando: ${currentBatchFile}`
                      : "Analisando documentos..."}
                  </span>
                </div>
                <div className="w-full max-w-xs mx-auto bg-bg-hover rounded-full h-1.5">
                  <div
                    className="bg-brand h-1.5 rounded-full transition-all duration-500"
                    style={{ width: `${progressPct}%` }}
                  />
                </div>
                <p className="text-xs text-text-label font-mono">
                  {analyzeProgress.done} de {analyzeProgress.total} arquivo{analyzeProgress.total !== 1 ? "s" : ""}
                </p>
              </div>
            ) : (
              <>
                <p className="text-text-primary font-medium">
                  Arraste PDFs/ZIPs aqui ou{" "}
                  <span className="text-brand underline">clique para selecionar</span>
                </p>
                <p className="text-xs text-text-muted mt-2">
                  Até 500 PDFs/ZIPs na fila · max. 50 MB por PDF · análise arquivo a arquivo
                </p>
              </>
            )}
          </div>

          {/* Erro de análise */}
          {analyzeError && (
            <div className="flex items-start gap-3 p-4 rounded-md bg-error/10 border border-error/20">
              <XCircle className="w-4 h-4 text-error shrink-0 mt-0.5" />
              <p className="text-sm text-error">{analyzeError}</p>
            </div>
          )}

          {/* Lista da fila */}
          {queue.length > 0 && (
            <div className="card space-y-3">
              <div className="flex items-center justify-between">
                <p className="section-label">
                  Na fila — {queue.length} arquivo{queue.length !== 1 ? "s" : ""}
                  {stage === "analyzing" && (
                    <span className="ml-2 text-brand normal-case tracking-normal font-sans">
                      {analyzeProgress.done} de {analyzeProgress.total} concluídos...
                    </span>
                  )}
                </p>
                {stage === "queue" && (
                  <button
                    onClick={() => setQueue([])}
                    className="text-xs text-text-label hover:text-text-secondary transition-colors"
                  >
                    Limpar tudo
                  </button>
                )}
              </div>
              <div className="space-y-0.5 max-h-64 overflow-y-auto">
                {queue.map((qf) => (
                  <QueueRow key={qf.id} qf={qf} onRemove={removeFromQueue} />
                ))}
              </div>
            </div>
          )}

          {/* Botão Analisar */}
          {queue.length > 0 && stage === "queue" && (
            <div className="flex justify-end">
              <button
                onClick={handleClearTestQueue}
                disabled={clearQueueLoading || demoEnabled}
                className="btn-secondary mr-2"
              >
                {clearQueueLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}
                Limpar fila de testes
              </button>
              <button onClick={handleAsyncAnalyze} className="btn-primary">
                <Upload className="w-4 h-4" />
                Analisar {queue.length} arquivo{queue.length !== 1 ? "s" : ""}
              </button>
            </div>
          )}
        </>
      )}

      {/* ── ETAPA 3: Revisão ──────────────────────────────────────────────── */}
      {(stage === "review" || stage === "confirming") && (
        <>
          {/* Banner de resumo */}
          <div className="card">
            <div className="flex items-center justify-between flex-wrap gap-3">
              <div>
                <p className="text-sm text-text-primary font-medium">
                  {reviewItems.length} arquivo{reviewItems.length !== 1 ? "s" : ""} analisado{reviewItems.length !== 1 ? "s" : ""}
                </p>
                <p className="text-xs text-text-muted mt-0.5">
                  {reviewItems.filter((r) => r.confidence >= 0.8).length} alta confiança ·{" "}
                  {reviewItems.filter((r) => r.confidence >= 0.5 && r.confidence < 0.8).length} média ·{" "}
                  {reviewItems.filter((r) => r.confidence < 0.5 && r.status !== "error").length} baixa ·{" "}
                  {reviewItems.filter((r) => r.is_duplicate).length} duplicados ·{" "}
                  {reviewItems.filter((r) => r.status === "error").length} com erro
                </p>
                <p className="text-xs text-text-label mt-1">
                  {reviewItems.filter((r) => ["queued", "processing"].includes(r.documento_status ?? "")).length} na fila/processando ·{" "}
                  {reviewItems.filter((r) => r.documento_status === "review_pending").length} prontos para revisão ·{" "}
                  {reviewItems.filter((r) => r.documento_status === "failed").length} falharam
                </p>
              </div>
              <div className="flex items-center gap-3">
                <button
                  onClick={handleProcessPendingReviewItems}
                  disabled={stage === "confirming" || demoEnabled}
                  className="btn-secondary text-xs"
                >
                  <RefreshCw className="w-3.5 h-3.5" />
                  Processar pendentes
                </button>
                <button
                  onClick={resetAll}
                  disabled={stage === "confirming"}
                  className="btn-secondary text-xs"
                >
                  <RefreshCw className="w-3.5 h-3.5" />
                  Novo Upload
                </button>
                <button
                  onClick={handleClearTestQueue}
                  disabled={stage === "confirming" || clearQueueLoading || demoEnabled}
                  className="btn-secondary text-xs"
                >
                  {clearQueueLoading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Trash2 className="w-3.5 h-3.5" />}
                  Limpar fila
                </button>
                <button
                  onClick={handleConfirm}
                  disabled={activeItems.length === 0 || activeItemsWithoutAgency.length > 0 || stage === "confirming" || demoEnabled}
                  className="btn-primary"
                >
                  {stage === "confirming" ? (
                    <><Loader2 className="w-4 h-4 animate-spin" /> Confirmando...</>
                  ) : (
                    <><CheckCircle className="w-4 h-4" /> Confirmar {activeItems.length} documento{activeItems.length !== 1 ? "s" : ""}</>
                  )}
                </button>
              </div>
            </div>
          </div>

          {analyzeError && (
            <div className="flex items-start gap-3 p-4 rounded-md bg-error/10 border border-error/20">
              <XCircle className="w-4 h-4 text-error shrink-0 mt-0.5" />
              <p className="text-sm text-error">{analyzeError}</p>
            </div>
          )}

          {activeItemsWithoutAgency.length > 0 && (
            <div className="flex items-start gap-3 p-4 rounded-md bg-warning/10 border border-warning/20">
              <AlertTriangle className="w-4 h-4 text-warning shrink-0 mt-0.5" />
              <p className="text-sm text-warning">
                {activeItemsWithoutAgency.length} arquivo(s) sem agência detectada. Selecione uma agência reguladora para confirmar o lote.
              </p>
            </div>
          )}

          {/* Cards de revisão */}
          <div className="space-y-3">
            {reviewItems.map((item) => (
              <ReviewCard
                key={item.id}
                item={item}
                onUpdate={updateReviewItem}
                onReject={toggleReject}
                onReprocess={handleReprocessItem}
              />
            ))}
          </div>

          {/* Rodapé sticky */}
          {activeItems.length > 0 && (
            <div className="sticky bottom-4 flex justify-end pt-2">
              <button
                onClick={handleConfirm}
                disabled={stage === "confirming" || activeItemsWithoutAgency.length > 0 || demoEnabled}
                className="btn-primary shadow-lg"
              >
                {stage === "confirming" ? (
                  <><Loader2 className="w-4 h-4 animate-spin" /> Confirmando...</>
                ) : (
                  <><CheckCircle className="w-4 h-4" /> Confirmar {activeItems.length} documento{activeItems.length !== 1 ? "s" : ""} →</>
                )}
              </button>
            </div>
          )}
        </>
      )}

      {/* ── ETAPA 4: Concluído ─────────────────────────────────────────────── */}
      {stage === "done" && confirmResults && (
        <div className="card space-y-5">
          <div className="flex items-center gap-3">
            <CheckCircle className="w-6 h-6 text-success" />
            <div>
              <p className="text-text-primary font-semibold">
                {confirmResults.created} documento{confirmResults.created !== 1 ? "s criados" : " criado"}
              </p>
              {confirmResults.errors > 0 && (
                <p className="text-xs text-error mt-0.5">
                  {confirmResults.errors} falha{confirmResults.errors !== 1 ? "s" : ""} — veja abaixo
                </p>
              )}
              {confirmResults.deliberacoes && confirmResults.deliberacoes.length > 0 && (
                <p className="text-xs text-text-muted mt-0.5">
                  Salvo localmente — configure o Supabase para persistência permanente.
                </p>
              )}
            </div>
          </div>

          <div className="space-y-1.5 max-h-96 overflow-y-auto">
            {confirmResults.results.map((r, i) => (
              <div
                key={i}
                className="flex items-center gap-3 px-3 py-2 rounded-md hover:bg-bg-hover transition-colors"
              >
                {r.status === "created" || r.status === "document_saved" ? (
                  <CheckCircle className="w-4 h-4 shrink-0 text-success" />
                ) : (
                  <XCircle className="w-4 h-4 shrink-0 text-error" />
                )}
                <span className="flex-1 text-sm text-text-secondary truncate">{r.filename}</span>
                {r.status === "created" && r.deliberacao_id ? (
                  <a
                    href={`/dashboard/deliberacoes/${r.deliberacao_id}`}
                    className="text-xs text-brand hover:underline font-mono shrink-0"
                  >
                    Ver deliberação →
                  </a>
                ) : r.status === "document_saved" ? (
                  <span className="text-xs text-text-muted truncate max-w-[240px]" title={r.message}>
                    {r.message ?? "Documento de apoio salvo"}
                  </span>
                ) : r.error ? (
                  <span className="text-xs text-error truncate max-w-[200px]" title={r.error}>
                    {r.error}
                  </span>
                ) : null}
              </div>
            ))}
          </div>

          <div className="flex justify-end pt-2 border-t border-border">
            <button onClick={resetAll} className="btn-primary">
              <RefreshCw className="w-4 h-4" />
              Novo Upload
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
